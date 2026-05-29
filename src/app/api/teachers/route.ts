import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { hashPassword, generatePassword } from '@/lib/utils';

// GET teachers for current tenant
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const teachers = await prisma.teacher.findMany({
    where: { user: { tenantId: session.user.tenantId } },
    include: {
      user: { select: { id: true, username: true, name: true, phone: true, email: true, isActive: true } },
      subjectMappings: { include: { subject: { select: { id: true, name: true, code: true } } } },
      classTeacherOf: { include: { class: { select: { name: true } } } },
    },
    orderBy: { teacherCode: 'asc' },
  });

  return NextResponse.json({ success: true, data: teachers });
}

// POST create teacher
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SCHOOL_ADMIN' || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const body = await req.json();
  const { name, teacherCode, penNo, designation, username, password, phone, email, subjectIds, classTeacherDivisionId, features } = body;

  if (!name || !teacherCode || !designation || !username) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const existingUser = await prisma.user.findUnique({ where: { username } });
  if (existingUser) {
    return NextResponse.json({ error: 'Username already exists' }, { status: 400 });
  }

  const pwd = password || generatePassword();
  const hashed = await hashPassword(pwd);

  const user = await prisma.user.create({
    data: {
      tenantId: session.user.tenantId,
      username,
      password: hashed,
      name,
      role: 'TEACHER',
      phone,
      email,
      mustChangePassword: !password,
      createdById: session.user.id,
      teacher: {
        create: {
          teacherCode,
          penNo,
          designation,
          subjectMappings: {
            create: (subjectIds || []).map((sid: string) => ({ subjectId: sid })),
          },
        },
      },
      featureAccess: {
        create: (features || []).map((f: string) => ({ feature: f })),
      },
    },
    include: {
      teacher: { include: { subjectMappings: true } },
    },
  });

  // Assign class teacher if specified
  if (classTeacherDivisionId && user.teacher) {
    await prisma.division.update({
      where: { id: classTeacherDivisionId },
      data: { classTeacherId: user.teacher.id },
    });
  }

  return NextResponse.json({
    success: true,
    data: { ...user, generatedPassword: !password ? pwd : undefined },
  }, { status: 201 });
}

// PATCH update teacher
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SCHOOL_ADMIN' || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const body = await req.json();
  const { id, name, teacherCode, penNo, designation, phone, email, subjectIds, classTeacherDivisionId, features } = body;

  if (!id) return NextResponse.json({ error: 'Teacher ID required' }, { status: 400 });

  const teacher = await prisma.teacher.findUnique({
    where: { id },
    include: { user: true, classTeacherOf: true },
  });
  if (!teacher || teacher.user.tenantId !== session.user.tenantId) {
    return NextResponse.json({ error: 'Teacher not found' }, { status: 404 });
  }

  const userId = teacher.user.id;

  await prisma.$transaction(async (tx) => {
    // Update user profile
    if (name || phone !== undefined || email !== undefined) {
      await tx.user.update({
        where: { id: userId },
        data: {
          ...(name ? { name } : {}),
          ...(phone !== undefined ? { phone } : {}),
          ...(email !== undefined ? { email } : {}),
        },
      });
    }

    // Update teacher core fields
    await tx.teacher.update({
      where: { id },
      data: {
        ...(teacherCode ? { teacherCode } : {}),
        ...(penNo !== undefined ? { penNo } : {}),
        ...(designation ? { designation } : {}),
      },
    });

    // Replace subject mappings
    if (subjectIds !== undefined) {
      await tx.teacherSubject.deleteMany({ where: { teacherId: id } });
      if (subjectIds.length > 0) {
        await tx.teacherSubject.createMany({
          data: subjectIds.map((sid: string) => ({ teacherId: id, subjectId: sid })),
        });
      }
    }

    // Update class teacher assignment
    if (classTeacherDivisionId !== undefined) {
      // Remove existing assignment
      await tx.division.updateMany({ where: { classTeacherId: id }, data: { classTeacherId: null } });
      if (classTeacherDivisionId) {
        await tx.division.update({
          where: { id: classTeacherDivisionId },
          data: { classTeacherId: id },
        });
      }
    }

    // Replace feature access
    if (features !== undefined) {
      await tx.featureAccess.deleteMany({ where: { userId } });
      if (features.length > 0) {
        await tx.featureAccess.createMany({
          data: features.map((f: string) => ({ userId, feature: f })),
        });
      }
    }
  });

  return NextResponse.json({ success: true });
}

// DELETE teacher
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SCHOOL_ADMIN' || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'Teacher ID is required' }, { status: 400 });
  }

  const teacher = await prisma.teacher.findUnique({
    where: { id },
    include: { user: true },
  });

  if (!teacher) {
    return NextResponse.json({ error: 'Teacher not found' }, { status: 404 });
  }

  const userId = teacher.user.id;

  await prisma.$transaction([
    prisma.division.updateMany({ where: { classTeacherId: id }, data: { classTeacherId: null } }),
    prisma.timetableEntry.deleteMany({ where: { teacherId: id } }),
    prisma.teacherSubject.deleteMany({ where: { teacherId: id } }),
    prisma.featureAccess.deleteMany({ where: { userId } }),
    prisma.teacher.delete({ where: { id } }),
    prisma.user.delete({ where: { id: userId, tenantId: session.user.tenantId } }),
  ]);

  return NextResponse.json({ success: true });
}

