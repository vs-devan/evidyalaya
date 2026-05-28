import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

// GET attendance
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const divisionId = searchParams.get('divisionId');
  const date = searchParams.get('date');
  const studentId = searchParams.get('studentId');

  const where: any = {};
  if (studentId) {
    where.studentId = studentId;
  } else if (divisionId) {
    where.student = { divisionId };
  }
  if (date) {
    where.date = new Date(date);
  }

  const attendance = await prisma.attendance.findMany({
    where,
    include: {
      student: { select: { id: true, name: true, rollNumber: true } },
    },
    orderBy: { date: 'desc' },
  });

  return NextResponse.json({ success: true, data: attendance });
}

// POST mark attendance (bulk)
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { divisionId, date, records } = await req.json();
  // records: [{ studentId, isPresent }]

  if (!divisionId || !date || !records?.length) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const attendanceDate = new Date(date);

  // Upsert attendance records
  for (const record of records) {
    await prisma.attendance.upsert({
      where: {
        studentId_date: {
          studentId: record.studentId,
          date: attendanceDate,
        },
      },
      update: { isPresent: record.isPresent },
      create: {
        studentId: record.studentId,
        date: attendanceDate,
        isPresent: record.isPresent,
        markedById: session.user.id,
      },
    });
  }

  return NextResponse.json({ success: true, message: 'Attendance saved' });
}
