'use client';

import { useSession } from 'next-auth/react';
import { useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';

export default function SettingsPage() {
  const { data: session } = useSession();
  const [showPwdModal, setShowPwdModal] = useState(false);
  const [pwdForm, setPwdForm] = useState({ targetUserId: '', newPassword: '', confirmAdminPassword: '' });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    const res = await fetch('/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pwdForm),
    });
    const data = await res.json();
    if (data.success) { setMessage('Password updated successfully'); setShowPwdModal(false); }
    else setMessage(data.error || 'Failed to update');
    setLoading(false);
  }

  return (
    <DashboardLayout>
      <div className="page-header"><div><h2>Settings</h2><p>Account and system settings</p></div></div>
      <div className="page-body">
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header"><h3>Account Info</h3></div>
          <div className="card-body">
            <div className="form-row">
              <div><label className="form-label">Name</label><p>{session?.user?.name}</p></div>
              <div><label className="form-label">Username</label><p>{session?.user?.username}</p></div>
              <div><label className="form-label">Role</label><p><span className="badge badge-green">{session?.user?.role}</span></p></div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3>Password Management</h3></div>
          <div className="card-body">
            <button className="btn btn-secondary" onClick={() => { setShowPwdModal(true); setPwdForm({ targetUserId: '', newPassword: '', confirmAdminPassword: '' }); }}>
              Change Own Password
            </button>
            <button className="btn btn-secondary" style={{ marginLeft: 8 }} onClick={() => { setShowPwdModal(true); setPwdForm({ targetUserId: 'other', newPassword: '', confirmAdminPassword: '' }); }}>
              Reset User Password
            </button>
            {message && <p style={{ marginTop: 12, color: message.includes('success') ? 'var(--success)' : 'var(--danger)' }}>{message}</p>}
          </div>
        </div>
      </div>

      {showPwdModal && (
        <div className="modal-overlay" onClick={() => setShowPwdModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>Change Password</h3><button className="btn btn-ghost btn-icon" onClick={() => setShowPwdModal(false)}>✕</button></div>
            <form onSubmit={changePassword}>
              <div className="modal-body">
                <div className="form-group"><label className="form-label">New Password</label><input className="form-input" type="password" required value={pwdForm.newPassword} onChange={e => setPwdForm({ ...pwdForm, newPassword: e.target.value })} /></div>
                {pwdForm.targetUserId && (
                  <div className="form-group"><label className="form-label">Your Password (confirmation)</label><input className="form-input" type="password" required value={pwdForm.confirmAdminPassword} onChange={e => setPwdForm({ ...pwdForm, confirmAdminPassword: e.target.value })} /></div>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowPwdModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Updating...' : 'Update Password'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
