import { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      username: string;
      role: 'SUPER_ADMIN' | 'SCHOOL_ADMIN' | 'TEACHER' | 'PARENT';
      tenantId: string | null;
      tenantCode: string | null;
      tenantName: string | null;
      teacherId: string | null;
      teacherCode: string | null;
      mustChangePassword: boolean;
      features: string[];
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    username: string;
    role: 'SUPER_ADMIN' | 'SCHOOL_ADMIN' | 'TEACHER' | 'PARENT';
    tenantId: string | null;
    tenantCode: string | null;
    tenantName: string | null;
    teacherId: string | null;
    teacherCode: string | null;
    mustChangePassword: boolean;
    features: string[];
  }
}
