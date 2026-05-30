'use client';

import { useEffect, useState, useRef } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { downloadExcel, parseExcel } from '@/lib/excel';

export default function ResultsPage() {
  const [classes, setClasses] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [results, setResults] = useState<any[]>([]);
  const [selectedDiv, setSelectedDiv] = useState('');
  const [examName, setExamName] = useState('First Term');
  const [editData, setEditData] = useState<Record<string, Record<string, string>>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { fetchInit(); }, []);
  useEffect(() => { if (selectedDiv) fetchData(); }, [selectedDiv, examName]);

  async function fetchInit() {
    const [cRes, sRes] = await Promise.all([
      fetch('/api/classes').then(r => r.json()),
      fetch('/api/subjects').then(r => r.json()),
    ]);
    if (cRes.success) setClasses(cRes.data);
    if (sRes.success) setSubjects(sRes.data);
  }

  async function fetchData() {
    const [stRes, rRes] = await Promise.all([
      fetch(`/api/students?divisionId=${selectedDiv}`).then(r => r.json()),
      fetch(`/api/results?divisionId=${selectedDiv}&examName=${examName}`).then(r => r.json()),
    ]);
    if (stRes.success) setStudents(stRes.data);
    if (rRes.success) setResults(rRes.data);

    // Build edit data
    const ed: Record<string, Record<string, string>> = {};
    stRes.data?.forEach((s: any) => { ed[s.id] = {}; });
    rRes.data?.forEach((r: any) => { if (ed[r.studentId]) ed[r.studentId][r.subjectId] = String(r.marks ?? ''); });
    setEditData(ed);
    setMessage('');
  }

  async function saveResults() {
    setSaving(true);
    const records: any[] = [];
    Object.entries(editData).forEach(([studentId, subs]) => {
      Object.entries(subs).forEach(([subjectId, marks]) => {
        if (marks !== '') records.push({ studentId, subjectId, marks: parseFloat(marks), maxMarks: 100 });
      });
    });
    const res = await fetch('/api/results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ examName, results: records }),
    });
    const data = await res.json();
    if (data.success) {
      setMessage('Results saved successfully.');
    } else {
      setMessage('Error saving results.');
    }
    setSaving(false);
  }

  function handleDownloadTemplate() {
    const headers: Record<string, any> = {
      'Roll Number': 1,
      'Student Name': 'Rahul S',
    };
    subjects.forEach(s => {
      headers[s.name] = '';
    });

    const rows = students.map(s => {
      const row: Record<string, any> = {
        'Roll Number': s.rollNumber,
        'Student Name': s.name,
      };
      subjects.forEach(sub => {
        row[sub.name] = editData[s.id]?.[sub.id] || '';
      });
      return row;
    });

    // If no students yet, just provide headers row
    const data = rows.length ? rows : [headers];
    downloadExcel(data, `results_template_${examName.replace(/\s+/g, '_')}`, 'Results');
  }

  async function handleUploadExcel(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsedData = await parseExcel(file);
      const ed = { ...editData };
      let matchedCount = 0;

      for (const row of parsedData) {
        const roll = String(row['Roll Number']);
        const studentObj = students.find(s => String(s.rollNumber) === roll);
        if (studentObj) {
          matchedCount++;
          if (!ed[studentObj.id]) ed[studentObj.id] = {};
          subjects.forEach(sub => {
            const key = sub.name;
            const key2 = sub.code;
            const marksVal = row[key] !== undefined ? row[key] : row[key2];
            if (marksVal !== undefined) {
              ed[studentObj.id][sub.id] = String(marksVal);
            }
          });
        }
      }
      setEditData(ed);
      setMessage(`Successfully loaded marks for ${matchedCount} students from Excel. Review below and click "Save Results".`);
    } catch (err: any) {
      setMessage(`Error parsing file: ${err.message || err}`);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const allDivisions = classes.flatMap((c: any) => c.divisions?.map((d: any) => ({ ...d, className: c.name })) || []);

  return (
    <DashboardLayout>
      <div className="page-header">
        <div>
          <h2>Exam Results</h2>
          <p>Upload and manage exam results</p>
        </div>
        <div className="page-header-actions">
          <select className="form-select" style={{ minWidth: 150 }} value={selectedDiv} onChange={e => setSelectedDiv(e.target.value)}>
            <option value="">Select Division...</option>
            {allDivisions.map((d: any) => <option key={d.id} value={d.id}>Class {d.className}{d.name}</option>)}
          </select>
          <select className="form-select" style={{ minWidth: 130 }} value={examName} onChange={e => setExamName(e.target.value)}>
            <option>First Term</option>
            <option>Mid Term</option>
            <option>Annual</option>
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
              <p>Choose a class and division to start entering results</p>
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="card-header">
              <h3>Results - {examName}</h3>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="btn btn-secondary btn-sm" onClick={handleDownloadTemplate}>⬇ Template</button>
                <button className="btn btn-secondary btn-sm" onClick={() => fileInputRef.current?.click()}
                >⬆ Excel</button>
                <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept=".xlsx" onChange={handleUploadExcel} />
                <button className="btn btn-primary btn-sm" onClick={saveResults} disabled={saving}>
                  {saving ? 'Saving...' : '💾 Save'}
                </button>
              </div>
            </div>
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Roll</th>
                    <th>Name</th>
                    {subjects.map(s => <th key={s.id} style={{ fontSize: 11 }}>{s.code}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {students.map((st: any) => (
                    <tr key={st.id}>
                      <td>{st.rollNumber}</td>
                      <td>{st.name}</td>
                      {subjects.map(sub => (
                        <td key={sub.id}>
                          <input
                            className="form-input"
                            type="number"
                            style={{ width: 64, padding: '4px 6px', fontSize: 12 }}
                            value={editData[st.id]?.[sub.id] || ''}
                            onChange={e => setEditData({
                              ...editData,
                              [st.id]: { ...editData[st.id], [sub.id]: e.target.value }
                            })}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                  {students.length === 0 && (
                    <tr>
                      <td colSpan={2 + subjects.length} style={{ textAlign: 'center', padding: 40 }}>
                        No students found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
