'use client';

import { useEffect, useState, useRef } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { downloadExcel, parseExcel } from '@/lib/excel';

const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const FIXED_SLOT_OPTIONS = [
  { value: '', label: 'Flexible (no fixed slot)' },
  { value: 'FIRST', label: 'First period' },
  { value: 'LAST', label: 'Last period' },
  { value: '2', label: 'Period 2' }, { value: '3', label: 'Period 3' },
  { value: '4', label: 'Period 4' }, { value: '5', label: 'Period 5' },
  { value: '6', label: 'Period 6' }, { value: '7', label: 'Period 7' },
];

const EMPTY_FORM = {
  name: '', code: '', periodsPerWeek: 1, isCore: true,
  eveningPriority: false, consecutiveSlots: 1, isLanguageVariant: false, replacesSubjectId: '',
  fixedDay: '' as string | number, fixedSlot: '', useClassTeacher: false,
};

export default function SubjectsPage() {
  const [subjects, setSubjects] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [classOverrides, setClassOverrides] = useState<Record<string, any[]>>({}); // subjectId → overrides[]
  const [showModal, setShowModal] = useState(false);
  const [editingSubject, setEditingSubject] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [expandedSubject, setExpandedSubject] = useState<string | null>(null);
  const [savingOverride, setSavingOverride] = useState<string | null>(null); // `${classId}:${subjectId}`
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({ ...EMPTY_FORM });
  // Per-class period inputs: { `${classId}:${subjectId}`: { periodsPerWeek: string } }
  const [classInputs, setClassInputs] = useState<Record<string, string>>({});

  // Division exclusions: { subjectId: Set<divisionId> }
  const [divisionExclusions, setDivisionExclusions] = useState<Record<string, Set<string>>>({});
  const [savingExclusions, setSavingExclusions] = useState<string | null>(null); // subjectId being saved;

  useEffect(() => {
    fetchSubjects();
    fetchClasses();
  }, []);

  async function fetchSubjects() {
    const res = await fetch('/api/subjects');
    const data = await res.json();
    if (data.success) setSubjects(data.data);
  }

  async function fetchClasses() {
    const res = await fetch('/api/classes?withDivisions=true');
    const data = await res.json();
    if (data.success) setClasses(data.data);
  }

  async function fetchDivisionExclusions(subjectId: string) {
    const res = await fetch(`/api/division-subjects?subjectId=${subjectId}`);
    const data = await res.json();
    if (data.success) {
      setDivisionExclusions(prev => ({ ...prev, [subjectId]: new Set(data.data as string[]) }));
    }
  }

  async function saveDivisionExclusions(subjectId: string) {
    setSavingExclusions(subjectId);
    const excludedDivisionIds = Array.from(divisionExclusions[subjectId] ?? []);
    await fetch('/api/division-subjects', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subjectId, excludedDivisionIds }),
    });
    setSavingExclusions(null);
  }

  function toggleDivisionExclusion(subjectId: string, divisionId: string) {
    setDivisionExclusions(prev => {
      const current = new Set(prev[subjectId] ?? []);
      if (current.has(divisionId)) current.delete(divisionId);
      else current.add(divisionId);
      return { ...prev, [subjectId]: current };
    });
  }

  async function fetchOverridesForSubject(subjectId: string) {
    const res = await fetch(`/api/class-subjects?subjectId=${subjectId}`);
    const data = await res.json();
    if (data.success) {
      setClassOverrides(prev => ({ ...prev, [subjectId]: data.data }));
      // Populate classInputs with existing override values
      const inputs: Record<string, string> = {};
      for (const o of data.data) {
        inputs[`${o.classId}:${subjectId}`] = o.periodsPerWeek !== null ? String(o.periodsPerWeek) : '';
      }
      setClassInputs(prev => ({ ...prev, ...inputs }));
    }
  }

  function openAddModal() {
    setEditingSubject(null);
    setForm({ ...EMPTY_FORM });
    setShowModal(true);
  }

  function openEditModal(subject: any) {
    setEditingSubject(subject);
    setForm({
      name: subject.name,
      code: subject.code,
      periodsPerWeek: subject.periodsPerWeek,
      isCore: subject.isCore,
      eveningPriority: subject.eveningPriority,
      consecutiveSlots: subject.consecutiveSlots,
      isLanguageVariant: subject.isLanguageVariant,
      replacesSubjectId: subject.replacesSubjectId || '',
      fixedDay: subject.fixedDay ?? '',
      fixedSlot: subject.fixedSlot ?? '',
      useClassTeacher: subject.useClassTeacher ?? false,
    });
    setShowModal(true);
  }

  async function saveSubject(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const payload = { ...form, replacesSubjectId: form.replacesSubjectId || null };

    if (editingSubject) {
      // PATCH existing
      const res = await fetch('/api/subjects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingSubject.id, ...payload }),
      });
      const data = await res.json();
      if (data.success) {
        setShowModal(false);
        setMessage(`✓ "${form.name}" updated successfully.`);
        fetchSubjects();
      } else {
        setMessage(`Error: ${data.error || 'Failed to update subject'}`);
      }
    } else {
      // POST new
      const res = await fetch('/api/subjects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        setShowModal(false);
        setMessage(`✓ "${form.name}" created successfully.`);
        fetchSubjects();
      } else {
        setMessage(`Error: ${data.error || 'Failed to create subject'}`);
      }
    }
    setLoading(false);
  }

  async function deleteSubject(id: string, name: string) {
    if (!confirm(`Are you sure you want to delete "${name}"? This will remove it from all timetables, teacher mappings, and results!`)) return;
    const res = await fetch(`/api/subjects?id=${id}`, { method: 'DELETE' });
    if ((await res.json()).success) {
      fetchSubjects();
      if (expandedSubject === id) setExpandedSubject(null);
    }
  }

  function toggleExpand(subjectId: string) {
    if (expandedSubject === subjectId) {
      setExpandedSubject(null);
    } else {
      setExpandedSubject(subjectId);
      if (!classOverrides[subjectId]) fetchOverridesForSubject(subjectId);
      if (!divisionExclusions[subjectId]) fetchDivisionExclusions(subjectId);
    }
  }

  function getOverrideForClass(subjectId: string, classId: string) {
    return classOverrides[subjectId]?.find((o: any) => o.classId === classId) || null;
  }

  async function saveClassOverride(classId: string, subjectId: string, subject: any) {
    const key = `${classId}:${subjectId}`;
    setSavingOverride(key);

    const inputVal = classInputs[key];
    const periodsPerWeek = inputVal === '' ? null : parseInt(inputVal);

    const res = await fetch('/api/class-subjects', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classId, subjectId, periodsPerWeek, consecutiveSlots: null }),
    });

    const data = await res.json();
    if (data.success) {
      // Refresh overrides for this subject
      await fetchOverridesForSubject(subjectId);
    }
    setSavingOverride(null);
  }

  async function resetClassOverride(classId: string, subjectId: string) {
    const key = `${classId}:${subjectId}`;
    setSavingOverride(key);

    await fetch(`/api/class-subjects?classId=${classId}&subjectId=${subjectId}`, { method: 'DELETE' });
    // Clear the input
    setClassInputs(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    await fetchOverridesForSubject(subjectId);
    setSavingOverride(null);
  }

  function handleDownloadTemplate() {
    const sampleData = [
      { 'Name': 'Malayalam I', 'Code': 'MAL1', 'Periods Per Week': 5, 'Is Core (True/False)': 'True', 'Evening Priority (True/False)': 'False', 'Consecutive Slots': 1, 'Language Variant (True/False)': 'False', 'Replaces Subject Code': '' },
      { 'Name': 'Sanskrit', 'Code': 'SANS', 'Periods Per Week': 5, 'Is Core (True/False)': 'True', 'Evening Priority (True/False)': 'False', 'Consecutive Slots': 1, 'Language Variant (True/False)': 'True', 'Replaces Subject Code': 'MAL1' },
    ];
    downloadExcel(sampleData, 'subjects_template', 'Subjects');
  }

  async function handleUploadExcel(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setMessage('');
    try {
      const parsedData = await parseExcel(file);
      if (parsedData.length === 0) { setMessage('No data found in Excel file.'); setUploading(false); return; }

      const currentSubjectsRes = await fetch('/api/subjects');
      const currentSubjectsData = await currentSubjectsRes.json();
      const currentSubjects: any[] = currentSubjectsData.success ? currentSubjectsData.data : [];

      let successCount = 0, failCount = 0;
      for (const row of parsedData) {
        const name = row['Name'];
        const code = row['Code'];
        const periodsPerWeek = parseInt(row['Periods Per Week'] || '1');
        const isCore = String(row['Is Core (True/False)']).toLowerCase() === 'true';
        const eveningPriority = String(row['Evening Priority (True/False)']).toLowerCase() === 'true';
        const consecutiveSlots = parseInt(row['Consecutive Slots'] || '1');
        const isLanguageVariant = String(row['Language Variant (True/False)']).toLowerCase() === 'true';
        const replacesCode = row['Replaces Subject Code'];
        let replacesSubjectId = null;
        if (isLanguageVariant && replacesCode) {
          const matched = currentSubjects.find(s => s.code === replacesCode);
          if (matched) replacesSubjectId = matched.id;
        }
        const res = await fetch('/api/subjects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, code, periodsPerWeek, isCore, eveningPriority, consecutiveSlots, isLanguageVariant, replacesSubjectId }),
        });
        (await res.json()).success ? successCount++ : failCount++;
      }
      setMessage(`Uploaded successfully! Created: ${successCount}, Failed: ${failCount}`);
      fetchSubjects();
    } catch (err: any) {
      setMessage(`Error parsing file: ${err.message || err}`);
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const baseSubjects = subjects.filter(s => !s.isLanguageVariant);

  return (
    <DashboardLayout>
      <div className="page-header">
        <div>
          <h2>Subject Management</h2>
          <p>Configure subjects, edit details, and set per-class period overrides</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-secondary" onClick={handleDownloadTemplate}>⬇ Template</button>
          <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? 'Uploading...' : '⬆ Excel'}
          </button>
          <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept=".xlsx" onChange={handleUploadExcel} />
          <button className="btn btn-primary" onClick={openAddModal}>+ Add Subject</button>
        </div>
      </div>

      <div className="page-body">
        {message && (
          <div className={`toast ${message.includes('Error') || message.includes('Failed') ? 'toast-error' : 'toast-info'}`}
            style={{ position: 'relative', bottom: 'auto', right: 'auto', marginBottom: 16, maxWidth: '100%' }}>
            {message}
            <button style={{ marginLeft: 12, background: 'none', border: 'none', cursor: 'pointer', opacity: 0.7 }} onClick={() => setMessage('')}>✕</button>
          </div>
        )}

        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3>Subjects ({subjects.length})</h3>
            <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>
              Click <strong>⚙ Class Periods</strong> to set per-class period overrides
            </span>
          </div>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Code</th>
                  <th>Default Periods/Week</th>
                  <th>Type</th>
                  <th>Placement Rule</th>
                  <th>Teachers</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {subjects.map(s => (
                  <>
                    <tr key={s.id} style={{ background: expandedSubject === s.id ? 'var(--hover-bg, rgba(99,102,241,0.05))' : undefined }}>
                      <td><strong>{s.name}</strong></td>
                      <td><span className="badge badge-gray">{s.code}</span></td>
                      <td>
                        <span style={{ fontWeight: 600 }}>{s.periodsPerWeek}</span>
                        <span style={{ fontSize: 11, color: 'var(--gray-400)', marginLeft: 4 }}>/ week</span>
                      </td>
                      <td><span className={`badge ${s.isCore ? 'badge-green' : 'badge-gold'}`}>{s.isCore ? 'Core' : 'Non-Core'}</span></td>
                      <td style={{ fontSize: 12 }}>
                        {s.fixedDay || s.fixedSlot || s.useClassTeacher ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {s.fixedDay && <span className="badge badge-blue" style={{ fontSize: 10 }}>📅 {DAYS[s.fixedDay]}</span>}
                            {s.fixedSlot && <span className="badge badge-gold" style={{ fontSize: 10 }}>🕐 {s.fixedSlot === 'LAST' ? 'Last Period' : s.fixedSlot === 'FIRST' ? 'First Period' : `Period ${s.fixedSlot}`}</span>}
                            {s.useClassTeacher && <span className="badge badge-green" style={{ fontSize: 10 }}>👤 Class Teacher</span>}
                          </div>
                        ) : <span style={{ color: 'var(--gray-400)' }}>—</span>}
                      </td>
                      <td>{s._count?.teacherMappings || 0}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button
                            className="btn btn-secondary btn-sm"
                            title="Set per-class period counts"
                            onClick={() => toggleExpand(s.id)}
                            style={{ fontSize: 11 }}
                          >
                            {expandedSubject === s.id ? '▲ Class Periods' : '⚙ Class Periods'}
                          </button>
                          <button className="btn btn-secondary btn-sm" onClick={() => openEditModal(s)}>Edit</button>
                          <button className="btn btn-red btn-sm" onClick={() => deleteSubject(s.id, s.name)}>Delete</button>
                        </div>
                      </td>
                    </tr>

                    {/* Per-class override panel */}
                    {expandedSubject === s.id && (
                      <tr key={`${s.id}-overrides`}>
                        <td colSpan={9} style={{ padding: 0 }}>
                          <div style={{
                            background: 'var(--surface-bg, #f8f9fc)',
                            borderTop: '2px solid var(--primary-color)',
                            borderBottom: '1px solid var(--border-color)',
                            padding: '16px 20px',
                          }}>

                            {/* ── Per-Class Period Overrides ── */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                              <span style={{ fontWeight: 600, fontSize: 14 }}>⏱ Per-Class Period Overrides</span>
                              <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>
                                — Default is <strong>{s.periodsPerWeek}</strong>/week. Leave blank to use the default.
                              </span>
                            </div>

                            {classes.length === 0 ? (
                              <p style={{ color: 'var(--gray-400)', fontSize: 13 }}>No classes configured yet. Add classes first.</p>
                            ) : (
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, marginBottom: 24 }}>
                                {classes.map(cls => {
                                  const key = `${cls.id}:${s.id}`;
                                  const override = getOverrideForClass(s.id, cls.id);
                                  const isSaving = savingOverride === key;
                                  const inputVal = classInputs[key] ?? (override?.periodsPerWeek !== null && override?.periodsPerWeek !== undefined ? String(override.periodsPerWeek) : '');
                                  const hasOverride = override !== null && override.periodsPerWeek !== null;

                                  return (
                                    <div key={cls.id} style={{
                                      background: 'var(--card-bg, white)',
                                      border: `1px solid ${hasOverride ? 'var(--primary-color)' : 'var(--border-color)'}`,
                                      borderRadius: 8,
                                      padding: '12px 14px',
                                    }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                        <span style={{ fontWeight: 600, fontSize: 13 }}>Class {cls.name}</span>
                                        {hasOverride && (
                                          <span className="badge badge-blue" style={{ fontSize: 10, padding: '2px 6px' }}>
                                            Override: {override.periodsPerWeek}/week
                                          </span>
                                        )}
                                      </div>
                                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                        <input
                                          type="number"
                                          min={1}
                                          max={14}
                                          placeholder={`Default: ${s.periodsPerWeek}`}
                                          value={inputVal}
                                          onChange={e => setClassInputs(prev => ({ ...prev, [key]: e.target.value }))}
                                          style={{
                                            width: '100%',
                                            padding: '6px 10px',
                                            border: '1px solid var(--border-color)',
                                            borderRadius: 6,
                                            fontSize: 13,
                                            background: 'var(--input-bg, white)',
                                            color: 'var(--text-primary)',
                                          }}
                                        />
                                        <button
                                          className="btn btn-primary btn-sm"
                                          disabled={isSaving}
                                          onClick={() => saveClassOverride(cls.id, s.id, s)}
                                          style={{ whiteSpace: 'nowrap', minWidth: 46 }}
                                        >
                                          {isSaving ? '…' : 'Save'}
                                        </button>
                                        {hasOverride && (
                                          <button
                                            className="btn btn-secondary btn-sm"
                                            disabled={isSaving}
                                            onClick={() => resetClassOverride(cls.id, s.id)}
                                            title="Reset to subject default"
                                            style={{ minWidth: 36 }}
                                          >
                                            ↺
                                          </button>
                                        )}
                                      </div>
                                      {!hasOverride && (
                                        <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 4 }}>
                                          Using global default ({s.periodsPerWeek}/week)
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {/* ── Division Exclusions ── */}
                            <div style={{ borderTop: '1px dashed var(--border-color)', paddingTop: 18 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                                <div>
                                  <span style={{ fontWeight: 600, fontSize: 14 }}>🚫 Division Exclusions</span>
                                  <span style={{ fontSize: 12, color: 'var(--gray-500)', marginLeft: 8 }}>
                                    — Checked divisions will NOT receive this subject in the timetable
                                  </span>
                                </div>
                                <button
                                  className="btn btn-primary btn-sm"
                                  disabled={savingExclusions === s.id}
                                  onClick={() => saveDivisionExclusions(s.id)}
                                  style={{ minWidth: 80 }}
                                >
                                  {savingExclusions === s.id ? 'Saving…' : '💾 Save Exclusions'}
                                </button>
                              </div>

                              {classes.flatMap(cls => cls.divisions ?? []).length === 0 ? (
                                <p style={{ color: 'var(--gray-400)', fontSize: 13 }}>No divisions found. Add classes with divisions first.</p>
                              ) : (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                                  {classes.map(cls =>
                                    (cls.divisions ?? []).map((div: any) => {
                                      const isExcluded = (divisionExclusions[s.id] ?? new Set()).has(div.id);
                                      return (
                                        <label
                                          key={div.id}
                                          style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 7,
                                            padding: '7px 13px',
                                            borderRadius: 8,
                                            border: `1.5px solid ${isExcluded ? '#ef4444' : 'var(--border-color)'}`,
                                            background: isExcluded ? '#fef2f2' : 'var(--card-bg, white)',
                                            cursor: 'pointer',
                                            fontSize: 13,
                                            fontWeight: isExcluded ? 600 : 400,
                                            color: isExcluded ? '#dc2626' : 'var(--text-primary)',
                                            transition: 'all 0.15s ease',
                                          }}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={isExcluded}
                                            onChange={() => toggleDivisionExclusion(s.id, div.id)}
                                            style={{ accentColor: '#ef4444', width: 15, height: 15 }}
                                          />
                                          <span>{cls.name}{div.name}</span>
                                          {isExcluded && <span style={{ fontSize: 10 }}>🚫</span>}
                                        </label>
                                      );
                                    })
                                  )}
                                </div>
                              )}

                              {Array.from(divisionExclusions[s.id] ?? []).length > 0 && (
                                <div style={{
                                  marginTop: 10, padding: '8px 12px',
                                  background: '#fef2f2', borderRadius: 6,
                                  fontSize: 12, color: '#dc2626',
                                  border: '1px solid #fecaca',
                                }}>
                                  ⚠ This subject is excluded from{' '}
                                  <strong>{Array.from(divisionExclusions[s.id] ?? []).length}</strong>{' '}
                                  division(s). They will not receive any periods for this subject.
                                </div>
                              )}
                            </div>

                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
                {subjects.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: 40 }}>No subjects added yet</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Add / Edit Subject Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingSubject ? `Edit Subject — ${editingSubject.name}` : 'Add Subject'}</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <form onSubmit={saveSubject}>
              <div className="modal-body">
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Subject Name</label>
                    <input className="form-input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g., Malayalam I" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Code</label>
                    <input className="form-input" required value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="e.g., MAL1" />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Default Periods per Week</label>
                    <input className="form-input" type="number" min={1} max={14} value={form.periodsPerWeek} onChange={e => setForm({ ...form, periodsPerWeek: parseInt(e.target.value) })} />
                    <span className="form-hint">Global default — can be overridden per class</span>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Consecutive Slots</label>
                    <input className="form-input" type="number" min={1} max={3} value={form.consecutiveSlots} onChange={e => setForm({ ...form, consecutiveSlots: parseInt(e.target.value) })} />
                    <span className="form-hint">e.g., 2 for IT Practical</span>
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 16 }}>
                  <label className="form-checkbox"><input type="checkbox" checked={form.isCore} onChange={e => setForm({ ...form, isCore: e.target.checked })} /> Core Subject</label>
                  <label className="form-checkbox"><input type="checkbox" checked={form.eveningPriority} onChange={e => setForm({ ...form, eveningPriority: e.target.checked })} /> Evening Priority</label>
                  <label className="form-checkbox"><input type="checkbox" checked={form.isLanguageVariant} onChange={e => setForm({ ...form, isLanguageVariant: e.target.checked })} /> Language Variant</label>
                </div>

                {/* ── Fixed Placement Rules ── */}
                <div style={{ background: 'var(--surface-bg, #f8f9fc)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '14px 16px', marginBottom: 16 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>📌 Fixed Placement Rules</div>
                  <div className="form-row" style={{ gap: 12 }}>
                    <div className="form-group">
                      <label className="form-label">Fixed Day</label>
                      <select className="form-select" value={String(form.fixedDay ?? '')} onChange={e => setForm({ ...form, fixedDay: e.target.value ? parseInt(e.target.value) : '' })}>
                        <option value="">Flexible (any day)</option>
                        {[1,2,3,4,5,6].map(d => <option key={d} value={d}>{DAYS[d]}</option>)}
                      </select>
                      <span className="form-hint">Lock this subject to a specific day of the week</span>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Fixed Slot</label>
                      <select className="form-select" value={form.fixedSlot} onChange={e => setForm({ ...form, fixedSlot: e.target.value })}>
                        {FIXED_SLOT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <span className="form-hint">Lock to a specific period within the day</span>
                    </div>
                  </div>
                  <label className="form-checkbox" style={{ marginTop: 8 }}>
                    <input type="checkbox" checked={form.useClassTeacher} onChange={e => setForm({ ...form, useClassTeacher: e.target.checked })} />
                    <span>
                      <strong>Use Class Teacher</strong>
                      <span style={{ fontSize: 12, color: 'var(--gray-500)', marginLeft: 6 }}>— The division's class teacher is auto-assigned (e.g. Recreation)</span>
                    </span>
                  </label>
                  {(form.fixedDay || form.fixedSlot || form.useClassTeacher) && (
                    <div style={{ marginTop: 10, padding: '8px 12px', background: '#eff6ff', borderRadius: 6, fontSize: 12, color: '#1d4ed8' }}>
                      ℹ This subject will be pinned to
                      {form.fixedDay ? ` ${DAYS[Number(form.fixedDay)]}` : ' any day'}
                      {form.fixedSlot ? `, ${form.fixedSlot === 'LAST' ? 'last period' : form.fixedSlot === 'FIRST' ? 'first period' : `period ${form.fixedSlot}`}` : ''}
                      {form.useClassTeacher ? ', assigned to the class teacher of each division' : ''}.
                    </div>
                  )}
                </div>
                {form.isLanguageVariant && (
                  <div className="form-group">
                    <label className="form-label">Replaces Subject</label>
                    <select className="form-select" value={form.replacesSubjectId} onChange={e => setForm({ ...form, replacesSubjectId: e.target.value })}>
                      <option value="">Select subject...</option>
                      {baseSubjects.filter(s => !editingSubject || s.id !== editingSubject.id).map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={loading}>
                  {loading ? (editingSubject ? 'Saving...' : 'Creating...') : (editingSubject ? 'Save Changes' : 'Create Subject')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
