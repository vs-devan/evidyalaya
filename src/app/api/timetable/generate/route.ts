import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { TimetableInput, DivisionInput } from '@/lib/timetable-engine';
import { solveTimetable, ScoreBreakdown } from '@/lib/timetable-solver';
import { repairTimetableGaps } from '@/lib/gemini';
import { compare } from 'bcryptjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ── SSE helpers ──────────────────────────────────────────────────────────────

type Phase =
  | 'init'
  | 'loading_data'
  | 'validating'
  | 'constraint_propagation'
  | 'annealing'
  | 'ai_repair'
  | 'saving'
  | 'done'
  | 'error';

interface ProgressEvent {
  phase: Phase;
  pct: number;        // 0–100
  label: string;      // human-readable step
  detail?: string;    // extra info
  errors?: HierarchicalIssue[];
  warnings?: HierarchicalIssue[];
  result?: any;       // only on 'done'
}

export interface HierarchicalIssue {
  severity: 'critical' | 'error' | 'warning' | 'info';
  code: string;
  message: string;
  affectedEntity?: string; // division / teacher / subject
  canContinue: boolean;    // if false, generation is blocked
}

function sseEvent(data: ProgressEvent): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SCHOOL_ADMIN' || !session.user.tenantId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403 });
  }

  const tenantId = session.user.tenantId;
  let activeConstraints: string[] = [];
  let peGroups: { subjectId: string; divisionIds: string[] }[] = [];
  let body: any = {};
  try {
    body = await req.json();
    activeConstraints = body.constraints || [];
    peGroups = Array.isArray(body.peGroups) ? body.peGroups : [];
  } catch {}

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function emit(event: ProgressEvent) {
        try { controller.enqueue(encoder.encode(sseEvent(event))); } catch {}
      }

      const issues: HierarchicalIssue[] = [];

      function addIssue(issue: HierarchicalIssue) {
        issues.push(issue);
      }

      try {
        // ─── Phase 0: Lock Validation ────────────────────────────────────────
        const currentTenant = await prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { timetableLocked: true },
        });

        if (currentTenant?.timetableLocked) {
          const { password } = body;
          if (!password) {
            emit({
              phase: 'error',
              pct: 0,
              label: 'Generation Blocked',
              detail: 'The timetable is locked. Please enter your admin password in the generation dialog to unlock and regenerate.',
            });
            controller.close();
            return;
          }

          const adminUser = await prisma.user.findUnique({
            where: { username: session.user.username },
            select: { password: true },
          });

          if (!adminUser) {
            emit({
              phase: 'error',
              pct: 0,
              label: 'Verification Failed',
              detail: 'Admin account not found.',
            });
            controller.close();
            return;
          }

          const isValid = await compare(password, adminUser.password);
          if (!isValid) {
            emit({
              phase: 'error',
              pct: 0,
              label: 'Incorrect Password',
              detail: 'The admin password entered is incorrect.',
            });
            controller.close();
            return;
          }

          // Auto-unlock on correct password
          await prisma.tenant.update({
            where: { id: tenantId },
            data: { timetableLocked: false },
          });
        }

        // ─── Phase 1: Loading Data ───────────────────────────────────────────
        emit({ phase: 'loading_data', pct: 5, label: 'Loading school configuration…' });

        const [tenant, subjects, classes, teachers, classSubjectOverrides, divisionExclusions, divisionSubjects] =
          await Promise.all([
            prisma.tenant.findUnique({
              where: { id: tenantId },
              select: { periodsPerDay: true, workingDays: true, morningPeriods: true, timetableLocked: true },
            }),
            prisma.subject.findMany({ where: { tenantId } }),
            prisma.class.findMany({
              where: { tenantId },
              include: { divisions: { include: { classTeacher: true } } },
              orderBy: { order: 'asc' },
            }),
            prisma.teacher.findMany({
              where: { user: { tenantId } },
              include: {
                user: { select: { name: true } },
                subjectMappings: true,
                subjectClassRestrictions: true,
              },
            }),
            prisma.classSubject.findMany({ where: { class: { tenantId } } }),
            prisma.divisionSubject.findMany({
              where: { excluded: true, division: { class: { tenantId } } },
              select: { divisionId: true, subjectId: true },
            }),
            prisma.divisionSubject.findMany({
              where: { division: { class: { tenantId } } },
            }),
          ]);

        const periodsPerDay = tenant?.periodsPerDay ?? 7;
        const workingDays = tenant?.workingDays ?? 5;
        const morningPeriods = tenant?.morningPeriods ?? 4;

        emit({
          phase: 'loading_data', pct: 15,
          label: `Loaded: ${subjects.length} subjects, ${classes.length} classes, ${teachers.length} teachers`,
          detail: `${periodsPerDay} periods/day × ${workingDays} days = ${periodsPerDay * workingDays} slots/week`,
        });

        // ─── Phase 2: Pre-flight Validation ────────────────────────────────
        emit({ phase: 'validating', pct: 18, label: 'Validating data & detecting conflicts…' });

        // Total capacity
        const totalCapacity = periodsPerDay * workingDays;

        // Build lookup structures
        const overrideMap = new Map(classSubjectOverrides.map(o => [`${o.classId}:${o.subjectId}`, o]));
        const exclusionSet = new Set(divisionExclusions.map(e => `${e.divisionId}:${e.subjectId}`));

        const restrictionMap = new Map<string, Set<string>>();
        for (const t of teachers) {
          for (const r of t.subjectClassRestrictions) {
            const key = `${r.teacherId}:${r.subjectId}`;
            if (!restrictionMap.has(key)) restrictionMap.set(key, new Set());
            restrictionMap.get(key)!.add(r.divisionId);
          }
        }

        function isTeacherAllowed(teacherId: string, subjectId: string, divisionId: string): boolean {
          if (!activeConstraints.includes('c_restrict_class') && activeConstraints.length > 0) return true;
          const key = `${teacherId}:${subjectId}`;
          const allowed = restrictionMap.get(key);
          if (!allowed || allowed.size === 0) return true;
          return allowed.has(divisionId);
        }

        // Validate teacher coverage
        const schedulableSubjects = subjects.filter(s => !s.isLanguageVariant);
        for (const s of schedulableSubjects) {
          const teachersForSubject = teachers.filter(t =>
            t.subjectMappings.some(m => m.subjectId === s.id)
          );
          if (teachersForSubject.length === 0) {
            addIssue({
              severity: 'critical',
              code: 'NO_TEACHER_FOR_SUBJECT',
              message: `Subject "${s.name}" has no teacher assigned. It will be skipped in the timetable.`,
              affectedEntity: s.name,
              canContinue: true,
            });
          }
        }

        // Validate teacher workload capacity
        const teacherPeriodDemand = new Map<string, number>();
        for (const cls of classes) {
          for (const div of cls.divisions) {
            for (const s of schedulableSubjects) {
              if (exclusionSet.has(`${div.id}:${s.id}`)) continue;
              const override = overrideMap.get(`${cls.id}:${s.id}`);
              const ppw = override?.periodsPerWeek ?? s.periodsPerWeek;
              // find teacher for this subject in this division
              const ct = div.classTeacher;
              let resolvedTeacherId = '';
              if (s.useClassTeacher && ct) { resolvedTeacherId = ct.id; }
              else {
                if (
                  ct &&
                  teachers.find(t => t.id === ct.id)?.subjectMappings.some(m => m.subjectId === s.id) &&
                  isTeacherAllowed(ct.id, s.id, div.id)
                ) {
                  resolvedTeacherId = ct.id;
                } else {
                  const cands = teachers.filter(t =>
                    t.id !== (ct?.id ?? '') &&
                    t.subjectMappings.some(m => m.subjectId === s.id) &&
                    isTeacherAllowed(t.id, s.id, div.id)
                  );
                  resolvedTeacherId = cands[0]?.id ?? '';
                }
              }
              if (resolvedTeacherId) {
                teacherPeriodDemand.set(resolvedTeacherId,
                  (teacherPeriodDemand.get(resolvedTeacherId) ?? 0) + ppw);
              }
            }
          }
        }

        for (const [tid, demand] of teacherPeriodDemand) {
          const t = teachers.find(t => t.id === tid);
          if (demand > totalCapacity) {
            addIssue({
              severity: 'error',
              code: 'TEACHER_OVERLOADED',
              message: `Teacher "${t?.user.name}" is assigned ${demand} periods/week but the school only has ${totalCapacity} slots. Some classes will be unscheduled.`,
              affectedEntity: t?.user.name,
              canContinue: true,
            });
          }
        }

        // Check divisions with no subjects
        for (const cls of classes) {
          for (const div of cls.divisions) {
            const divLabel = `${cls.name}${div.name}`;
            const applicableSubjects = schedulableSubjects.filter(s => !exclusionSet.has(`${div.id}:${s.id}`));
            if (applicableSubjects.length === 0) {
              addIssue({
                severity: 'warning',
                code: 'DIVISION_NO_SUBJECTS',
                message: `Division ${divLabel} has no applicable subjects (all may be excluded).`,
                affectedEntity: divLabel,
                canContinue: true,
              });
            }

            // Check demand vs capacity per division
            const divDemand = applicableSubjects.reduce((sum, s) => {
              const override = overrideMap.get(`${cls.id}:${s.id}`);
              return sum + (override?.periodsPerWeek ?? s.periodsPerWeek);
            }, 0);

            if (divDemand > totalCapacity) {
              addIssue({
                severity: 'critical',
                code: 'DIVISION_OVERCAPACITY',
                message: `Division ${divLabel} requires ${divDemand} periods/week but capacity is ${totalCapacity}. Reduce subject periods or the school will have gaps.`,
                affectedEntity: divLabel,
                canContinue: true,
              });
            } else if (divDemand < totalCapacity * 0.9) {
              addIssue({
                severity: 'info',
                code: 'DIVISION_UNDERFILLED',
                message: `Division ${divLabel} only uses ${divDemand}/${totalCapacity} slots (${Math.round(divDemand/totalCapacity*100)}%). Some periods will be free.`,
                affectedEntity: divLabel,
                canContinue: true,
              });
            }
          }
        }

        const criticalBlocking = issues.filter(i => i.severity === 'critical' && !i.canContinue);
        if (criticalBlocking.length > 0) {
          emit({
            phase: 'error', pct: 20,
            label: 'Critical errors block generation',
            errors: issues.filter(i => i.severity === 'critical'),
            warnings: issues.filter(i => i.severity !== 'critical'),
          });
          controller.close();
          return;
        }

        const validationErrors = issues.filter(i => ['critical', 'error'].includes(i.severity));
        const validationWarnings = issues.filter(i => ['warning', 'info'].includes(i.severity));

        emit({
          phase: 'validating', pct: 22,
          label: `Validation complete — ${validationErrors.length} errors, ${validationWarnings.length} notices`,
          errors: validationErrors,
          warnings: validationWarnings,
        });

        // ─── Phase 3: Build Engine Input ────────────────────────────────────
        function resolveTeacher(
          subjectId: string, divisionId: string, useClassTeacher: boolean,
          classTeacherId: string | null, divisionName: string, subjectName: string,
        ): string {
          if (useClassTeacher) return classTeacherId ?? '';
          if (classTeacherId) {
            const ct = teachers.find(t => t.id === classTeacherId);
            if (
              ct?.subjectMappings.some(m => m.subjectId === subjectId) &&
              isTeacherAllowed(classTeacherId, subjectId, divisionId)
            ) return classTeacherId;
          }
          const restricted = teachers.filter(t =>
            t.id !== classTeacherId &&
            t.subjectMappings.some(m => m.subjectId === subjectId) &&
            isTeacherAllowed(t.id, subjectId, divisionId)
          );
          if (restricted.length > 0) return restricted[0].id;
          const fallback = teachers.filter(t =>
            t.id !== classTeacherId &&
            t.subjectMappings.some(m => m.subjectId === subjectId)
          );
          if (fallback.length > 0) {
            addIssue({
              severity: 'warning',
              code: 'RESTRICTION_RELAXED',
              message: `${divisionName}: "${subjectName}" — no teacher with valid class restriction, using ${fallback[0].user.name} (restriction relaxed).`,
              affectedEntity: divisionName,
              canContinue: true,
            });
            return fallback[0].id;
          }
          return '';
        }

        const divisionInputs: DivisionInput[] = [];
        for (const cls of classes) {
          for (const div of cls.divisions) {
            const divSubjects = schedulableSubjects
              .filter(s => !exclusionSet.has(`${div.id}:${s.id}`))
              .map(s => {
                const override = overrideMap.get(`${cls.id}:${s.id}`);
                const periodsPerWeek = override?.periodsPerWeek ?? s.periodsPerWeek;
                const consecutiveSlots = override?.consecutiveSlots ?? s.consecutiveSlots;
                const teacherId = resolveTeacher(
                  s.id, div.id, s.useClassTeacher,
                  div.classTeacherId, `${cls.name}${div.name}`, s.name,
                );
                return {
                  subjectId: s.id, teacherId, periodsPerWeek,
                  isCore: s.isCore, eveningPriority: s.eveningPriority,
                  consecutiveSlots, fixedDay: s.fixedDay, fixedSlot: s.fixedSlot,
                  useClassTeacher: s.useClassTeacher,
                  sharedVenueGroupId: s.sharedVenueGroupId ?? null,
                };
              })
              .filter(s => s.teacherId && s.periodsPerWeek > 0);

            // Resolve active language variant teachers for this division
            const activeVariantTeacherIds: string[] = [];
            const variantsForDiv = subjects.filter(s => s.isLanguageVariant && s.replacesSubjectId);
            for (const vSub of variantsForDiv) {
              if (exclusionSet.has(`${div.id}:${vSub.id}`)) continue;
              const vTeacherId = resolveTeacher(
                vSub.id, div.id, vSub.useClassTeacher,
                div.classTeacherId, `${cls.name}${div.name}`, vSub.name,
              );
              if (vTeacherId) {
                activeVariantTeacherIds.push(vTeacherId);
              }
            }

            divisionInputs.push({
              id: div.id,
              name: `${cls.name}${div.name}`,
              classId: cls.id,
              classTeacherId: div.classTeacherId,
              subjects: divSubjects,
              variantTeacherIds: activeVariantTeacherIds,
            });
          }
        }

        // Construct default PE groups if none are provided
        if (peGroups.length === 0) {
          const peSub = subjects.find(s =>
            s.code === 'PE' || s.code === 'PET' || s.name.toLowerCase().includes('physical education')
          );
          if (peSub) {
            const allDivs = classes.flatMap((c: any) =>
              c.divisions?.map((d: any) => ({ ...d, className: c.name, label: `${c.name}${d.name}` })) || []
            );
            const div5A = allDivs.find((d: any) => d.label === '5A');
            const div5B = allDivs.find((d: any) => d.label === '5B');
            const div6A = allDivs.find((d: any) => d.label === '6A');
            const div6B = allDivs.find((d: any) => d.label === '6B');
            if (div5A && div5B) {
              peGroups.push({ subjectId: peSub.id, divisionIds: [div5A.id, div5B.id] });
            }
            if (div6A && div6B) {
              peGroups.push({ subjectId: peSub.id, divisionIds: [div6A.id, div6B.id] });
            }
          }
        }

        // ─── PE Group Co-scheduling Injection ────────────────────────────────
        // For each configured PE group, remove the shared subject from follower
        // divisions and wire up coScheduledDivisions on the lead division's PE subject.
        const peGroupSubjectIds = new Set<string>();
        for (const group of peGroups) {
          if (!group.subjectId || !Array.isArray(group.divisionIds) || group.divisionIds.length < 2) continue;

          const validDivIds = group.divisionIds.filter(id =>
            divisionInputs.some(di => di.id === id)
          );
          if (validDivIds.length < 2) continue;

          peGroupSubjectIds.add(group.subjectId);

          const [leadId, ...followerIds] = validDivIds;
          const leadInput = divisionInputs.find(di => di.id === leadId);
          if (!leadInput) continue;

          const leadPeSub = leadInput.subjects.find(s => s.subjectId === group.subjectId);
          if (!leadPeSub) continue;

          // Initialise coScheduledDivisions on lead's PE subject if needed
          if (!leadPeSub.coScheduledDivisions) leadPeSub.coScheduledDivisions = [];

          for (const followerId of followerIds) {
            const followerInput = divisionInputs.find(di => di.id === followerId);
            if (!followerInput) continue;

            // Find the PE subject's teacher for this follower
            const followerPeSub = followerInput.subjects.find(s => s.subjectId === group.subjectId);
            if (!followerPeSub) continue;

            // Wire follower into lead's PE subject co-scheduled list
            leadPeSub.coScheduledDivisions.push({
              divisionId: followerId,
              teacherId: followerPeSub.teacherId,
            });

            // Remove PE subject from follower so solver doesn't double-schedule it
            followerInput.subjects = followerInput.subjects.filter(
              s => s.subjectId !== group.subjectId
            );
          }
        }

        // --- Co-scheduling Analysis ---
        const baseSubjectIds = new Set(
          subjects.filter(s => s.isLanguageVariant && s.replacesSubjectId).map(s => s.replacesSubjectId!)
        );

        const variantTeachersMap = new Map<string, string[]>();
        for (const s of subjects) {
          if (s.isLanguageVariant) {
            const vTeachers = teachers.filter(t => t.subjectMappings.some(sm => sm.subjectId === s.id));
            variantTeachersMap.set(s.id, vTeachers.map(t => t.id));
          }
        }

        const divisionVariantTeachers = new Map<string, Set<string>>();
        for (const ds of divisionSubjects) {
          if (ds.useLanguageVariant && ds.languageVariantSubjectId) {
            const vTeachers = variantTeachersMap.get(ds.languageVariantSubjectId) || [];
            if (!divisionVariantTeachers.has(ds.divisionId)) {
              divisionVariantTeachers.set(ds.divisionId, new Set());
            }
            const set = divisionVariantTeachers.get(ds.divisionId)!;
            for (const tId of vTeachers) {
              set.add(tId);
            }
          }
        }

        for (const cls of classes) {
          const classDivs = cls.divisions;
          if (classDivs.length <= 1) continue;

          const adj = new Map<string, string[]>();
          for (const d of classDivs) adj.set(d.id, []);

          for (let i = 0; i < classDivs.length; i++) {
            for (let j = i + 1; j < classDivs.length; j++) {
              const d1 = classDivs[i];
              const d2 = classDivs[j];
              const t1 = divisionVariantTeachers.get(d1.id) || new Set();
              const t2 = divisionVariantTeachers.get(d2.id) || new Set();
              let share = false;
              for (const tId of t1) {
                if (t2.has(tId)) { share = true; break; }
              }
              if (share) {
                adj.get(d1.id)!.push(d2.id);
                adj.get(d2.id)!.push(d1.id);
              }
            }
          }

          const visited = new Set<string>();
          for (const d of classDivs) {
            if (!visited.has(d.id)) {
              const comp: string[] = [];
              const queue = [d.id];
              visited.add(d.id);
              while (queue.length > 0) {
                const u = queue.shift()!;
                comp.push(u);
                for (const v of adj.get(u) || []) {
                  if (!visited.has(v)) {
                    visited.add(v);
                    queue.push(v);
                  }
                }
              }
              const hasVariantTeachers = comp.some(divId => (divisionVariantTeachers.get(divId)?.size ?? 0) > 0);
              if (comp.length > 1 && hasVariantTeachers) {
                const leadId = comp[0];
                const leadInput = divisionInputs.find(di => di.id === leadId);
                if (leadInput) {
                  leadInput.coScheduledDivisions = [];
                  for (let idx = 1; idx < comp.length; idx++) {
                    const followerId = comp[idx];
                    const followerInput = divisionInputs.find(di => di.id === followerId);
                    if (followerInput) {
                      followerInput.isFollowerDivision = true;
                      for (const baseId of baseSubjectIds) {
                        const fSub = followerInput.subjects.find(s => s.subjectId === baseId);
                        if (fSub) {
                          leadInput.coScheduledDivisions.push({
                            divisionId: followerId,
                            teacherId: fSub.teacherId,
                          });
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }

        const engineInput: TimetableInput = {
          divisions: divisionInputs,
          subjects: subjects.map(s => ({
            id: s.id, name: s.name, isCore: s.isCore,
            eveningPriority: s.eveningPriority, consecutiveSlots: s.consecutiveSlots,
            periodsPerWeek: s.periodsPerWeek,
            isLanguageVariant: s.isLanguageVariant,
            replacesSubjectId: s.replacesSubjectId,
          })),
          teachers: teachers.map(t => ({
            id: t.id, name: t.user.name, teacherCode: t.teacherCode,
            subjectMappings: t.subjectMappings.map(m => m.subjectId),
            subjectClassRestrictions: t.subjectClassRestrictions.map(r => ({
              subjectId: r.subjectId, divisionId: r.divisionId,
            })),
          })),
          days: workingDays,
          slotsPerDay: periodsPerDay,
          morningPeriods,
          // PE groups: tells solver to co-schedule these subjects across grouped divisions
          sharedSubjectIds: peGroupSubjectIds.size > 0 ? Array.from(peGroupSubjectIds) : undefined,
        };

        const totalExpectedSlots = divisionInputs.reduce(
          (sum, div) => sum + div.subjects.reduce((s, ds) => s + ds.periodsPerWeek, 0), 0
        );

        // ─── Phase 4: Run Hybrid Solver ─────────────────────────────────────
        const solverResult = await solveTimetable(
          engineInput,
          activeConstraints,
          (phase, pct, label, detail) => {
            emit({ phase: phase as Phase, pct, label, detail });
          },
        );

        let finalTimetable = solverResult.timetable;
        const solverScore = solverResult.score;

        // ─── Phase 5: AI Repair (if needed) ─────────────────────────────────
        const exclusionList = divisionExclusions.map(e => {
          const div = classes.flatMap(c => c.divisions).find(d => d.id === e.divisionId);
          const cls = classes.find(c => c.divisions.some(d => d.id === e.divisionId));
          const sub = subjects.find(s => s.id === e.subjectId);
          return {
            divisionId: e.divisionId,
            divisionName: cls && div ? `${cls.name}${div.name}` : e.divisionId,
            subjectId: e.subjectId,
            subjectName: sub?.name ?? e.subjectId,
          };
        });

        if (solverScore.fillRate < 98 && finalTimetable.length < totalExpectedSlots) {
          const gapCount = totalExpectedSlots - finalTimetable.length;
          emit({
            phase: 'ai_repair', pct: 84,
            label: `Invoking Gemini AI to repair ${gapCount} unfilled slot(s)…`,
            detail: `Solver fill rate: ${solverScore.fillRate.toFixed(1)}% — AI will target specific gaps`,
          });

          try {
            const aiSlots = await repairTimetableGaps({
              divisions: engineInput.divisions,
              subjects: engineInput.subjects,
              teachers: engineInput.teachers,
              days: engineInput.days,
              slotsPerDay: engineInput.slotsPerDay,
              morningPeriods: engineInput.morningPeriods,
              divisionExclusions: exclusionList,
              existingTimetable: finalTimetable,
            }, activeConstraints);

            if (aiSlots && Array.isArray(aiSlots) && aiSlots.length > 0) {
              const validDivisions = new Set(engineInput.divisions.map(d => d.id));
              const validSubjects = new Set(engineInput.subjects.map(s => s.id));
              const validTeachers = new Set(engineInput.teachers.map(t => t.id));

              const divisionNames = new Map(engineInput.divisions.map(d => [d.id, d.name]));

              // Map base subject ID to its variant teacher IDs
              const variantTeachersByBase = new Map<string, string[]>();
              for (const s of subjects) {
                if (s.isLanguageVariant && s.replacesSubjectId) {
                  const baseId = s.replacesSubjectId;
                  if (!variantTeachersByBase.has(baseId)) {
                    variantTeachersByBase.set(baseId, []);
                  }
                  const teachersForVariant = teachers.filter(t => t.subjectMappings.some(sm => sm.subjectId === s.id));
                  const currentList = variantTeachersByBase.get(baseId)!;
                  for (const t of teachersForVariant) {
                    if (!currentList.includes(t.id)) {
                      currentList.push(t.id);
                    }
                  }
                }
              }

              // Build occupancy set from existing timetable for dedup
              const occupied = new Set(
                finalTimetable.map(e => `${e.divisionId}:${e.dayOfWeek}:${e.slotNumber}`)
              );
              const teacherOccupied = new Set<string>();
              for (const e of finalTimetable) {
                teacherOccupied.add(`${e.teacherId}:${e.dayOfWeek}:${e.slotNumber}`);
                const divName = divisionNames.get(e.divisionId) ?? '';
                if (divName.endsWith('A')) {
                  const varTeachers = variantTeachersByBase.get(e.subjectId) || [];
                  for (const vtId of varTeachers) {
                    teacherOccupied.add(`${vtId}:${e.dayOfWeek}:${e.slotNumber}`);
                  }
                }
              }

              // Map: divisionId -> list of all co-scheduled division details in its group (including itself)
              const coScheduledGroupMap = new Map<string, { divisionId: string; teacherId: string }[]>();
              for (const di of engineInput.divisions) {
                if (di.coScheduledDivisions && di.coScheduledDivisions.length > 0) {
                  const leadBaseSub = di.subjects.find(s => baseSubjectIds.has(s.subjectId));
                  const leadTeacherId = leadBaseSub?.teacherId ?? '';
                  const fullGroup = [
                    { divisionId: di.id, teacherId: leadTeacherId },
                    ...di.coScheduledDivisions
                  ];
                  for (const member of fullGroup) {
                    coScheduledGroupMap.set(member.divisionId, fullGroup);
                  }
                }
              }

              let addedCount = 0;
              for (const slot of aiSlots) {
                if (!slot || typeof slot.divisionId !== 'string') continue;
                if (!validDivisions.has(slot.divisionId)) continue;
                if (!validSubjects.has(slot.subjectId)) continue;
                if (!validTeachers.has(slot.teacherId)) continue;
                if (slot.dayOfWeek < 1 || slot.dayOfWeek > engineInput.days) continue;
                if (slot.slotNumber < 1 || slot.slotNumber > engineInput.slotsPerDay) continue;
                if (exclusionSet.has(`${slot.divisionId}:${slot.subjectId}`)) continue;
                if (!isTeacherAllowed(slot.teacherId, slot.subjectId, slot.divisionId)) continue;

                // Check co-scheduling if it's a base subject in a co-scheduled division
                const isBase = baseSubjectIds.has(slot.subjectId);
                const coGroup = isBase ? coScheduledGroupMap.get(slot.divisionId) : undefined;

                if (coGroup) {
                  // Verify all co-scheduled divisions and teachers are free
                  let canPlaceCo = true;
                  for (const member of coGroup) {
                    const divKey = `${member.divisionId}:${slot.dayOfWeek}:${slot.slotNumber}`;
                    const tKey = `${member.teacherId}:${slot.dayOfWeek}:${slot.slotNumber}`;
                    if (occupied.has(divKey) || teacherOccupied.has(tKey)) {
                      canPlaceCo = false;
                      break;
                    }
                  }
                  if (!canPlaceCo) continue;

                  // Verify variant teachers are free (since they are shared in Division A)
                  let variantTeacherBusy = false;
                  for (const member of coGroup) {
                    const divInput = engineInput.divisions.find(d => d.id === member.divisionId);
                    const varTeachers = divInput?.variantTeacherIds || [];
                    for (const vtId of varTeachers) {
                      if (teacherOccupied.has(`${vtId}:${slot.dayOfWeek}:${slot.slotNumber}`)) {
                        variantTeacherBusy = true;
                        break;
                      }
                    }
                    if (variantTeacherBusy) break;
                  }
                  if (variantTeacherBusy) continue;

                  // Place all co-scheduled entries
                  for (const member of coGroup) {
                    finalTimetable.push({
                      divisionId: member.divisionId,
                      dayOfWeek: slot.dayOfWeek,
                      slotNumber: slot.slotNumber,
                      subjectId: slot.subjectId,
                      teacherId: member.teacherId,
                    });
                    occupied.add(`${member.divisionId}:${slot.dayOfWeek}:${slot.slotNumber}`);
                    teacherOccupied.add(`${member.teacherId}:${slot.dayOfWeek}:${slot.slotNumber}`);
                    
                    const divInput = engineInput.divisions.find(d => d.id === member.divisionId);
                    const varTeachers = divInput?.variantTeacherIds || [];
                    for (const vtId of varTeachers) {
                      teacherOccupied.add(`${vtId}:${slot.dayOfWeek}:${slot.slotNumber}`);
                    }
                  }
                  addedCount += coGroup.length;
                } else {
                  // Standard single entry scheduling
                  const divKey = `${slot.divisionId}:${slot.dayOfWeek}:${slot.slotNumber}`;
                  const tKey = `${slot.teacherId}:${slot.dayOfWeek}:${slot.slotNumber}`;

                  if (occupied.has(divKey) || teacherOccupied.has(tKey)) continue;

                  const divInput = engineInput.divisions.find(d => d.id === slot.divisionId);
                  const varTeachers = divInput?.variantTeacherIds || [];
                  let variantTeacherBusy = false;
                  for (const vtId of varTeachers) {
                    if (teacherOccupied.has(`${vtId}:${slot.dayOfWeek}:${slot.slotNumber}`)) {
                      variantTeacherBusy = true;
                      break;
                    }
                  }
                  if (variantTeacherBusy) continue;

                  finalTimetable.push({
                    divisionId: slot.divisionId,
                    dayOfWeek: slot.dayOfWeek,
                    slotNumber: slot.slotNumber,
                    subjectId: slot.subjectId,
                    teacherId: slot.teacherId,
                  });
                  occupied.add(divKey);
                  teacherOccupied.add(tKey);
                  for (const vtId of varTeachers) {
                    teacherOccupied.add(`${vtId}:${slot.dayOfWeek}:${slot.slotNumber}`);
                  }
                  addedCount++;
                }
              }

              emit({
                phase: 'ai_repair', pct: 88,
                label: addedCount > 0
                  ? `AI repaired ${addedCount} gap(s) — ${finalTimetable.length}/${totalExpectedSlots} slots now filled`
                  : 'AI could not add valid entries — using solver result as-is',
              });
            } else {
              emit({ phase: 'ai_repair', pct: 88, label: 'AI could not improve on solver result' });
            }
          } catch (aiErr: any) {
            emit({
              phase: 'ai_repair', pct: 88,
              label: 'AI repair failed — using solver result',
              detail: aiErr?.message ?? 'Unknown AI error',
            });
          }
        } else {
          emit({
            phase: 'ai_repair', pct: 88,
            label: `Solver achieved ${solverScore.fillRate.toFixed(1)}% fill rate — AI repair skipped ✓`,
          });
        }

        // ─── Phase 6: Save ──────────────────────────────────────────────────
        // Expand finalTimetable to include parallel language variants
        const expandedTimetable: any[] = [];
        for (const entry of finalTimetable) {
          expandedTimetable.push(entry);

          // If this entry is Malayalam I, add parallel entries for active variants
          const sub = subjects.find(s => s.id === entry.subjectId);
          if (sub && !sub.isLanguageVariant) {
            const variants = subjects.filter(v => v.isLanguageVariant && v.replacesSubjectId === sub.id);
            if (variants.length > 0) {
              for (const vSub of variants) {
                if (exclusionSet.has(`${entry.divisionId}:${vSub.id}`)) continue;
                const divObj = classes.flatMap(c => c.divisions).find(d => d.id === entry.divisionId);
                const classObj = classes.find(c => c.divisions.some(d => d.id === entry.divisionId));
                if (divObj) {
                  const vTeacherId = resolveTeacher(
                    vSub.id, entry.divisionId, vSub.useClassTeacher,
                    divObj.classTeacherId, classObj ? `${classObj.name}${divObj.name}` : entry.divisionId, vSub.name
                  );
                  if (vTeacherId) {
                    expandedTimetable.push({
                      divisionId: entry.divisionId,
                      dayOfWeek: entry.dayOfWeek,
                      slotNumber: entry.slotNumber,
                      subjectId: vSub.id,
                      teacherId: vTeacherId,
                    });
                  }
                }
              }
            }
          }
        }

        emit({ phase: 'saving', pct: 93, label: `Saving ${expandedTimetable.length} new entries…` });
        await prisma.timetableEntry.deleteMany({ where: { tenantId } });
        if (expandedTimetable.length > 0) {
          await prisma.timetableEntry.createMany({
            data: expandedTimetable.map((entry: any) => ({
              tenantId,
              divisionId: entry.divisionId,
              dayOfWeek: entry.dayOfWeek,
              slotNumber: entry.slotNumber,
              subjectId: entry.subjectId,
              teacherId: entry.teacherId,
            })),
          });
        }

        // ─── Phase 7: Aggregate all issues ──────────────────────────────────
        const engineErrors: HierarchicalIssue[] = solverResult.errors.map(e => ({
          severity: 'error' as const, code: 'UNASSIGNED', message: e,
          canContinue: true,
        }));
        const engineWarnings: HierarchicalIssue[] = solverResult.warnings.map(w => ({
          severity: 'warning' as const, code: 'ENGINE_WARN', message: w,
          canContinue: true,
        }));
        const allIssues = [...issues, ...engineErrors, ...engineWarnings];

        const finalScore = Math.round((finalTimetable.length / Math.max(totalExpectedSlots, 1)) * 100);

        emit({
          phase: 'done', pct: 100,
          label: `Done — ${finalTimetable.length}/${totalExpectedSlots} slots scheduled (${finalScore}%)`,
          errors: allIssues.filter(i => ['critical', 'error'].includes(i.severity)),
          warnings: allIssues.filter(i => ['warning', 'info'].includes(i.severity)),
          result: {
            generated: finalTimetable.length,
            totalExpected: totalExpectedSlots,
            score: finalScore,
            scoreBreakdown: solverScore,
            settings: { periodsPerDay, workingDays, morningPeriods },
            stats: {
              ...solverResult.stats,
              filledSlots: finalTimetable.length,
              totalSlots: totalExpectedSlots,
            },
          },
        });
      } catch (err: any) {
        emit({
          phase: 'error', pct: 0,
          label: 'Unexpected server error during generation',
          detail: err?.message ?? 'Unknown error',
        });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
