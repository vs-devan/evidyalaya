import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { compare } from 'bcryptjs';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SCHOOL_ADMIN' || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: session.user.tenantId },
      select: { timetableLocked: true },
    });

    return NextResponse.json({
      success: true,
      locked: tenant?.timetableLocked ?? false,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SCHOOL_ADMIN' || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const tenantId = session.user.tenantId;

  try {
    const body = await req.json();
    const { action, password } = body;

    if (action === 'lock') {
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { timetableLocked: true },
      });
      return NextResponse.json({ success: true, locked: true });
    }

    if (action === 'unlock') {
      if (!password) {
        return NextResponse.json({ success: false, error: 'Password is required to unlock.' }, { status: 400 });
      }

      // Fetch the admin user's hashed password
      const adminUser = await prisma.user.findUnique({
        where: { username: session.user.username },
        select: { password: true },
      });

      if (!adminUser) {
        return NextResponse.json({ success: false, error: 'Admin account not found.' }, { status: 404 });
      }

      // Verify the password
      const isValid = await compare(password, adminUser.password);
      if (!isValid) {
        return NextResponse.json({ success: false, error: 'Incorrect admin password.' }, { status: 401 });
      }

      // Password matches, unlock the timetable
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { timetableLocked: false },
      });

      return NextResponse.json({ success: true, locked: false });
    }

    return NextResponse.json({ success: false, error: 'Invalid action.' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message }, { status: 500 });
  }
}
