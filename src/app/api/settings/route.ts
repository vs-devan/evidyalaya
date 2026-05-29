import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

/**
 * GET /api/settings
 * Returns timetable settings for the current tenant.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: session.user.tenantId },
    select: {
      id: true,
      name: true,
      schoolName: true,
      section: true,
      academicYear: true,
      periodsPerDay: true,
      workingDays: true,
      morningPeriods: true,
    },
  });

  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });

  return NextResponse.json({ success: true, data: tenant });
}

/**
 * PATCH /api/settings
 * Update timetable settings for the current tenant.
 * Body: { periodsPerDay?, workingDays?, morningPeriods?, academicYear? }
 */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SCHOOL_ADMIN' || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const body = await req.json();
  const { periodsPerDay, workingDays, morningPeriods, academicYear } = body;

  // Validate
  if (periodsPerDay !== undefined && (periodsPerDay < 1 || periodsPerDay > 12)) {
    return NextResponse.json({ error: 'periodsPerDay must be between 1 and 12' }, { status: 400 });
  }
  if (workingDays !== undefined && workingDays !== 5 && workingDays !== 6) {
    return NextResponse.json({ error: 'workingDays must be 5 (Mon–Fri) or 6 (Mon–Sat)' }, { status: 400 });
  }
  if (morningPeriods !== undefined && periodsPerDay !== undefined && morningPeriods >= periodsPerDay) {
    return NextResponse.json({ error: 'morningPeriods must be less than periodsPerDay' }, { status: 400 });
  }

  const updated = await prisma.tenant.update({
    where: { id: session.user.tenantId },
    data: {
      ...(periodsPerDay !== undefined ? { periodsPerDay: parseInt(periodsPerDay) } : {}),
      ...(workingDays !== undefined ? { workingDays: parseInt(workingDays) } : {}),
      ...(morningPeriods !== undefined ? { morningPeriods: parseInt(morningPeriods) } : {}),
      ...(academicYear ? { academicYear } : {}),
    },
    select: { periodsPerDay: true, workingDays: true, morningPeriods: true, academicYear: true },
  });

  return NextResponse.json({ success: true, data: updated });
}
