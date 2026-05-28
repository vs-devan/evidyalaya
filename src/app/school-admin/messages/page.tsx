'use client';

import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';

export default function MessagesPage() {
  const [messages, setMessages] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [classes, setClasses] = useState<any[]>([]);
  const [form, setForm] = useState({ content: '', targetType: 'ALL', targetClassDivisionId: '' });

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    const [mRes, cRes] = await Promise.all([
      fetch('/api/messages?sent=true').then(r => r.json()),
      fetch('/api/classes').then(r => r.json()),
    ]);
    if (mRes.success) setMessages(mRes.data);
    if (cRes.success) setClasses(cRes.data);
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setShowModal(false);
    setForm({ content: '', targetType: 'ALL', targetClassDivisionId: '' });
    fetchAll();
    setLoading(false);
  }

  const allDivisions = classes.flatMap((c: any) => c.divisions?.map((d: any) => ({ ...d, className: c.name })) || []);
  const targetLabels: Record<string, string> = { ALL: 'Everyone', ALL_TEACHERS: 'All Teachers', ALL_PARENTS: 'All Parents', CLASS: 'Class' };

  return (
    <DashboardLayout>
      <div className="page-header">
        <div><h2>Messages</h2><p>Broadcast messages to teachers and parents</p></div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ New Message</button>
      </div>
      <div className="page-body">
        <div className="card">
          <div className="card-header"><h3>Sent Messages ({messages.length})</h3></div>
          <div className="card-body">
            {messages.length === 0 ? (
              <div className="empty-state"><div className="empty-state-icon">💬</div><h3>No Messages</h3><p>Send your first broadcast message</p></div>
            ) : messages.map((m: any) => (
              <div key={m.id} style={{ padding: '16px 0', borderBottom: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span className="badge badge-blue">{targetLabels[m.targetType] || m.targetType}</span>
                  <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>{new Date(m.createdAt).toLocaleString('en-IN')}</span>
                </div>
                <p style={{ fontSize: 14, marginTop: 8 }}>{m.content}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>Send Message</h3><button className="btn btn-ghost btn-icon" onClick={() => setShowModal(false)}>✕</button></div>
            <form onSubmit={sendMessage}>
              <div className="modal-body">
                <div className="form-group"><label className="form-label">Send To</label>
                  <select className="form-select" value={form.targetType} onChange={e => setForm({ ...form, targetType: e.target.value })}>
                    <option value="ALL">Everyone</option>
                    <option value="ALL_TEACHERS">All Teachers</option>
                    <option value="ALL_PARENTS">All Parents</option>
                    <option value="CLASS">Specific Class</option>
                  </select>
                </div>
                {form.targetType === 'CLASS' && (
                  <div className="form-group"><label className="form-label">Select Class</label>
                    <select className="form-select" value={form.targetClassDivisionId} onChange={e => setForm({ ...form, targetClassDivisionId: e.target.value })}>
                      <option value="">Select...</option>
                      {allDivisions.map((d: any) => <option key={d.id} value={d.id}>Class {d.className}{d.name}</option>)}
                    </select>
                  </div>
                )}
                <div className="form-group"><label className="form-label">Message</label>
                  <textarea className="form-textarea" required value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} placeholder="Type your message..." />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Sending...' : 'Send Message'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
