'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/DashboardLayout';

function DashboardIcon({ name, style }: { name: string; style?: any }) {
  const s = { width: 24, height: 24, ...style };
  switch (name) {
    case 'classes':
    case '🏛️':
      return (
        <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={s}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 16.5h1.5M13.5 16.5H15" />
        </svg>
      );
    case 'teachers':
    case '👩‍🏫':
      return (
        <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={s}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.9c4.956 0 9.31 1.766 12.23 4.673a2.25 2.25 0 0 1-1.22 3.678A48.433 48.433 0 0 0 12 18c-3.185 0-6.29.309-9.31.903a2.25 2.25 0 0 1-1.22-3.678A48.47 48.47 0 0 1 4.26 10.147Z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
        </svg>
      );
    case 'subjects':
    case '📚':
      return (
        <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={s}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-16.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-16.25v14.25" />
        </svg>
      );
    case 'students':
    case '🎓':
      return (
        <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={s}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.436 60.436 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.9c4.956 0 9.31 1.766 12.23 4.673a2.25 2.25 0 0 1-1.22 3.678A48.433 48.433 0 0 0 12 18c-3.185 0-6.29.309-9.31.903a2.25 2.25 0 0 1-1.22-3.678A48.47 48.47 0 0 1 4.26 10.147ZM12 12.75a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5Z" />
        </svg>
      );
    case 'timetable':
    case '📅':
      return (
        <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={s}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
        </svg>
      );
    case 'substitute':
    case '🔄':
      return (
        <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={s}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
        </svg>
      );
    case 'certificates':
    case '📜':
      return (
        <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={s}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 0 1 3 3h-15a3 3 0 0 1 3-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.75a1.125 1.125 0 0 1-1.125-1.125V11.25M7.5 18.75v-3.375c0-.621.503-1.125 1.125-1.125h.75A1.125 1.125 0 0 0 10.5 13.125V11.25m-3 7.5h9" />
        </svg>
      );
    case 'messages':
    case '💬':
      return (
        <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={s}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501" />
        </svg>
      );
    default:
      return null;
  }
}

export default function SchoolAdminDashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [stats, setStats] = useState({ classes: 0, teachers: 0, students: 0, subjects: 0 });

  useEffect(() => {
    if (status === 'authenticated' && session?.user?.role !== 'SCHOOL_ADMIN') {
      router.push('/');
    }
    if (status === 'authenticated') fetchStats();
  }, [status]);

  async function fetchStats() {
    const [classRes, teacherRes, subjectRes] = await Promise.all([
      fetch('/api/classes').then(r => r.json()),
      fetch('/api/teachers').then(r => r.json()),
      fetch('/api/subjects').then(r => r.json()),
    ]);
    setStats({
      classes: classRes.data?.length || 0,
      teachers: teacherRes.data?.length || 0,
      subjects: subjectRes.data?.length || 0,
      students: classRes.data?.reduce((s: number, c: any) =>
        s + c.divisions?.reduce((d: number, div: any) => d + (div._count?.students || 0), 0), 0) || 0,
    });
  }

  if (status === 'loading') return <div className="loading-page"><div className="spinner" /><p>Loading...</p></div>;

  const quickActions = [
    { label: 'Manage Classes', href: '/school-admin/classes', icon: '🏛️', desc: 'Add classes & divisions' },
    { label: 'Manage Subjects', href: '/school-admin/subjects', icon: '📚', desc: 'Configure subjects' },
    { label: 'Manage Teachers', href: '/school-admin/teachers', icon: '👩‍🏫', desc: 'Add & edit teachers' },
    { label: 'Generate Timetable', href: '/school-admin/timetable', icon: '📅', desc: 'Auto-generate schedules' },
    { label: 'Substitute Teacher', href: '/school-admin/substitute', icon: '🔄', desc: 'Manage absences' },
    { label: 'Certificates', href: '/school-admin/certificates', icon: '📜', desc: 'Generate certificates' },
    { label: 'View Students', href: '/school-admin/students', icon: '🎓', desc: 'Student management' },
    { label: 'Messages', href: '/school-admin/messages', icon: '💬', desc: 'Broadcast messages' },
  ];

  return (
    <DashboardLayout>
      <div className="page-header">
        <div>
          <h2>School Admin Dashboard</h2>
          <p>{session?.user?.tenantName || 'Welcome'} • {new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>
      </div>
      <div className="page-body">
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-icon green"><DashboardIcon name="🏛️" /></div>
            <div><div className="stat-value">{stats.classes}</div><div className="stat-label">Classes</div></div>
          </div>
          <div className="stat-card">
            <div className="stat-icon blue"><DashboardIcon name="👩‍🏫" /></div>
            <div><div className="stat-value">{stats.teachers}</div><div className="stat-label">Teachers</div></div>
          </div>
          <div className="stat-card">
            <div className="stat-icon gold"><DashboardIcon name="📚" /></div>
            <div><div className="stat-value">{stats.subjects}</div><div className="stat-label">Subjects</div></div>
          </div>
          <div className="stat-card">
            <div className="stat-icon green"><DashboardIcon name="🎓" /></div>
            <div><div className="stat-value">{stats.students}</div><div className="stat-label">Students</div></div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3>Quick Actions</h3></div>
          <div className="card-body">
            <div className="quick-actions-grid">
              {quickActions.map(a => (
                <button key={a.href} className="btn btn-secondary quick-action-btn"
                  onClick={() => router.push(a.href)}>
                  <span style={{ marginBottom: 8, color: 'var(--primary-color)' }}><DashboardIcon name={a.icon} style={{ width: 28, height: 28 }} /></span>
                  <strong style={{ fontSize: 13 }}>{a.label}</strong>
                  <span style={{ fontSize: 11, color: 'var(--gray-500)', fontWeight: 400 }}>{a.desc}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
