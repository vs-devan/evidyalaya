'use client';

import { useEffect, useState, useRef } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { downloadExcel, parseExcel } from '@/lib/excel';

const EMPTY_FORM = { rollNumber: '', name: '', parentName: '', parentPhone: '' };

export default function StudentsPage() {
  const [classes, setClasses] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [selectedDiv, setSelectedDiv] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingStudent, setEditingStudent] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [genInfo, setGenInfo] = useState<any>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const [showPwdModal, setShowPwdModal] = useState(false);
  const [pwdTarget, setPwdTarget] = useState<any>(null);
  const [pwdForm, setPwdForm] = useState({ newPassword: '', confirmAdminPassword: '' });

  useEffect(() => { fetchClasses(); }, []);
  useEffect(() => { if (selectedDiv) fetchStudents(); }, [selectedDiv]);

  async function fetchClasses() {
    const res = await fetch('/api/classes');
    const data = await res.json();
    if (data.success) setClasses(data.data);
  }

  async function fetchStudents() {
    const res = await fetch(`/api/students?divisionId=${selectedDiv}`);
    const data = await res.json();
    if (data.success) setStudents(data.data);
  }

  function openAddModal() {
    setEditingStudent(null);
    setGenInfo(null);
    setForm({ ...EMPTY_FORM });
    setShowModal(true);
  }

  function openEditModal(s: any) {
    setEditingStudent(s);
    setGenInfo(null);
    setForm({
      rollNumber: String(s.rollNumber),
      name: s.name,
      parentName: s.parentName || '',
      parentPhone: s.parentPhone || '',
    });
    setShowModal(true);
  }

  async function saveStudent(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    if (editingStudent) {
      const res = await fetch('/api/students', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingStudent.id, ...form }),
      });
      const data = await res.json();
      if (data.success) {
        setShowModal(false);
        setMessage(`✓ ${form.name} updated successfully.`);
        fetchStudents();
      } else {
        setMessage(`Error: ${data.error || 'Update failed'}`);
      }
    } else {
      const res = await fetch('/api/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, divisionId: selectedDiv }),
      });
      const data = await res.json();
      if (data.success) {
        setGenInfo({ username: data.data.username, password: data.data.generatedPassword });
        setForm({ ...EMPTY_FORM });
        fetchStudents();
      } else {
        setMessage(`Error: ${data.error || 'Creation failed'}`);
      }
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

  async function deleteStudent(id: string) {
    if (!confirm('Are you sure you want to delete this student? This will permanently delete their parent user account and academic results!')) return;
    const res = await fetch(`/api/students?id=${id}`, { method: 'DELETE' });
    const data = await res.json();
    setMessage(data.success ? 'Student deleted successfully.' : data.error || 'Failed');
    if (data.success) fetchStudents();
  }

  function handleDownloadTemplate() {
    const sampleData = [
      { 'Roll Number': 1, 'Name': 'Rahul S', 'Parent Name': 'Suresh Kumar', 'Parent Phone': '9876543210' },
      { 'Roll Number': 2, 'Name': 'Sneha M', 'Parent Name': 'Mohan Das', 'Parent Phone': '9876543211' }
    ];
    downloadExcel(sampleData, 'students_template', 'Students');
  }

  async function handleUploadExcel(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !selectedDiv) return;
    setUploading(true);
    setMessage('');
    try {
      const parsedData = await parseExcel(file);
      if (parsedData.length === 0) { setMessage('No data found in Excel file.'); setUploading(false); return; }
      let successCount = 0, failCount = 0;
      for (const row of parsedData) {
        const res = await fetch('/api/students', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rollNumber: parseInt(row['Roll Number'] || '1'),
            name: row['Name'],
            parentName: row['Parent Name'] || '',
            parentPhone: String(row['Parent Phone'] || ''),
            divisionId: selectedDiv
          }),
        });
        (await res.json()).success ? successCount++ : failCount++;
      }
      setMessage(`Uploaded successfully! Created: ${successCount}, Failed: ${failCount}`);
      fetchStudents();
    } catch (err: any) {
      setMessage(`Error parsing file: ${err.message || err}`);
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const allDivisions = classes.flatMap((c: any) => c.divisions?.map((d: any) => ({ ...d, className: c.name })) || []);

  return (
    <DashboardLayout>
      <div className="page-header">
        <div>
          <h2>Student Management</h2>
          <p>Manage students and parent accounts</p>
        </div>
        <div className="page-header-actions">
          <select className="form-select" style={{ minWidth: 160 }} value={selectedDiv} onChange={e => setSelectedDiv(e.target.value)}>
            <option value="">Select Division...</option>
            {allDivisions.map((d: any) => <option key={d.id} value={d.id}>Class {d.className}{d.name}</option>)}
          </select>
          {selectedDiv && (
            <>
              <button className="btn btn-secondary" onClick={handleDownloadTemplate}>⬇ Template</button>
              <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                {uploading ? 'Uploading...' : '⬆ Excel'}
              </button>
              <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept=".xlsx" onChange={handleUploadExcel} />
              <button className="btn btn-primary" onClick={openAddModal}>+ Add Student</button>
            </>
          )}
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

        {!selectedDiv ? (
          <div className="card">
            <div className="empty-state">
              <h3>Select a Division</h3>
              <p>Choose a class and division to view students</p>
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="card-header">
              <h3>Students ({students.length})</h3>
            </div>
            {/* Desktop Table View */}
            <div className="table-container desktop-only">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Roll</th>
                    <th>Name</th>
                    <th>Parent</th>
                    <th>Phone</th>
                    <th>Username</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s: any) => (
                    <tr key={s.id}>
                      <td><strong>{s.rollNumber}</strong></td>
                      <td>{s.name}</td>
                      <td>{s.parentName || '—'}</td>
                      <td>{s.parentPhone || '—'}</td>
                      <td><span className="badge badge-gray">{s.user?.username}</span></td>
                      <td><span className={`badge ${s.user?.isActive ? 'badge-green' : 'badge-red'}`}>{s.user?.isActive ? 'Active' : 'Inactive'}</span></td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button className="btn btn-secondary btn-sm" onClick={() => openEditModal(s)}>Edit</button>
                          {s.user?.id && (
                            <button className="btn btn-ghost btn-sm" onClick={() => { setPwdTarget({ id: s.user.id, name: s.name }); setShowPwdModal(true); setPwdForm({ newPassword: '', confirmAdminPassword: '' }); setMessage(''); }}>Reset Pwd</button>
                          )}
                          <button className="btn btn-red btn-sm" onClick={() => deleteStudent(s.id)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {students.length === 0 && (
                    <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40 }}>No students in this division</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile Card View */}
            <div className="mobile-only" style={{ padding: '0 16px' }}>
              <div className="student-cards-grid">
                {students.map((s: any) => (
                  <div key={s.id} className="student-card">
                    <div className="student-card-header">
                      <strong>Roll #{s.rollNumber}</strong>
                      <span className={`badge ${s.user?.isActive ? 'badge-green' : 'badge-red'}`}>
                        {s.user?.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div className="student-card-row">
                      <span style={{ color: 'var(--gray-500)' }}>Name:</span>
                      <strong>{s.name}</strong>
                    </div>
                    <div className="student-card-row">
                      <span style={{ color: 'var(--gray-500)' }}>Parent:</span>
                      <span>{s.parentName || '—'}</span>
                    </div>
                    <div className="student-card-row">
                      <span style={{ color: 'var(--gray-500)' }}>Phone:</span>
                      <span>{s.parentPhone || '—'}</span>
                    </div>
                    <div className="student-card-row">
                      <span style={{ color: 'var(--gray-500)' }}>Username:</span>
                      <span className="badge badge-gray">{s.user?.username || '—'}</span>
                    </div>
                    <div className="student-card-actions">
                      <button className="btn btn-secondary btn-sm" onClick={() => openEditModal(s)}>Edit</button>
                      {s.user?.id && (
                        <button className="btn btn-ghost btn-sm" onClick={() => { setPwdTarget({ id: s.user.id, name: s.name }); setShowPwdModal(true); setPwdForm({ newPassword: '', confirmAdminPassword: '' }); setMessage(''); }}>Reset Pwd</button>
                      )}
                      <button className="btn btn-red btn-sm" onClick={() => deleteStudent(s.id)}>Delete</button>
                    </div>
                  </div>
                ))}
                {students.length === 0 && (
                  <div style={{ textAlign: 'center', padding: 24, color: 'var(--gray-400)' }}>No students in this division</div>
                )}
              </div>
            </div>
          </div>
        )}
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

      {/* Add / Edit Student Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{genInfo ? 'Student Created' : editingStudent ? `Edit — ${editingStudent.name}` : 'Add Student'}</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowModal(false)}>✕</button>
            </div>
            {genInfo ? (
              <div className="modal-body" style={{ textAlign: 'center', padding: 24 }}>
                <div style={{ color: 'var(--success)', fontWeight: 700, marginBottom: 12 }}>Student Account Created Successfully</div>
                <div style={{ background: 'var(--gray-100)', borderRadius: 8, padding: 16, marginTop: 16, textAlign: 'left' }}>
                  <p><strong>Username:</strong> <code>{genInfo.username}</code></p>
                  <p><strong>Password:</strong> <code>{genInfo.password}</code></p>
                </div>
                <p style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 8 }}>Share these credentials with the parent</p>
                <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => { setShowModal(false); setGenInfo(null); }}>Done</button>
              </div>
            ) : (
              <form onSubmit={saveStudent}>
                <div className="modal-body">
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Roll Number *</label><input className="form-input" type="number" required value={form.rollNumber} onChange={e => setForm({ ...form, rollNumber: e.target.value })} /></div>
                    <div className="form-group"><label className="form-label">Student Name *</label><input className="form-input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
                  </div>
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Parent Name</label><input className="form-input" value={form.parentName} onChange={e => setForm({ ...form, parentName: e.target.value })} /></div>
                    <div className="form-group"><label className="form-label">Phone Number</label><input className="form-input" value={form.parentPhone} onChange={e => setForm({ ...form, parentPhone: e.target.value })} /></div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={loading}>
                    {loading ? (editingStudent ? 'Saving...' : 'Creating...') : (editingStudent ? 'Save Changes' : 'Create Student')}
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
