'use client';

import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';

export default function TenantsPage() {
  const [tenants, setTenants] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ name: '', code: '', schoolName: '', section: 'UP', adminName: '', adminUsername: '', adminPassword: '' });

  useEffect(() => { fetchTenants(); }, []);

  async function fetchTenants() {
    const res = await fetch('/api/tenants');
    const data = await res.json();
    if (data.success) setTenants(data.data);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch('/api/tenants', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    if ((await res.json()).success) { setShowModal(false); fetchTenants(); }
    setLoading(false);
  }

  async function deleteTenant(id: string) {
    if (!confirm('Are you sure you want to delete this tenant? This will permanently delete all associated data!')) return;
    const res = await fetch(`/api/tenants?id=${id}`, { method: 'DELETE' });
    if ((await res.json()).success) {
      fetchTenants();
    }
  }

  return (
    <DashboardLayout>
      <div className="page-header">
        <div><h2>Tenant Management</h2><p>Manage school tenants</p></div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Add Tenant</button>
      </div>
      <div className="page-body">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
          {tenants.map(t => (
            <div key={t.id} className="card">
              <div className="card-header"><h3>{t.name}</h3><span className="badge badge-blue">{t.section}</span></div>
              <div className="card-body">
                <p><strong>Code:</strong> {t.code}</p>
                <p><strong>School:</strong> {t.schoolName}</p>
                <p><strong>Academic Year:</strong> {t.academicYear}</p>
                <p><strong>Users:</strong> {t._count?.users || 0} | <strong>Classes:</strong> {t._count?.classes || 0}</p>
                <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className={`badge ${t.isActive ? 'badge-green' : 'badge-red'}`}>{t.isActive ? 'Active' : 'Inactive'}</span>
                  <button className="btn btn-red btn-sm" onClick={() => deleteTenant(t.id)}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>Add Tenant</h3><button className="btn btn-ghost btn-icon" onClick={() => setShowModal(false)}>✕</button></div>
            <form onSubmit={create}>
              <div className="modal-body">
                <div className="form-row">
                  <div className="form-group"><label className="form-label">School Name</label><input className="form-input" required value={form.schoolName} onChange={e => setForm({ ...form, schoolName: e.target.value })} /></div>
                  <div className="form-group"><label className="form-label">Section</label><select className="form-select" value={form.section} onChange={e => setForm({ ...form, section: e.target.value })}><option value="UP">UP</option><option value="HS">HS</option></select></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Tenant Name</label><input className="form-input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
                  <div className="form-group"><label className="form-label">Code</label><input className="form-input" required value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="e.g., up_tshss" /></div>
                </div>
                <hr style={{ margin: '16px 0', border: 'none', borderTop: '1px solid var(--border-color)' }} />
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Admin Name</label><input className="form-input" value={form.adminName} onChange={e => setForm({ ...form, adminName: e.target.value })} /></div>
                  <div className="form-group"><label className="form-label">Username</label><input className="form-input" value={form.adminUsername} onChange={e => setForm({ ...form, adminUsername: e.target.value })} /></div>
                </div>
                <div className="form-group"><label className="form-label">Password</label><input className="form-input" type="password" value={form.adminPassword} onChange={e => setForm({ ...form, adminPassword: e.target.value })} /></div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Creating...' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
