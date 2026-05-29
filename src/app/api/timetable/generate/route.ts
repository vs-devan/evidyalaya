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
  let body: any = {};
  try {
    body = await req.json();
    activeConstraints = body.constraints || [];
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

        const [tenant, subjects, classes, teachers, classSubjectOverrides, divisionExclusions] =
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
                };
              })
              .filter(s => s.teacherId && s.periodsPerWeek > 0);

            divisionInputs.push({
              id: div.id,
              name: `${cls.name}${div.name}`,
              classId: cls.id,
              classTeacherId: div.classTeacherId,
              subjects: divSubjects,
            });
          }
        }

        const engineInput: TimetableInput = {
          divisions: divisionInputs,
          subjects: subjects.map(s => ({
            id: s.id, name: s.name, isCore: s.isCore,
            eveningPriority: s.eveningPriority, consecutiveSlots: s.consecutiveSlots,
            periodsPerWeek: s.periodsPerWeek,
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

              // Build occupancy set from existing timetable for dedup
              const occupied = new Set(
                finalTimetable.map(e => `${e.divisionId}:${e.dayOfWeek}:${e.slotNumber}`)
              );
              const teacherOccupied = new Set(
                finalTimetable.map(e => `${e.teacherId}:${e.dayOfWeek}:${e.slotNumber}`)
              );

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

                const divKey = `${slot.divisionId}:${slot.dayOfWeek}:${slot.slotNumber}`;
                const tKey = `${slot.teacherId}:${slot.dayOfWeek}:${slot.slotNumber}`;

                if (occupied.has(divKey) || teacherOccupied.has(tKey)) continue;

                finalTimetable.push({
                  divisionId: slot.divisionId,
                  dayOfWeek: slot.dayOfWeek,
                  slotNumber: slot.slotNumber,
                  subjectId: slot.subjectId,
                  teacherId: slot.teacherId,
                });
                occupied.add(divKey);
                teacherOccupied.add(tKey);
                addedCount++;
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
        emit({ phase: 'saving', pct: 90, label: 'Clearing old timetable entries…' });
        await prisma.timetableEntry.deleteMany({ where: { tenantId } });

        emit({ phase: 'saving', pct: 93, label: `Saving ${finalTimetable.length} new entries…` });
        if (finalTimetable.length > 0) {
          await prisma.timetableEntry.createMany({
            data: finalTimetable.map((entry: any) => ({
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
