import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { generateTimetable, TimetableInput, DivisionInput } from '@/lib/timetable-engine';
import { generateTimetableWithAI } from '@/lib/gemini';

// GET timetable for current tenant
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const divisionId = searchParams.get('divisionId');
  const dayOfWeek = searchParams.get('dayOfWeek');
  const teacherId = searchParams.get('teacherId');

  const where: any = { tenantId: session.user.tenantId };
  if (divisionId) where.divisionId = divisionId;
  if (dayOfWeek) where.dayOfWeek = parseInt(dayOfWeek);
  if (teacherId) where.teacherId = teacherId;

  const entries = await prisma.timetableEntry.findMany({
    where,
    include: {
      subject: {
        select: {
          id: true,
          name: true,
          code: true,
          isLanguageVariant: true,
          replacesSubjectId: true,
          variants: {
            select: { id: true, name: true, code: true },
          },
        },
      },
      teacher: { select: { id: true, teacherCode: true, user: { select: { name: true } } } },
      division: { include: { class: { select: { name: true } } } },
    },
    orderBy: [{ dayOfWeek: 'asc' }, { slotNumber: 'asc' }],
  });

  return NextResponse.json({ success: true, data: entries });
}

// POST generate timetable
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SCHOOL_ADMIN' || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const tenantId = session.user.tenantId;
  const generationWarnings: string[] = [];

  let activeConstraints: string[] = [];
  try {
    const body = await req.json();
    activeConstraints = body.constraints || [];
  } catch (e) {
    // No body or invalid JSON (fallback to empty, meaning all default built-ins apply)
  }

  // ── Fetch tenant settings ─────────────────────────────────────────────
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { periodsPerDay: true, workingDays: true, morningPeriods: true },
  });
  const periodsPerDay = tenant?.periodsPerDay ?? 7;
  const workingDays = tenant?.workingDays ?? 5;
  const morningPeriods = tenant?.morningPeriods ?? 4;

  // ── Fetch all subjects ────────────────────────────────────────────────
  const subjects = await prisma.subject.findMany({ where: { tenantId } });

  // Build a quick lookup: subjectId → subject
  const subjectMap = new Map(subjects.map(s => [s.id, s]));

  // Determine which subjects are "base" (not a language variant themselves)
  // Language variants replace another subject for specific students — we include
  // both the base subject AND its variants, but the engine will only schedule one.
  // For simplicity we include ALL subjects in each division unless filtered.
  const baseSubjectIds = new Set(subjects.map(s => s.id));

  // ── Fetch classes with divisions ──────────────────────────────────────
  const classes = await prisma.class.findMany({
    where: { tenantId },
    include: {
      divisions: {
        include: { classTeacher: true },
      },
    },
    orderBy: { order: 'asc' },
  });

  // ── Fetch teachers with subject mappings ──────────────────────────────
  const teachers = await prisma.teacher.findMany({
    where: { user: { tenantId } },
    include: {
      user: { select: { name: true } },
      subjectMappings: true,
      subjectClassRestrictions: true,
    },
  });

  // ── Build teacher-division restriction lookup ─────────────────────────
  // Map: `teacherId:subjectId` → Set<divisionId>   (missing key = unrestricted)
  const restrictionMap = new Map<string, Set<string>>();
  for (const teacher of teachers) {
    for (const r of teacher.subjectClassRestrictions) {
      const key = `${r.teacherId}:${r.subjectId}`;
      if (!restrictionMap.has(key)) restrictionMap.set(key, new Set());
      restrictionMap.get(key)!.add(r.divisionId);
    }
  }

  function isTeacherAllowedForDivision(teacherId: string, subjectId: string, divisionId: string): boolean {
    const enableClassRestriction = activeConstraints.length === 0 || activeConstraints.includes('c_restrict_class');
    if (!enableClassRestriction) return true;

    const key = `${teacherId}:${subjectId}`;
    const allowed = restrictionMap.get(key);
    if (!allowed || allowed.size === 0) return true; // no restriction → unrestricted
    return allowed.has(divisionId);
  }

  // ── Fetch per-class period overrides ──────────────────────────────────
  const classSubjectOverrides = await prisma.classSubject.findMany({
    where: { class: { tenantId } },
  });
  const overrideMap = new Map(
    classSubjectOverrides.map(o => [`${o.classId}:${o.subjectId}`, o])
  );

  // ── Fetch division-level subject exclusions ────────────────────────────
  // exclusionSet: Set of `${divisionId}:${subjectId}` pairs where excluded=true
  const divisionExclusions = await prisma.divisionSubject.findMany({
    where: {
      excluded: true,
      division: { class: { tenantId } },
    },
    select: { divisionId: true, subjectId: true },
  });
  const exclusionSet = new Set(divisionExclusions.map(e => `${e.divisionId}:${e.subjectId}`));

  // ── Resolve teacher for a given subject in a given division ──────────
  // Priority:
  //   1. If useClassTeacher flag → class teacher of this division
  //   2. The class teacher of this division (if they can teach this subject AND
  //      their restrictions allow it for this division)
  //   3. Any teacher who maps this subject AND passes division restriction
  //   4. Fallback: any teacher who maps this subject (restriction is relaxed, warning emitted)
  function resolveTeacher(
    subjectId: string,
    divisionId: string,
    useClassTeacher: boolean,
    classTeacherId: string | null,
    divisionName: string,
    subjectName: string,
  ): string {
    if (useClassTeacher) {
      if (classTeacherId) return classTeacherId;
      generationWarnings.push(`No class teacher set for ${divisionName} — "${subjectName}" (useClassTeacher) cannot be assigned`);
      return '';
    }

    // Prefer the class teacher IF they can teach this subject AND their
    // subject-class restrictions allow it for this specific division.
    if (classTeacherId) {
      const ct = teachers.find(t => t.id === classTeacherId);
      if (
        ct?.subjectMappings.some(sm => sm.subjectId === subjectId) &&
        isTeacherAllowedForDivision(classTeacherId, subjectId, divisionId)
      ) {
        return classTeacherId;
      }
    }

    // Other teachers who can teach this subject AND pass restriction
    const restricted = teachers.filter(t =>
      t.id !== classTeacherId &&
      t.subjectMappings.some(sm => sm.subjectId === subjectId) &&
      isTeacherAllowedForDivision(t.id, subjectId, divisionId)
    );
    if (restricted.length > 0) return restricted[0].id;

    // Fallback: any teacher who can teach this subject (restriction couldn't be satisfied)
    const any = teachers.filter(t =>
      t.id !== classTeacherId &&
      t.subjectMappings.some(sm => sm.subjectId === subjectId)
    );
    if (any.length > 0) {
      generationWarnings.push(`Division ${divisionName}: no teacher with valid restriction for "${subjectName}" — using ${any[0].user.name} (restriction ignored)`);
      return any[0].id;
    }

    generationWarnings.push(`Division ${divisionName}: no teacher found for "${subjectName}"`);
    return '';
  }

  // ── Build DivisionInput for the engine ────────────────────────────────
  // KEY DESIGN DECISION:
  // We do NOT require the DivisionSubject join table to be pre-populated.
  // All tenant subjects are used for every division by default.
  // Language variants (isLanguageVariant=true) that replace another subject are
  // excluded; only the base subject is included per division.
  // Per-class period overrides (ClassSubject) are applied.

  const divisionInputs: DivisionInput[] = [];

  // Filter to non-variant subjects (include base subjects only;
  // variants are an advanced feature handled separately)
  const schedulableSubjects = subjects.filter(s => !s.isLanguageVariant);

  for (const cls of classes) {
    for (const div of cls.divisions) {
      const divSubjects = schedulableSubjects
        .filter(subject => !exclusionSet.has(`${div.id}:${subject.id}`))
        .map(subject => {
        const override = overrideMap.get(`${cls.id}:${subject.id}`);
        const periodsPerWeek = override?.periodsPerWeek ?? subject.periodsPerWeek;
        const consecutiveSlots = override?.consecutiveSlots ?? subject.consecutiveSlots;

        const teacherId = resolveTeacher(
          subject.id,
          div.id,
          subject.useClassTeacher,
          div.classTeacherId,
          `${cls.name}${div.name}`,
          subject.name,
        );

        return {
          subjectId: subject.id,
          teacherId,
          periodsPerWeek,
          isCore: subject.isCore,
          eveningPriority: subject.eveningPriority,
          consecutiveSlots,
          fixedDay: subject.fixedDay,
          fixedSlot: subject.fixedSlot,
          useClassTeacher: subject.useClassTeacher,
        };
      }).filter(s => s.teacherId && s.periodsPerWeek > 0);

      divisionInputs.push({
        id: div.id,
        name: `${cls.name}${div.name}`,
        classId: cls.id,
        classTeacherId: div.classTeacherId,
        subjects: divSubjects,
      });
    }
  }

  if (divisionInputs.length === 0) {
    return NextResponse.json({
      success: false,
      data: {
        generated: 0,
        errors: ['No classes or divisions configured. Please add classes and divisions first.'],
        warnings: [],
        stats: { totalSlots: 0, filledSlots: 0, conflicts: 0, iterations: 0 },
        settings: { periodsPerDay, workingDays, morningPeriods },
      },
    });
  }

  if (subjects.length === 0) {
    return NextResponse.json({
      success: false,
      data: {
        generated: 0,
        errors: ['No subjects configured. Please add subjects and assign teachers first.'],
        warnings: [],
        stats: { totalSlots: 0, filledSlots: 0, conflicts: 0, iterations: 0 },
        settings: { periodsPerDay, workingDays, morningPeriods },
      },
    });
  }

  // ── Build engine input ────────────────────────────────────────────────
  const input: TimetableInput = {
    divisions: divisionInputs,
    subjects: subjects.map(s => ({
      id: s.id,
      name: s.name,
      isCore: s.isCore,
      eveningPriority: s.eveningPriority,
      consecutiveSlots: s.consecutiveSlots,
      periodsPerWeek: s.periodsPerWeek,
    })),
    teachers: teachers.map(t => ({
      id: t.id,
      name: t.user.name,
      teacherCode: t.teacherCode,
      subjectMappings: t.subjectMappings.map(sm => sm.subjectId),
      subjectClassRestrictions: t.subjectClassRestrictions.map(r => ({
        subjectId: r.subjectId,
        divisionId: r.divisionId,
      })),
    })),
    days: workingDays,
    slotsPerDay: periodsPerDay,
    morningPeriods,
  };

  // Build human-readable exclusions for AI context
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

  const totalExpectedSlots = divisionInputs.reduce(
    (sum, div) => sum + div.subjects.reduce((s, ds) => s + ds.periodsPerWeek, 0),
    0
  );

  let result = generateTimetable(input, activeConstraints);

  // If there are errors or unassigned slots, try to resolve using AI
  if (!result.success || result.timetable.length < totalExpectedSlots) {
    generationWarnings.push('Local engine scheduling failed to satisfy all constraints. Invoking Gemini AI for conflict resolution...');
    try {
      const aiSlots = await generateTimetableWithAI(
        {
          divisions: input.divisions,
          subjects: input.subjects,
          teachers: input.teachers,
          days: input.days,
          slotsPerDay: input.slotsPerDay,
          morningPeriods: input.morningPeriods,
          divisionExclusions: exclusionList,
        },
        activeConstraints,
        result.timetable
      );

      if (aiSlots && Array.isArray(aiSlots) && aiSlots.length > 0) {
        // Validate AI response data to prevent DB constraints errors
        const validDivisions = new Set(input.divisions.map(d => d.id));
        const validSubjects = new Set(input.subjects.map(s => s.id));
        const validTeachers = new Set(input.teachers.map(t => t.id));

        const validatedSlots = aiSlots.filter((slot: any) => {
          return (
            slot &&
            typeof slot.divisionId === 'string' &&
            validDivisions.has(slot.divisionId) &&
            typeof slot.subjectId === 'string' &&
            validSubjects.has(slot.subjectId) &&
            typeof slot.teacherId === 'string' &&
            validTeachers.has(slot.teacherId) &&
            typeof slot.dayOfWeek === 'number' &&
            slot.dayOfWeek >= 1 &&
            slot.dayOfWeek <= input.days &&
            typeof slot.slotNumber === 'number' &&
            slot.slotNumber >= 1 &&
            slot.slotNumber <= input.slotsPerDay &&
            // Respect division exclusions — never schedule an excluded subject for an excluded division
            !exclusionSet.has(`${slot.divisionId}:${slot.subjectId}`) &&
            // Respect teacher-class restrictions — never accept an AI slot where
            // the assigned teacher is not permitted to teach that subject to that division
            isTeacherAllowedForDivision(slot.teacherId, slot.subjectId, slot.divisionId)
          );
        });

        if (validatedSlots.length > 0) {
          result.timetable = validatedSlots;
          result.success = true;
          result.errors = [];
          generationWarnings.push(`Successfully optimized and completed the timetable using Gemini AI (${validatedSlots.length} valid slots).`);
        } else {
          generationWarnings.push('Gemini AI returned slots, but none passed validation.');
        }
      } else {
        generationWarnings.push('Gemini AI could not find a better conflict-free solution.');
      }
    } catch (error) {
      console.error('Gemini optimization error:', error);
      generationWarnings.push('Gemini AI conflict resolution failed due to an error.');
    }
  }

  const allWarnings = [...generationWarnings, ...(result.warnings ?? [])];

  // Always persist whatever was generated
  await prisma.timetableEntry.deleteMany({ where: { tenantId } });
  if (result.timetable.length > 0) {
    await prisma.timetableEntry.createMany({
      data: result.timetable.map(entry => ({
        tenantId,
        divisionId: entry.divisionId,
        dayOfWeek: entry.dayOfWeek,
        slotNumber: entry.slotNumber,
        subjectId: entry.subjectId,
        teacherId: entry.teacherId,
      })),
    });
  }

  return NextResponse.json({
    success: true,
    data: {
      generated: result.timetable.length,
      errors: result.errors,
      warnings: allWarnings,
      stats: {
        ...result.stats,
        filledSlots: result.timetable.length,
      },
      settings: { periodsPerDay, workingDays, morningPeriods },
    },
  });
}
