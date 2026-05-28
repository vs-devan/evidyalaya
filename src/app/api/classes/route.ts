import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

// GET classes for current tenant
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const classes = await prisma.class.findMany({
    where: { tenantId: session.user.tenantId },
    include: {
      divisions: {
        include: {
          classTeacher: { include: { user: { select: { name: true } } } },
          _count: { select: { students: true } },
        },
        orderBy: { name: 'asc' },
      },
    },
    orderBy: { order: 'asc' },
  });

  return NextResponse.json({ success: true, data: classes });
}

// POST create class
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SCHOOL_ADMIN' || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { name, order, divisions } = await req.json();

  if (!name) {
    return NextResponse.json({ error: 'Class name is required' }, { status: 400 });
  }

  const cls = await prisma.class.create({
    data: {
      tenantId: session.user.tenantId,
      name,
      order: order || 0,
      divisions: {
        create: (divisions || ['A']).map((d: string) => ({ name: d })),
      },
    },
    include: { divisions: true },
  });

  return NextResponse.json({ success: true, data: cls }, { status: 201 });
}

// DELETE class
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SCHOOL_ADMIN' || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'Class ID is required' }, { status: 400 });
  }

  const divisions = await prisma.division.findMany({ where: { classId: id } });
  const divisionIds = divisions.map(d => d.id);

  await prisma.$transaction([
    prisma.timetableEntry.deleteMany({ where: { divisionId: { in: divisionIds } } }),
    prisma.attendance.deleteMany({ where: { student: { divisionId: { in: divisionIds } } } }),
    prisma.examResult.deleteMany({ where: { student: { divisionId: { in: divisionIds } } } }),
    prisma.student.deleteMany({ where: { divisionId: { in: divisionIds } } }),
    prisma.division.deleteMany({ where: { classId: id } }),
    prisma.class.delete({ where: { id, tenantId: session.user.tenantId } }),
  ]);

  return NextResponse.json({ success: true });
}

