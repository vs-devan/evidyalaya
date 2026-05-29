import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

/**
 * GET /api/teacher-subject-classes?teacherId=X
 * Returns all division restrictions for a teacher, grouped by subjectId.
 * Response: { [subjectId]: string[] (divisionIds) }
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const teacherId = searchParams.get('teacherId');
  if (!teacherId) return NextResponse.json({ error: 'teacherId required' }, { status: 400 });

  const restrictions = await prisma.teacherSubjectClass.findMany({
    where: { teacherId },
    select: { id: true, subjectId: true, divisionId: true },
  });

  // Group by subjectId → divisionId[]
  const grouped: Record<string, string[]> = {};
  for (const r of restrictions) {
    if (!grouped[r.subjectId]) grouped[r.subjectId] = [];
    grouped[r.subjectId].push(r.divisionId);
  }

  return NextResponse.json({ success: true, data: grouped });
}

/**
 * PUT /api/teacher-subject-classes
 * Set (replace) the allowed division list for a teacher-subject pair.
 * Body: { teacherId, subjectId, divisionIds: string[] }
 * divisionIds=[] → removes all restrictions (unrestricted for all divisions)
 */
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SCHOOL_ADMIN' || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const body = await req.json();
  const { teacherId, subjectId, divisionIds } = body;

  if (!teacherId || !subjectId || !Array.isArray(divisionIds)) {
    return NextResponse.json({ error: 'teacherId, subjectId, and divisionIds[] are required' }, { status: 400 });
  }

  await prisma.$transaction([
    prisma.teacherSubjectClass.deleteMany({ where: { teacherId, subjectId } }),
    ...(divisionIds.length > 0
      ? [prisma.teacherSubjectClass.createMany({
          data: divisionIds.map((divisionId: string) => ({ teacherId, subjectId, divisionId })),
        })]
      : []),
  ]);

  return NextResponse.json({ success: true });
}

/**
 * DELETE /api/teacher-subject-classes?teacherId=X&subjectId=Y
 * Remove ALL division restrictions for a teacher-subject pair (make unrestricted).
 */
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SCHOOL_ADMIN' || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const teacherId = searchParams.get('teacherId');
  const subjectId = searchParams.get('subjectId');

  if (!teacherId || !subjectId) {
    return NextResponse.json({ error: 'teacherId and subjectId required' }, { status: 400 });
  }

  await prisma.teacherSubjectClass.deleteMany({ where: { teacherId, subjectId } });
  return NextResponse.json({ success: true });
}
