'use client';

import { useEffect, useState, useRef } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { FEATURES } from '@/types';
import { downloadExcel, parseExcel } from '@/lib/excel';

export default function TeachersPage() {
  const [teachers, setTeachers] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [genPassword, setGenPassword] = useState('');
  const [form, setForm] = useState({
    name: '', teacherCode: '', penNo: '', designation: 'HSA', username: '', password: '',
    phone: '', email: '', subjectIds: [] as string[], classTeacherDivisionId: '', features: [] as string[],
  });

  const [showPwdModal, setShowPwdModal] = useState(false);
  const [pwdTarget, setPwdTarget] = useState<any>(null);
  const [pwdForm, setPwdForm] = useState({ newPassword: '', confirmAdminPassword: '' });

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

  async function createTeacher(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch('/api/teachers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (data.success) {
      if (data.data?.generatedPassword) setGenPassword(data.data.generatedPassword);
      else { setShowModal(false); }
      setForm({ name: '', teacherCode: '', penNo: '', designation: 'HSA', username: '', password: '', phone: '', email: '', subjectIds: [], classTeacherDivisionId: '', features: [] });
      fetchAll();
    }
    setLoading(false);
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
    const sampleData = [
      {
        'Teacher Code': 'T001',
        'Name': 'Anil Kumar',
        'Designation (HSA/UPSA)': 'HSA',
        'PEN Number': '123456',
        'Username': 'anil_tshss',
        'Password (Optional)': '',
        'Subject Codes (Comma Separated)': 'MAL1,MAL2',
        'Class Teacher Division (e.g. 8A)': '8A',
        'Feature Access (e.g. ATTENDANCE,RESULTS)': 'ATTENDANCE,RESULTS'
      }
    ];
    downloadExcel(sampleData, 'teachers_template', 'Teachers');
  }

  async function handleUploadExcel(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setMessage('');
    try {
      const parsedData = await parseExcel(file);
      if (parsedData.length === 0) {
        setMessage('No data found in Excel file.');
        setUploading(false);
        return;
      }

      // Fetch all metadata to resolve names/codes to ids
      const [subjectsRes, classesRes] = await Promise.all([
        fetch('/api/subjects').then(r => r.json()),
        fetch('/api/classes').then(r => r.json())
      ]);

      const activeSubjects = subjectsRes.success ? subjectsRes.data : [];
      const activeClasses = classesRes.success ? classesRes.data : [];
      const allDivisions = activeClasses.flatMap((c: any) => c.divisions?.map((d: any) => ({ ...d, label: `${c.name}${d.name}`.toLowerCase() })) || []);

      let successCount = 0;
      let failCount = 0;

      for (const row of parsedData) {
        const teacherCode = row['Teacher Code'];
        const name = row['Name'];
        const designation = row['Designation (HSA/UPSA)'] || 'HSA';
        const penNo = String(row['PEN Number'] || '');
        const username = row['Username'];
        const password = row['Password (Optional)'] || '';
        const subjectCodesStr = row['Subject Codes (Comma Separated)'] || '';
        const divisionStr = String(row['Class Teacher Division (e.g. 8A)'] || '').replace(/\s+/g, '').toLowerCase();
        const featuresStr = row['Feature Access (e.g. ATTENDANCE,RESULTS)'] || '';

        // Resolve subject codes to ids
        const subjectIds: string[] = [];
        if (subjectCodesStr) {
          const codes = subjectCodesStr.split(',').map((c: string) => c.trim().toLowerCase());
          codes.forEach((c: string) => {
            const matched = activeSubjects.find((s: any) => s.code.toLowerCase() === c);
            if (matched) subjectIds.push(matched.id);
          });
        }

        // Resolve class teacher division
        let classTeacherDivisionId = '';
        if (divisionStr) {
          const matched = allDivisions.find((d: any) => d.label === divisionStr);
          if (matched) classTeacherDivisionId = matched.id;
        }

        const features: string[] = [];
        if (featuresStr) {
          featuresStr.split(',').map((f: string) => f.trim().toUpperCase()).forEach((f: string) => {
            if ((FEATURES as readonly string[]).includes(f)) features.push(f);
          });
        }

        const res = await fetch('/api/teachers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name, teacherCode, penNo, designation, username, password,
            phone: '', email: '', subjectIds, classTeacherDivisionId, features
          }),
        });

        const status = await res.json();
        if (status.success) {
          successCount++;
        } else {
          failCount++;
        }
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
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-secondary" onClick={handleDownloadTemplate}>
            Download Template
          </button>
          <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? 'Uploading...' : 'Upload Excel'}
          </button>
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            accept=".xlsx"
            onChange={handleUploadExcel}
          />
          <button className="btn btn-primary" onClick={() => { setShowModal(true); setGenPassword(''); }}>
            Add Teacher
          </button>
        </div>
      </div>
      <div className="page-body">
        {message && (
          <div className={`toast ${message.includes('Error') || message.includes('Failed') ? 'toast-error' : 'toast-info'}`} style={{ position: 'relative', bottom: 'auto', right: 'auto', marginBottom: 16, maxWidth: '100%' }}>
            {message}
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
                    <td><span className="badge badge-blue">{t.designation}</span></td>
                    <td>{t.penNo || '—'}</td>
                    <td>{t.subjectMappings?.map((sm: any) => sm.subject?.name).join(', ') || '—'}</td>
                    <td>{t.classTeacherOf ? <span className="badge badge-green">Class {t.classTeacherOf.class?.name} {t.classTeacherOf.name}</span> : '—'}</td>
                    <td><span className={`badge ${t.user?.isActive ? 'badge-green' : 'badge-red'}`}>{t.user?.isActive ? 'Active' : 'Inactive'}</span></td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => { setPwdTarget({ id: t.user.id, name: t.user.name }); setShowPwdModal(true); setPwdForm({ newPassword: '', confirmAdminPassword: '' }); setMessage(''); }}>Reset Password</button>
                        <button className="btn btn-red btn-sm" onClick={() => deleteTeacher(t.id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: 40 }}>
                      No teachers found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

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


      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{genPassword ? 'Teacher Created' : 'Add Teacher'}</h3>
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
              <form onSubmit={createTeacher}>
                <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Name *</label><input className="form-input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
                    <div className="form-group"><label className="form-label">Teacher Code *</label><input className="form-input" required value={form.teacherCode} onChange={e => setForm({ ...form, teacherCode: e.target.value })} placeholder="e.g., T001" /></div>
                  </div>
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Username *</label><input className="form-input" required value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} /></div>
                    <div className="form-group"><label className="form-label">Password</label><input className="form-input" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="Leave blank to auto-generate" /></div>
                  </div>
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
                    <label className="form-label">Subjects (select all that apply)</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {subjects.map((s: any) => (
                        <label key={s.id} className="form-checkbox" style={{ minWidth: 140 }}>
                          <input type="checkbox" checked={form.subjectIds.includes(s.id)}
                            onChange={e => setForm({ ...form, subjectIds: e.target.checked ? [...form.subjectIds, s.id] : form.subjectIds.filter(id => id !== s.id) })} />
                          {s.name}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Class Teacher Of</label>
                    <select className="form-select" value={form.classTeacherDivisionId} onChange={e => setForm({ ...form, classTeacherDivisionId: e.target.value })}>
                      <option value="">Not a class teacher</option>
                      {allDivisions.map((d: any) => (<option key={d.id} value={d.id}>Class {d.className} - {d.name}</option>))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Feature Access</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {FEATURES.map(f => (
                        <label key={f} className="form-checkbox">
                          <input type="checkbox" checked={form.features.includes(f)}
                            onChange={e => setForm({ ...form, features: e.target.checked ? [...form.features, f] : form.features.filter(x => x !== f) })} />
                          {f}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Creating...' : 'Create Teacher'}</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
