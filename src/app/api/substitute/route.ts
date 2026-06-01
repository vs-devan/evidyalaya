import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

// GET substitute assignments for a date
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date');

  if (!date) {
    return NextResponse.json({ error: 'Date is required' }, { status: 400 });
  }

  const subs = await prisma.substituteAssignment.findMany({
    where: { tenantId: session.user.tenantId, date: new Date(date) },
    include: {
      absentTeacher: { include: { user: { select: { name: true } } } },
      substituteTeacher: { include: { user: { select: { name: true } } } },
      originalDivision: { include: { class: { select: { name: true } } } },
    },
    orderBy: { originalSlotNumber: 'asc' },
  });

  return NextResponse.json({ success: true, data: subs });
}

// POST create substitute assignment
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SCHOOL_ADMIN' || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { date, absentTeacherId, assignments } = await req.json();
  // assignments: [{ slotNumber, divisionId, substituteTeacherId }]

  if (!date || !absentTeacherId || !assignments?.length) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const subDate = new Date(date);

  const created = [];
  for (const a of assignments) {
    const sub = await prisma.substituteAssignment.upsert({
      where: {
        date_originalDivisionId_originalSlotNumber: {
          date: subDate,
          originalDivisionId: a.divisionId,
          originalSlotNumber: a.slotNumber,
        },
      },
      update: { substituteTeacherId: a.substituteTeacherId },
      create: {
        tenantId: session.user.tenantId,
        date: subDate,
        absentTeacherId,
        originalSlotNumber: a.slotNumber,
        originalDivisionId: a.divisionId,
        substituteTeacherId: a.substituteTeacherId,
        assignedById: session.user.id,
      },
    });
    created.push(sub);
  }

  return NextResponse.json({ success: true, data: created }, { status: 201 });
}

// DELETE substitute assignment
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SCHOOL_ADMIN' || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'ID is required' }, { status: 400 });
  }

  const existing = await prisma.substituteAssignment.findUnique({
    where: { id },
  });

  if (!existing || existing.tenantId !== session.user.tenantId) {
    return NextResponse.json({ error: 'Not found or unauthorized' }, { status: 404 });
  }

  await prisma.substituteAssignment.delete({
    where: { id },
  });

  return NextResponse.json({ success: true, message: 'Assignment deleted successfully' });
}
