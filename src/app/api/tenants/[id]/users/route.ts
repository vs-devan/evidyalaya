import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { id } = await params;

  const users = await prisma.user.findMany({
    where: { tenantId: id },
    select: { id: true, username: true, name: true, role: true, isActive: true, email: true, phone: true },
    orderBy: { name: 'asc' },
  });

  return NextResponse.json({ success: true, data: users });
}

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');

  if (!userId) {
    return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { teacher: true, student: true },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  await prisma.$transaction([
    ...(user.teacher ? [
      prisma.division.updateMany({ where: { classTeacherId: user.teacher.id }, data: { classTeacherId: null } }),
      prisma.timetableEntry.deleteMany({ where: { teacherId: user.teacher.id } }),
      prisma.teacherSubject.deleteMany({ where: { teacherId: user.teacher.id } }),
      prisma.teacher.delete({ where: { id: user.teacher.id } }),
    ] : []),
    ...(user.student ? [
      prisma.examResult.deleteMany({ where: { studentId: user.student.id } }),
      prisma.student.delete({ where: { id: user.student.id } }),
    ] : []),
    prisma.featureAccess.deleteMany({ where: { userId } }),
    prisma.user.delete({ where: { id: userId } }),
  ]);

  return NextResponse.json({ success: true });
}

