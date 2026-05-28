'use client';
import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { getPercentage } from '@/lib/utils';

export default function ParentAttendance() {
  const [attendance, setAttendance] = useState<any[]>([]);
  useEffect(() => {
    fetch('/api/parent/data').then(r => r.json()).then(d => { if (d.success) setAttendance(d.data.attendance || []); });
  }, []);
  const total = attendance.length;
  const present = attendance.filter((a: any) => a.isPresent).length;
  const absent = total - present;
  return (
    <DashboardLayout>
      <div className="page-header"><div><h2>Attendance</h2><p>View attendance history</p></div></div>
      <div className="page-body">
        <div className="stat-grid">
          <div className="stat-card"><div className="stat-icon green">✅</div><div><div className="stat-value">{getPercentage(present, total)}%</div><div className="stat-label">Attendance Rate</div></div></div>
          <div className="stat-card"><div className="stat-icon blue">📅</div><div><div className="stat-value">{present}</div><div className="stat-label">Present</div></div></div>
          <div className="stat-card"><div className="stat-icon red">❌</div><div><div className="stat-value">{absent}</div><div className="stat-label">Absent</div></div></div>
        </div>
        <div className="card">
          <div className="card-header"><h3>Attendance History</h3></div>
          <div className="table-container">
            <table className="data-table">
              <thead><tr><th>Date</th><th>Status</th></tr></thead>
              <tbody>
                {attendance.map((a: any) => (
                  <tr key={a.id}>
                    <td>{new Date(a.date).toLocaleDateString('en-IN')}</td>
                    <td><span className={`badge ${a.isPresent ? 'badge-green' : 'badge-red'}`}>{a.isPresent ? 'Present' : 'Absent'}</span></td>
                  </tr>
                ))}
                {attendance.length === 0 && <tr><td colSpan={2} style={{ textAlign: 'center', padding: 40 }}>No attendance records</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
