'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';

export default function TeacherMessages() {
  const { data: session } = useSession();
  const [messages, setMessages] = useState<any[]>([]);
  const [sentMessages, setSentMessages] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [divisionId, setDivisionId] = useState('');
  const [form, setForm] = useState({ content: '' });
  const [tab, setTab] = useState<'received' | 'sent'>('received');

  useEffect(() => {
    if (session?.user?.teacherId) {
      fetch('/api/teachers').then(r => r.json()).then(d => {
        if (d.success) {
          const teacher = d.data.find((t: any) => t.id === session?.user?.teacherId);
          if (teacher?.classTeacherOf) setDivisionId(teacher.classTeacherOf.id);
        }
      });
    }
    fetchMessages();
  }, [session]);

  async function fetchMessages() {
    const [rRes, sRes] = await Promise.all([
      fetch('/api/messages').then(r => r.json()),
      fetch('/api/messages?sent=true').then(r => r.json()),
    ]);
    if (rRes.success) setMessages(rRes.data);
    if (sRes.success) setSentMessages(sRes.data);
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: form.content, targetType: 'CLASS', targetClassDivisionId: divisionId }),
    });
    setShowModal(false);
    setForm({ content: '' });
    fetchMessages();
    setLoading(false);
  }

  const displayMessages = tab === 'received' ? messages : sentMessages;

  return (
    <DashboardLayout>
      <div className="page-header">
        <div><h2>Messages</h2><p>View and send messages</p></div>
        {divisionId && <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Message Class</button>}
      </div>
      <div className="page-body">
        <div className="tabs">
          <button className={`tab ${tab === 'received' ? 'active' : ''}`} onClick={() => setTab('received')}>Received</button>
          <button className={`tab ${tab === 'sent' ? 'active' : ''}`} onClick={() => setTab('sent')}>Sent</button>
        </div>
        <div className="card">
          <div className="card-body">
            {displayMessages.length === 0 ? (
              <div className="empty-state"><div className="empty-state-icon">💬</div><h3>No Messages</h3></div>
            ) : displayMessages.map((m: any) => (
              <div key={m.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--gray-400)' }}>
                  <span>{m.sender?.name || 'You'}</span>
                  <span>{new Date(m.createdAt).toLocaleString('en-IN')}</span>
                </div>
                <p style={{ fontSize: 14, marginTop: 4 }}>{m.content}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>Message Class</h3><button className="btn btn-ghost btn-icon" onClick={() => setShowModal(false)}>✕</button></div>
            <form onSubmit={sendMessage}>
              <div className="modal-body">
                <div className="form-group"><label className="form-label">Message</label>
                  <textarea className="form-textarea" required value={form.content} onChange={e => setForm({ content: e.target.value })} placeholder="Type message..." />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Sending...' : 'Send'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
