import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

// GET subjects for current tenant
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const subjects = await prisma.subject.findMany({
    where: { tenantId: session.user.tenantId },
    include: {
      replacesSubject: { select: { id: true, name: true } },
      variants: { select: { id: true, name: true } },
      _count: { select: { teacherMappings: true } },
    },
    orderBy: { name: 'asc' },
  });

  return NextResponse.json({ success: true, data: subjects });
}

// POST create subject
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SCHOOL_ADMIN' || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const body = await req.json();
  const {
    name, code, periodsPerWeek, isCore, eveningPriority, consecutiveSlots,
    isLanguageVariant, replacesSubjectId,
    fixedDay, fixedSlot, useClassTeacher, sharedVenueGroupId,
  } = body;

  if (!name || !code) {
    return NextResponse.json({ error: 'Name and code are required' }, { status: 400 });
  }

  // Create subject record in database
  const subject = await prisma.subject.create({
    data: {
      tenantId: session.user.tenantId,
      name,
      code,
      periodsPerWeek: periodsPerWeek || 1,
      isCore: isCore ?? true,
      eveningPriority: eveningPriority ?? false,
      consecutiveSlots: consecutiveSlots || 1,
      isLanguageVariant: isLanguageVariant ?? false,
      replacesSubjectId: replacesSubjectId || null,
      fixedDay: fixedDay !== undefined && fixedDay !== '' && fixedDay !== null ? parseInt(String(fixedDay), 10) : null,
      fixedSlot: fixedSlot !== undefined && fixedSlot !== '' && fixedSlot !== null ? String(fixedSlot) : null,
      useClassTeacher: useClassTeacher ?? false,
      sharedVenueGroupId: sharedVenueGroupId !== undefined && sharedVenueGroupId !== '' ? String(sharedVenueGroupId) : null,
    },
  });

  return NextResponse.json({ success: true, data: subject }, { status: 201 });
}

// PATCH update subject
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SCHOOL_ADMIN' || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const body = await req.json();
  const {
    id, name, code, periodsPerWeek, isCore, eveningPriority, consecutiveSlots,
    isLanguageVariant, replacesSubjectId,
    fixedDay, fixedSlot, useClassTeacher, sharedVenueGroupId,
  } = body;

  if (!id) return NextResponse.json({ error: 'Subject ID is required' }, { status: 400 });
  if (!name || !code) return NextResponse.json({ error: 'Name and code are required' }, { status: 400 });

  const existing = await prisma.subject.findFirst({
    where: { id, tenantId: session.user.tenantId },
  });
  if (!existing) return NextResponse.json({ error: 'Subject not found' }, { status: 404 });

  // Update subject record in database
  const subject = await prisma.subject.update({
    where: { id },
    data: {
      name,
      code,
      periodsPerWeek: periodsPerWeek ?? existing.periodsPerWeek,
      isCore: isCore ?? existing.isCore,
      eveningPriority: eveningPriority ?? existing.eveningPriority,
      consecutiveSlots: consecutiveSlots ?? existing.consecutiveSlots,
      isLanguageVariant: isLanguageVariant ?? existing.isLanguageVariant,
      replacesSubjectId: replacesSubjectId || null,
      fixedDay: fixedDay !== undefined ? (fixedDay !== '' && fixedDay !== null ? parseInt(String(fixedDay), 10) : null) : existing.fixedDay,
      fixedSlot: fixedSlot !== undefined ? (fixedSlot !== '' && fixedSlot !== null ? String(fixedSlot) : null) : existing.fixedSlot,
      useClassTeacher: useClassTeacher ?? existing.useClassTeacher,
      sharedVenueGroupId: sharedVenueGroupId !== undefined
        ? (sharedVenueGroupId !== '' && sharedVenueGroupId !== null ? String(sharedVenueGroupId) : null)
        : existing.sharedVenueGroupId,
    },
  });

  return NextResponse.json({ success: true, data: subject });
}

// DELETE subject
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SCHOOL_ADMIN' || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'Subject ID is required' }, { status: 400 });
  }

  await prisma.$transaction([
    prisma.timetableEntry.deleteMany({ where: { subjectId: id } }),
    prisma.teacherSubject.deleteMany({ where: { subjectId: id } }),
    prisma.examResult.deleteMany({ where: { subjectId: id } }),
    prisma.subject.updateMany({ where: { replacesSubjectId: id }, data: { replacesSubjectId: null } }),
    prisma.subject.delete({ where: { id, tenantId: session.user.tenantId } }),
  ]);

  return NextResponse.json({ success: true });
}

