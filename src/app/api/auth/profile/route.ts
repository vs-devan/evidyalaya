import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { name, username } = await req.json();

    if (!name?.trim() || !username?.trim()) {
      return NextResponse.json({ error: 'Name and Username are required' }, { status: 400 });
    }

    const cleanName = name.trim();
    const cleanUsername = username.trim();

    // Check if username is already taken by another user
    const existing = await prisma.user.findFirst({
      where: {
        username: cleanUsername,
        NOT: { id: (session.user as any).id }
      }
    });

    if (existing) {
      return NextResponse.json({ error: 'Username is already taken' }, { status: 400 });
    }

    // Update user
    const updatedUser = await prisma.user.update({
      where: { id: (session.user as any).id },
      data: { name: cleanName, username: cleanUsername },
    });


    return NextResponse.json({
      success: true,
      user: {
        name: updatedUser.name,
        username: updatedUser.username,
      }
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
