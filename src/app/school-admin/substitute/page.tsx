'use client';

import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { getDayName } from '@/lib/utils';

export default function SubstitutePage() {
  const [teachers, setTeachers] = useState<any[]>([]);
  const [timetable, setTimetable] = useState<any[]>([]);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [absentTeacherId, setAbsentTeacherId] = useState('');
  const [affectedSlots, setAffectedSlots] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [subs, setSubs] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchData(); }, []);
  useEffect(() => { if (date) fetchSubs(); }, [date]);

  async function fetchData() {
    const [tRes, ttRes] = await Promise.all([
      fetch('/api/teachers').then(r => r.json()),
      fetch('/api/timetable').then(r => r.json()),
    ]);
    if (tRes.success) setTeachers(tRes.data);
    if (ttRes.success) setTimetable(ttRes.data);
  }

  async function fetchSubs() {
    const res = await fetch(`/api/substitute?date=${date}`);
    const data = await res.json();
    if (data.success) setSubs(data.data);
  }

  useEffect(() => {
    if (!absentTeacherId || !date) { setAffectedSlots([]); return; }
    const dayOfWeek = new Date(date).getDay() || 7; // Sunday=7
    const slots = timetable.filter((e: any) => e.teacherId === absentTeacherId && e.dayOfWeek === dayOfWeek);
    setAffectedSlots(slots);
  }, [absentTeacherId, date, timetable]);

  const slots = [1, 2, 3, 4, 5, 6, 7];

  function getFreePeriodsCount(teacherId: string, currentSlotNumber?: number) {
    const dayOfWeek = new Date(date).getDay() || 7;
    const busySlots = new Set<number>();

    // 1. Regular timetable busy slots (excluding lunch break slot 5)
    timetable.forEach((e: any) => {
      if (e.teacherId === teacherId && e.dayOfWeek === dayOfWeek && e.slotNumber !== 5) {
        busySlots.add(e.slotNumber);
      }
    });

    // 2. Saved substitutions on this date where this teacher is the substitute (excluding lunch break)
    subs.forEach((s: any) => {
      if (s.substituteTeacherId === teacherId && s.originalSlotNumber !== 5) {
        if (s.originalSlotNumber !== currentSlotNumber) {
          busySlots.add(s.originalSlotNumber);
        }
      }
    });

    // 3. Unsaved substitutions in UI (excluding lunch break)
    Object.entries(assignments).forEach(([key, subTeacherId]) => {
      if (subTeacherId === teacherId) {
        const [slotStr] = key.split('_');
        const slotNum = parseInt(slotStr);
        if (slotNum !== 5 && slotNum !== currentSlotNumber) {
          busySlots.add(slotNum);
        }
      }
    });

    const teachingSlots = [1, 2, 3, 4, 6, 7];
    return Math.max(0, teachingSlots.length - busySlots.size);
  }

  function getFreeTeachers(slot: number, divisionId?: string) {
    const dayOfWeek = new Date(date).getDay() || 7;
    
    // Start with teachers busy in the regular timetable for this slot
    const busyTeacherIds = new Set(
      timetable
        .filter((e: any) => e.dayOfWeek === dayOfWeek && e.slotNumber === slot)
        .map((e: any) => e.teacherId)
    );

    // Add teachers who are busy due to other saved substitutions on this date for the same slot
    subs.forEach((s: any) => {
      if (s.originalSlotNumber === slot && s.substituteTeacherId) {
        if (!divisionId || s.originalDivisionId !== divisionId) {
          busyTeacherIds.add(s.substituteTeacherId);
        }
      }
    });

    // Add teachers who are busy due to other unsaved substitutions in this slot
    Object.entries(assignments).forEach(([key, subTeacherId]) => {
      const [slotStr, divId] = key.split('_');
      const slotNum = parseInt(slotStr);
      if (slotNum === slot && subTeacherId && (!divisionId || divId !== divisionId)) {
        busyTeacherIds.add(subTeacherId);
      }
    });

    return teachers.filter((t: any) => !busyTeacherIds.has(t.id) && t.id !== absentTeacherId);
  }

  async function saveSubstitutes() {
    setSaving(true);
    const assigns = Object.entries(assignments).map(([key, subTeacherId]) => {
      const [slotNumber, divisionId] = key.split('_');
      return { slotNumber: parseInt(slotNumber), divisionId, substituteTeacherId: subTeacherId };
    });
    await fetch('/api/substitute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, absentTeacherId, assignments: assigns }),
    });
    fetchSubs();
    setSaving(false);
  }

  return (
    <DashboardLayout>
      <div className="page-header">
        <div><h2>Substitute Assignment</h2><p>Manage teacher absences and substitutes</p></div>
        <button className="btn btn-secondary" onClick={() => window.print()}>🖨️ Print Updated</button>
      </div>
      <div className="page-body">
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body">
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Date</label>
                <input className="form-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Absent Teacher</label>
                <select className="form-select" value={absentTeacherId} onChange={e => setAbsentTeacherId(e.target.value)}>
                  <option value="">Select teacher...</option>
                  {teachers.map((t: any) => <option key={t.id} value={t.id}>{t.teacherCode} - {t.user?.name}</option>)}
                </select>
              </div>
            </div>
          </div>
        </div>

        {affectedSlots.length > 0 && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header"><h3>Affected Slots ({affectedSlots.length})</h3></div>
            <div className="table-container">
              <table className="data-table">
                <thead><tr><th>Period</th><th>Class</th><th>Subject</th><th>Substitute</th></tr></thead>
                <tbody>
                  {affectedSlots.map((slot: any) => {
                    const key = `${slot.slotNumber}_${slot.divisionId}`;
                    const freeTeachers = getFreeTeachers(slot.slotNumber, slot.divisionId);
                    return (
                      <tr key={key}>
                        <td>Period {slot.slotNumber}</td>
                        <td>{slot.division?.class?.name}{slot.division?.name}</td>
                        <td>{slot.subject?.name}</td>
                        <td>
                          <select className="form-select" value={assignments[key] || ''} onChange={e => setAssignments({ ...assignments, [key]: e.target.value })}>
                            <option value="">Select substitute...</option>
                            {freeTeachers.map((t: any) => {
                              const freeCount = getFreePeriodsCount(t.id, slot.slotNumber);
                              return (
                                <option key={t.id} value={t.id}>
                                  {t.teacherCode} - {t.user?.name} ({freeCount} free period{freeCount !== 1 ? 's' : ''} today)
                                </option>
                              );
                            })}
                          </select>
                          <span className="form-hint">{freeTeachers.length} teachers available</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ padding: 16, borderTop: '1px solid var(--border-color)' }}>
              <button className="btn btn-primary" onClick={saveSubstitutes} disabled={saving}>{saving ? 'Saving...' : 'Save Substitutions'}</button>
            </div>
          </div>
        )}

        {subs.length > 0 && (
          <div className="card">
            <div className="card-header"><h3>Today&apos;s Substitutions</h3></div>
            <div className="table-container">
              <table className="data-table">
                <thead><tr><th>Period</th><th>Class</th><th>Absent</th><th>Substitute</th></tr></thead>
                <tbody>
                  {subs.map((s: any) => (
                    <tr key={s.id}>
                      <td>Period {s.originalSlotNumber}</td>
                      <td>{s.originalDivision?.class?.name}{s.originalDivision?.name}</td>
                      <td><span className="badge badge-red">{s.absentTeacher?.user?.name}</span></td>
                      <td><span className="badge badge-green">{s.substituteTeacher?.user?.name}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
