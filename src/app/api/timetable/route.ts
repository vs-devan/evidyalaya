import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { generateTimetable, TimetableInput, DivisionInput } from '@/lib/timetable-engine';

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
      subject: { select: { id: true, name: true, code: true } },
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

  // Fetch all data needed for generation
  const classes = await prisma.class.findMany({
    where: { tenantId },
    include: {
      divisions: {
        include: {
          classTeacher: true,
          divisionSubjects: {
            include: { subject: true },
          },
        },
      },
    },
  });

  const subjects = await prisma.subject.findMany({ where: { tenantId } });
  const teachers = await prisma.teacher.findMany({
    where: { user: { tenantId } },
    include: {
      user: { select: { name: true } },
      subjectMappings: true,
    },
  });

  // Build input for the engine
  const divisionInputs: DivisionInput[] = [];

  for (const cls of classes) {
    for (const div of cls.divisions) {
      const divSubjects = div.divisionSubjects.map(ds => {
        // Find a teacher assigned to this subject for this division
        // Use the first teacher who teaches this subject
        const teacherForSubject = teachers.find(t =>
          t.subjectMappings.some(sm => sm.subjectId === ds.subjectId)
        );

        return {
          subjectId: ds.subjectId,
          teacherId: teacherForSubject?.id || '',
          periodsPerWeek: ds.subject.periodsPerWeek,
          isCore: ds.subject.isCore,
          eveningPriority: ds.subject.eveningPriority,
          consecutiveSlots: ds.subject.consecutiveSlots,
        };
      }).filter(s => s.teacherId); // Only include subjects that have teachers

      divisionInputs.push({
        id: div.id,
        name: `${cls.name}${div.name}`,
        classTeacherId: div.classTeacherId,
        subjects: divSubjects,
      });
    }
  }

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
    })),
    days: 5,
    slotsPerDay: 7,
  };

  const result = generateTimetable(input);

  if (result.success || result.timetable.length > 0) {
    // Clear existing timetable
    await prisma.timetableEntry.deleteMany({ where: { tenantId } });

    // Insert new entries
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
  }

  return NextResponse.json({
    success: true,
    data: {
      generated: result.timetable.length,
      errors: result.errors,
      warnings: result.warnings,
      stats: result.stats,
    },
  });
}
