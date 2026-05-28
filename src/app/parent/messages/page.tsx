'use client';
import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';

export default function ParentMessages() {
  const [messages, setMessages] = useState<any[]>([]);
  useEffect(() => {
    fetch('/api/messages').then(r => r.json()).then(d => { if (d.success) setMessages(d.data); });
  }, []);
  return (
    <DashboardLayout>
      <div className="page-header"><div><h2>Messages</h2></div></div>
      <div className="page-body">
        <div className="card">
          <div className="card-header"><h3>Messages ({messages.length})</h3></div>
          <div className="card-body">
            {messages.length === 0 ? (
              <div className="empty-state"><div className="empty-state-icon">💬</div><h3>No Messages</h3></div>
            ) : messages.map((m: any) => (
              <div key={m.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--gray-400)' }}>
                  <span>{m.sender?.name}</span>
                  <span>{new Date(m.createdAt).toLocaleString('en-IN')}</span>
                </div>
                <p style={{ marginTop: 4 }}>{m.content}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
