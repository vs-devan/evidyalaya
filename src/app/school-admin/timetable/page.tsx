'use client';

import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { getDayName } from '@/lib/utils';

export default function TimetablePage() {
  const [entries, setEntries] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [viewMode, setViewMode] = useState<'weekly' | 'daily'>('weekly');
  const [selectedDay, setSelectedDay] = useState(new Date().getDay() || 1);
  const [selectedDivision, setSelectedDivision] = useState('');
  const [result, setResult] = useState<any>(null);

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    setLoading(true);
    const [tRes, cRes] = await Promise.all([
      fetch('/api/timetable').then(r => r.json()),
      fetch('/api/classes').then(r => r.json()),
    ]);
    if (tRes.success) setEntries(tRes.data);
    if (cRes.success) setClasses(cRes.data);
    setLoading(false);
  }

  async function generateTimetable() {
    if (!confirm('This will regenerate the entire timetable. Continue?')) return;
    setGenerating(true);
    setResult(null);
    const res = await fetch('/api/timetable', { method: 'POST' });
    const data = await res.json();
    setResult(data.data);
    if (data.success) fetchAll();
    setGenerating(false);
  }

  const allDivisions = classes.flatMap((c: any) =>
    c.divisions?.map((d: any) => ({ ...d, className: c.name, label: `${c.name}${d.name}` })) || []
  );

  const days = [1, 2, 3, 4, 5];
  const slots = [1, 2, 3, 4, 5, 6, 7];

  function getEntry(divId: string, day: number, slot: number) {
    return entries.find((e: any) => e.divisionId === divId && e.dayOfWeek === day && e.slotNumber === slot);
  }

  return (
    <DashboardLayout>
      <div className="page-header">
        <div><h2>Timetable</h2><p>Generate and view weekly timetables</p></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-accent" onClick={generateTimetable} disabled={generating}>
            {generating ? '⏳ Generating...' : '🔄 Generate Timetable'}
          </button>
          <button className="btn btn-secondary" onClick={() => window.print()}>🖨️ Print</button>
        </div>
      </div>
      <div className="page-body">
        {result && (
          <div className="card" style={{ marginBottom: 16, padding: 16, background: result.errors?.length ? '#fef2f2' : '#f0fdf4' }}>
            <p><strong>Generated {result.generated} entries</strong> in {result.stats?.iterations} iterations</p>
            {result.warnings?.map((w: string, i: number) => <p key={i} style={{ color: 'var(--warning)', fontSize: 13 }}>⚠️ {w}</p>)}
            {result.errors?.map((e: string, i: number) => <p key={i} style={{ color: 'var(--danger)', fontSize: 13 }}>❌ {e}</p>)}
          </div>
        )}

        <div className="tabs no-print">
          <button className={`tab ${viewMode === 'weekly' ? 'active' : ''}`} onClick={() => setViewMode('weekly')}>Weekly View</button>
          <button className={`tab ${viewMode === 'daily' ? 'active' : ''}`} onClick={() => setViewMode('daily')}>Daily View</button>
        </div>

        {viewMode === 'weekly' && (
          <div className="no-print" style={{ marginBottom: 16 }}>
            <select className="form-select" style={{ width: 200 }} value={selectedDivision} onChange={e => setSelectedDivision(e.target.value)}>
              <option value="">All Divisions</option>
              {allDivisions.map((d: any) => <option key={d.id} value={d.id}>Class {d.label}</option>)}
            </select>
          </div>
        )}

        {viewMode === 'daily' && (
          <div className="no-print" style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
            {days.map(d => (
              <button key={d} className={`btn ${selectedDay === d ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setSelectedDay(d)}>
                {getDayName(d)}
              </button>
            ))}
          </div>
        )}

        {entries.length === 0 ? (
          <div className="card"><div className="empty-state">
            <div className="empty-state-icon">📅</div>
            <h3>No Timetable Generated</h3>
            <p>Set up classes, subjects, and teachers first, then click Generate Timetable</p>
          </div></div>
        ) : viewMode === 'weekly' ? (
          /* Weekly view for a selected division */
          (selectedDivision ? [allDivisions.find((d: any) => d.id === selectedDivision)] : allDivisions).filter(Boolean).map((div: any) => (
            <div key={div.id} className="card" style={{ marginBottom: 16 }}>
              <div className="card-header"><h3>Class {div.label}</h3></div>
              <div className="card-body" style={{ overflowX: 'auto' }}>
                <div className="timetable-grid" style={{ gridTemplateColumns: `100px repeat(${days.length}, 1fr)` }}>
                  <div className="timetable-cell header">Slot</div>
                  {days.map(d => <div key={d} className="timetable-cell header">{getDayName(d)}</div>)}
                  {slots.map(slot => (
                    <>
                      {slot === 5 && (
                        <>
                          <div className="timetable-cell lunch" style={{ gridColumn: `1 / -1` }}>🍴 Lunch Break</div>
                        </>
                      )}
                      <div key={`slot-${slot}`} className="timetable-cell slot-header">Period {slot}</div>
                      {days.map(day => {
                        const entry = getEntry(div.id, day, slot);
                        return (
                          <div key={`${day}-${slot}`} className="timetable-cell">
                            {entry ? (
                              <>
                                <span className="subject-name">{entry.subject?.code || entry.subject?.name}</span>
                                <span className="teacher-code">{entry.teacher?.teacherCode}</span>
                              </>
                            ) : <span style={{ color: 'var(--gray-300)' }}>—</span>}
                          </div>
                        );
                      })}
                    </>
                  ))}
                </div>
              </div>
            </div>
          ))
        ) : (
          /* Daily view - all divisions for selected day */
          <div className="card">
            <div className="card-header"><h3>{getDayName(selectedDay)} Timetable</h3></div>
            <div className="card-body" style={{ overflowX: 'auto' }}>
              <div className="timetable-grid" style={{ gridTemplateColumns: `100px repeat(${allDivisions.length}, 1fr)` }}>
                <div className="timetable-cell header">Slot</div>
                {allDivisions.map((d: any) => <div key={d.id} className="timetable-cell header">{d.label}</div>)}
                {slots.map(slot => (
                  <>
                    {slot === 5 && <div className="timetable-cell lunch" style={{ gridColumn: '1 / -1' }}>🍴 Lunch Break</div>}
                    <div key={`slot-${slot}`} className="timetable-cell slot-header">Period {slot}</div>
                    {allDivisions.map((div: any) => {
                      const entry = getEntry(div.id, selectedDay, slot);
                      return (
                        <div key={`${div.id}-${slot}`} className="timetable-cell">
                          {entry ? (
                            <>
                              <span className="subject-name">{entry.subject?.code}</span>
                              <span className="teacher-code">{entry.teacher?.teacherCode}</span>
                            </>
                          ) : <span style={{ color: 'var(--gray-300)' }}>—</span>}
                        </div>
                      );
                    })}
                  </>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
