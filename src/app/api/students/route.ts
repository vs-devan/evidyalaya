import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { hashPassword, generatePassword } from '@/lib/utils';

// GET students for a division
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const divisionId = searchParams.get('divisionId');

  if (!divisionId) {
    return NextResponse.json({ error: 'divisionId is required' }, { status: 400 });
  }

  const students = await prisma.student.findMany({
    where: { divisionId },
    include: {
      division: { include: { class: { select: { name: true } } } },
      user: { select: { username: true, isActive: true } },
    },
    orderBy: { rollNumber: 'asc' },
  });

  return NextResponse.json({ success: true, data: students });
}

// POST create student
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const body = await req.json();
  const { divisionId, rollNumber, name, parentName, parentPhone } = body;

  if (!divisionId || !rollNumber || !name) {
    return NextResponse.json({ error: 'Division, roll number, and name are required' }, { status: 400 });
  }

  // Get division info for username
  const division = await prisma.division.findUnique({
    where: { id: divisionId },
    include: { class: { include: { tenant: true } } },
  });

  if (!division) {
    return NextResponse.json({ error: 'Division not found' }, { status: 404 });
  }

  const tenantCode = division.class.tenant.code;
  const classDiv = `${division.class.name}${division.name}`.toLowerCase();
  const username = `${tenantCode}_${classDiv}_${String(rollNumber).padStart(2, '0')}`;
  const pwd = generatePassword();
  const hashed = await hashPassword(pwd);

  const user = await prisma.user.create({
    data: {
      tenantId: session.user.tenantId,
      username,
      password: hashed,
      name,
      role: 'PARENT',
      phone: parentPhone,
      mustChangePassword: true,
      createdById: session.user.id,
      student: {
        create: {
          divisionId,
          rollNumber: parseInt(String(rollNumber)),
          name,
          parentName,
          parentPhone,
        },
      },
    },
    include: { student: true },
  });

  return NextResponse.json({
    success: true,
    data: { ...user, generatedPassword: pwd },
  }, { status: 201 });
}

// DELETE student
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'Student ID is required' }, { status: 400 });
  }

  const student = await prisma.student.findUnique({
    where: { id },
    include: { user: true },
  });

  if (!student) {
    return NextResponse.json({ error: 'Student not found' }, { status: 404 });
  }

  const userId = student.user?.id;

  await prisma.$transaction([
    prisma.examResult.deleteMany({ where: { studentId: id } }),
    prisma.student.delete({ where: { id } }),
    ...(userId ? [prisma.user.delete({ where: { id: userId, tenantId: session.user.tenantId } })] : []),
  ]);

  return NextResponse.json({ success: true });
}

