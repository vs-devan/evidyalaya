'use client';
import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';

export default function ParentResults() {
  const [results, setResults] = useState<any[]>([]);
  useEffect(() => {
    fetch('/api/parent/data').then(r => r.json()).then(d => { if (d.success) setResults(d.data.results || []); });
  }, []);
  return (
    <DashboardLayout>
      <div className="page-header"><div><h2>Exam Results</h2></div></div>
      <div className="page-body">
        <div className="card">
          <div className="card-header"><h3>Results</h3></div>
          <div className="table-container">
            <table className="data-table">
              <thead><tr><th>Subject</th><th>Exam</th><th>Marks</th><th>Max</th></tr></thead>
              <tbody>
                {results.map((r: any) => (
                  <tr key={r.id}><td>{r.subject?.name}</td><td>{r.examName}</td><td><strong>{r.marks}</strong></td><td>{r.maxMarks}</td></tr>
                ))}
                {results.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', padding: 40 }}>No results yet</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
