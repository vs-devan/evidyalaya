import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export default async function Home() {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect('/login');
  }

  switch (session.user.role) {
    case 'SUPER_ADMIN': redirect('/super-admin');
    case 'SCHOOL_ADMIN': redirect('/school-admin');
    case 'TEACHER': redirect('/teacher');
    case 'PARENT': redirect('/parent');
    default: redirect('/login');
  }
}
