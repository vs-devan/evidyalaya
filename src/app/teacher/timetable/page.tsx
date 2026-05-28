'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { getDayName } from '@/lib/utils';

export default function TeacherTimetable() {
  const { data: session } = useSession();
  const [timetable, setTimetable] = useState<any[]>([]);
  const [selectedDay, setSelectedDay] = useState(new Date().getDay() || 1);

  useEffect(() => {
    if (session?.user?.teacherId) {
      fetch(`/api/timetable?teacherId=${session.user.teacherId}`)
        .then(r => r.json())
        .then(d => { if (d.success) setTimetable(d.data); });
    }
  }, [session]);

  const days = [1, 2, 3, 4, 5];
  const slots = [1, 2, 3, 4, 5, 6, 7];

  return (
    <DashboardLayout>
      <div className="page-header"><div><h2>My Timetable</h2><p>View your weekly schedule</p></div></div>
      <div className="page-body">
        <div className="card">
          <div className="card-header"><h3>Weekly Timetable</h3></div>
          <div className="card-body" style={{ overflowX: 'auto' }}>
            <div className="timetable-grid" style={{ gridTemplateColumns: `80px repeat(${days.length}, 1fr)` }}>
              <div className="timetable-cell header">Slot</div>
              {days.map(d => <div key={d} className="timetable-cell header">{getDayName(d).slice(0, 3)}</div>)}
              {slots.map(slot => (
                <>
                  {slot === 5 && <div className="timetable-cell lunch" style={{ gridColumn: '1 / -1' }}>🍴 Lunch</div>}
                  <div key={`s${slot}`} className="timetable-cell slot-header">P{slot}</div>
                  {days.map(day => {
                    const entry = timetable.find((e: any) => e.dayOfWeek === day && e.slotNumber === slot);
                    return (
                      <div key={`${day}${slot}`} className="timetable-cell">
                        {entry ? (
                          <>
                            <span className="subject-name">{entry.subject?.name}</span>
                            <span className="teacher-code">{entry.division?.class?.name}{entry.division?.name}</span>
                          </>
                        ) : <span style={{ color: 'var(--gray-300)' }}>Free</span>}
                      </div>
                    );
                  })}
                </>
              ))}
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
