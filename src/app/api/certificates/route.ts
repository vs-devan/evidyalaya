import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { generateCertificateContent } from '@/lib/gemini';

// GET certificates
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const certs = await prisma.certificate.findMany({
    where: { tenantId: session.user.tenantId },
    include: {
      generatedFor: { include: { user: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ success: true, data: certs });
}

// POST generate certificate
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SCHOOL_ADMIN' || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const body = await req.json();
  const { type, teacherId, additionalContext, supportingDocContent } = body;

  if (!type || !teacherId) {
    return NextResponse.json({ error: 'Type and teacher are required' }, { status: 400 });
  }

  const teacher = await prisma.teacher.findUnique({
    where: { id: teacherId },
    include: { user: { select: { name: true, tenantId: true } } },
  });

  if (!teacher) {
    return NextResponse.json({ error: 'Teacher not found' }, { status: 404 });
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: session.user.tenantId } });

  const content = await generateCertificateContent(
    type,
    teacher.user.name,
    tenant?.schoolName || '',
    additionalContext || '',
    supportingDocContent
  );

  const cert = await prisma.certificate.create({
    data: {
      tenantId: session.user.tenantId,
      type,
      generatedForId: teacherId,
      content,
      metadata: { additionalContext },
    },
  });

  return NextResponse.json({ success: true, data: cert }, { status: 201 });
}
