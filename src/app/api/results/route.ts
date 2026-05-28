import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

// GET exam results
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const divisionId = searchParams.get('divisionId');
  const studentId = searchParams.get('studentId');
  const examName = searchParams.get('examName');

  const where: any = {};
  if (studentId) where.studentId = studentId;
  if (divisionId) where.student = { divisionId };
  if (examName) where.examName = examName;

  const results = await prisma.examResult.findMany({
    where,
    include: {
      student: { select: { name: true, rollNumber: true } },
      subject: { select: { name: true, code: true } },
    },
    orderBy: [{ student: { rollNumber: 'asc' } }, { subject: { name: 'asc' } }],
  });

  return NextResponse.json({ success: true, data: results });
}

// POST upload exam results (bulk)
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { examName, results } = await req.json();
  // results: [{ studentId, subjectId, marks, grade, maxMarks }]

  if (!examName || !results?.length) {
    return NextResponse.json({ error: 'Exam name and results are required' }, { status: 400 });
  }

  let created = 0;
  for (const r of results) {
    await prisma.examResult.upsert({
      where: {
        studentId_subjectId_examName: {
          studentId: r.studentId,
          subjectId: r.subjectId,
          examName,
        },
      },
      update: { marks: r.marks, grade: r.grade, maxMarks: r.maxMarks || 100 },
      create: {
        studentId: r.studentId,
        subjectId: r.subjectId,
        examName,
        marks: r.marks,
        grade: r.grade,
        maxMarks: r.maxMarks || 100,
      },
    });
    created++;
  }

  return NextResponse.json({ success: true, message: `${created} results saved` });
}
