'use client';

import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';

export default function SuperAdminUsers() {
  const [tenants, setTenants] = useState<any[]>([]);
  const [selectedTenant, setSelectedTenant] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const [showPwdModal, setShowPwdModal] = useState(false);
  const [pwdTarget, setPwdTarget] = useState<any>(null);
  const [pwdForm, setPwdForm] = useState({ newPassword: '', confirmAdminPassword: '' });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => { fetchTenants(); }, []);

  async function fetchTenants() {
    const res = await fetch('/api/tenants');
    const data = await res.json();
    if (data.success) setTenants(data.data);
  }

  async function fetchUsers(tenantId: string) {
    setSelectedTenant(tenantId);
    const res = await fetch(`/api/tenants/${tenantId}/users`);
    const data = await res.json();
    if (data.success) setUsers(data.data);
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
    setMessage(data.success ? 'Password updated!' : data.error || 'Failed');
    if (data.success) setShowPwdModal(false);
    setLoading(false);
  }

  async function deleteUser(userId: string) {
    if (!confirm('Are you sure you want to delete this user? This will delete all associated profile data!')) return;
    const res = await fetch(`/api/tenants/${selectedTenant}/users?userId=${userId}`, { method: 'DELETE' });
    const data = await res.json();
    setMessage(data.success ? 'User deleted successfully.' : data.error || 'Failed to delete user.');
    if (data.success) fetchUsers(selectedTenant);
  }

  return (
    <DashboardLayout>
      <div className="page-header">
        <div><h2>User Management</h2><p>View and manage all users across tenants</p></div>
      </div>
      <div className="page-body">
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body">
            <label className="form-label">Select Tenant</label>
            <select className="form-select" style={{ width: 300 }} value={selectedTenant} onChange={e => fetchUsers(e.target.value)}>
              <option value="">Choose a tenant...</option>
              {tenants.map(t => <option key={t.id} value={t.id}>{t.name} ({t.code})</option>)}
            </select>
          </div>
        </div>

        {users.length > 0 && (
          <div className="card">
            <div className="card-header"><h3>Users ({users.length})</h3></div>
            <div className="table-container">
              <table className="data-table">
                <thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {users.map((u: any) => (
                    <tr key={u.id}>
                      <td><strong>{u.username}</strong></td>
                      <td>{u.name}</td>
                      <td><span className="badge badge-blue">{u.role}</span></td>
                      <td><span className={`badge ${u.isActive ? 'badge-green' : 'badge-red'}`}>{u.isActive ? 'Active' : 'Inactive'}</span></td>
                      <td style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => { setPwdTarget(u); setShowPwdModal(true); setPwdForm({ newPassword: '', confirmAdminPassword: '' }); setMessage(''); }}>Reset Password</button>
                        <button className="btn btn-red btn-sm" onClick={() => deleteUser(u.id)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {message && <div className={`toast ${message.includes('successfully') || message.includes('updated') ? 'toast-success' : 'toast-error'}`}>{message}</div>}
      </div>


      {showPwdModal && (
        <div className="modal-overlay" onClick={() => setShowPwdModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>Reset Password for {pwdTarget?.name}</h3><button className="btn btn-ghost btn-icon" onClick={() => setShowPwdModal(false)}>✕</button></div>
            <form onSubmit={resetPassword}>
              <div className="modal-body">
                <div className="form-group"><label className="form-label">New Password</label><input className="form-input" type="password" required value={pwdForm.newPassword} onChange={e => setPwdForm({ ...pwdForm, newPassword: e.target.value })} /></div>
                <div className="form-group"><label className="form-label">Your Password (confirmation)</label><input className="form-input" type="password" required value={pwdForm.confirmAdminPassword} onChange={e => setPwdForm({ ...pwdForm, confirmAdminPassword: e.target.value })} /></div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowPwdModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Updating...' : 'Reset'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
