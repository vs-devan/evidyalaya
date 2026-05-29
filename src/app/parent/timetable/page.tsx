'use client';

import React, { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { getDayName } from '@/lib/utils';

export default function ParentTimetable() {
  const [timetable, setTimetable] = useState<any[]>([]);
  const [selectedDay, setSelectedDay] = useState(new Date().getDay() || 1);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    fetch('/api/parent/data')
      .then(r => r.json())
      .then(d => { if (d.success) setTimetable(d.data.timetable || []); });
  }, []);

  const days = [1, 2, 3, 4, 5];
  const slots = [1, 2, 3, 4, 5, 6, 7];

  return (
    <DashboardLayout>
      <div className="page-header">
        <div>
          <h2>Class Timetable</h2>
          <p>View weekly schedule for your child</p>
        </div>
      </div>
      <div className="page-body">
        <div className="card">
          <div className="card-header">
            <h3>{isMobile ? `Timetable — ${getDayName(selectedDay)}` : 'Weekly Timetable'}</h3>
          </div>
          <div className="card-body" style={{ overflowX: 'auto', padding: isMobile ? '12px' : '24px' }}>
            {timetable.length > 0 ? (
              isMobile ? (
                <div className="tt-mobile-timeline">
                  {/* Day selector pills */}
                  <div className="tt-mobile-days">
                    {days.map(d => (
                      <button
                        key={d}
                        type="button"
                        className={`tt-mobile-day-btn ${selectedDay === d ? 'active' : ''}`}
                        onClick={() => setSelectedDay(d)}
                      >
                        {getDayName(d).slice(0, 3)}
                      </button>
                    ))}
                  </div>

                  {/* Vertical slots list */}
                  <div className="tt-mobile-slots" style={{ marginTop: 12 }}>
                    {slots.map(slot => {
                      if (slot === 5) {
                        return (
                          <div key="lunch-break" className="tt-mobile-slot-card lunch">
                            <div className="tt-slot-time">🍴 Break</div>
                            <div className="tt-slot-info">Lunch Break</div>
                          </div>
                        );
                      }

                      const entry = timetable.find((t: any) => t.dayOfWeek === selectedDay && t.slotNumber === slot);

                      return (
                        <div key={slot} className={`tt-mobile-slot-card ${entry ? 'filled' : 'empty'}`}>
                          <div className="tt-slot-time">Period {slot}</div>
                          <div className="tt-slot-info">
                            {entry ? (
                              <>
                                <div className="tt-slot-subject">{entry.subject?.name || entry.subject?.code}</div>
                                <div className="tt-slot-teacher">
                                  👩‍🏫 {entry.teacher?.user?.name || entry.teacher?.teacherCode}
                                </div>
                              </>
                            ) : (
                              <div className="tt-slot-empty">Free Period</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="timetable-grid" style={{ gridTemplateColumns: `80px repeat(${days.length}, 1fr)` }}>
                  <div className="timetable-cell header">Slot</div>
                  {days.map(d => <div key={d} className="timetable-cell header">{getDayName(d).slice(0, 3)}</div>)}
                  {slots.map(slot => (
                    <React.Fragment key={`slot-row-${slot}`}>
                      {slot === 5 && <div className="timetable-cell lunch" style={{ gridColumn: '1 / -1' }}>🍴 Lunch</div>}
                      <div key={`s${slot}`} className="timetable-cell slot-header">P{slot}</div>
                      {days.map(day => {
                        const e = timetable.find((t: any) => t.dayOfWeek === day && t.slotNumber === slot);
                        return (
                          <div key={`${day}${slot}`} className="timetable-cell">
                            {e ? <span className="subject-name">{e.subject?.name || e.subject?.code}</span> : '—'}
                          </div>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </div>
              )
            ) : (
              <p style={{ textAlign: 'center', color: 'var(--gray-400)', padding: 20 }}>Not available</p>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
