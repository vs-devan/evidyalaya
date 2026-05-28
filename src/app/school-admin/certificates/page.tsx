'use client';

import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';

export default function CertificatesPage() {
  const [teachers, setTeachers] = useState<any[]>([]);
  const [certs, setCerts] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ type: 'COVER_LETTER', teacherId: '', additionalContext: '', supportingDocContent: '' });

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    const [tRes, cRes] = await Promise.all([
      fetch('/api/teachers').then(r => r.json()),
      fetch('/api/certificates').then(r => r.json()),
    ]);
    if (tRes.success) setTeachers(tRes.data);
    if (cRes.success) setCerts(cRes.data);
  }

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch('/api/certificates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    if ((await res.json()).success) {
      setShowModal(false);
      fetchAll();
    }
    setLoading(false);
  }

  const typeLabels: Record<string, string> = { COVER_LETTER: 'Cover Letter', RELIEVING_ORDER: 'Relieving Order', DUTY_CERTIFICATE: 'Duty Certificate' };

  return (
    <DashboardLayout>
      <div className="page-header">
        <div><h2>Certificates</h2><p>Generate certificates with AI assistance</p></div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Generate Certificate</button>
      </div>
      <div className="page-body">
        <div className="card">
          <div className="card-header"><h3>Generated Certificates ({certs.length})</h3></div>
          <div className="table-container">
            <table className="data-table">
              <thead><tr><th>Type</th><th>Teacher</th><th>Date</th><th>Actions</th></tr></thead>
              <tbody>
                {certs.map((c: any) => (
                  <tr key={c.id}>
                    <td><span className="badge badge-blue">{typeLabels[c.type] || c.type}</span></td>
                    <td>{c.generatedFor?.user?.name}</td>
                    <td>{new Date(c.createdAt).toLocaleDateString('en-IN')}</td>
                    <td><button className="btn btn-ghost btn-sm" onClick={() => { /* TODO: view/print */ }}>View</button></td>
                  </tr>
                ))}
                {certs.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', padding: 40 }}>No certificates generated yet</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>Generate Certificate</h3><button className="btn btn-ghost btn-icon" onClick={() => setShowModal(false)}>✕</button></div>
            <form onSubmit={generate}>
              <div className="modal-body">
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Type</label>
                    <select className="form-select" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                      <option value="COVER_LETTER">Cover Letter</option>
                      <option value="RELIEVING_ORDER">Relieving Order</option>
                      <option value="DUTY_CERTIFICATE">Duty Certificate</option>
                    </select>
                  </div>
                  <div className="form-group"><label className="form-label">Teacher</label>
                    <select className="form-select" required value={form.teacherId} onChange={e => setForm({ ...form, teacherId: e.target.value })}>
                      <option value="">Select teacher...</option>
                      {teachers.map((t: any) => <option key={t.id} value={t.id}>{t.teacherCode} - {t.user?.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="form-group"><label className="form-label">Additional Context</label>
                  <textarea className="form-textarea" value={form.additionalContext} onChange={e => setForm({ ...form, additionalContext: e.target.value })} placeholder="Provide details like reason, dates, destination..." />
                </div>
                <div className="form-group"><label className="form-label">Supporting Document Content (optional)</label>
                  <textarea className="form-textarea" value={form.supportingDocContent} onChange={e => setForm({ ...form, supportingDocContent: e.target.value })} placeholder="Paste content from supporting documents..." />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? '🤖 Generating...' : '🤖 Generate with AI'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
