'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/DashboardLayout';

export default function SuperAdminDashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [tenants, setTenants] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', code: '', schoolName: '', section: 'UP', adminName: '', adminUsername: '', adminPassword: '' });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (status === 'authenticated' && session?.user?.role !== 'SUPER_ADMIN') {
      router.push('/');
    }
    if (status === 'authenticated') fetchTenants();
  }, [status]);

  async function fetchTenants() {
    const res = await fetch('/api/tenants');
    const data = await res.json();
    if (data.success) setTenants(data.data);
  }

  async function createTenant(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch('/api/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (data.success) {
      setShowModal(false);
      setForm({ name: '', code: '', schoolName: '', section: 'UP', adminName: '', adminUsername: '', adminPassword: '' });
      fetchTenants();
    }
    setLoading(false);
  }

  if (status === 'loading') return <div className="loading-page"><div className="spinner" /><p>Loading...</p></div>;

  return (
    <DashboardLayout>
      <div className="page-header">
        <div>
          <h2>Super Admin Dashboard</h2>
          <p>Manage all schools and tenants</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Add Tenant</button>
        </div>
      </div>

      <div className="page-body">
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-icon green">
              <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 24, height: 24 }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0 0 12 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75Z" />
              </svg>
            </div>
            <div>
              <div className="stat-value">{tenants.length}</div>
              <div className="stat-label">Total Tenants</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon blue">
              <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 24, height: 24 }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
              </svg>
            </div>
            <div>
              <div className="stat-value">{tenants.reduce((s, t) => s + (t._count?.users || 0), 0)}</div>
              <div className="stat-label">Total Users</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon gold">
              <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 24, height: 24 }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 16.5h1.5M13.5 16.5H15" />
              </svg>
            </div>
            <div>
              <div className="stat-value">{tenants.reduce((s, t) => s + (t._count?.classes || 0), 0)}</div>
              <div className="stat-label">Total Classes</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon green">
              <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 24, height: 24 }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            </div>
            <div>
              <div className="stat-value">{tenants.filter(t => t.isActive).length}</div>
              <div className="stat-label">Active Tenants</div>
            </div>
          </div>
        </div>


        <div className="card">
          <div className="card-header">
            <h3>All Tenants</h3>
          </div>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Section</th>
                  <th>Academic Year</th>
                  <th>Users</th>
                  <th>Classes</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map(t => (
                  <tr key={t.id}>
                    <td><strong>{t.code}</strong></td>
                    <td>{t.name}</td>
                    <td><span className="badge badge-blue">{t.section}</span></td>
                    <td>{t.academicYear}</td>
                    <td>{t._count?.users || 0}</td>
                    <td>{t._count?.classes || 0}</td>
                    <td><span className={`badge ${t.isActive ? 'badge-green' : 'badge-red'}`}>{t.isActive ? 'Active' : 'Inactive'}</span></td>
                  </tr>
                ))}
                {tenants.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40 }}>No tenants yet. Click &quot;Add Tenant&quot; to get started.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Add New Tenant</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <form onSubmit={createTenant}>
              <div className="modal-body">
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">School Name</label>
                    <input className="form-input" required value={form.schoolName} onChange={e => setForm({ ...form, schoolName: e.target.value })} placeholder="TSHSS Punalur" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Section</label>
                    <select className="form-select" value={form.section} onChange={e => setForm({ ...form, section: e.target.value })}>
                      <option value="UP">Upper Primary (UP)</option>
                      <option value="HS">High School (HS)</option>
                    </select>
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Tenant Name</label>
                    <input className="form-input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="TSHSS Punalur - UP Section" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Tenant Code</label>
                    <input className="form-input" required value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="up_tshss" />
                    <span className="form-hint">Unique identifier (e.g., up_tshss, hs_tshss)</span>
                  </div>
                </div>
                <div style={{ borderTop: '1px solid var(--border-color)', margin: '20px 0', paddingTop: 20 }}>
                  <h4 style={{ fontSize: 14, marginBottom: 12 }}>School Admin Account</h4>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Admin Name</label>
                      <input className="form-input" value={form.adminName} onChange={e => setForm({ ...form, adminName: e.target.value })} placeholder="Headmistress Name" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Username</label>
                      <input className="form-input" value={form.adminUsername} onChange={e => setForm({ ...form, adminUsername: e.target.value })} placeholder="admin_up_tshss" />
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Password</label>
                    <input className="form-input" type="password" value={form.adminPassword} onChange={e => setForm({ ...form, adminPassword: e.target.value })} placeholder="Initial password" />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Creating...' : 'Create Tenant'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
