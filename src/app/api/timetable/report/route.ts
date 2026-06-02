import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SCHOOL_ADMIN' || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const tenantId = session.user.tenantId;

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
  const totalCapacity = periodsPerDay * workingDays;

  const overrideMap = new Map(classSubjectOverrides.map(o => [`${o.classId}:${o.subjectId}`, o]));
  const exclusionSet = new Set(divisionExclusions.map(e => `${e.divisionId}:${e.subjectId}`));

  // Teacher restriction map: teacherId:subjectId -> Set<divisionId>
  const restrictionMap = new Map<string, Set<string>>();
  for (const t of teachers) {
    for (const r of t.subjectClassRestrictions) {
      const key = `${r.teacherId}:${r.subjectId}`;
      if (!restrictionMap.has(key)) restrictionMap.set(key, new Set());
      restrictionMap.get(key)!.add(r.divisionId);
    }
  }

  function isTeacherAllowed(teacherId: string, subjectId: string, divisionId: string): boolean {
    const key = `${teacherId}:${subjectId}`;
    const allowed = restrictionMap.get(key);
    if (!allowed || allowed.size === 0) return true;
    return allowed.has(divisionId);
  }

  function resolveTeacher(
    subjectId: string, divisionId: string, useClassTeacher: boolean,
    classTeacherId: string | null
  ): { id: string; name: string; code: string; resolvedVia: string } | null {
    if (useClassTeacher) {
      const ct = teachers.find(t => t.id === classTeacherId);
      return ct ? { id: ct.id, name: ct.user.name, code: ct.teacherCode, resolvedVia: 'class_teacher_flag' } : null;
    }
    if (classTeacherId) {
      const ct = teachers.find(t => t.id === classTeacherId);
      if (ct?.subjectMappings.some(m => m.subjectId === subjectId) && isTeacherAllowed(classTeacherId, subjectId, divisionId)) {
        return { id: ct.id, name: ct.user.name, code: ct.teacherCode, resolvedVia: 'class_teacher' };
      }
    }
    const restricted = teachers.filter(t =>
      t.id !== classTeacherId &&
      t.subjectMappings.some(m => m.subjectId === subjectId) &&
      isTeacherAllowed(t.id, subjectId, divisionId)
    );
    if (restricted.length > 0) {
      const t = restricted[0];
      return { id: t.id, name: t.user.name, code: t.teacherCode, resolvedVia: 'subject_mapping' };
    }
    // fallback (restriction relaxed)
    const fallback = teachers.filter(t =>
      t.id !== classTeacherId &&
      t.subjectMappings.some(m => m.subjectId === subjectId)
    );
    if (fallback.length > 0) {
      const t = fallback[0];
      return { id: t.id, name: t.user.name, code: t.teacherCode, resolvedVia: 'fallback_restriction_relaxed' };
    }
    return null;
  }

  const schedulableSubjects = subjects.filter(s => !s.isLanguageVariant);
  const variantSubjects = subjects.filter(s => s.isLanguageVariant);

  // ── Per-subject global data ──────────────────────────────────────────────
  const subjectReport = schedulableSubjects.map(s => {
    const teachersForSubject = teachers.filter(t => t.subjectMappings.some(m => m.subjectId === s.id));
    return {
      id: s.id,
      name: s.name,
      code: s.code,
      periodsPerWeek: s.periodsPerWeek,
      isCore: s.isCore,
      eveningPriority: s.eveningPriority,
      consecutiveSlots: s.consecutiveSlots,
      fixedDay: s.fixedDay,
      fixedSlot: s.fixedSlot,
      useClassTeacher: s.useClassTeacher,
      sharedVenueGroupId: s.sharedVenueGroupId ?? null,
      isLanguageVariant: s.isLanguageVariant,
      teacherCount: teachersForSubject.length,
      teachers: teachersForSubject.map(t => ({ id: t.id, name: t.user.name, code: t.teacherCode })),
      hasNoTeacher: teachersForSubject.length === 0,
    };
  });

  // ── Per-division detailed breakdown ──────────────────────────────────────
  const divisionReport = classes.flatMap(cls =>
    cls.divisions.map(div => {
      const divLabel = `${cls.name}${div.name}`;
      const classTeacher = div.classTeacher;

      const divisionVariants = variantSubjects
        .filter(s => !exclusionSet.has(`${div.id}:${s.id}`))
        .map(s => {
          const baseSub = schedulableSubjects.find(bs => bs.id === s.replacesSubjectId);
          const baseOverride = baseSub ? overrideMap.get(`${cls.id}:${baseSub.id}`) : null;
          const periodsPerWeek = baseOverride?.periodsPerWeek ?? baseSub?.periodsPerWeek ?? s.periodsPerWeek;
          const consecutiveSlots = baseOverride?.consecutiveSlots ?? baseSub?.consecutiveSlots ?? s.consecutiveSlots;

          const teacher = resolveTeacher(s.id, div.id, s.useClassTeacher, div.classTeacherId);
          const excluded = exclusionSet.has(`${div.id}:${s.id}`);
          const skippedFromEngine = !teacher || periodsPerWeek <= 0;

          return {
            subjectId: s.id,
            subjectName: s.name,
            subjectCode: s.code,
            periodsPerWeek,
            consecutiveSlots,
            isCore: s.isCore,
            eveningPriority: s.eveningPriority,
            isOverridden: !!baseOverride,
            originalPeriodsPerWeek: s.periodsPerWeek,
            fixedDay: s.fixedDay,
            fixedSlot: s.fixedSlot,
            useClassTeacher: s.useClassTeacher,
            excluded,
            teacher: teacher
              ? { id: teacher.id, name: teacher.name, code: teacher.code, resolvedVia: teacher.resolvedVia }
              : null,
            skippedFromEngine,
            skipReason: skippedFromEngine
              ? (!teacher ? 'No teacher assigned' : 'Zero periods per week')
              : null,
            isLanguageVariant: true,
          };
        });

      const subjectRows = [
        ...schedulableSubjects
          .filter(s => !exclusionSet.has(`${div.id}:${s.id}`))
          .map(s => {
            const override = overrideMap.get(`${cls.id}:${s.id}`);
            const periodsPerWeek = override?.periodsPerWeek ?? s.periodsPerWeek;
            const consecutiveSlots = override?.consecutiveSlots ?? s.consecutiveSlots;
            const teacher = resolveTeacher(s.id, div.id, s.useClassTeacher, div.classTeacherId);
            const excluded = exclusionSet.has(`${div.id}:${s.id}`);

            // Check if this subject is skipped from engine (no teacher or 0 ppw)
            const skippedFromEngine = !teacher || periodsPerWeek <= 0;

            return {
              subjectId: s.id,
              subjectName: s.name,
              subjectCode: s.code,
              periodsPerWeek,
              consecutiveSlots,
              isCore: s.isCore,
              eveningPriority: s.eveningPriority,
              isOverridden: !!override,
              originalPeriodsPerWeek: s.periodsPerWeek,
              fixedDay: s.fixedDay,
              fixedSlot: s.fixedSlot,
              useClassTeacher: s.useClassTeacher,
              excluded,
              teacher: teacher
                ? { id: teacher.id, name: teacher.name, code: teacher.code, resolvedVia: teacher.resolvedVia }
                : null,
              skippedFromEngine,
              skipReason: skippedFromEngine
                ? (!teacher ? 'No teacher assigned' : 'Zero periods per week')
                : null,
            };
          }),
        ...divisionVariants
      ];

      const excludedSubjects = [
        ...schedulableSubjects.filter(s => exclusionSet.has(`${div.id}:${s.id}`)),
        ...variantSubjects.filter(s => exclusionSet.has(`${div.id}:${s.id}`))
      ].map(s => ({ subjectId: s.id, subjectName: s.name, subjectCode: s.code }));

      const activeSubjects = subjectRows.filter(r => !r.skippedFromEngine);
      const skippedSubjects = subjectRows.filter(r => r.skippedFromEngine);

      // Keep totalDemand for Malayalam I only, exclude variant subjects so totalDemand matches timetable capacity
      const totalDemand = activeSubjects
        .filter((r: any) => !r.isLanguageVariant)
        .reduce((sum, r) => sum + r.periodsPerWeek, 0);
      const fillRate = totalCapacity > 0 ? Math.round((totalDemand / totalCapacity) * 100) : 0;

      // Teacher demand for this division
      const teacherDemandInDiv = new Map<string, { name: string; code: string; periods: number }>();
      for (const r of activeSubjects) {
        if (r.teacher) {
          const existing = teacherDemandInDiv.get(r.teacher.id);
          if (existing) {
            existing.periods += r.periodsPerWeek;
          } else {
            teacherDemandInDiv.set(r.teacher.id, {
              name: r.teacher.name,
              code: r.teacher.code,
              periods: r.periodsPerWeek,
            });
          }
        }
      }

      // Flags
      const flags: { type: 'error' | 'warning' | 'info'; message: string }[] = [];

      if (totalDemand > totalCapacity) {
        flags.push({
          type: 'error',
          message: `Over-capacity: ${totalDemand} periods demanded vs ${totalCapacity} available. Some slots will be unfilled.`,
        });
      } else if (totalDemand < totalCapacity * 0.9) {
        flags.push({
          type: 'info',
          message: `Under-filled: only ${totalDemand}/${totalCapacity} slots used (${fillRate}%). Some periods will be free.`,
        });
      }
      if (activeSubjects.length === 0) {
        flags.push({ type: 'error', message: 'No schedulable subjects — division will have an empty timetable.' });
      }
      if (!div.classTeacherId) {
        flags.push({ type: 'warning', message: 'No class teacher assigned — Period 1 constraint will be skipped.' });
      }
      for (const r of skippedSubjects) {
        flags.push({ type: 'warning', message: `"${r.subjectName}" skipped: ${r.skipReason}` });
      }
      // Consecutive subjects check
      const consecutiveSubjects = activeSubjects.filter(r => r.consecutiveSlots > 1);
      for (const r of consecutiveSubjects) {
        if (r.periodsPerWeek % r.consecutiveSlots !== 0) {
          flags.push({
            type: 'warning',
            message: `"${r.subjectName}": periodsPerWeek (${r.periodsPerWeek}) is not divisible by consecutiveSlots (${r.consecutiveSlots}) — may result in partial placement.`,
          });
        }
      }

      return {
        divisionId: div.id,
        divisionLabel: divLabel,
        className: cls.name,
        classId: cls.id,
        divisionName: div.name,
        classTeacher: classTeacher
          ? { id: classTeacher.id, name: teachers.find(t => t.id === classTeacher.id)?.user.name ?? classTeacher.teacherCode, code: classTeacher.teacherCode }
          : null,
        totalCapacity,
        totalDemand,
        fillRate,
        subjectCount: activeSubjects.length,
        subjects: subjectRows,
        excludedSubjects,
        teacherDemand: Array.from(teacherDemandInDiv.entries()).map(([id, v]) => ({ id, ...v })),
        flags,
      };
    })
  );

  // ── Global teacher workload analysis ─────────────────────────────────────
  const teacherWorkload = teachers.map(t => {
    let totalDemand = 0;
    const divisionBreakdown: { divisionLabel: string; subjectName: string; periods: number }[] = [];

    for (const cls of classes) {
      for (const div of cls.divisions) {
        const divLabel = `${cls.name}${div.name}`;
        for (const s of subjects) {
          if (exclusionSet.has(`${div.id}:${s.id}`)) continue;
          
          let ppw = 0;
          let resolved: any = null;
          
          if (s.isLanguageVariant) {
            const baseSub = subjects.find(bs => bs.id === s.replacesSubjectId);
            if (!baseSub) continue;
            if (exclusionSet.has(`${div.id}:${baseSub.id}`)) continue;
            
            resolved = resolveTeacher(s.id, div.id, s.useClassTeacher, div.classTeacherId);
            if (resolved?.id !== t.id) continue;
            
            const override = overrideMap.get(`${cls.id}:${baseSub.id}`);
            ppw = override?.periodsPerWeek ?? baseSub.periodsPerWeek;
          } else {
            resolved = resolveTeacher(s.id, div.id, s.useClassTeacher, div.classTeacherId);
            if (resolved?.id !== t.id) continue;
            
            const override = overrideMap.get(`${cls.id}:${s.id}`);
            ppw = override?.periodsPerWeek ?? s.periodsPerWeek;
          }
          
          totalDemand += ppw;
          divisionBreakdown.push({ divisionLabel: divLabel, subjectName: s.name, periods: ppw });
        }
      }
    }

    const utilisation = totalCapacity > 0 ? Math.round((totalDemand / totalCapacity) * 100) : 0;
    return {
      id: t.id,
      name: t.user.name,
      code: t.teacherCode,
      subjectCount: t.subjectMappings.length,
      subjects: t.subjectMappings.map(m => {
        const sub = subjects.find(s => s.id === m.subjectId);
        return { subjectId: m.subjectId, subjectName: sub?.name ?? m.subjectId, subjectCode: sub?.code ?? '' };
      }),
      totalDemand,
      totalCapacity,
      utilisation,
      isOverloaded: totalDemand > totalCapacity,
      isIdle: totalDemand === 0,
      divisionBreakdown,
    };
  });

  // ── Summary stats ──────────────────────────────────────────────────────
  const totalExpectedSlots = divisionReport.reduce((sum, d) => sum + d.totalDemand, 0);
  const totalCapacityAllDivisions = divisionReport.length * totalCapacity;
  const overloadedDivisions = divisionReport.filter(d => d.totalDemand > totalCapacity).length;
  const emptyDivisions = divisionReport.filter(d => d.subjectCount === 0).length;
  const subjectsWithNoTeacher = subjectReport.filter(s => s.hasNoTeacher).length;
  const overloadedTeachers = teacherWorkload.filter(t => t.isOverloaded).length;
  const idleTeachers = teacherWorkload.filter(t => t.isIdle).length;

  return NextResponse.json({
    success: true,
    data: {
      schoolConfig: {
        periodsPerDay,
        workingDays,
        morningPeriods,
        afternoonPeriods: periodsPerDay - morningPeriods,
        totalCapacityPerDivision: totalCapacity,
        timetableLocked: tenant?.timetableLocked ?? false,
      },
      summary: {
        classCount: classes.length,
        divisionCount: divisionReport.length,
        subjectCount: subjects.length,
        schedulableSubjectCount: schedulableSubjects.length,
        variantSubjectCount: variantSubjects.length,
        teacherCount: teachers.length,
        totalExpectedSlots,
        totalCapacityAllDivisions,
        overallFillRate: totalCapacityAllDivisions > 0
          ? Math.round((totalExpectedSlots / totalCapacityAllDivisions) * 100)
          : 0,
        overloadedDivisions,
        emptyDivisions,
        subjectsWithNoTeacher,
        overloadedTeachers,
        idleTeachers,
      },
      subjects: subjectReport,
      divisions: divisionReport,
      teachers: teacherWorkload,
    },
  });
}
