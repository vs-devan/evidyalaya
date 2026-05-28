import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { hashPassword } from '@/lib/utils';
import { compare } from 'bcryptjs';

// POST change password (self or hierarchical)
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { targetUserId, newPassword, confirmAdminPassword } = await req.json();

  if (!newPassword) {
    return NextResponse.json({ error: 'New password is required' }, { status: 400 });
  }

  // Self password change
  if (!targetUserId || targetUserId === session.user.id) {
    const hashed = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: session.user.id },
      data: { password: hashed, mustChangePassword: false },
    });
    return NextResponse.json({ success: true, message: 'Password updated' });
  }

  // Hierarchical password change - must confirm admin password
  if (!confirmAdminPassword) {
    return NextResponse.json({ error: 'Admin password confirmation required' }, { status: 400 });
  }

  const admin = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!admin) {
    return NextResponse.json({ error: 'Admin not found' }, { status: 404 });
  }

  const isValid = await compare(confirmAdminPassword, admin.password);
  if (!isValid) {
    return NextResponse.json({ error: 'Invalid admin password' }, { status: 401 });
  }

  // Check hierarchy
  const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!targetUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const hierarchy: Record<string, string[]> = {
    SUPER_ADMIN: ['SCHOOL_ADMIN', 'TEACHER', 'PARENT'],
    SCHOOL_ADMIN: ['TEACHER', 'PARENT'],
    TEACHER: ['PARENT'],
  };

  const allowedTargets = hierarchy[session.user.role] || [];
  if (!allowedTargets.includes(targetUser.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  // For SCHOOL_ADMIN, ensure same tenant
  if (session.user.role === 'SCHOOL_ADMIN' && targetUser.tenantId !== session.user.tenantId) {
    return NextResponse.json({ error: 'Cannot modify users from other tenants' }, { status: 403 });
  }

  const hashed = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: targetUserId },
    data: { password: hashed, mustChangePassword: true },
  });

  return NextResponse.json({ success: true, message: 'Password updated' });
}
