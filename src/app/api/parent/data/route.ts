import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'PARENT') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id },
    include: { division: { include: { class: true } } },
  });

  if (!student) {
    return NextResponse.json({ error: 'Student not found' }, { status: 404 });
  }

  const [timetable, attendance, results] = await Promise.all([
    prisma.timetableEntry.findMany({
      where: { divisionId: student.divisionId },
      include: {
        subject: { select: { name: true, code: true } },
        teacher: { select: { teacherCode: true } },
      },
      orderBy: [{ dayOfWeek: 'asc' }, { slotNumber: 'asc' }],
    }),
    prisma.attendance.findMany({
      where: { studentId: student.id },
      orderBy: { date: 'desc' },
      take: 90,
    }),
    prisma.examResult.findMany({
      where: { studentId: student.id },
      include: { subject: { select: { name: true, code: true } } },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return NextResponse.json({
    success: true,
    data: { student, timetable, attendance, results },
  });
}
