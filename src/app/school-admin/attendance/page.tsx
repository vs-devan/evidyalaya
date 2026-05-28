'use client';

import { useEffect, useState, useRef } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { downloadExcel, parseExcel } from '@/lib/excel';

export default function AttendancePage() {
  const [classes, setClasses] = useState<any[]>([]);
  const [selectedDiv, setSelectedDiv] = useState('');
  const [students, setStudents] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<Record<string, boolean>>({});
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { fetchClasses(); }, []);
  useEffect(() => { if (selectedDiv) fetchStudents(); }, [selectedDiv, date]);

  async function fetchClasses() {
    const res = await fetch('/api/classes');
    const data = await res.json();
    if (data.success) setClasses(data.data);
  }

  async function fetchStudents() {
    const [sRes, aRes] = await Promise.all([
      fetch(`/api/students?divisionId=${selectedDiv}`).then(r => r.json()),
      fetch(`/api/attendance?divisionId=${selectedDiv}&date=${date}`).then(r => r.json()),
    ]);
    if (sRes.success) setStudents(sRes.data);
    const att: Record<string, boolean> = {};
    sRes.data?.forEach((s: any) => { att[s.id] = true; }); // default present
    aRes.data?.forEach((a: any) => { att[a.studentId] = a.isPresent; });
    setAttendance(att);
    setMessage('');
  }

  async function saveAttendance() {
    setSaving(true);
    const records = students.map(s => ({ studentId: s.id, isPresent: attendance[s.id] ?? true }));
    const res = await fetch('/api/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ divisionId: selectedDiv, date, records }),
    });
    const data = await res.json();
    if (data.success) {
      setMessage('Attendance saved successfully.');
    } else {
      setMessage('Error saving attendance.');
    }
    setSaving(false);
  }

  function handleDownloadTemplate() {
    const sampleData = students.map(s => ({
      'Roll Number': s.rollNumber,
      'Student Name': s.name,
      'Status (Present/Absent)': attendance[s.id] ? 'Present' : 'Absent'
    }));

    const data = sampleData.length ? sampleData : [
      { 'Roll Number': 1, 'Student Name': 'Rahul S', 'Status (Present/Absent)': 'Present' }
    ];
    downloadExcel(data, `attendance_template_${date}`, 'Attendance');
  }

  async function handleUploadExcel(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsedData = await parseExcel(file);
      const att = { ...attendance };
      let matchedCount = 0;

      for (const row of parsedData) {
        const roll = String(row['Roll Number']);
        const status = String(row['Status (Present/Absent)'] || '').trim().toLowerCase();
        const studentObj = students.find(s => String(s.rollNumber) === roll);
        if (studentObj) {
          matchedCount++;
          att[studentObj.id] = status === 'present';
        }
      }
      setAttendance(att);
      setMessage(`Successfully loaded attendance for ${matchedCount} students from Excel. Review below and click Save.`);
    } catch (err: any) {
      setMessage(`Error parsing file: ${err.message || err}`);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const allDivisions = classes.flatMap((c: any) => c.divisions?.map((d: any) => ({ ...d, className: c.name })) || []);
  const presentCount = Object.values(attendance).filter(Boolean).length;
  const absentCount = students.length - presentCount;

  return (
    <DashboardLayout>
      <div className="page-header">
        <div>
          <h2>Attendance</h2>
          <p>Mark daily attendance</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="form-input" type="date" value={date} onChange={e => setDate(e.target.value)} style={{ width: 160 }} />
          <select className="form-select" style={{ width: 200 }} value={selectedDiv} onChange={e => setSelectedDiv(e.target.value)}>
            <option value="">Select Division...</option>
            {allDivisions.map((d: any) => <option key={d.id} value={d.id}>Class {d.className}{d.name}</option>)}
          </select>
        </div>
      </div>
      <div className="page-body">
        {message && (
          <div className={`toast ${message.includes('Error') ? 'toast-error' : 'toast-info'}`} style={{ position: 'relative', bottom: 'auto', right: 'auto', marginBottom: 16, maxWidth: '100%' }}>
            {message}
          </div>
        )}

        {!selectedDiv ? (
          <div className="card">
            <div className="empty-state">
              <h3>Select a Division</h3>
              <p>Choose a class and division to start marking attendance</p>
            </div>
          </div>
        ) : (
          <>
            <div className="stat-grid">
              <div className="stat-card">
                <div className="stat-icon green" style={{ fontSize: 13, fontWeight: 700 }}>PR</div>
                <div>
                  <div className="stat-value">{presentCount}</div>
                  <div className="stat-label">Present</div>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon red" style={{ fontSize: 13, fontWeight: 700 }}>AB</div>
                <div>
                  <div className="stat-value">{absentCount}</div>
                  <div className="stat-label">Absent</div>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon blue" style={{ fontSize: 13, fontWeight: 700 }}>%</div>
                <div>
                  <div className="stat-value">{students.length > 0 ? Math.round(presentCount / students.length * 100) : 0}%</div>
                  <div className="stat-label">Attendance Rate</div>
                </div>
              </div>
            </div>
            <div className="card">
              <div className="card-header">
                <h3>Students ({students.length})</h3>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-secondary btn-sm" onClick={handleDownloadTemplate}>
                    Download Template
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => fileInputRef.current?.click()}>
                    Upload Excel
                  </button>
                  <input
                    type="file"
                    ref={fileInputRef}
                    style={{ display: 'none' }}
                    accept=".xlsx"
                    onChange={handleUploadExcel}
                  />
                  <button className="btn btn-primary" onClick={saveAttendance} disabled={saving}>
                    {saving ? 'Saving...' : 'Save Attendance'}
                  </button>
                </div>
              </div>
              <ul className="attendance-list">
                {students.map((s: any) => (
                  <li key={s.id} className="attendance-item">
                    <div><strong>{s.rollNumber}.</strong> {s.name}</div>
                    <button
                      className={`attendance-toggle ${attendance[s.id] ? 'present' : 'absent'}`}
                      onClick={() => setAttendance({ ...attendance, [s.id]: !attendance[s.id] })}
                    >
                      {attendance[s.id] ? 'Present' : 'Absent'}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
