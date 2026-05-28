'use client';
import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { getDayName } from '@/lib/utils';

export default function ParentTimetable() {
  const [timetable, setTimetable] = useState<any[]>([]);
  useEffect(() => {
    fetch('/api/parent/data').then(r => r.json()).then(d => { if (d.success) setTimetable(d.data.timetable || []); });
  }, []);
  const days = [1, 2, 3, 4, 5]; const slots = [1, 2, 3, 4, 5, 6, 7];
  return (
    <DashboardLayout>
      <div className="page-header"><div><h2>Class Timetable</h2></div></div>
      <div className="page-body">
        <div className="card"><div className="card-body" style={{ overflowX: 'auto' }}>
          {timetable.length > 0 ? (
            <div className="timetable-grid" style={{ gridTemplateColumns: `80px repeat(${days.length}, 1fr)` }}>
              <div className="timetable-cell header">Slot</div>
              {days.map(d => <div key={d} className="timetable-cell header">{getDayName(d).slice(0, 3)}</div>)}
              {slots.map(slot => (<>
                {slot === 5 && <div className="timetable-cell lunch" style={{ gridColumn: '1 / -1' }}>🍴 Lunch</div>}
                <div key={`s${slot}`} className="timetable-cell slot-header">P{slot}</div>
                {days.map(day => { const e = timetable.find((t: any) => t.dayOfWeek === day && t.slotNumber === slot);
                  return <div key={`${day}${slot}`} className="timetable-cell">{e ? <span className="subject-name">{e.subject?.name || e.subject?.code}</span> : '—'}</div>;
                })}
              </>))}
            </div>
          ) : <p style={{ textAlign: 'center', color: 'var(--gray-400)', padding: 20 }}>Not available</p>}
        </div></div>
      </div>
    </DashboardLayout>
  );
}
