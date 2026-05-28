'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState, useRef } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { downloadExcel, parseExcel } from '@/lib/excel';

export default function TeacherStudents() {
  const { data: session } = useSession();
  const [students, setStudents] = useState<any[]>([]);
  const [divisionId, setDivisionId] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [genInfo, setGenInfo] = useState<any>(null);
  const [form, setForm] = useState({ rollNumber: '', name: '', parentName: '', parentPhone: '' });

  const [showPwdModal, setShowPwdModal] = useState(false);
  const [pwdTarget, setPwdTarget] = useState<any>(null);
  const [pwdForm, setPwdForm] = useState({ newPassword: '', confirmAdminPassword: '' });

  useEffect(() => {
    if (session?.user?.teacherId) {
      fetch('/api/teachers').then(r => r.json()).then(d => {
        if (d.success) {
          const teacher = d.data.find((t: any) => t.id === session?.user?.teacherId);
          if (teacher?.classTeacherOf) setDivisionId(teacher.classTeacherOf.id);
        }
      });
    }
  }, [session]);

  useEffect(() => { if (divisionId) fetchStudents(); }, [divisionId]);

  async function fetchStudents() {
    const res = await fetch(`/api/students?divisionId=${divisionId}`);
    const data = await res.json();
    if (data.success) setStudents(data.data);
  }

  async function createStudent(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch('/api/students', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, divisionId }),
    });
    const data = await res.json();
    if (data.success) {
      setGenInfo({ username: data.data.username, password: data.data.generatedPassword });
      setForm({ rollNumber: '', name: '', parentName: '', parentPhone: '' });
      fetchStudents();
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
      {
        'Roll Number': 1,
        'Name': 'Rahul S',
        'Parent Name': 'Suresh Kumar',
        'Parent Phone': '9876543210'
      },
      {
        'Roll Number': 2,
        'Name': 'Sneha M',
        'Parent Name': 'Mohan Das',
        'Parent Phone': '9876543211'
      }
    ];
    downloadExcel(sampleData, 'students_template', 'Students');
  }

  async function handleUploadExcel(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !divisionId) return;

    setUploading(true);
    setMessage('');
    try {
      const parsedData = await parseExcel(file);
      if (parsedData.length === 0) {
        setMessage('No data found in Excel file.');
        setUploading(false);
        return;
      }

      let successCount = 0;
      let failCount = 0;

      for (const row of parsedData) {
        const rollNumber = parseInt(row['Roll Number'] || '1');
        const name = row['Name'];
        const parentName = row['Parent Name'] || '';
        const parentPhone = String(row['Parent Phone'] || '');

        const res = await fetch('/api/students', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rollNumber, name, parentName, parentPhone, divisionId
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
      fetchStudents();
    } catch (err: any) {
      setMessage(`Error parsing file: ${err.message || err}`);
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <DashboardLayout>
      <div className="page-header">
        <div>
          <h2>My Students</h2>
          <p>Manage students in your class</p>
        </div>
        {divisionId && (
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
            <button className="btn btn-primary" onClick={() => { setShowModal(true); setGenInfo(null); }}>
              Add Student
            </button>
          </div>
        )}
      </div>
      <div className="page-body">
        {message && (
          <div className={`toast ${message.includes('Error') || message.includes('Failed') ? 'toast-error' : 'toast-info'}`} style={{ position: 'relative', bottom: 'auto', right: 'auto', marginBottom: 16, maxWidth: '100%' }}>
            {message}
          </div>
        )}

        {!divisionId ? (
          <div className="card">
            <div className="empty-state">
              <h3>Not a Class Teacher</h3>
              <p>Only class teachers can manage students</p>
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="card-header">
              <h3>Students ({students.length})</h3>
            </div>
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Roll</th>
                    <th>Name</th>
                    <th>Parent</th>
                    <th>Phone</th>
                    <th>Username</th>
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
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {s.user?.id && (
                            <button className="btn btn-ghost btn-sm" onClick={() => { setPwdTarget({ id: s.user.id, name: s.name }); setShowPwdModal(true); setPwdForm({ newPassword: '', confirmAdminPassword: '' }); setMessage(''); }}>Reset Password</button>
                          )}
                          <button className="btn btn-red btn-sm" onClick={() => deleteStudent(s.id)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {students.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: 40 }}>
                        No students in this division
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
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
                  <label className="form-label">Confirm Your Teacher Password</label>
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
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{genInfo ? 'Student Created' : 'Add Student'}</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowModal(false)}>✕</button>
            </div>
            {genInfo ? (
              <div className="modal-body" style={{ textAlign: 'center' }}>
                <div style={{ color: 'var(--success)', fontWeight: 700, marginBottom: 12 }}>Student Account Created Successfully</div>
                <div style={{ background: 'var(--gray-100)', borderRadius: 8, padding: 16, marginTop: 16 }}>
                  <p><strong>Username:</strong> <code>{genInfo.username}</code></p>
                  <p><strong>Password:</strong> <code>{genInfo.password}</code></p>
                </div>
                <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setShowModal(false)}>Done</button>
              </div>
            ) : (
              <form onSubmit={createStudent}>
                <div className="modal-body">
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Roll Number *</label><input className="form-input" type="number" required value={form.rollNumber} onChange={e => setForm({ ...form, rollNumber: e.target.value })} /></div>
                    <div className="form-group"><label className="form-label">Name *</label><input className="form-input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
                  </div>
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Parent Name</label><input className="form-input" value={form.parentName} onChange={e => setForm({ ...form, parentName: e.target.value })} /></div>
                    <div className="form-group"><label className="form-label">Phone</label><input className="form-input" value={form.parentPhone} onChange={e => setForm({ ...form, parentPhone: e.target.value })} /></div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Creating...' : 'Create'}</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

