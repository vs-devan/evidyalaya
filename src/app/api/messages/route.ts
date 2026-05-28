import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

// GET messages
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const sent = searchParams.get('sent') === 'true';

  let messages;
  if (sent) {
    messages = await prisma.message.findMany({
      where: { tenantId: session.user.tenantId, senderId: session.user.id },
      include: { sender: { select: { name: true, role: true } } },
      orderBy: { createdAt: 'desc' },
    });
  } else {
    const received = await prisma.messageRecipient.findMany({
      where: { userId: session.user.id },
      include: {
        message: {
          include: { sender: { select: { name: true, role: true } } },
        },
      },
      orderBy: { message: { createdAt: 'desc' } },
    });
    messages = received.map(r => ({ ...r.message, isRead: r.isRead }));
  }

  return NextResponse.json({ success: true, data: messages });
}

// POST send message
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { content, targetType, targetClassDivisionId } = await req.json();

  if (!content || !targetType) {
    return NextResponse.json({ error: 'Content and target are required' }, { status: 400 });
  }

  // Find recipients based on targetType
  let recipientIds: string[] = [];

  if (targetType === 'CLASS' && targetClassDivisionId) {
    const students = await prisma.student.findMany({
      where: { divisionId: targetClassDivisionId },
      select: { userId: true },
    });
    recipientIds = students.map(s => s.userId);
  } else if (targetType === 'ALL_TEACHERS') {
    const teachers = await prisma.user.findMany({
      where: { tenantId: session.user.tenantId, role: 'TEACHER' },
      select: { id: true },
    });
    recipientIds = teachers.map(t => t.id);
  } else if (targetType === 'ALL_PARENTS') {
    const parents = await prisma.user.findMany({
      where: { tenantId: session.user.tenantId, role: 'PARENT' },
      select: { id: true },
    });
    recipientIds = parents.map(p => p.id);
  } else if (targetType === 'ALL') {
    const users = await prisma.user.findMany({
      where: { tenantId: session.user.tenantId, id: { not: session.user.id } },
      select: { id: true },
    });
    recipientIds = users.map(u => u.id);
  }

  const message = await prisma.message.create({
    data: {
      tenantId: session.user.tenantId,
      senderId: session.user.id,
      content,
      targetType,
      targetClassDivisionId,
      recipients: {
        create: recipientIds.map(uid => ({ userId: uid })),
      },
    },
  });

  return NextResponse.json({ success: true, data: message }, { status: 201 });
}
