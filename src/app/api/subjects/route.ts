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
  const { name, code, periodsPerWeek, isCore, eveningPriority, consecutiveSlots, isLanguageVariant, replacesSubjectId } = body;

  if (!name || !code) {
    return NextResponse.json({ error: 'Name and code are required' }, { status: 400 });
  }

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
    },
  });

  return NextResponse.json({ success: true, data: subject }, { status: 201 });
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

