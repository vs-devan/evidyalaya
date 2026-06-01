'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';

const DAY_LABELS: Record<number, string> = { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday' };

export default function SettingsPage() {
  const { data: session, update } = useSession();

  // ── Profile Edit ──────────────────────────────────────────────────────────
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileForm, setProfileForm] = useState({ name: '', username: '' });
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileMsg, setProfileMsg] = useState('');

  // ── Password ────────────────────────────────────────────────────────────
  const [showPwdModal, setShowPwdModal] = useState(false);
  const [pwdForm, setPwdForm] = useState({ targetUserId: '', newPassword: '', confirmAdminPassword: '' });
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdMsg, setPwdMsg] = useState('');

  // ── Timetable settings ──────────────────────────────────────────────────
  const [settings, setSettings] = useState({ periodsPerDay: 7, workingDays: 5, morningPeriods: 4, academicYear: '' });
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState('');
  const [settingsDirty, setSettingsDirty] = useState(false);

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(d => { if (d.success) setSettings(s => ({ ...s, ...d.data })); });
  }, []);

  function updateSetting(key: string, value: any) {
    setSettings(s => ({ ...s, [key]: value }));
    setSettingsDirty(true);
  }

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    setSettingsLoading(true);
    setSettingsMsg('');
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    const data = await res.json();
    setSettingsMsg(data.success ? '✓ Settings saved successfully' : `Error: ${data.error || 'Failed'}`);
    if (data.success) setSettingsDirty(false);
    setSettingsLoading(false);
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwdLoading(true);
    setPwdMsg('');
    const res = await fetch('/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pwdForm),
    });
    const data = await res.json();
    if (data.success) { setPwdMsg('Password updated successfully'); setShowPwdModal(false); }
    else setPwdMsg(data.error || 'Failed to update');
    setPwdLoading(false);
  }

  function openProfileModal() {
    setProfileForm({
      name: session?.user?.name || '',
      username: session?.user?.username || '',
    });
    setProfileMsg('');
    setShowProfileModal(true);
  }

  async function handleProfileSubmit(e: React.FormEvent) {
    e.preventDefault();
    setProfileLoading(true);
    setProfileMsg('');

    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profileForm),
      });
      const data = await res.json();

      if (data.success) {
        // Update client session
        await update({
          name: profileForm.name,
          username: profileForm.username,
        });
        setProfileMsg('✓ Account details updated successfully');
        setShowProfileModal(false);
      } else {
        setProfileMsg(data.error || 'Failed to update account details');
      }
    } catch {
      setProfileMsg('An error occurred. Please try again.');
    } finally {
      setProfileLoading(false);
    }
  }

  // Slot labels for the period grid preview
  const slotLabels = Array.from({ length: settings.periodsPerDay }, (_, i) => i + 1);
  const dayRange = Array.from({ length: settings.workingDays }, (_, i) => i + 1);

  return (
    <DashboardLayout>
      <div className="page-header">
        <div><h2>Settings</h2><p>School configuration and account settings</p></div>
      </div>
      <div className="page-body">

        {/* ── Timetable Settings ── */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header">
            <h3>⏱ Timetable Settings</h3>
            <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>Applied to all classes &amp; divisions during generation</span>
          </div>
          <form onSubmit={saveSettings}>
            <div className="card-body">
              <div className="form-row" style={{ gap: 24 }}>
                <div className="form-group">
                  <label className="form-label">Periods per Day</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <input
                      className="form-input"
                      type="number" min={1} max={12}
                      style={{ width: 80 }}
                      value={settings.periodsPerDay}
                      onChange={e => updateSetting('periodsPerDay', parseInt(e.target.value))}
                    />
                    <span style={{ fontSize: 13, color: 'var(--gray-500)' }}>slots/day</span>
                  </div>
                  <span className="form-hint">Total periods in a school day (e.g. 7)</span>
                </div>

                <div className="form-group">
                  <label className="form-label">Working Days</label>
                  <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                    <label className="form-checkbox">
                      <input type="radio" name="workingDays" checked={settings.workingDays === 5}
                        onChange={() => updateSetting('workingDays', 5)} />
                      Mon – Fri (5 days)
                    </label>
                    <label className="form-checkbox">
                      <input type="radio" name="workingDays" checked={settings.workingDays === 6}
                        onChange={() => updateSetting('workingDays', 6)} />
                      Mon – Sat (6 days)
                    </label>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Morning Periods (before lunch)</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <input
                      className="form-input"
                      type="number" min={1} max={settings.periodsPerDay - 1}
                      style={{ width: 80 }}
                      value={settings.morningPeriods}
                      onChange={e => updateSetting('morningPeriods', parseInt(e.target.value))}
                    />
                    <span style={{ fontSize: 13, color: 'var(--gray-500)' }}>
                      Slots {1}–{settings.morningPeriods} = morning &nbsp;|&nbsp; Slots {settings.morningPeriods + 1}–{settings.periodsPerDay} = afternoon
                    </span>
                  </div>
                  <span className="form-hint">Core subjects are scheduled in morning slots; evening-priority in afternoon</span>
                </div>

                <div className="form-group">
                  <label className="form-label">Academic Year</label>
                  <input
                    className="form-input"
                    style={{ width: 140 }}
                    value={settings.academicYear}
                    onChange={e => updateSetting('academicYear', e.target.value)}
                    placeholder="e.g. 2025-2026"
                  />
                </div>
              </div>

              {/* Visual period grid preview */}
              <div style={{ marginTop: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-500)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Preview — {settings.workingDays} days × {settings.periodsPerDay} periods
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr>
                        <th style={{ padding: '4px 10px', background: 'var(--gray-100)', border: '1px solid var(--border-color)' }}></th>
                        {slotLabels.map(s => (
                          <th key={s} style={{
                            padding: '4px 10px',
                            background: s <= settings.morningPeriods ? '#dbeafe' : '#fef9c3',
                            border: '1px solid var(--border-color)',
                            color: s <= settings.morningPeriods ? '#1d4ed8' : '#92400e',
                            fontWeight: 600,
                          }}>
                            P{s}
                            {s === settings.morningPeriods && <span style={{ marginLeft: 4, opacity: 0.6 }}>☀</span>}
                            {s === settings.morningPeriods + 1 && <span style={{ marginLeft: 4, opacity: 0.6 }}>🌙</span>}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {dayRange.map(day => (
                        <tr key={day}>
                          <td style={{ padding: '4px 10px', fontWeight: 600, background: 'var(--gray-50)', border: '1px solid var(--border-color)', fontSize: 11 }}>
                            {DAY_LABELS[day]}
                          </td>
                          {slotLabels.map(s => (
                            <td key={s} style={{
                              padding: '4px 16px',
                              border: '1px solid var(--border-color)',
                              background: s <= settings.morningPeriods ? 'rgba(219,234,254,0.3)' : 'rgba(254,249,195,0.3)',
                              textAlign: 'center',
                              color: 'var(--gray-400)',
                            }}>
                              {day === settings.workingDays && s === settings.periodsPerDay
                                ? <span style={{ color: '#9333ea', fontWeight: 600 }}>Rec</span>
                                : '·'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 6 }}>
                    🔵 Morning (core subjects) &nbsp; 🟡 Afternoon (evening-priority subjects) &nbsp; 🟣 Last period on last day = Recreation slot
                  </p>
                </div>
              </div>

              {settingsMsg && (
                <div className={`toast ${settingsMsg.includes('Error') ? 'toast-error' : 'toast-info'}`}
                  style={{ position: 'relative', bottom: 'auto', right: 'auto', marginTop: 16, maxWidth: '100%' }}>
                  {settingsMsg}
                </div>
              )}
            </div>
            <div className="modal-footer" style={{ padding: '12px 20px', borderTop: '1px solid var(--border-color)' }}>
              <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>
                {settingsDirty ? '⚠ Unsaved changes' : 'All changes saved'}
              </span>
              <button type="submit" className="btn btn-primary" disabled={settingsLoading || !settingsDirty}>
                {settingsLoading ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </form>
        </div>

        {/* ── Account Info ── */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header">
            <h3>Account Info</h3>
            <button className="btn btn-secondary btn-sm" onClick={openProfileModal}>Edit Details</button>
          </div>
          <div className="card-body">
            <div className="form-row">
              <div><label className="form-label">Name</label><p>{session?.user?.name}</p></div>
              <div><label className="form-label">Username</label><p>{session?.user?.username}</p></div>
              <div><label className="form-label">Role</label><p><span className="badge badge-green">{session?.user?.role}</span></p></div>
            </div>
            {profileMsg && <p style={{ marginTop: 12, color: profileMsg.includes('success') ? 'var(--success)' : 'var(--danger)', fontSize: 13 }}>{profileMsg}</p>}
          </div>
        </div>

        {/* ── Password ── */}
        <div className="card">
          <div className="card-header"><h3>Password Management</h3></div>
          <div className="card-body">
            <button className="btn btn-secondary" onClick={() => { setShowPwdModal(true); setPwdForm({ targetUserId: '', newPassword: '', confirmAdminPassword: '' }); }}>
              Change Own Password
            </button>
            {pwdMsg && <p style={{ marginTop: 12, color: pwdMsg.includes('success') ? 'var(--success)' : 'var(--danger)' }}>{pwdMsg}</p>}
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
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowPwdModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={pwdLoading}>{pwdLoading ? 'Updating...' : 'Update Password'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showProfileModal && (
        <div className="modal-overlay" onClick={() => setShowProfileModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Edit Account Details</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowProfileModal(false)}>✕</button>
            </div>
            <form onSubmit={handleProfileSubmit}>
              <div className="modal-body">
                {profileMsg && !profileMsg.includes('success') && (
                  <div className="form-error" style={{ marginBottom: 16 }}>{profileMsg}</div>
                )}
                <div className="form-group">
                  <label className="form-label">Full Name</label>
                  <input
                    className="form-input"
                    type="text"
                    required
                    value={profileForm.name}
                    onChange={e => setProfileForm({ ...profileForm, name: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Username</label>
                  <input
                    className="form-input"
                    type="text"
                    required
                    value={profileForm.username}
                    onChange={e => setProfileForm({ ...profileForm, username: e.target.value })}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowProfileModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={profileLoading}>
                  {profileLoading ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
