import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

/**
 * GET /api/class-subjects?classId=X
 * Returns all ClassSubject overrides for a given class.
 * Also accepts ?subjectId=Y to get overrides for a specific subject across all classes.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const classId = searchParams.get('classId');
  const subjectId = searchParams.get('subjectId');

  const where: any = {};

  if (classId) {
    // Verify the class belongs to this tenant
    const cls = await prisma.class.findFirst({
      where: { id: classId, tenantId: session.user.tenantId },
    });
    if (!cls) return NextResponse.json({ error: 'Class not found' }, { status: 404 });
    where.classId = classId;
  }

  if (subjectId) {
    where.subjectId = subjectId;
    // Verify the subject belongs to this tenant
    const subject = await prisma.subject.findFirst({
      where: { id: subjectId, tenantId: session.user.tenantId },
    });
    if (!subject) return NextResponse.json({ error: 'Subject not found' }, { status: 404 });
  }

  const overrides = await prisma.classSubject.findMany({
    where,
    include: {
      class: { select: { id: true, name: true, order: true } },
      subject: { select: { id: true, name: true, code: true, periodsPerWeek: true, consecutiveSlots: true } },
    },
    orderBy: { class: { order: 'asc' } },
  });

  return NextResponse.json({ success: true, data: overrides });
}

/**
 * PUT /api/class-subjects
 * Upsert a ClassSubject override.
 * Body: { classId, subjectId, periodsPerWeek?, consecutiveSlots? }
 * Pass null for either field to remove that override (revert to subject default).
 */
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SCHOOL_ADMIN' || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const body = await req.json();
  const { classId, subjectId, periodsPerWeek, consecutiveSlots } = body;

  if (!classId || !subjectId) {
    return NextResponse.json({ error: 'classId and subjectId are required' }, { status: 400 });
  }

  // Verify ownership
  const [cls, subject] = await Promise.all([
    prisma.class.findFirst({ where: { id: classId, tenantId: session.user.tenantId } }),
    prisma.subject.findFirst({ where: { id: subjectId, tenantId: session.user.tenantId } }),
  ]);

  if (!cls) return NextResponse.json({ error: 'Class not found' }, { status: 404 });
  if (!subject) return NextResponse.json({ error: 'Subject not found' }, { status: 404 });

  // If both values are null/undefined, delete the override (revert to default)
  const pVal = periodsPerWeek === undefined ? undefined : (periodsPerWeek === null ? null : parseInt(periodsPerWeek));
  const cVal = consecutiveSlots === undefined ? undefined : (consecutiveSlots === null ? null : parseInt(consecutiveSlots));

  // Check if either field has a meaningful value
  if (pVal === null && cVal === null) {
    // Delete the override record entirely
    await prisma.classSubject.deleteMany({ where: { classId, subjectId } });
    return NextResponse.json({ success: true, deleted: true });
  }

  const override = await prisma.classSubject.upsert({
    where: { classId_subjectId: { classId, subjectId } },
    create: {
      classId,
      subjectId,
      periodsPerWeek: pVal ?? null,
      consecutiveSlots: cVal ?? null,
    },
    update: {
      periodsPerWeek: pVal,
      consecutiveSlots: cVal,
    },
    include: {
      class: { select: { name: true } },
      subject: { select: { name: true } },
    },
  });

  return NextResponse.json({ success: true, data: override });
}

/**
 * DELETE /api/class-subjects?classId=X&subjectId=Y
 * Remove the per-class override (revert to Subject default).
 */
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SCHOOL_ADMIN' || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const classId = searchParams.get('classId');
  const subjectId = searchParams.get('subjectId');

  if (!classId || !subjectId) {
    return NextResponse.json({ error: 'classId and subjectId are required' }, { status: 400 });
  }

  await prisma.classSubject.deleteMany({ where: { classId, subjectId } });

  return NextResponse.json({ success: true });
}
