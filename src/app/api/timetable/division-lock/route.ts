import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

// GET lock status for all divisions in the tenant
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SCHOOL_ADMIN' || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const divisions = await prisma.division.findMany({
      where: { class: { tenantId: session.user.tenantId } },
      select: {
        id: true,
        name: true,
        timetableLocked: true,
        class: { select: { name: true } },
      },
      orderBy: { class: { order: 'asc' } },
    });

    return NextResponse.json({
      success: true,
      data: divisions.map(d => ({
        divisionId: d.id,
        label: `${d.class.name}${d.name}`,
        locked: d.timetableLocked,
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message }, { status: 500 });
  }
}

// POST set lock status for one or more divisions
// Body: { divisions: [{ divisionId: string, locked: boolean }] }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SCHOOL_ADMIN' || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { divisions } = body;

    if (!Array.isArray(divisions) || divisions.length === 0) {
      return NextResponse.json({ success: false, error: 'divisions array is required' }, { status: 400 });
    }

    // Verify all divisions belong to this tenant
    const tenantDivisions = await prisma.division.findMany({
      where: { class: { tenantId: session.user.tenantId } },
      select: { id: true },
    });
    const validIds = new Set(tenantDivisions.map(d => d.id));

    const updates = [];
    for (const { divisionId, locked } of divisions) {
      if (!validIds.has(divisionId)) continue;
      updates.push(
        prisma.division.update({
          where: { id: divisionId },
          data: { timetableLocked: !!locked },
        })
      );
    }

    await prisma.$transaction(updates);

    return NextResponse.json({ success: true, updated: updates.length });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message }, { status: 500 });
  }
}
