'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { getDayName, getPercentage } from '@/lib/utils';

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
    case 'present':
    case '✅':
      return (
        <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={s}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
      );
    case 'absent':
    case '❌':
      return (
        <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={s}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
      );
    default:
      return null;
  }
}

export default function ParentDashboard() {
  const { data: session, status } = useSession();
  const [student, setStudent] = useState<any>(null);
  const [timetable, setTimetable] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [results, setResults] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [divisionName, setDivisionName] = useState<string>('');

  useEffect(() => {
    if (status === 'authenticated') fetchData();
  }, [status]);

  async function fetchData() {
    // First get student info
    const mRes = await fetch('/api/messages').then(r => r.json());
    if (mRes.success) setMessages(mRes.data);

    // For parent, we need custom endpoint - use the session info
    // Fetch student data through general endpoints
    try {
      const sRes = await fetch(`/api/parent/data`).then(r => r.json());
      if (sRes.success) {
        setStudent(sRes.data.student);
        setTimetable(sRes.data.timetable || []);
        setAttendance(sRes.data.attendance || []);
        setResults(sRes.data.results || []);
        const firstEntry = sRes.data.timetable?.[0];
        if (firstEntry?.division?.name) setDivisionName(firstEntry.division.name);
      }
    } catch {
      // Parent data API may not exist yet
    }
  }

  // Build parallel cell label for Division A (MAL1/SAN/ARA)
  function buildParallelCell(entry: any) {
    if (!entry) return null;
    if (divisionName !== 'A') return null;
    if (entry.subject?.isLanguageVariant) return null;
    const variants: any[] = entry.subject?.variants ?? [];
    if (variants.length === 0) return null;
    const codes = [entry.subject.code, ...variants.map((v: any) => v.code)];
    return codes;
  }

  const totalDays = attendance.length;
  const presentDays = attendance.filter((a: any) => a.isPresent).length;
  const absentDays = totalDays - presentDays;
  const days = [1, 2, 3, 4, 5];
  const slots = [1, 2, 3, 4, 5, 6, 7];

  if (status === 'loading') return <div className="loading-page"><div className="spinner" /><p>Loading...</p></div>;

  return (
    <DashboardLayout>
      <div className="page-header">
        <div>
          <h2>Welcome, {session?.user?.name}</h2>
          <p>{student ? `${student.name} - Class ${student.division?.class?.name}${student.division?.name}` : 'Parent Dashboard'}</p>
        </div>
      </div>
      <div className="page-body">
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-icon green"><DashboardIcon name="✅" /></div>
            <div><div className="stat-value">{getPercentage(presentDays, totalDays)}%</div><div className="stat-label">Attendance</div></div>
          </div>
          <div className="stat-card">
            <div className="stat-icon blue"><DashboardIcon name="📅" /></div>
            <div><div className="stat-value">{presentDays}</div><div className="stat-label">Days Present</div></div>
          </div>
          <div className="stat-card">
            <div className="stat-icon red"><DashboardIcon name="❌" /></div>
            <div><div className="stat-value">{absentDays}</div><div className="stat-label">Days Absent</div></div>
          </div>
          <div className="stat-card">
            <div className="stat-icon gold"><DashboardIcon name="💬" /></div>
            <div><div className="stat-value">{messages.length}</div><div className="stat-label">Messages</div></div>
          </div>
        </div>

        {/* Weekly Timetable */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header"><h3>Weekly Timetable</h3></div>
          <div className="card-body" style={{ overflowX: 'auto' }}>
            {timetable.length > 0 ? (
              <div className="timetable-grid" style={{ gridTemplateColumns: `80px repeat(${days.length}, 1fr)` }}>
                <div className="timetable-cell header">Slot</div>
                {days.map(d => <div key={d} className="timetable-cell header">{getDayName(d).slice(0, 3)}</div>)}
                {slots.map(slot => (
                  <>
                    {slot === 5 && (
                      <div className="timetable-cell lunch" style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6 }}>
                        <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 16, height: 16 }}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                        </svg>
                        Lunch
                      </div>
                    )}

                    <div key={`s${slot}`} className="timetable-cell slot-header">P{slot}</div>
                    {days.map(day => {
                      const entry = timetable.find((e: any) => e.dayOfWeek === day && e.slotNumber === slot);
                      const parallel = buildParallelCell(entry);
                      return (
                        <div key={`${day}${slot}`} className="timetable-cell">
                          {entry ? (
                            parallel ? (
                              <span className="subject-name" style={{ fontSize: 10, fontWeight: 800, color: 'var(--primary-700)', letterSpacing: '.3px' }}>
                                {parallel.join('/')}
                              </span>
                            ) : (
                              <span className="subject-name">{entry.subject?.code || entry.subject?.name}</span>
                            )
                          ) : '—'}
                        </div>
                      );
                    })}
                  </>
                ))}
              </div>
            ) : (
              <p style={{ textAlign: 'center', color: 'var(--gray-400)', padding: 20 }}>Timetable not available yet</p>
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          {/* Results */}
          <div className="card">
            <div className="card-header"><h3>Exam Results</h3></div>
            <div className="card-body">
              {results.length > 0 ? results.map((r: any) => (
                <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border-color)' }}>
                  <span>{r.subject?.name}</span>
                  <strong>{r.marks}/{r.maxMarks}</strong>
                </div>
              )) : <p style={{ textAlign: 'center', color: 'var(--gray-400)', padding: 20 }}>No results yet</p>}
            </div>
          </div>

          {/* Messages */}
          <div className="card">
            <div className="card-header"><h3>Messages</h3></div>
            <div className="card-body">
              {messages.length > 0 ? messages.slice(0, 5).map((m: any) => (
                <div key={m.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border-color)' }}>
                  <p style={{ fontSize: 12, color: 'var(--gray-400)' }}>{new Date(m.createdAt).toLocaleDateString('en-IN')}</p>
                  <p style={{ fontSize: 14, marginTop: 2 }}>{m.content}</p>
                </div>
              )) : <p style={{ textAlign: 'center', color: 'var(--gray-400)', padding: 20 }}>No messages</p>}
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
