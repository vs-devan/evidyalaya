import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

/**
 * GET /api/division-subjects?subjectId=X
 * Returns all excluded divisions for a subject.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const subjectId = searchParams.get('subjectId');

  if (!subjectId) {
    return NextResponse.json({ error: 'subjectId is required' }, { status: 400 });
  }

  // Verify subject belongs to tenant
  const subject = await prisma.subject.findFirst({
    where: { id: subjectId, tenantId: session.user.tenantId },
  });
  if (!subject) return NextResponse.json({ error: 'Subject not found' }, { status: 404 });

  // Get all DivisionSubjects with excluded=true for this subject, across all divisions of this tenant
  const excluded = await prisma.divisionSubject.findMany({
    where: {
      subjectId,
      division: { class: { tenantId: session.user.tenantId } },
      excluded: true,
    },
    select: { divisionId: true },
  });

  return NextResponse.json({ success: true, data: excluded.map(e => e.divisionId) });
}

/**
 * PUT /api/division-subjects
 * Set which divisions are excluded from a subject.
 * Body: { subjectId: string, excludedDivisionIds: string[] }
 */
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SCHOOL_ADMIN' || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const body = await req.json();
  const { subjectId, excludedDivisionIds } = body as {
    subjectId: string;
    excludedDivisionIds: string[];
  };

  if (!subjectId || !Array.isArray(excludedDivisionIds)) {
    return NextResponse.json({ error: 'subjectId and excludedDivisionIds[] are required' }, { status: 400 });
  }

  // Verify subject belongs to tenant
  const subject = await prisma.subject.findFirst({
    where: { id: subjectId, tenantId: session.user.tenantId },
  });
  if (!subject) return NextResponse.json({ error: 'Subject not found' }, { status: 404 });

  // Get all divisions in this tenant
  const allDivisions = await prisma.division.findMany({
    where: { class: { tenantId: session.user.tenantId } },
    select: { id: true },
  });
  const allDivisionIds = allDivisions.map(d => d.id);

  // Validate that passed IDs belong to this tenant
  const validExcluded = excludedDivisionIds.filter(id => allDivisionIds.includes(id));

  // Upsert DivisionSubject for each division:
  // - excluded=true if in excludedDivisionIds
  // - if not excluded and existing record exists, delete or set excluded=false
  // We do this in a transaction
  await prisma.$transaction(async (tx) => {
    // For divisions being excluded: upsert with excluded=true
    for (const divisionId of validExcluded) {
      await tx.divisionSubject.upsert({
        where: { divisionId_subjectId: { divisionId, subjectId } },
        create: { divisionId, subjectId, excluded: true },
        update: { excluded: true },
      });
    }

    // For divisions no longer excluded: set excluded=false
    const notExcluded = allDivisionIds.filter(id => !validExcluded.includes(id));
    for (const divisionId of notExcluded) {
      await tx.divisionSubject.updateMany({
        where: { divisionId, subjectId },
        data: { excluded: false },
      });
    }
  });

  return NextResponse.json({ success: true, data: { subjectId, excludedDivisionIds: validExcluded } });
}
