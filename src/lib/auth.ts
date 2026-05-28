import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { compare } from 'bcryptjs';
import prisma from './prisma';

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) {
          throw new Error('Username and password are required');
        }

        const user = await prisma.user.findUnique({
          where: { username: credentials.username },
          include: {
            tenant: true,
            teacher: true,
            featureAccess: true,
          },
        });

        if (!user || !user.isActive) {
          throw new Error('Invalid credentials');
        }

        const isPasswordValid = await compare(credentials.password, user.password);
        if (!isPasswordValid) {
          throw new Error('Invalid credentials');
        }

        return {
          id: user.id,
          name: user.name,
          username: user.username,
          role: user.role,
          tenantId: user.tenantId,
          tenantCode: user.tenant?.code || null,
          tenantName: user.tenant?.name || null,
          teacherId: user.teacher?.id || null,
          teacherCode: user.teacher?.teacherCode || null,
          mustChangePassword: user.mustChangePassword,
          features: user.featureAccess.map(fa => fa.feature),
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.username = (user as any).username;
        token.role = (user as any).role;
        token.tenantId = (user as any).tenantId;
        token.tenantCode = (user as any).tenantCode;
        token.tenantName = (user as any).tenantName;
        token.teacherId = (user as any).teacherId;
        token.teacherCode = (user as any).teacherCode;
        token.mustChangePassword = (user as any).mustChangePassword;
        token.features = (user as any).features;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).username = token.username;
        (session.user as any).role = token.role;
        (session.user as any).tenantId = token.tenantId;
        (session.user as any).tenantCode = token.tenantCode;
        (session.user as any).tenantName = token.tenantName;
        (session.user as any).teacherId = token.teacherId;
        (session.user as any).teacherCode = token.teacherCode;
        (session.user as any).mustChangePassword = token.mustChangePassword;
        (session.user as any).features = token.features;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'jwt',
    maxAge: 24 * 60 * 60, // 24 hours
  },
  secret: process.env.NEXTAUTH_SECRET,
};
