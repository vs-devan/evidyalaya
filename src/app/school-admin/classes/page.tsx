'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';

export default function ClassesPage() {
  const { data: session } = useSession();
  const [classes, setClasses] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', order: 0, divisions: 'A,B' });
  const [loading, setLoading] = useState(false);

  useEffect(() => { fetchClasses(); }, []);

  async function fetchClasses() {
    const res = await fetch('/api/classes');
    const data = await res.json();
    if (data.success) setClasses(data.data);
  }

  async function createClass(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const divs = form.divisions.split(',').map(d => d.trim()).filter(Boolean);
    const res = await fetch('/api/classes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: form.name, order: form.order, divisions: divs }),
    });
    if ((await res.json()).success) {
      setShowModal(false);
      setForm({ name: '', order: 0, divisions: 'A,B' });
      fetchClasses();
    }
    setLoading(false);
  }

  async function deleteClass(id: string) {
    if (!confirm('Are you sure you want to delete this class? This will delete all divisions, students, results, and timetable entries under this class!')) return;
    const res = await fetch(`/api/classes?id=${id}`, { method: 'DELETE' });
    if ((await res.json()).success) {
      fetchClasses();
    }
  }

  return (
    <DashboardLayout>
      <div className="page-header">
        <div><h2>Classes & Divisions</h2><p>Manage class structure for your school</p></div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Add Class</button>
      </div>
      <div className="page-body">
        {classes.length === 0 ? (
          <div className="card"><div className="empty-state">
            <div className="empty-state-icon">
              <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 48, height: 48, color: 'var(--gray-300)' }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 16.5h1.5M13.5 16.5H15" />
              </svg>
            </div>
            <h3>No Classes Yet</h3>
            <p>Start by adding classes and their divisions (e.g., Class 8 with divisions A, B, C)</p>
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setShowModal(true)}>+ Add Class</button>
          </div></div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {classes.map(cls => (
              <div key={cls.id} className="card">
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3>Class {cls.name}</h3>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span className="badge badge-blue">{cls.divisions?.length || 0} Divisions</span>
                    <button className="btn btn-red btn-sm" style={{ padding: '2px 6px', fontSize: 11 }} onClick={() => deleteClass(cls.id)}>Delete</button>
                  </div>
                </div>
                <div className="card-body">
                  {cls.divisions?.map((div: any) => (
                    <div key={div.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border-color)' }}>
                      <div>
                        <strong>Division {div.name}</strong>
                        <span style={{ fontSize: 12, color: 'var(--gray-500)', marginLeft: 8 }}>{div._count?.students || 0} students</span>
                      </div>
                      {div.classTeacher && (
                        <span className="badge badge-green">{div.classTeacher.user?.name}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>


      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Add New Class</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <form onSubmit={createClass}>
              <div className="modal-body">
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Class Name</label>
                    <input className="form-input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g., 8, 9, 10" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Sort Order</label>
                    <input className="form-input" type="number" value={form.order} onChange={e => setForm({ ...form, order: parseInt(e.target.value) })} />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Divisions (comma-separated)</label>
                  <input className="form-input" value={form.divisions} onChange={e => setForm({ ...form, divisions: e.target.value })} placeholder="A, B, C" />
                  <span className="form-hint">Enter division names separated by commas</span>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Creating...' : 'Create Class'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
