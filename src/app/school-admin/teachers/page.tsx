'use client';

import { useEffect, useState, useRef } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { FEATURES } from '@/types';
import { downloadExcel, parseExcel } from '@/lib/excel';

// Features accessible from the teacher dashboard
const TEACHER_FEATURES = ['TIMETABLE', 'ATTENDANCE', 'RESULTS', 'MESSAGES', 'STUDENTS'] as const;

const EMPTY_FORM = {
  name: '', teacherCode: '', penNo: '', designation: 'HSA', username: '', password: '',
  phone: '', email: '', subjectIds: [] as string[], classTeacherDivisionId: '', features: [] as string[],
};

export default function TeachersPage() {
  const [teachers, setTeachers] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingTeacher, setEditingTeacher] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [genPassword, setGenPassword] = useState('');
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const [showPwdModal, setShowPwdModal] = useState(false);
  const [pwdTarget, setPwdTarget] = useState<any>(null);
  const [pwdForm, setPwdForm] = useState({ newPassword: '', confirmAdminPassword: '' });

  // subjectClassRestrictions: { [subjectId]: Set<classId> }  — empty set = unrestricted
  const [subjectRestrictions, setSubjectRestrictions] = useState<Record<string, Set<string>>>({});
  const [expandedRestriction, setExpandedRestriction] = useState<string | null>(null);

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    const [tRes, sRes, cRes] = await Promise.all([
      fetch('/api/teachers').then(r => r.json()),
      fetch('/api/subjects').then(r => r.json()),
      fetch('/api/classes').then(r => r.json()),
    ]);
    if (tRes.success) setTeachers(tRes.data);
    if (sRes.success) setSubjects(sRes.data);
    if (cRes.success) setClasses(cRes.data);
  }

  async function fetchRestrictions(teacherId: string) {
    const res = await fetch(`/api/teacher-subject-classes?teacherId=${teacherId}`);
    const data = await res.json();
    if (data.success) {
      // Convert grouped object to Record<subjectId, Set<divisionId>>
      const map: Record<string, Set<string>> = {};
      for (const [sid, divisionIds] of Object.entries(data.data as Record<string, string[]>)) {
        map[sid] = new Set(divisionIds);
      }
      setSubjectRestrictions(map);
    }
  }

  function openAddModal() {
    setEditingTeacher(null);
    setGenPassword('');
    setSubjectRestrictions({});
    setExpandedRestriction(null);
    setForm({
      ...EMPTY_FORM,
      subjectIds: subjects.filter(s => !s.isCore).map((s: any) => s.id),
      features: [...TEACHER_FEATURES],
    });
    setShowModal(true);
  }

  function openEditModal(t: any) {
    setEditingTeacher(t);
    setGenPassword('');
    setExpandedRestriction(null);
    setSubjectRestrictions({});
    setForm({
      name: t.user?.name || '',
      teacherCode: t.teacherCode || '',
      penNo: t.penNo || '',
      designation: t.designation || 'HSA',
      username: t.user?.username || '',
      password: '',
      phone: t.user?.phone || '',
      email: t.user?.email || '',
      subjectIds: t.subjectMappings?.map((sm: any) => sm.subject?.id).filter(Boolean) || [],
      classTeacherDivisionId: t.classTeacherOf?.id || '',
      features: t.featureAccess?.map((fa: any) => fa.feature) || [],
    });
    // Load existing class restrictions
    fetchRestrictions(t.id);
    setShowModal(true);
  }

  async function saveTeacher(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    if (editingTeacher) {
      const res = await fetch('/api/teachers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingTeacher.id, ...form }),
      });
      const data = await res.json();
      if (data.success) {
        // Save all class restrictions
        await saveAllRestrictions(editingTeacher.id);
        setShowModal(false);
        setMessage(`✓ ${form.name} updated successfully.`);
        fetchAll();
      } else {
        setMessage(`Error: ${data.error || 'Update failed'}`);
      }
    } else {
      const res = await fetch('/api/teachers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.success) {
        // Save class restrictions for newly created teacher
        if (data.data?.teacher?.id) {
          await saveAllRestrictions(data.data.teacher.id);
        }
        if (data.data?.generatedPassword) {
          setGenPassword(data.data.generatedPassword);
        } else {
          setShowModal(false);
        }
        setForm({ ...EMPTY_FORM });
        fetchAll();
      } else {
        setMessage(`Error: ${data.error || 'Creation failed'}`);
      }
    }
    setLoading(false);
  }

  async function saveAllRestrictions(teacherId: string) {
    for (const [subjectId, divisionSet] of Object.entries(subjectRestrictions)) {
      await fetch('/api/teacher-subject-classes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacherId, subjectId, divisionIds: Array.from(divisionSet) }),
      });
    }
  }

  function toggleDivisionRestriction(subjectId: string, divisionId: string, checked: boolean) {
    setSubjectRestrictions(prev => {
      const next = { ...prev };
      if (!next[subjectId]) next[subjectId] = new Set();
      else next[subjectId] = new Set(next[subjectId]);
      if (checked) next[subjectId].add(divisionId);
      else next[subjectId].delete(divisionId);
      return next;
    });
  }

  function toggleAllDivisionsInClass(subjectId: string, cls: any, checked: boolean) {
    setSubjectRestrictions(prev => {
      const next = { ...prev };
      if (!next[subjectId]) next[subjectId] = new Set();
      else next[subjectId] = new Set(next[subjectId]);
      for (const div of (cls.divisions || [])) {
        if (checked) next[subjectId].add(div.id);
        else next[subjectId].delete(div.id);
      }
      return next;
    });
  }

  async function resetPassword(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    const res = await fetch('/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUserId: pwdTarget.id, ...pwdForm }),
    });
    const data = await res.json();
    setMessage(data.success ? 'Password updated successfully!' : data.error || 'Failed');
    if (data.success) setShowPwdModal(false);
    setLoading(false);
  }

  async function deleteTeacher(id: string) {
    if (!confirm('Are you sure you want to delete this teacher? This will delete their class teacher status and user account!')) return;
    const res = await fetch(`/api/teachers?id=${id}`, { method: 'DELETE' });
    const data = await res.json();
    setMessage(data.success ? 'Teacher deleted successfully.' : data.error || 'Failed');
    if (data.success) fetchAll();
  }

  function handleDownloadTemplate() {
    const sampleData = [{
      'Teacher Code': 'T001', 'Name': 'Anil Kumar', 'Designation (HSA/UPSA)': 'HSA',
      'PEN Number': '123456', 'Username': 't001.40010', 'Password (Optional)': '',
      'Subject Codes (Comma Separated)': 'MAL1,MAL2',
      'Class Teacher Division (e.g. 8A)': '8A',
      'Feature Access (e.g. ATTENDANCE,RESULTS)': 'ATTENDANCE,RESULTS'
    }];
    downloadExcel(sampleData, 'teachers_template', 'Teachers');
  }

  async function handleUploadExcel(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setMessage('');
    try {
      const parsedData = await parseExcel(file);
      if (parsedData.length === 0) { setMessage('No data found in Excel file.'); setUploading(false); return; }

      const [subjectsRes, classesRes] = await Promise.all([
        fetch('/api/subjects').then(r => r.json()),
        fetch('/api/classes').then(r => r.json())
      ]);
      const activeSubjects = subjectsRes.success ? subjectsRes.data : [];
      const activeClasses = classesRes.success ? classesRes.data : [];
      const allDivisions = activeClasses.flatMap((c: any) => c.divisions?.map((d: any) => ({ ...d, label: `${c.name}${d.name}`.toLowerCase() })) || []);

      let successCount = 0, failCount = 0;
      for (const row of parsedData) {
        const subjectCodesStr = row['Subject Codes (Comma Separated)'] || '';
        const subjectIds: string[] = [];
        if (subjectCodesStr) {
          subjectCodesStr.split(',').map((c: string) => c.trim().toLowerCase()).forEach((c: string) => {
            const matched = activeSubjects.find((s: any) => s.code.toLowerCase() === c);
            if (matched) subjectIds.push(matched.id);
          });
        }
        const divisionStr = String(row['Class Teacher Division (e.g. 8A)'] || '').replace(/\s+/g, '').toLowerCase();
        const matched = allDivisions.find((d: any) => d.label === divisionStr);
        const featuresStr = row['Feature Access (e.g. ATTENDANCE,RESULTS)'] || '';
        const features = featuresStr ? featuresStr.split(',').map((f: string) => f.trim().toUpperCase()).filter((f: string) => (FEATURES as readonly string[]).includes(f)) : [];

        const res = await fetch('/api/teachers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: row['Name'], teacherCode: row['Teacher Code'], penNo: String(row['PEN Number'] || ''),
            designation: row['Designation (HSA/UPSA)'] || 'HSA', username: row['Username'],
            password: row['Password (Optional)'] || '', phone: '', email: '',
            subjectIds, classTeacherDivisionId: matched?.id || '', features
          }),
        });
        (await res.json()).success ? successCount++ : failCount++;
      }
      setMessage(`Uploaded successfully! Created: ${successCount}, Failed: ${failCount}`);
      fetchAll();
    } catch (err: any) {
      setMessage(`Error parsing file: ${err.message || err}`);
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const allDivisions = classes.flatMap((c: any) => c.divisions?.map((d: any) => ({ ...d, className: c.name })) || []);
  const filtered = teachers.filter((t: any) => t.user?.name?.toLowerCase().includes(search.toLowerCase()) || t.teacherCode?.toLowerCase().includes(search.toLowerCase()));

  return (
    <DashboardLayout>
      <div className="page-header">
        <div>
          <h2>Teacher Management</h2>
          <p>Manage teacher profiles, subjects, and access</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-secondary" onClick={handleDownloadTemplate}>⬇ Template</button>
          <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? 'Uploading...' : '⬆ Excel'}
          </button>
          <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept=".xlsx" onChange={handleUploadExcel} />
          <button className="btn btn-primary" onClick={openAddModal}>+ Add Teacher</button>
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
          <div className="card-header">
            <h3>Teachers ({filtered.length})</h3>
            <input className="form-input" style={{ width: 240 }} placeholder="Search by name or code..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Username</th>
                  <th>Designation</th>
                  <th>PEN</th>
                  <th>Subjects</th>
                  <th>Class Teacher</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t: any) => (
                  <tr key={t.id}>
                    <td><strong>{t.teacherCode}</strong></td>
                    <td>{t.user?.name}</td>
                    <td><code style={{ fontSize: 13, background: 'rgba(0,0,0,0.05)', padding: '2px 6px', borderRadius: 4 }}>{t.user?.username || '—'}</code></td>
                    <td><span className="badge badge-blue">{t.designation}</span></td>
                    <td>{t.penNo || '—'}</td>
                    <td style={{ maxWidth: 200 }}>
                      <span style={{ fontSize: 12 }}>{t.subjectMappings?.map((sm: any) => sm.subject?.name).join(', ') || '—'}</span>
                    </td>
                    <td>{t.classTeacherOf ? <span className="badge badge-green">Class {t.classTeacherOf.class?.name} {t.classTeacherOf.name}</span> : '—'}</td>
                    <td><span className={`badge ${t.user?.isActive ? 'badge-green' : 'badge-red'}`}>{t.user?.isActive ? 'Active' : 'Inactive'}</span></td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => openEditModal(t)}>Edit</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => { setPwdTarget({ id: t.user.id, name: t.user.name }); setShowPwdModal(true); setPwdForm({ newPassword: '', confirmAdminPassword: '' }); setMessage(''); }}>Reset Pwd</button>
                        <button className="btn btn-red btn-sm" onClick={() => deleteTeacher(t.id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40 }}>No teachers found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Password Reset Modal */}
      {showPwdModal && (
        <div className="modal-overlay" onClick={() => setShowPwdModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Reset Password for {pwdTarget?.name}</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowPwdModal(false)}>✕</button>
            </div>
            <form onSubmit={resetPassword}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">New Password</label>
                  <input className="form-input" type="password" required value={pwdForm.newPassword} onChange={e => setPwdForm({ ...pwdForm, newPassword: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Confirm Your Admin Password</label>
                  <input className="form-input" type="password" required value={pwdForm.confirmAdminPassword} onChange={e => setPwdForm({ ...pwdForm, confirmAdminPassword: e.target.value })} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowPwdModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Updating...' : 'Reset'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add / Edit Teacher Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{genPassword ? 'Teacher Created' : editingTeacher ? `Edit — ${editingTeacher.user?.name}` : 'Add Teacher'}</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowModal(false)}>✕</button>
            </div>
            {genPassword ? (
              <div className="modal-body">
                <div style={{ textAlign: 'center', padding: 20 }}>
                  <div style={{ color: 'var(--success)', fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Teacher Created Successfully</div>
                  <p style={{ marginTop: 8, color: 'var(--gray-500)' }}>Auto-generated password:</p>
                  <div style={{ background: 'var(--gray-100)', padding: '12px 20px', borderRadius: 8, fontSize: 20, fontWeight: 700, marginTop: 8, fontFamily: 'monospace' }}>{genPassword}</div>
                  <p style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 8 }}>Please share this with the teacher. They will be asked to change it on first login.</p>
                </div>
                <div className="modal-footer" style={{ borderTop: 'none', justifyContent: 'center' }}>
                  <button className="btn btn-primary" onClick={() => setShowModal(false)}>Done</button>
                </div>
              </div>
            ) : (
              <form onSubmit={saveTeacher}>
                <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Name *</label><input className="form-input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
                    <div className="form-group"><label className="form-label">Teacher Code *</label><input className="form-input" required value={form.teacherCode} onChange={e => setForm({ ...form, teacherCode: e.target.value })} placeholder="e.g., T001" /></div>
                  </div>
                  {!editingTeacher && (
                    <div className="form-row">
                      <div className="form-group">
                        <label className="form-label">Username</label>
                        <input className="form-input" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} placeholder="Leave blank to auto-generate" />
                        <span className="form-hint">Format: &lt;teacher_code&gt;.40010 (lowercased)</span>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Password</label>
                        <input className="form-input" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="Leave blank to auto-generate" />
                        <span className="form-hint">Format: &lt;teacher_code&gt;@40010 (lowercased)</span>
                      </div>
                    </div>
                  )}
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Designation *</label>
                      <select className="form-select" value={form.designation} onChange={e => setForm({ ...form, designation: e.target.value })}>
                        <option value="HSA">HSA (High School Assistant)</option>
                        <option value="UPSA">UPSA (UP School Assistant)</option>
                      </select>
                    </div>
                    <div className="form-group"><label className="form-label">PEN Number</label><input className="form-input" value={form.penNo} onChange={e => setForm({ ...form, penNo: e.target.value })} /></div>
                  </div>
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Phone</label><input className="form-input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
                    <div className="form-group"><label className="form-label">Email</label><input className="form-input" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
                  </div>
                  <div className="form-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <label className="form-label" style={{ margin: 0 }}>Subjects</label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button type="button" className="btn btn-secondary btn-sm" style={{ fontSize: 11 }}
                          onClick={() => setForm({ ...form, subjectIds: subjects.map((s: any) => s.id) })}>
                          Select All
                        </button>
                        <button type="button" className="btn btn-secondary btn-sm" style={{ fontSize: 11 }}
                          onClick={() => setForm({ ...form, subjectIds: [] })}>
                          Deselect All
                        </button>
                        <button type="button" className="btn btn-secondary btn-sm" style={{ fontSize: 11 }}
                          onClick={() => setForm({ ...form, subjectIds: subjects.filter((s: any) => !s.isCore).map((s: any) => s.id) })}>
                          Non-Core Only
                        </button>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '10px 12px', background: 'var(--surface-bg, rgba(0,0,0,0.02))', borderRadius: 8, border: '1px solid var(--border-color)' }}>
                      {subjects.map((s: any) => (
                        <label key={s.id} className="form-checkbox" style={{ minWidth: 140 }}>
                          <input type="checkbox" checked={form.subjectIds.includes(s.id)}
                            onChange={e => setForm({ ...form, subjectIds: e.target.checked ? [...form.subjectIds, s.id] : form.subjectIds.filter(id => id !== s.id) })} />
                          <span>
                            {s.name}
                            {!s.isCore && <span style={{ fontSize: 10, marginLeft: 4, color: 'var(--primary-color)', opacity: 0.7 }}>non-core</span>}
                          </span>
                        </label>
                      ))}
                    </div>
                    <span className="form-hint">{form.subjectIds.length} of {subjects.length} selected</span>
                  </div>

                  {/* ── Per-Subject Division Restrictions ── */}
                  {form.subjectIds.length > 0 && classes.length > 0 && (
                    <div style={{ background: 'var(--surface-bg, #f8f9fc)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '12px 14px', marginBottom: 4 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>🏫 Division Restrictions per Subject</div>
                      <p style={{ fontSize: 12, color: 'var(--gray-500)', marginBottom: 10 }}>
                        Leave a subject with <em>no divisions checked</em> = <strong>unrestricted</strong> (all classes and divisions).
                        Check specific divisions to restrict this teacher to only those.
                      </p>
                      {subjects.filter((s: any) => form.subjectIds.includes(s.id)).map((s: any) => {
                        const restricted = subjectRestrictions[s.id];
                        const isExpanded = expandedRestriction === s.id;
                        const restrictedCount = restricted?.size ?? 0;
                        // Count total divisions across all classes
                        const totalDivisions = classes.reduce((sum: number, cls: any) => sum + (cls.divisions?.length || 0), 0);
                        return (
                          <div key={s.id} style={{ marginBottom: 6, border: '1px solid var(--border-color)', borderRadius: 6, overflow: 'hidden' }}>
                            {/* Subject row header */}
                            <button
                              type="button"
                              onClick={() => setExpandedRestriction(isExpanded ? null : s.id)}
                              style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: isExpanded ? 'rgba(99,102,241,0.07)' : 'var(--card-bg, white)', border: 'none', cursor: 'pointer', fontSize: 13 }}
                            >
                              <span style={{ fontWeight: 500 }}>{s.name}</span>
                              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                {restrictedCount > 0
                                  ? <span className="badge badge-blue" style={{ fontSize: 10 }}>
                                      Restricted to {restrictedCount}/{totalDivisions} division{restrictedCount > 1 ? 's' : ''}
                                    </span>
                                  : <span className="badge badge-green" style={{ fontSize: 10 }}>All divisions (unrestricted)</span>}
                                <span>{isExpanded ? '▲' : '▼'}</span>
                              </span>
                            </button>

                            {isExpanded && (
                              <div style={{ borderTop: '1px solid var(--border-color)', padding: '10px 12px' }}>
                                {/* Clear all button */}
                                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                                  <button type="button" className="btn btn-secondary btn-sm" style={{ fontSize: 11 }}
                                    onClick={() => setSubjectRestrictions(prev => ({ ...prev, [s.id]: new Set() }))}>
                                    Clear all (unrestricted)
                                  </button>
                                </div>

                                {/* Class → Division tree */}
                                {classes.map((cls: any) => {
                                  const divs: any[] = cls.divisions || [];
                                  if (divs.length === 0) return null;
                                  const allDivChecked = divs.every((d: any) => restricted?.has(d.id));
                                  const someDivChecked = divs.some((d: any) => restricted?.has(d.id));
                                  return (
                                    <div key={cls.id} style={{ marginBottom: 10 }}>
                                      {/* Class header with select-all */}
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                        <label className="form-checkbox" style={{ fontWeight: 600, fontSize: 13 }}>
                                          <input
                                            type="checkbox"
                                            checked={allDivChecked}
                                            ref={el => { if (el) el.indeterminate = !allDivChecked && someDivChecked; }}
                                            onChange={e => toggleAllDivisionsInClass(s.id, cls, e.target.checked)}
                                          />
                                          Class {cls.name}
                                        </label>
                                        <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>
                                          ({divs.filter((d: any) => restricted?.has(d.id)).length}/{divs.length} selected)
                                        </span>
                                      </div>
                                      {/* Individual divisions indented */}
                                      <div style={{ paddingLeft: 24, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                        {divs.map((div: any) => (
                                          <label key={div.id} className="form-checkbox" style={{ minWidth: 70 }}>
                                            <input
                                              type="checkbox"
                                              checked={restricted?.has(div.id) ?? false}
                                              onChange={e => toggleDivisionRestriction(s.id, div.id, e.target.checked)}
                                            />
                                            Div {div.name}
                                          </label>
                                        ))}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="form-group">
                    <label className="form-label">Class Teacher Of</label>
                    <select className="form-select" value={form.classTeacherDivisionId} onChange={e => setForm({ ...form, classTeacherDivisionId: e.target.value })}>
                      <option value="">Not a class teacher</option>
                      {allDivisions.map((d: any) => <option key={d.id} value={d.id}>Class {d.className} - Division {d.name}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <label className="form-label" style={{ margin: 0 }}>Feature Access</label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button type="button" className="btn btn-secondary btn-sm" style={{ fontSize: 11 }}
                          onClick={() => setForm({ ...form, features: [...FEATURES] })}>
                          Select All
                        </button>
                        <button type="button" className="btn btn-secondary btn-sm" style={{ fontSize: 11 }}
                          onClick={() => setForm({ ...form, features: [...TEACHER_FEATURES] })}>
                          Teacher Defaults
                        </button>
                        <button type="button" className="btn btn-secondary btn-sm" style={{ fontSize: 11 }}
                          onClick={() => setForm({ ...form, features: [] })}>
                          None
                        </button>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '10px 12px', background: 'var(--surface-bg, rgba(0,0,0,0.02))', borderRadius: 8, border: '1px solid var(--border-color)' }}>
                      {FEATURES.map(f => {
                        const isTeacherFeature = (TEACHER_FEATURES as readonly string[]).includes(f);
                        return (
                          <label key={f} className="form-checkbox">
                            <input type="checkbox" checked={form.features.includes(f)}
                              onChange={e => setForm({ ...form, features: e.target.checked ? [...form.features, f] : form.features.filter(x => x !== f) })} />
                            <span>
                              {f}
                              {isTeacherFeature && <span style={{ fontSize: 10, marginLeft: 4, color: 'var(--success, #16a34a)', opacity: 0.8 }}>✓ teacher</span>}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    <span className="form-hint">{form.features.length} of {FEATURES.length} features enabled</span>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={loading}>
                    {loading ? (editingTeacher ? 'Saving...' : 'Creating...') : (editingTeacher ? 'Save Changes' : 'Create Teacher')}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
