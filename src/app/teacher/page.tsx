'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { getDayName } from '@/lib/utils';

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
    case 'subjects':
    case '📚':
      return (
        <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={s}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-16.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-16.25v14.25" />
        </svg>
      );
    case 'timetable':
    case '📅':
      return (
        <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={s}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
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

export default function TeacherDashboard() {
  const { data: session, status } = useSession();
  const [timetable, setTimetable] = useState<any[]>([]);
  const [selectedDay, setSelectedDay] = useState(new Date().getDay() || 1);
  const [messages, setMessages] = useState<any[]>([]);

  useEffect(() => {
    if (status === 'authenticated') fetchData();
  }, [status]);

  async function fetchData() {
    const [ttRes, mRes] = await Promise.all([
      fetch(`/api/timetable?teacherId=${session?.user?.teacherId}`).then(r => r.json()),
      fetch('/api/messages').then(r => r.json()),
    ]);
    if (ttRes.success) setTimetable(ttRes.data);
    if (mRes.success) setMessages(mRes.data);
  }

  const todayEntries = timetable.filter((e: any) => e.dayOfWeek === selectedDay).sort((a: any, b: any) => a.slotNumber - b.slotNumber);
  const days = [1, 2, 3, 4, 5];
  const slots = [1, 2, 3, 4, 5, 6, 7];

  if (status === 'loading') return <div className="loading-page"><div className="spinner" /><p>Loading...</p></div>;

  return (
    <DashboardLayout>
      <div className="page-header">
        <div>
          <h2>Welcome, {session?.user?.name}</h2>
          <p>{new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>
      </div>
      <div className="page-body">
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-icon green"><DashboardIcon name="📅" /></div>
            <div><div className="stat-value">{todayEntries.length}</div><div className="stat-label">Periods Today</div></div>
          </div>
          <div className="stat-card">
            <div className="stat-icon blue"><DashboardIcon name="📚" /></div>
            <div><div className="stat-value">{new Set(timetable.map((e: any) => e.subjectId)).size}</div><div className="stat-label">Subjects</div></div>
          </div>
          <div className="stat-card">
            <div className="stat-icon gold"><DashboardIcon name="🏛️" /></div>
            <div><div className="stat-value">{new Set(timetable.map((e: any) => e.divisionId)).size}</div><div className="stat-label">Divisions</div></div>
          </div>
          <div className="stat-card">
            <div className="stat-icon green"><DashboardIcon name="💬" /></div>
            <div><div className="stat-value">{messages.length}</div><div className="stat-label">Messages</div></div>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header"><h3>Today&apos;s Timetable</h3></div>
          <div className="card-body">
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              {days.map(d => (
                <button key={d} className={`btn btn-sm ${selectedDay === d ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setSelectedDay(d)}>
                  {getDayName(d).slice(0, 3)}
                </button>
              ))}
            </div>
            {todayEntries.length === 0 ? (
              <p style={{ color: 'var(--gray-400)', textAlign: 'center', padding: 20 }}>No periods on {getDayName(selectedDay)}</p>
            ) : (
              <div>
                {slots.map(slot => {
                  const entry = todayEntries.find((e: any) => e.slotNumber === slot);
                  if (slot === 5) {
                    return (
                      <div key="lunch">
                        <div style={{ padding: '8px 16px', background: 'var(--accent-50)', borderRadius: 8, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6, color: 'var(--accent-600)', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                          <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 16, height: 16 }}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                          </svg>
                          Lunch Break
                        </div>
                        {entry && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border-color)', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                              <span className="badge badge-blue">P{slot}</span>
                              <strong>{entry.subject?.name}</strong>
                            </div>
                            <span className="badge badge-green">{entry.division?.class?.name}{entry.division?.name}</span>
                          </div>
                        )}
                      </div>
                    );
                  }

                  if (!entry) return null;
                  return (
                    <div key={slot} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border-color)', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span className="badge badge-blue">P{slot}</span>
                        <strong>{entry.subject?.name}</strong>
                      </div>
                      <span className="badge badge-green">{entry.division?.class?.name}{entry.division?.name}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {messages.length > 0 && (
          <div className="card">
            <div className="card-header"><h3>Recent Messages</h3></div>
            <div className="card-body">
              {messages.slice(0, 5).map((m: any) => (
                <div key={m.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--gray-400)' }}>
                    <span>{m.sender?.name}</span>
                    <span>{new Date(m.createdAt).toLocaleDateString('en-IN')}</span>
                  </div>
                  <p style={{ fontSize: 14, marginTop: 4 }}>{m.content}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
