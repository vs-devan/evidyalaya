'use client';

import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { getDayName } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AbsentEntry {
  teacherId: string;
  affectedSlots: any[];
}

// ─── Substitute Page ─────────────────────────────────────────────────────────

export default function SubstitutePage() {
  const [teachers, setTeachers] = useState<any[]>([]);
  const [timetable, setTimetable] = useState<any[]>([]);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);

  // Multiple absent teachers
  const [absentEntries, setAbsentEntries] = useState<AbsentEntry[]>([]);
  const [selectingTeacherId, setSelectingTeacherId] = useState('');

  // assignments: key = `${teacherId}_${slotNumber}_${divisionId}` → substituteTeacherId
  const [assignments, setAssignments] = useState<Record<string, string>>({});

  const [subs, setSubs] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

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

  // ── Derived helpers ────────────────────────────────────────────────────────

  const allAbsentTeacherIds = new Set(absentEntries.map(e => e.teacherId));

  function computeAffectedSlots(teacherId: string): any[] {
    const dayOfWeek = new Date(date).getDay() || 7;
    return timetable.filter((e: any) => e.teacherId === teacherId && e.dayOfWeek === dayOfWeek);
  }

  function addAbsentTeacher() {
    if (!selectingTeacherId) return;
    if (allAbsentTeacherIds.has(selectingTeacherId)) return;
    const slots = computeAffectedSlots(selectingTeacherId);
    setAbsentEntries(prev => [...prev, { teacherId: selectingTeacherId, affectedSlots: slots }]);
    setSelectingTeacherId('');
  }

  function removeAbsentTeacher(teacherId: string) {
    setAbsentEntries(prev => prev.filter(e => e.teacherId !== teacherId));
    // Clear any assignments for this teacher's slots
    setAssignments(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(k => { if (k.startsWith(`${teacherId}_`)) delete next[k]; });
      return next;
    });
  }

  function getTeacherName(id: string) {
    const t = teachers.find(t => t.id === id);
    return t ? `${t.teacherCode} – ${t.user?.name}` : id;
  }

  function getFreePeriodsCount(teacherId: string, currentSlotKey?: string) {
    const dayOfWeek = new Date(date).getDay() || 7;
    const busySlots = new Set<number>();

    // Regular timetable (excluding lunch 5)
    timetable.forEach((e: any) => {
      if (e.teacherId === teacherId && e.dayOfWeek === dayOfWeek && e.slotNumber !== 5) {
        busySlots.add(e.slotNumber);
      }
    });

    // Saved subs on this date
    subs.forEach((s: any) => {
      if (s.substituteTeacherId === teacherId && s.originalSlotNumber !== 5) {
        const ck = `${s.absentTeacherId}_${s.originalSlotNumber}_${s.originalDivisionId}`;
        if (ck !== currentSlotKey) busySlots.add(s.originalSlotNumber);
      }
    });

    // Unsaved assignments
    Object.entries(assignments).forEach(([key, subTeacherId]) => {
      if (subTeacherId === teacherId && key !== currentSlotKey) {
        const parts = key.split('_');
        const slotNum = parseInt(parts[1]);
        if (slotNum !== 5) busySlots.add(slotNum);
      }
    });

    const teachingSlots = [1, 2, 3, 4, 6, 7];
    return Math.max(0, teachingSlots.length - busySlots.size);
  }

  function getFreeTeachers(slot: number, divisionId: string, absentTeacherId: string) {
    const dayOfWeek = new Date(date).getDay() || 7;

    const busyTeacherIds = new Set(
      timetable
        .filter((e: any) => e.dayOfWeek === dayOfWeek && e.slotNumber === slot)
        .map((e: any) => e.teacherId)
    );

    // Saved subs for this slot
    subs.forEach((s: any) => {
      if (s.originalSlotNumber === slot && s.substituteTeacherId) {
        if (s.originalDivisionId !== divisionId) busyTeacherIds.add(s.substituteTeacherId);
      }
    });

    // Unsaved assignments for this slot (different division)
    Object.entries(assignments).forEach(([key, subTeacherId]) => {
      const parts = key.split('_');
      const slotNum = parseInt(parts[1]);
      const divId = parts[2];
      if (slotNum === slot && subTeacherId && divId !== divisionId) {
        busyTeacherIds.add(subTeacherId);
      }
    });

    // All absent teachers are unavailable
    allAbsentTeacherIds.forEach(id => busyTeacherIds.add(id));

    return teachers.filter((t: any) => !busyTeacherIds.has(t.id));
  }

  async function saveSubstitutes() {
    setSaving(true);
    setSaveMsg('');
    let total = 0;

    for (const entry of absentEntries) {
      const assigns = Object.entries(assignments)
        .filter(([key]) => key.startsWith(`${entry.teacherId}_`))
        .map(([key, subTeacherId]) => {
          const parts = key.split('_');
          return { slotNumber: parseInt(parts[1]), divisionId: parts[2], substituteTeacherId: subTeacherId };
        })
        .filter(a => a.substituteTeacherId);

      if (assigns.length === 0) continue;

      await fetch('/api/substitute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, absentTeacherId: entry.teacherId, assignments: assigns }),
      });
      total += assigns.length;
    }

    await fetchSubs();
    setSaving(false);
    setSaveMsg(`✓ ${total} substitution${total !== 1 ? 's' : ''} saved.`);
    setTimeout(() => setSaveMsg(''), 3500);
  }

  // ── Group today's subs by absent teacher ────────────────────────────────────

  const subsGrouped = subs.reduce((acc: Record<string, any[]>, s: any) => {
    const key = s.absentTeacherId;
    if (!acc[key]) acc[key] = [];
    acc[key].push(s);
    return acc;
  }, {});

  const totalAffected = absentEntries.reduce((sum, e) => sum + e.affectedSlots.length, 0);
  const totalAssigned = Object.values(assignments).filter(Boolean).length;

  return (
    <DashboardLayout>
      <div className="page-header">
        <div>
          <h2>Substitute Assignment</h2>
          <p>Manage teacher absences and substitutes</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {saveMsg && (
            <span style={{ fontSize: 13, color: 'var(--success)', alignSelf: 'center', fontWeight: 600 }}>{saveMsg}</span>
          )}
          <button className="btn btn-secondary" onClick={() => window.print()}>🖨️ Print</button>
        </div>
      </div>

      <div className="page-body">

        {/* ── Date + Absent Teacher selection ─────────────────────────────── */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body">
            <div className="sub-form-row">
              {/* Date picker */}
              <div className="form-group" style={{ marginBottom: 0, minWidth: 160 }}>
                <label className="form-label">Date</label>
                <input
                  className="form-input"
                  type="date"
                  value={date}
                  onChange={e => { setDate(e.target.value); setAbsentEntries([]); setAssignments({}); }}
                />
                <span className="form-hint">{getDayName(new Date(date).getDay() || 7)}</span>
              </div>

              {/* Absent teacher selector */}
              <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
                <label className="form-label">Add Absent Teacher</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select
                    className="form-select"
                    value={selectingTeacherId}
                    onChange={e => setSelectingTeacherId(e.target.value)}
                    style={{ flex: 1 }}
                  >
                    <option value="">Select teacher...</option>
                    {teachers
                      .filter(t => !allAbsentTeacherIds.has(t.id))
                      .map((t: any) => (
                        <option key={t.id} value={t.id}>{t.teacherCode} – {t.user?.name}</option>
                      ))}
                  </select>
                  <button
                    className="btn btn-primary"
                    onClick={addAbsentTeacher}
                    disabled={!selectingTeacherId}
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    + Add
                  </button>
                </div>
                <span className="form-hint">You can add multiple absent teachers for the same day</span>
              </div>
            </div>

            {/* Absent teacher pills */}
            {absentEntries.length > 0 && (
              <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-500)', alignSelf: 'center' }}>
                  Absent today:
                </span>
                {absentEntries.map(entry => (
                  <span key={entry.teacherId} className="sub-absent-chip">
                    <span className="sub-chip-dot" />
                    {getTeacherName(entry.teacherId)}
                    <button
                      onClick={() => removeAbsentTeacher(entry.teacherId)}
                      title="Remove"
                    >✕</button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Per-teacher affected slot cards ─────────────────────────────── */}
        {absentEntries.length > 0 && (
          <>
            {/* Summary bar */}
            {totalAffected > 0 && (
              <div className="sub-summary-bar">
                <span>📋 <strong>{totalAffected}</strong> affected period{totalAffected !== 1 ? 's' : ''} across <strong>{absentEntries.length}</strong> absent teacher{absentEntries.length !== 1 ? 's' : ''}</span>
                <span className={`sub-assign-pill ${totalAssigned === totalAffected ? 'done' : ''}`}>
                  {totalAssigned}/{totalAffected} assigned
                </span>
              </div>
            )}

            {absentEntries.map(entry => (
              <div key={entry.teacherId} className="card" style={{ marginBottom: 16 }}>
                <div className="card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 20 }}>🏫</span>
                    <div>
                      <h3 style={{ margin: 0 }}>{getTeacherName(entry.teacherId)}</h3>
                      <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>
                        {entry.affectedSlots.length} period{entry.affectedSlots.length !== 1 ? 's' : ''} affected
                        {entry.affectedSlots.length === 0 ? ' — no classes on this day' : ''}
                      </span>
                    </div>
                  </div>
                  <span className="badge badge-red">Absent</span>
                </div>

                {entry.affectedSlots.length === 0 ? (
                  <div className="card-body" style={{ padding: '16px 24px' }}>
                    <p style={{ color: 'var(--gray-400)', fontSize: 13, fontStyle: 'italic' }}>
                      This teacher has no classes scheduled on {getDayName(new Date(date).getDay() || 7)}.
                    </p>
                  </div>
                ) : (
                  <div className="table-container">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Period</th>
                          <th>Class</th>
                          <th>Subject</th>
                          <th>Substitute Teacher</th>
                        </tr>
                      </thead>
                      <tbody>
                        {entry.affectedSlots.map((slot: any) => {
                          const key = `${entry.teacherId}_${slot.slotNumber}_${slot.divisionId}`;
                          const freeTeachers = getFreeTeachers(slot.slotNumber, slot.divisionId, entry.teacherId);
                          return (
                            <tr key={key}>
                              <td>
                                <span className="sub-period-badge">P{slot.slotNumber}</span>
                              </td>
                              <td style={{ fontWeight: 600 }}>
                                {slot.division?.class?.name}{slot.division?.name}
                              </td>
                              <td>{slot.subject?.name}</td>
                              <td>
                                <select
                                  className="form-select"
                                  style={{ minWidth: 200 }}
                                  value={assignments[key] || ''}
                                  onChange={e => setAssignments({ ...assignments, [key]: e.target.value })}
                                >
                                  <option value="">Select substitute...</option>
                                  {freeTeachers.map((t: any) => {
                                    const freeCount = getFreePeriodsCount(t.id, key);
                                    return (
                                      <option key={t.id} value={t.id}>
                                        {t.teacherCode} – {t.user?.name} ({freeCount} free)
                                      </option>
                                    );
                                  })}
                                </select>
                                <span className="form-hint">{freeTeachers.length} available</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}

            {/* Save button */}
            {totalAffected > 0 && (
              <div style={{ marginBottom: 16 }}>
                <button
                  className="btn btn-primary"
                  style={{ minWidth: 200 }}
                  onClick={saveSubstitutes}
                  disabled={saving || totalAssigned === 0}
                >
                  {saving ? '⏳ Saving...' : `💾 Save ${totalAssigned} Substitution${totalAssigned !== 1 ? 's' : ''}`}
                </button>
              </div>
            )}
          </>
        )}

        {/* ── Today's Substitutions (all saved records) ───────────────────── */}
        {subs.length > 0 && (
          <div className="card">
            <div className="card-header">
              <h3>📋 {date === new Date().toISOString().split('T')[0] ? "Today's" : `${date}`} Substitutions</h3>
              <span className="badge badge-blue">{subs.length} total</span>
            </div>

            {Object.entries(subsGrouped).map(([absentId, group]: [string, any]) => {
              const absentTeacher = group[0]?.absentTeacher;
              return (
                <div key={absentId} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <div style={{ padding: '10px 20px', background: 'var(--gray-50)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="badge badge-red">{absentTeacher?.user?.name ?? 'Unknown'}</span>
                    <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>absent — {group.length} period{group.length !== 1 ? 's' : ''} covered</span>
                  </div>
                  <div className="table-container">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Period</th>
                          <th>Class</th>
                          <th>Substitute</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.map((s: any) => (
                          <tr key={s.id}>
                            <td><span className="sub-period-badge">P{s.originalSlotNumber}</span></td>
                            <td style={{ fontWeight: 600 }}>{s.originalDivision?.class?.name}{s.originalDivision?.name}</td>
                            <td><span className="badge badge-green">{s.substituteTeacher?.user?.name}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <style>{substituteStyles}</style>
    </DashboardLayout>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const substituteStyles = `
/* Absent teacher chip */
.sub-absent-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px 4px 8px;
  background: #fef2f2;
  border: 1px solid rgba(190,18,60,.2);
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  color: var(--danger);
}
.sub-chip-dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  background: var(--danger);
  flex-shrink: 0;
}
.sub-absent-chip button {
  background: none; border: none;
  font-size: 11px; color: var(--danger);
  cursor: pointer; padding: 0 2px;
  line-height: 1; opacity: 0.7;
  transition: opacity 0.15s;
}
.sub-absent-chip button:hover { opacity: 1; }

/* Form row for date + teacher select */
.sub-form-row {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  flex-wrap: wrap;
}
.sub-form-row .form-group { margin-bottom: 0; }

/* Summary bar */
.sub-summary-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--primary-50);
  border: 1px solid var(--primary-200);
  border-radius: var(--radius-md);
  padding: 10px 16px;
  margin-bottom: 12px;
  font-size: 13px;
  gap: 12px;
  flex-wrap: wrap;
}
.sub-assign-pill {
  background: var(--gray-200);
  color: var(--gray-600);
  font-size: 12px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 999px;
  flex-shrink: 0;
}
.sub-assign-pill.done {
  background: var(--primary-100);
  color: var(--primary-700);
}

/* Period badge */
.sub-period-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--primary-700);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 4px;
  min-width: 28px;
}

@media (max-width: 640px) {
  .sub-form-row { flex-direction: column; }
  .sub-form-row .form-group { width: 100%; }
  .sub-summary-bar { flex-direction: column; align-items: flex-start; gap: 8px; }
}
`;
