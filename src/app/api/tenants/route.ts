import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { hashPassword } from '@/lib/utils';

// GET all tenants
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const tenants = await prisma.tenant.findMany({
    include: { _count: { select: { users: true, classes: true } } },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ success: true, data: tenants });
}

// POST create tenant + school admin
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const body = await req.json();
  const { name, code, schoolName, section, academicYear, adminName, adminUsername, adminPassword } = body;

  if (!name || !code || !schoolName || !section) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const existing = await prisma.tenant.findUnique({ where: { code } });
  if (existing) {
    return NextResponse.json({ error: 'Tenant code already exists' }, { status: 400 });
  }

  const tenant = await prisma.tenant.create({
    data: {
      name, code, schoolName, section,
      academicYear: academicYear || '2025-2026',
    },
  });

  // Create school admin user
  const schoolCode = code.trim();
  const finalAdminUsername = (adminUsername && adminUsername.trim()) || `admin_${schoolCode}`;
  const finalAdminPassword = (adminPassword && adminPassword.trim()) || `${schoolCode}admin`;

  const hashed = await hashPassword(finalAdminPassword);
  await prisma.user.create({
    data: {
      tenantId: tenant.id,
      username: finalAdminUsername,
      password: hashed,
      name: adminName || `${schoolName} Admin`,
      role: 'SCHOOL_ADMIN',
      mustChangePassword: true,
      createdById: session.user.id,
    },
  });

  return NextResponse.json({ success: true, data: tenant }, { status: 201 });
}

// DELETE tenant
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'Tenant ID is required' }, { status: 400 });
  }

  const classes = await prisma.class.findMany({ where: { tenantId: id } });
  const classIds = classes.map(c => c.id);
  const divisions = await prisma.division.findMany({ where: { classId: { in: classIds } } });
  const divisionIds = divisions.map(d => d.id);

  await prisma.$transaction([
    prisma.timetableEntry.deleteMany({ where: { divisionId: { in: divisionIds } } }),
    prisma.attendance.deleteMany({ where: { student: { divisionId: { in: divisionIds } } } }),
    prisma.examResult.deleteMany({ where: { student: { divisionId: { in: divisionIds } } } }),
    prisma.student.deleteMany({ where: { divisionId: { in: divisionIds } } }),
    prisma.division.deleteMany({ where: { classId: { in: classIds } } }),
    prisma.class.deleteMany({ where: { tenantId: id } }),
    prisma.teacherSubject.deleteMany({ where: { teacher: { user: { tenantId: id } } } }),
    prisma.certificate.deleteMany({ where: { tenantId: id } }),
    prisma.substituteAssignment.deleteMany({ where: { tenantId: id } }),
    prisma.messageRecipient.deleteMany({ where: { message: { tenantId: id } } }),
    prisma.message.deleteMany({ where: { tenantId: id } }),
    prisma.teacher.deleteMany({ where: { user: { tenantId: id } } }),
    prisma.featureAccess.deleteMany({ where: { user: { tenantId: id } } }),
    prisma.subject.deleteMany({ where: { tenantId: id } }),
    prisma.user.deleteMany({ where: { tenantId: id } }),
    prisma.tenant.delete({ where: { id } }),
  ]);

  return NextResponse.json({ success: true });
}

