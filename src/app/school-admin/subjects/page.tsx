'use client';

import { useEffect, useState, useRef } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { downloadExcel, parseExcel } from '@/lib/excel';

export default function SubjectsPage() {
  const [subjects, setSubjects] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    name: '', code: '', periodsPerWeek: 1, isCore: true,
    eveningPriority: false, consecutiveSlots: 1, isLanguageVariant: false, replacesSubjectId: '',
  });

  useEffect(() => { fetchSubjects(); }, []);

  async function fetchSubjects() {
    const res = await fetch('/api/subjects');
    const data = await res.json();
    if (data.success) setSubjects(data.data);
  }

  async function createSubject(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch('/api/subjects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, replacesSubjectId: form.replacesSubjectId || null }),
    });
    if ((await res.json()).success) {
      setShowModal(false);
      setForm({ name: '', code: '', periodsPerWeek: 1, isCore: true, eveningPriority: false, consecutiveSlots: 1, isLanguageVariant: false, replacesSubjectId: '' });
      fetchSubjects();
    }
    setLoading(false);
  }

  function handleDownloadTemplate() {
    const sampleData = [
      {
        'Name': 'Malayalam I',
        'Code': 'MAL1',
        'Periods Per Week': 5,
        'Is Core (True/False)': 'True',
        'Evening Priority (True/False)': 'False',
        'Consecutive Slots': 1,
        'Language Variant (True/False)': 'False',
        'Replaces Subject Code': ''
      },
      {
        'Name': 'Sanskrit',
        'Code': 'SANS',
        'Periods Per Week': 5,
        'Is Core (True/False)': 'True',
        'Evening Priority (True/False)': 'False',
        'Consecutive Slots': 1,
        'Language Variant (True/False)': 'True',
        'Replaces Subject Code': 'MAL1'
      }
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
      if (parsedData.length === 0) {
        setMessage('No data found in Excel file.');
        setUploading(false);
        return;
      }

      // First fetch subjects to resolve references
      const currentSubjectsRes = await fetch('/api/subjects');
      const currentSubjectsData = await currentSubjectsRes.json();
      const currentSubjects: any[] = currentSubjectsData.success ? currentSubjectsData.data : [];

      let successCount = 0;
      let failCount = 0;

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
          // Look up replacesCode in existing subjects or currently loaded ones
          const matched = currentSubjects.find(s => s.code === replacesCode);
          if (matched) {
            replacesSubjectId = matched.id;
          }
        }

        const res = await fetch('/api/subjects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name, code, periodsPerWeek, isCore, eveningPriority, consecutiveSlots, isLanguageVariant, replacesSubjectId
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
      fetchSubjects();
    } catch (err: any) {
      setMessage(`Error parsing file: ${err.message || err}`);
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function deleteSubject(id: string) {
    if (!confirm('Are you sure you want to delete this subject? This will remove it from all timetables, teacher mappings, and results!')) return;
    const res = await fetch(`/api/subjects?id=${id}`, { method: 'DELETE' });
    if ((await res.json()).success) {
      fetchSubjects();
    }
  }

  const baseSubjects = subjects.filter(s => !s.isLanguageVariant);
  const variants = subjects.filter(s => s.isLanguageVariant);

  return (
    <DashboardLayout>
      <div className="page-header">
        <div>
          <h2>Subject Management</h2>
          <p>Configure subjects with periods, priorities, and language variants</p>
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
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            Add Subject
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
            <h3>Subjects ({subjects.length})</h3>
          </div>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Code</th>
                  <th>Periods/Week</th>
                  <th>Type</th>
                  <th>Evening Priority</th>
                  <th>Consecutive</th>
                  <th>Teachers</th>
                  <th>Replaces</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {subjects.map(s => (
                  <tr key={s.id}>
                    <td><strong>{s.name}</strong></td>
                    <td><span className="badge badge-gray">{s.code}</span></td>
                    <td>{s.periodsPerWeek}</td>
                    <td><span className={`badge ${s.isCore ? 'badge-green' : 'badge-gold'}`}>{s.isCore ? 'Core' : 'Non-Core'}</span></td>
                    <td>{s.eveningPriority ? <span className="badge badge-gold">Yes</span> : '—'}</td>
                    <td>{s.consecutiveSlots > 1 ? <span className="badge badge-blue">{s.consecutiveSlots} slots</span> : '1'}</td>
                    <td>{s._count?.teacherMappings || 0}</td>
                    <td>{s.replacesSubject ? <span className="badge badge-red">{s.replacesSubject.name}</span> : '—'}</td>
                    <td>
                      <button className="btn btn-red btn-sm" onClick={() => deleteSubject(s.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
                {subjects.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: 40 }}>
                      No subjects added yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>


        {variants.length > 0 && (
          <div className="card" style={{ marginTop: 24 }}>
            <div className="card-header">
              <h3>Language Variants</h3>
            </div>
            <div className="card-body">
              {variants.map(v => (
                <div key={v.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border-color)' }}>
                  <strong>{v.name}</strong> replaces <span className="badge badge-blue">{v.replacesSubject?.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Add Subject</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <form onSubmit={createSubject}>
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
                    <label className="form-label">Periods per Week</label>
                    <input className="form-input" type="number" min={1} max={10} value={form.periodsPerWeek} onChange={e => setForm({ ...form, periodsPerWeek: parseInt(e.target.value) })} />
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
                {form.isLanguageVariant && (
                  <div className="form-group">
                    <label className="form-label">Replaces Subject</label>
                    <select className="form-select" value={form.replacesSubjectId} onChange={e => setForm({ ...form, replacesSubjectId: e.target.value })}>
                      <option value="">Select subject...</option>
                      {baseSubjects.map(s => (<option key={s.id} value={s.id}>{s.name}</option>))}
                    </select>
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Creating...' : 'Create Subject'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
