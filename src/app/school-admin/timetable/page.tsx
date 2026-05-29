'use client';

import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { getDayName } from '@/lib/utils';

// ─── Types ─────────────────────────────────────────────────────────────────

type ViewMode = 'weekly' | 'daily' | 'conditions';

interface Constraint {
  id: string;
  label: string;
  category: string;
  enabled: boolean;
  source: 'builtin' | 'ai';
}

interface Issue {
  type: 'error' | 'warning' | 'info';
  category: string;
  message: string;
  detail?: string;
}

interface AnalysisResult {
  issues: Issue[];
  stats: {
    totalEntries: number;
    errors: number;
    warnings: number;
    info: number;
    teacherCount: number;
    avgLoad: number | string;
  };
}

// ─── Built-in constraints from the implementation plan ───────────────────────

const BUILTIN_CONSTRAINTS: Constraint[] = [
  // Teacher Rules
  { id: 'c_ct_period1', label: 'Class teacher must take Period 1 of their division every day', category: 'Class Teacher', enabled: true, source: 'builtin' },
  { id: 'c_no_double_book', label: 'No teacher can be assigned to two classes at the same time slot', category: 'Teacher Rules', enabled: true, source: 'builtin' },
  { id: 'c_single_teacher', label: 'A single teacher is assigned per subject per division (no split teaching)', category: 'Teacher Rules', enabled: true, source: 'builtin' },
  { id: 'c_uniform_load', label: 'Teaching load should be distributed uniformly across all teachers', category: 'Teacher Rules', enabled: true, source: 'builtin' },
  // Subject Distribution
  { id: 'c_max_once_day', label: 'Each subject appears at most once per day per division (except consecutive-slot subjects)', category: 'Subject Distribution', enabled: true, source: 'builtin' },
  { id: 'c_core_morning', label: 'Core subjects (English, Maths, Languages, Science) are prioritized in morning slots (1–4)', category: 'Slot Priority', enabled: true, source: 'builtin' },
  { id: 'c_evening_priority', label: 'Evening-priority subjects (PE, Art, IT Practical, Recreation) are placed in afternoon slots (5–7)', category: 'Slot Priority', enabled: true, source: 'builtin' },
  // Consecutive slots
  { id: 'c_consecutive', label: 'Subjects requiring consecutive slots (e.g., IT Practical) must be placed in adjacent periods without spanning the lunch break', category: 'Consecutive Slots', enabled: true, source: 'builtin' },
  { id: 'c_no_span_lunch', label: 'Consecutive-slot subjects must not span across the lunch break', category: 'Consecutive Slots', enabled: true, source: 'builtin' },
  // Language variants
  { id: 'c_lang_variant', label: 'Language variant subjects (Sanskrit, Arabic, Urdu) replace Malayalam I — only one is scheduled per division', category: 'Language Variants', enabled: true, source: 'builtin' },
  // Fixed placement
  { id: 'c_fixed_day', label: 'Fixed-day subjects are pinned to their designated weekday (e.g., Recreation = Friday)', category: 'Special Rules', enabled: true, source: 'builtin' },
  { id: 'c_fixed_slot', label: 'Fixed-slot subjects are pinned to their designated period (FIRST, LAST, or a specific slot number)', category: 'Special Rules', enabled: true, source: 'builtin' },
  // Distribution quality
  { id: 'c_spread_week', label: 'Subjects with ≥4 periods/week should be spread evenly across days (not clustered)', category: 'Subject Distribution', enabled: true, source: 'builtin' },
  { id: 'c_no_same_teacher_consecutive', label: 'Avoid placing the same teacher in more than 3 consecutive periods', category: 'Teacher Rules', enabled: false, source: 'builtin' },
  { id: 'c_restrict_class', label: 'Teacher–class restrictions must be respected (if a teacher is restricted to specific classes for a subject)', category: 'Teacher Rules', enabled: true, source: 'builtin' },
];

const CATEGORY_ICONS: Record<string, string> = {
  'Class Teacher': '👨‍🏫',
  'Teacher Rules': '📋',
  'Subject Distribution': '📚',
  'Slot Priority': '⏰',
  'Consecutive Slots': '🔗',
  'Language Variants': '🌐',
  'Special Rules': '⭐',
  'General': '📌',
};

const CATEGORY_COLORS: Record<string, string> = {
  'Class Teacher': 'var(--primary-600)',
  'Teacher Rules': 'var(--info)',
  'Subject Distribution': '#7c3aed',
  'Slot Priority': 'var(--warning)',
  'Consecutive Slots': '#0891b2',
  'Language Variants': '#c026d3',
  'Special Rules': 'var(--accent-600)',
  'General': 'var(--gray-600)',
};

// ─── Main Page ─────────────────────────────────────────────────────────────

// Generation progress state
interface GenProgress {
  phase: string;
  pct: number;
  label: string;
  detail?: string;
  steps: { phase: string; label: string; pct: number; done: boolean }[];
  errors: any[];
  warnings: any[];
}

const PHASE_LABELS: Record<string, string> = {
  init: 'Initializing',
  loading_data: 'Loading Data',
  validating: 'Validating',
  constraint_propagation: 'Constraint Solver',
  annealing: 'SA Optimizer',
  ai_repair: 'AI Repair',
  saving: 'Saving',
  done: 'Complete',
  error: 'Failed',
};

export default function TimetablePage() {
  const [entries, setEntries] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('weekly');
  const [selectedDay, setSelectedDay] = useState(new Date().getDay() || 1);
  const [selectedDivision, setSelectedDivision] = useState('');
  const [result, setResult] = useState<any>(null);
  const [genProgress, setGenProgress] = useState<GenProgress | null>(null);

  // Constraints state
  const [constraints, setConstraints] = useState<Constraint[]>(BUILTIN_CONSTRAINTS);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  // Analysis state
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [issueFilter, setIssueFilter] = useState<'all' | 'error' | 'warning' | 'info'>('all');
  const [showAnalysis, setShowAnalysis] = useState(false);

  // Locking states
  const [locked, setLocked] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordPurpose, setPasswordPurpose] = useState<'unlock_only' | 'unlock_and_generate'>('unlock_only');

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    setLoading(true);
    const [tRes, cRes, lRes] = await Promise.all([
      fetch('/api/timetable').then(r => r.json()),
      fetch('/api/classes').then(r => r.json()),
      fetch('/api/timetable/lock').then(r => r.json()).catch(() => ({ success: false, locked: false })),
    ]);
    if (tRes.success) setEntries(tRes.data);
    if (cRes.success) setClasses(cRes.data);
    if (lRes.success) setLocked(lRes.locked);
    setLoading(false);
  }

  async function generateTimetable(password?: string) {
    if (locked && !password) {
      setPasswordPurpose('unlock_and_generate');
      setPasswordInput('');
      setPasswordError('');
      setShowPasswordModal(true);
      return;
    }

    if (!confirm('This will regenerate the entire timetable. Continue?')) return;
    setGenerating(true);
    setResult(null);
    setAnalysis(null);
    setShowAnalysis(false);
    const PHASES = ['loading_data', 'validating', 'constraint_propagation', 'annealing', 'ai_repair', 'saving', 'done'];
    setGenProgress({
      phase: 'init', pct: 0, label: 'Starting generation…',
      steps: PHASES.map(p => ({ phase: p, label: PHASE_LABELS[p], pct: 0, done: false })),
      errors: [], warnings: [],
    });

    const activeConstraints = constraints.filter(c => c.enabled).map(c => c.id);

    try {
      const res = await fetch('/api/timetable/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ constraints: activeConstraints, password }),
      });

      if (!res.body) throw new Error('No response body');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            setGenProgress(prev => {
              if (!prev) return prev;
              const steps = prev.steps.map(s => ({
                ...s,
                done: s.done || (PHASES.indexOf(s.phase) < PHASES.indexOf(event.phase)),
              }));
              return {
                ...prev,
                phase: event.phase,
                pct: event.pct,
                label: event.label,
                detail: event.detail,
                steps,
                errors: event.errors ?? prev.errors,
                warnings: event.warnings ?? prev.warnings,
              };
            });

            if (event.phase === 'done' && event.result) {
              setResult(event.result);
              await fetchAll();
              await runAnalysis();
            }
          } catch {}
        }
      }
    } catch (err: any) {
      setGenProgress(prev => prev ? ({ ...prev, phase: 'error', label: err?.message ?? 'Unknown error' }) : null);
    }

    setGenerating(false);
  }

  async function handleLockToggle() {
    if (locked) {
      setPasswordPurpose('unlock_only');
      setPasswordInput('');
      setPasswordError('');
      setShowPasswordModal(true);
    } else {
      try {
        const res = await fetch('/api/timetable/lock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'lock' }),
        });
        const data = await res.json();
        if (data.success) setLocked(true);
      } catch (err) {
        console.error('Failed to lock:', err);
      }
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError('');

    if (passwordPurpose === 'unlock_only') {
      try {
        const res = await fetch('/api/timetable/lock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'unlock', password: passwordInput }),
        });
        const data = await res.json();
        if (data.success) {
          setLocked(false);
          setShowPasswordModal(false);
        } else {
          setPasswordError(data.error || 'Incorrect admin password.');
        }
      } catch (err) {
        setPasswordError('Network error. Please try again.');
      }
    } else if (passwordPurpose === 'unlock_and_generate') {
      setShowPasswordModal(false);
      generateTimetable(passwordInput);
    }
  }

  async function runAnalysis() {
    setAnalyzing(true);
    try {
      const res = await fetch('/api/timetable/analyze', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setAnalysis(data.data);
        setShowAnalysis(true);
      }
    } catch (e) {
      console.error('Analysis failed:', e);
    }
    setAnalyzing(false);
  }

  async function handleAiConstraint() {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    setAiError('');
    try {
      const res = await fetch('/api/timetable/constraints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: aiPrompt }),
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        setConstraints(prev => [...prev, ...data.data]);
        setAiPrompt('');
      } else {
        setAiError(data.error || 'Failed to generate constraints');
      }
    } catch {
      setAiError('Network error. Please try again.');
    }
    setAiLoading(false);
  }

  function toggleConstraint(id: string) {
    setConstraints(prev => prev.map(c => c.id === id ? { ...c, enabled: !c.enabled } : c));
  }

  function removeAiConstraint(id: string) {
    setConstraints(prev => prev.filter(c => c.id !== id));
  }

  const allDivisions = classes.flatMap((c: any) =>
    c.divisions?.map((d: any) => ({ ...d, className: c.name, label: `${c.name}${d.name}` })) || []
  );

  const days = [1, 2, 3, 4, 5];
  const slots = [1, 2, 3, 4, 5, 6, 7];

  function getEntry(divId: string, day: number, slot: number) {
    return entries.find((e: any) => e.divisionId === divId && e.dayOfWeek === day && e.slotNumber === slot);
  }

  // Group constraints by category
  const constraintsByCategory = constraints.reduce((acc, c) => {
    if (!acc[c.category]) acc[c.category] = [];
    acc[c.category].push(c);
    return acc;
  }, {} as Record<string, Constraint[]>);

  const filteredIssues = analysis?.issues.filter(i =>
    issueFilter === 'all' || i.type === issueFilter
  ) ?? [];

  return (
    <DashboardLayout>
      <div className="page-header">
        <div>
          <h2>Timetable</h2>
          <p>Generate, view and manage weekly timetables</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {entries.length > 0 && (
            <button
              className="btn btn-secondary"
              onClick={runAnalysis}
              disabled={analyzing}
              id="btn-analyze-timetable"
            >
              {analyzing ? '⏳ Analyzing...' : '🔍 Analyze Issues'}
            </button>
          )}
          <button
            className={`btn ${locked ? 'btn-danger' : 'btn-secondary'}`}
            onClick={handleLockToggle}
            id="btn-lock-timetable"
          >
            {locked ? '🔒 Locked' : '🔓 Unlocked'}
          </button>
          <button
            className="btn btn-accent"
            onClick={() => generateTimetable()}
            disabled={generating}
            id="btn-generate-timetable"
          >
            {generating ? '⏳ Generating...' : '🔄 Generate Timetable'}
          </button>
          <button className="btn btn-secondary" onClick={() => window.print()} id="btn-print-timetable">
            🖨️ Print
          </button>
        </div>
      </div>

      <div className="page-body">

        {/* ─── Generation Progress Overlay ─────────────────────────────── */}
        {generating && genProgress && (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{
              background: 'var(--card-bg, #fff)',
              borderRadius: 20, padding: '32px 36px',
              width: '100%', maxWidth: 560,
              boxShadow: '0 24px 80px rgba(0,0,0,0.25)',
            }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: '50%',
                  background: genProgress.phase === 'error' ? '#fef2f2' : genProgress.phase === 'done' ? '#f0fdf4' : '#eff6ff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
                  flexShrink: 0,
                }}>
                  {genProgress.phase === 'error' ? '❌' : genProgress.phase === 'done' ? '✅' : '⚙️'}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--text-primary)' }}>Generating Timetable</div>
                  <div style={{ fontSize: 13, color: 'var(--gray-500)', marginTop: 2 }}>
                    {PHASE_LABELS[genProgress.phase] ?? genProgress.phase}
                  </div>
                </div>
                <div style={{
                  marginLeft: 'auto', fontSize: 22, fontWeight: 800,
                  color: genProgress.phase === 'error' ? '#dc2626' : genProgress.phase === 'done' ? '#16a34a' : 'var(--primary-color)',
                }}>
                  {genProgress.pct}%
                </div>
              </div>

              {/* Progress bar */}
              <div style={{ height: 10, borderRadius: 99, background: 'var(--surface-bg, #f3f4f6)', overflow: 'hidden', marginBottom: 20 }}>
                <div style={{
                  height: '100%', borderRadius: 99,
                  width: `${genProgress.pct}%`,
                  background: genProgress.phase === 'error'
                    ? 'linear-gradient(90deg,#ef4444,#dc2626)'
                    : genProgress.phase === 'done'
                    ? 'linear-gradient(90deg,#22c55e,#16a34a)'
                    : 'linear-gradient(90deg,var(--primary-color),#818cf8)',
                  transition: 'width 0.4s ease, background 0.4s ease',
                }}/>
              </div>

              {/* Phase steps */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 18 }}>
                {genProgress.steps.map((step, i) => {
                  const isCurrent = step.phase === genProgress.phase;
                  const isDone = step.done;
                  return (
                    <div key={step.phase} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, flex: 1 }}>
                      <div style={{
                        width: 26, height: 26, borderRadius: '50%', display: 'flex',
                        alignItems: 'center', justifyContent: 'center', fontSize: 12,
                        fontWeight: 700, flexShrink: 0,
                        background: isDone ? '#22c55e' : isCurrent ? 'var(--primary-color)' : 'var(--surface-bg, #f3f4f6)',
                        color: isDone || isCurrent ? '#fff' : 'var(--gray-400)',
                        transition: 'all 0.3s ease',
                        boxShadow: isCurrent ? '0 0 0 3px rgba(99,102,241,0.25)' : 'none',
                      }}>
                        {isDone ? '✓' : i + 1}
                      </div>
                      <span style={{ fontSize: 9, color: isCurrent ? 'var(--primary-color)' : isDone ? '#16a34a' : 'var(--gray-400)', textAlign: 'center', fontWeight: isCurrent ? 700 : 400 }}>
                        {step.label}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Current label */}
              <div style={{
                padding: '10px 14px', borderRadius: 10,
                background: genProgress.phase === 'error' ? '#fef2f2' : 'var(--surface-bg, #f8f9fc)',
                border: '1px solid var(--border-color)', marginBottom: 14,
              }}>
                <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{genProgress.label}</div>
                {genProgress.detail && <div style={{ fontSize: 11, color: 'var(--gray-500)', marginTop: 3 }}>{genProgress.detail}</div>}
              </div>

              {/* Errors hierarchy */}
              {genProgress.errors.length > 0 && (
                <div style={{ maxHeight: 160, overflowY: 'auto' }}>
                  {genProgress.errors.map((e: any, i: number) => (
                    <div key={i} style={{
                      padding: '7px 11px', borderRadius: 8, marginBottom: 5,
                      background: e.severity === 'critical' ? '#fef2f2' : '#fffbeb',
                      borderLeft: `3px solid ${e.severity === 'critical' ? '#dc2626' : '#d97706'}`,
                      fontSize: 12,
                    }}>
                      <span style={{ fontWeight: 700, color: e.severity === 'critical' ? '#dc2626' : '#d97706' }}>
                        {e.severity === 'critical' ? '🔴 CRITICAL' : '🟠 ERROR'}:
                      </span>{' '}
                      <span style={{ color: 'var(--text-primary)' }}>{e.message}</span>
                    </div>
                  ))}
                </div>
              )}

              {genProgress.warnings.length > 0 && (
                <div style={{ maxHeight: 100, overflowY: 'auto', marginTop: 6 }}>
                  {genProgress.warnings.slice(0, 4).map((w: any, i: number) => (
                    <div key={i} style={{
                      padding: '5px 10px', borderRadius: 6, marginBottom: 4,
                      background: '#f0f9ff', borderLeft: '3px solid #0ea5e9',
                      fontSize: 11, color: 'var(--text-primary)',
                    }}>
                      🔵 {w.message ?? w}
                    </div>
                  ))}
                  {genProgress.warnings.length > 4 && (
                    <div style={{ fontSize: 11, color: 'var(--gray-500)', textAlign: 'center' }}>
                      +{genProgress.warnings.length - 4} more notices
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Generation result banner */}
        {result && !generating && (
          <div
            className="tt-result-banner"
            style={{
              background: (result.score ?? 100) < 90 ? 'rgba(190,18,60,.07)' : 'rgba(15,118,110,.07)',
              borderColor: (result.score ?? 100) < 90 ? 'rgba(190,18,60,.2)' : 'rgba(15,118,110,.2)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 18 }}>{(result.score ?? 100) >= 90 ? '✅' : '⚠️'}</span>
              <strong>
                {result.generated ?? result.stats?.filledSlots} / {result.totalExpected ?? result.stats?.totalSlots} slots scheduled
                {result.score != null ? ` — ${result.score}% coverage` : ''}
              </strong>
            </div>

            {/* Score breakdown grid */}
            {result.scoreBreakdown && (
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                gap: 8, margin: '12px 0',
              }}>
                {[
                  { label: 'Fill Rate', value: result.scoreBreakdown.fillRate, icon: '📊' },
                  { label: 'Day Uniqueness', value: result.scoreBreakdown.subjectDayUniqueness, icon: '📅' },
                  { label: 'Week Spread', value: result.scoreBreakdown.subjectWeekSpread, icon: '📆' },
                  { label: 'Core Morning', value: result.scoreBreakdown.coreMorning, icon: '🌅' },
                  { label: 'Evening Priority', value: result.scoreBreakdown.eveningPriority, icon: '🌇' },
                  { label: 'Teacher Balance', value: result.scoreBreakdown.teacherBalance, icon: '⚖️' },
                  { label: 'CT Period 1', value: result.scoreBreakdown.classTeacherP1, icon: '👨‍🏫' },
                  { label: 'Consecutive', value: result.scoreBreakdown.consecutiveCompliance, icon: '🔗' },
                ].map(dim => {
                  const pct = Math.round(dim.value ?? 0);
                  const color = pct >= 90 ? '#16a34a' : pct >= 70 ? '#d97706' : '#dc2626';
                  return (
                    <div key={dim.label} style={{
                      padding: '8px 12px', borderRadius: 10,
                      background: 'var(--surface-bg, #f8f9fc)',
                      border: '1px solid var(--border-color)',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontSize: 11, color: 'var(--gray-500)', fontWeight: 500 }}>
                          {dim.icon} {dim.label}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 700, color }}>{pct}%</span>
                      </div>
                      <div style={{ height: 4, borderRadius: 99, background: 'var(--border-color)', overflow: 'hidden' }}>
                        <div style={{
                          height: '100%', borderRadius: 99, width: `${pct}%`, background: color,
                          transition: 'width 0.5s ease',
                        }} />
                      </div>
                    </div>
                  );
                })}
                <div style={{
                  padding: '8px 12px', borderRadius: 10,
                  background: 'linear-gradient(135deg, var(--primary-50, #eef2ff), var(--primary-100, #e0e7ff))',
                  border: '1px solid var(--primary-200, #c7d2fe)',
                  gridColumn: 'span 2',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--primary-700)' }}>🏆 Overall Quality Score</span>
                  <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--primary-600)' }}>
                    {result.scoreBreakdown.total?.toFixed(1) ?? '—'} / 100
                  </span>
                </div>
              </div>
            )}

            {genProgress?.warnings?.map((w: any, i: number) => (
              <p key={i} className="tt-result-line warning">⚠️ {w.message ?? w}</p>
            ))}
            {genProgress?.errors?.map((e: any, i: number) => (
              <p key={i} className={`tt-result-line ${e.severity === 'critical' ? 'error' : 'warning'}`}>
                {e.severity === 'critical' ? '❌' : '⚠️'} [{e.code}] {e.message}
              </p>
            ))}
          </div>
        )}

        {/* Analysis Issues Panel */}
        {showAnalysis && analysis && (
          <div className="tt-analysis-panel no-print">
            <div className="tt-analysis-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 22 }}>🔍</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--gray-900)' }}>Timetable Analysis</div>
                  <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>
                    {analysis.stats.totalEntries} entries · {analysis.stats.teacherCount} teachers · avg {analysis.stats.avgLoad} periods/week
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div className="tt-analysis-stats">
                  {analysis.stats.errors > 0 && (
                    <span className="tt-stat-chip error">{analysis.stats.errors} Error{analysis.stats.errors !== 1 ? 's' : ''}</span>
                  )}
                  {analysis.stats.warnings > 0 && (
                    <span className="tt-stat-chip warning">{analysis.stats.warnings} Warning{analysis.stats.warnings !== 1 ? 's' : ''}</span>
                  )}
                  {analysis.stats.info > 0 && (
                    <span className="tt-stat-chip info">{analysis.stats.info} Info</span>
                  )}
                  {analysis.issues.length === 0 && (
                    <span className="tt-stat-chip success">✅ No issues found</span>
                  )}
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setShowAnalysis(false)}
                  style={{ padding: '4px 8px', fontSize: 16 }}
                >
                  ✕
                </button>
              </div>
            </div>

            {analysis.issues.length > 0 && (
              <>
                <div className="tt-issue-filters">
                  {(['all', 'error', 'warning', 'info'] as const).map(f => (
                    <button
                      key={f}
                      className={`tt-filter-btn ${issueFilter === f ? 'active' : ''}`}
                      onClick={() => setIssueFilter(f)}
                    >
                      {f === 'all' ? `All (${analysis.issues.length})` :
                        f === 'error' ? `🔴 Errors (${analysis.stats.errors})` :
                          f === 'warning' ? `🟡 Warnings (${analysis.stats.warnings})` :
                            `🔵 Info (${analysis.stats.info})`}
                    </button>
                  ))}
                </div>

                <div className="tt-issues-list">
                  {filteredIssues.map((issue, i) => (
                    <div key={i} className={`tt-issue-item ${issue.type}`}>
                      <div className="tt-issue-icon">
                        {issue.type === 'error' ? '🔴' : issue.type === 'warning' ? '🟡' : '🔵'}
                      </div>
                      <div className="tt-issue-content">
                        <div className="tt-issue-header">
                          <span className="tt-issue-category">{issue.category}</span>
                          <span className="tt-issue-message">{issue.message}</span>
                        </div>
                        {issue.detail && <div className="tt-issue-detail">{issue.detail}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Tab Bar */}
        <div className="tabs no-print">
          <button
            className={`tab ${viewMode === 'weekly' ? 'active' : ''}`}
            onClick={() => setViewMode('weekly')}
            id="tab-weekly"
          >
            📅 Weekly View
          </button>
          <button
            className={`tab ${viewMode === 'daily' ? 'active' : ''}`}
            onClick={() => setViewMode('daily')}
            id="tab-daily"
          >
            📆 Daily View
          </button>
          <button
            className={`tab ${viewMode === 'conditions' ? 'active' : ''}`}
            onClick={() => setViewMode('conditions')}
            id="tab-conditions"
          >
            ⚙️ Conditions
            <span className="tt-badge-count">
              {constraints.filter(c => c.enabled).length}/{constraints.length}
            </span>
          </button>
        </div>

        {/* ── WEEKLY VIEW ─────────────────────────────────────────────── */}
        {viewMode === 'weekly' && (
          <>
            <div className="no-print" style={{ marginBottom: 16 }}>
              <select
                className="form-select"
                style={{ width: 220 }}
                value={selectedDivision}
                onChange={e => setSelectedDivision(e.target.value)}
                id="select-division"
              >
                <option value="">All Divisions</option>
                {allDivisions.map((d: any) => (
                  <option key={d.id} value={d.id}>Class {d.label}</option>
                ))}
              </select>
            </div>

            {entries.length === 0 ? (
              <EmptyState />
            ) : (
              (selectedDivision
                ? [allDivisions.find((d: any) => d.id === selectedDivision)]
                : allDivisions
              ).filter(Boolean).map((div: any) => (
                <div key={div.id} className="card" style={{ marginBottom: 16 }}>
                  <div className="card-header">
                    <h3>Class {div.label}</h3>
                    <span className="badge badge-green">{div.className}</span>
                  </div>
                  <div className="card-body" style={{ padding: '0', overflowX: 'auto' }}>
                    {/* Inverted table: Days as rows, Periods as columns */}
                    <InvertedTimetableGrid
                      div={div}
                      days={days}
                      slots={slots}
                      getEntry={getEntry}
                    />
                  </div>
                </div>
              ))
            )}
          </>
        )}

        {/* ── DAILY VIEW ─────────────────────────────────────────────── */}
        {viewMode === 'daily' && (
          <>
            <div className="no-print" style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {days.map(d => (
                <button
                  key={d}
                  id={`tab-day-${d}`}
                  className={`btn ${selectedDay === d ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setSelectedDay(d)}
                >
                  {getDayName(d)}
                </button>
              ))}
            </div>

            {entries.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="card">
                <div className="card-header">
                  <h3>📆 {getDayName(selectedDay)} — All Divisions</h3>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  {/* Daily view also inverted: Divisions as rows, Periods as columns */}
                  <DailyInvertedGrid
                    divisions={allDivisions}
                    slots={slots}
                    selectedDay={selectedDay}
                    getEntry={getEntry}
                  />
                </div>
              </div>
            )}
          </>
        )}

        {/* ── CONDITIONS TAB ───────────────────────────────────────────── */}
        {viewMode === 'conditions' && (
          <div className="tt-conditions">
            {/* AI Prompt Box */}
            <div className="card tt-ai-card">
              <div className="card-header" style={{ background: 'linear-gradient(135deg, var(--primary-700), var(--primary-600))' }}>
                <h3 style={{ color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>✨</span> AI Constraint Generator
                </h3>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,.7)' }}>Powered by Gemini</span>
              </div>
              <div className="card-body">
                <p style={{ fontSize: 13, color: 'var(--gray-600)', marginBottom: 12 }}>
                  Describe a scheduling rule in plain language and AI will generate the appropriate constraints as checkboxes.
                </p>
                <div className="tt-ai-input-row">
                  <textarea
                    className="form-textarea tt-ai-textarea"
                    value={aiPrompt}
                    onChange={e => setAiPrompt(e.target.value)}
                    placeholder="e.g., 'Mathematics should not be scheduled in the last two periods of any day' or 'The same subject should not appear on two consecutive days'"
                    rows={3}
                    id="ai-constraint-prompt"
                    onKeyDown={e => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleAiConstraint();
                    }}
                  />
                  <button
                    className="btn btn-primary tt-ai-submit"
                    onClick={handleAiConstraint}
                    disabled={aiLoading || !aiPrompt.trim()}
                    id="btn-ai-generate-constraint"
                  >
                    {aiLoading ? (
                      <><span className="spinner-sm" /> Generating...</>
                    ) : (
                      <>✨ Generate</>
                    )}
                  </button>
                </div>
                {aiError && <p className="form-error" style={{ marginTop: 8 }}>{aiError}</p>}
                <p style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 8 }}>
                  Tip: Press Ctrl+Enter to generate. New constraints will appear below.
                </p>
              </div>
            </div>

            {/* Constraints list grouped by category */}
            <div className="tt-constraints-grid">
              {Object.entries(constraintsByCategory).map(([category, catConstraints]) => (
                <div key={category} className="card tt-constraint-group">
                  <div className="tt-constraint-group-header">
                    <span className="tt-cat-icon">{CATEGORY_ICONS[category] ?? '📌'}</span>
                    <span
                      className="tt-cat-label"
                      style={{ color: CATEGORY_COLORS[category] ?? 'var(--gray-700)' }}
                    >
                      {category}
                    </span>
                    <span className="tt-cat-count">
                      {catConstraints.filter(c => c.enabled).length}/{catConstraints.length} active
                    </span>
                  </div>
                  <div className="tt-constraint-list">
                    {catConstraints.map(constraint => (
                      <label key={constraint.id} className="tt-constraint-item">
                        <input
                          type="checkbox"
                          checked={constraint.enabled}
                          onChange={() => toggleConstraint(constraint.id)}
                          id={`constraint-${constraint.id}`}
                        />
                        <span className="tt-constraint-label">{constraint.label}</span>
                        {constraint.source === 'ai' && (
                          <>
                            <span className="tt-ai-badge">AI</span>
                            <button
                              className="tt-remove-btn"
                              onClick={() => removeAiConstraint(constraint.id)}
                              title="Remove AI constraint"
                            >
                              ✕
                            </button>
                          </>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Summary footer */}
            <div className="tt-conditions-footer">
              <div className="tt-conditions-summary">
                <span>✅ <strong>{constraints.filter(c => c.enabled).length}</strong> active constraints</span>
                <span>·</span>
                <span>🔒 <strong>{constraints.filter(c => !c.enabled).length}</strong> disabled</span>
                <span>·</span>
                <span>✨ <strong>{constraints.filter(c => c.source === 'ai').length}</strong> AI-generated</span>
              </div>
              <p style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 6 }}>
                These constraints are informational guides for the generation algorithm. The engine always respects hard rules (no double-booking, no spanning lunch).
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Admin Password Modal for Locking/Generation */}
      {showPasswordModal && (
        <div className="modal-overlay" onClick={() => setShowPasswordModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                {passwordPurpose === 'unlock_and_generate'
                  ? '🔒 Timetable Locked — Verify Password'
                  : '🔓 Unlock Timetable'}
              </h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowPasswordModal(false)}>✕</button>
            </div>
            <form onSubmit={handlePasswordSubmit}>
              <div className="modal-body">
                <p style={{ fontSize: 13, color: 'var(--gray-600)', marginBottom: 16 }}>
                  {passwordPurpose === 'unlock_and_generate'
                    ? 'Regeneration requires administrative authorization. Please enter your account password to unlock the timetable and proceed with generation.'
                    : 'Please enter your account password to unlock the timetable configuration.'}
                </p>
                <div className="form-group">
                  <label className="form-label">Admin Password</label>
                  <input
                    className="form-input"
                    type="password"
                    required
                    placeholder="Enter password..."
                    value={passwordInput}
                    onChange={e => setPasswordInput(e.target.value)}
                    autoFocus
                  />
                  {passwordError && <p className="form-error" style={{ marginTop: 8 }}>{passwordError}</p>}
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowPasswordModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">
                  {passwordPurpose === 'unlock_and_generate' ? 'Unlock & Generate' : 'Unlock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style>{timetableStyles}</style>
    </DashboardLayout>
  );
}

// ─── Inverted Timetable Grid (Weekly View) ────────────────────────────────
// Layout: Rows = Days, Columns = Periods

function InvertedTimetableGrid({ div, days, slots, getEntry }: {
  div: any;
  days: number[];
  slots: number[];
  getEntry: (divId: string, day: number, slot: number) => any;
}) {
  const [isMobile, setIsMobile] = useState(false);
  const [activeDay, setActiveDay] = useState(1);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const morningSlots = slots.filter(s => s <= 4);
  const afternoonSlots = slots.filter(s => s > 4);

  if (isMobile) {
    return (
      <div className="tt-mobile-timeline">
        {/* Day Selector Pills */}
        <div className="tt-mobile-days">
          {days.map(day => (
            <button
              key={day}
              type="button"
              className={`tt-mobile-day-btn ${activeDay === day ? 'active' : ''}`}
              onClick={() => setActiveDay(day)}
            >
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day - 1]}
            </button>
          ))}
        </div>

        {/* Vertical Slots List */}
        <div className="tt-mobile-slots">
          {slots.map(slot => {
            if (slot === 5) {
              return (
                <div key="lunch-break" className="tt-mobile-slot-card lunch">
                  <div className="tt-slot-time">🍴 Break</div>
                  <div className="tt-slot-info">Lunch Break</div>
                </div>
              );
            }

            const entry = getEntry(div.id, activeDay, slot);

            return (
              <div key={slot} className={`tt-mobile-slot-card ${entry ? 'filled' : 'empty'}`}>
                <div className="tt-slot-time">Period {slot}</div>
                <div className="tt-slot-info">
                  {entry ? (
                    <>
                      <div className="tt-slot-subject">{entry.subject?.name} ({entry.subject?.code})</div>
                      <div className="tt-slot-teacher">
                        👩‍🏫 {entry.teacher?.user?.name || entry.teacher?.teacherCode}
                      </div>
                    </>
                  ) : (
                    <div className="tt-slot-empty">Free Period</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="tt-inverted-wrapper">
      <table className="tt-inverted-table">
        <thead>
          <tr>
            <th className="tt-corner-cell">Day \ Period</th>
            {morningSlots.map(slot => (
              <th key={slot} className="tt-period-header tt-morning">
                <div className="tt-period-num">P{slot}</div>
                <div className="tt-period-label">Period {slot}</div>
              </th>
            ))}
            <th className="tt-lunch-header">🍴</th>
            {afternoonSlots.map(slot => (
              <th key={slot} className="tt-period-header tt-afternoon">
                <div className="tt-period-num">P{slot}</div>
                <div className="tt-period-label">Period {slot}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map(day => (
            <tr key={day} className="tt-day-row">
              <td className="tt-day-header">
                <div className="tt-day-name">{getDayName(day)}</div>
                <div className="tt-day-short">{['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day]}</div>
              </td>
              {morningSlots.map(slot => {
                const entry = getEntry(div.id, day, slot);
                return (
                  <td key={slot} className={`tt-entry-cell ${entry ? 'filled' : 'empty'}`}>
                    {entry ? (
                      <div className="tt-entry-content">
                        <span className="tt-subject">{entry.subject?.code || entry.subject?.name}</span>
                        <span className="tt-teacher">{entry.teacher?.teacherCode}</span>
                      </div>
                    ) : (
                      <span className="tt-empty-mark">—</span>
                    )}
                  </td>
                );
              })}
              <td className="tt-lunch-cell">
                <span>Lunch</span>
              </td>
              {afternoonSlots.map(slot => {
                const entry = getEntry(div.id, day, slot);
                return (
                  <td key={slot} className={`tt-entry-cell tt-pm ${entry ? 'filled' : 'empty'}`}>
                    {entry ? (
                      <div className="tt-entry-content">
                        <span className="tt-subject">{entry.subject?.code || entry.subject?.name}</span>
                        <span className="tt-teacher">{entry.teacher?.teacherCode}</span>
                      </div>
                    ) : (
                      <span className="tt-empty-mark">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Daily Inverted Grid ─────────────────────────────────────────────────
// Layout: Rows = Divisions, Columns = Periods

function DailyInvertedGrid({ divisions, slots, selectedDay, getEntry }: {
  divisions: any[];
  slots: number[];
  selectedDay: number;
  getEntry: (divId: string, day: number, slot: number) => any;
}) {
  const [isMobile, setIsMobile] = useState(false);
  const [activeDivision, setActiveDivision] = useState(divisions[0]?.id || '');

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (divisions.length > 0 && !activeDivision) {
      setActiveDivision(divisions[0].id);
    }
  }, [divisions]);

  const morningSlots = slots.filter(s => s <= 4);
  const afternoonSlots = slots.filter(s => s > 4);

  if (isMobile) {
    const selectedDiv = divisions.find(d => d.id === activeDivision);
    return (
      <div className="tt-mobile-timeline" style={{ padding: 12 }}>
        {/* Division Selector */}
        <div className="form-group" style={{ marginBottom: 16 }}>
          <label className="form-label">Select Division</label>
          <select
            className="form-select"
            value={activeDivision}
            onChange={e => setActiveDivision(e.target.value)}
          >
            {divisions.map(d => (
              <option key={d.id} value={d.id}>Class {d.label}</option>
            ))}
          </select>
        </div>

        {selectedDiv && (
          <div className="tt-mobile-slots">
            {slots.map(slot => {
              if (slot === 5) {
                return (
                  <div key="lunch-break" className="tt-mobile-slot-card lunch">
                    <div className="tt-slot-time">🍴 Break</div>
                    <div className="tt-slot-info">Lunch Break</div>
                  </div>
                );
              }

              const entry = getEntry(selectedDiv.id, selectedDay, slot);

              return (
                <div key={slot} className={`tt-mobile-slot-card ${entry ? 'filled' : 'empty'}`}>
                  <div className="tt-slot-time">Period {slot}</div>
                  <div className="tt-slot-info">
                    {entry ? (
                      <>
                        <div className="tt-slot-subject">{entry.subject?.name} ({entry.subject?.code})</div>
                        <div className="tt-slot-teacher">
                          👩‍🏫 {entry.teacher?.user?.name || entry.teacher?.teacherCode}
                        </div>
                      </>
                    ) : (
                      <div className="tt-slot-empty">Free Period</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="tt-inverted-wrapper">
      <table className="tt-inverted-table">
        <thead>
          <tr>
            <th className="tt-corner-cell">Division \ Period</th>
            {morningSlots.map(slot => (
              <th key={slot} className="tt-period-header tt-morning">
                <div className="tt-period-num">P{slot}</div>
                <div className="tt-period-label">Period {slot}</div>
              </th>
            ))}
            <th className="tt-lunch-header">🍴</th>
            {afternoonSlots.map(slot => (
              <th key={slot} className="tt-period-header tt-afternoon">
                <div className="tt-period-num">P{slot}</div>
                <div className="tt-period-label">Period {slot}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {divisions.map((div: any) => (
            <tr key={div.id} className="tt-day-row">
              <td className="tt-day-header">
                <div className="tt-day-name">Class {div.label}</div>
                <div className="tt-day-short">{div.className}</div>
              </td>
              {morningSlots.map(slot => {
                const entry = getEntry(div.id, selectedDay, slot);
                return (
                  <td key={slot} className={`tt-entry-cell ${entry ? 'filled' : 'empty'}`}>
                    {entry ? (
                      <div className="tt-entry-content">
                        <span className="tt-subject">{entry.subject?.code || entry.subject?.name}</span>
                        <span className="tt-teacher">{entry.teacher?.teacherCode}</span>
                      </div>
                    ) : (
                      <span className="tt-empty-mark">—</span>
                    )}
                  </td>
                );
              })}
              <td className="tt-lunch-cell">
                <span>Lunch</span>
              </td>
              {afternoonSlots.map(slot => {
                const entry = getEntry(div.id, selectedDay, slot);
                return (
                  <td key={slot} className={`tt-entry-cell tt-pm ${entry ? 'filled' : 'empty'}`}>
                    {entry ? (
                      <div className="tt-entry-content">
                        <span className="tt-subject">{entry.subject?.code || entry.subject?.name}</span>
                        <span className="tt-teacher">{entry.teacher?.teacherCode}</span>
                      </div>
                    ) : (
                      <span className="tt-empty-mark">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Empty State ─────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="card">
      <div className="empty-state">
        <div className="empty-state-icon">📅</div>
        <h3>No Timetable Generated</h3>
        <p>Set up classes, subjects, and teachers first, then click Generate Timetable</p>
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────

const timetableStyles = `
/* ── Result Banner ── */
.tt-result-banner {
  border: 1px solid;
  border-radius: var(--radius-md);
  padding: 14px 18px;
  margin-bottom: 16px;
  font-size: 13px;
}
.tt-result-line { font-size: 12px; margin-top: 4px; }
.tt-result-line.warning { color: var(--warning); }
.tt-result-line.error { color: var(--danger); }

/* ── Tab badge ── */
.tt-badge-count {
  display: inline-flex; align-items: center;
  background: var(--primary-100); color: var(--primary-700);
  border-radius: 999px; font-size: 10px; font-weight: 700;
  padding: 1px 7px; margin-left: 6px;
}

/* ── Analysis Panel ── */
.tt-analysis-panel {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  margin-bottom: 20px;
  overflow: hidden;
  box-shadow: var(--shadow-md);
}
.tt-analysis-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px;
  background: var(--gray-50);
  border-bottom: 1px solid var(--border-color);
  flex-wrap: wrap; gap: 10px;
}
.tt-analysis-stats { display: flex; gap: 6px; flex-wrap: wrap; }
.tt-stat-chip {
  display: inline-flex; align-items: center;
  padding: 4px 12px; border-radius: 999px;
  font-size: 12px; font-weight: 600;
}
.tt-stat-chip.error { background: #fef2f2; color: var(--danger); border: 1px solid rgba(190,18,60,.2); }
.tt-stat-chip.warning { background: #fffbeb; color: var(--warning); border: 1px solid rgba(217,119,6,.2); }
.tt-stat-chip.info { background: #eff6ff; color: var(--info); border: 1px solid rgba(3,105,161,.2); }
.tt-stat-chip.success { background: var(--primary-50); color: var(--primary-700); border: 1px solid rgba(15,118,110,.2); }

.tt-issue-filters {
  display: flex; gap: 0;
  padding: 0 20px;
  border-bottom: 1px solid var(--border-color);
  overflow-x: auto;
}
.tt-filter-btn {
  padding: 10px 16px; font-size: 12px; font-weight: 600;
  color: var(--gray-500); border: none; background: none;
  border-bottom: 2px solid transparent; margin-bottom: -1px;
  cursor: pointer; white-space: nowrap; transition: all var(--transition);
}
.tt-filter-btn:hover { color: var(--gray-700); }
.tt-filter-btn.active { color: var(--primary-600); border-bottom-color: var(--primary-600); }

.tt-issues-list { padding: 12px 20px; display: flex; flex-direction: column; gap: 6px; max-height: 360px; overflow-y: auto; }
.tt-issue-item {
  display: flex; gap: 10px; align-items: flex-start;
  padding: 10px 12px; border-radius: var(--radius-sm);
  font-size: 13px;
}
.tt-issue-item.error { background: #fef2f2; }
.tt-issue-item.warning { background: #fffbeb; }
.tt-issue-item.info { background: #eff6ff; }
.tt-issue-icon { font-size: 14px; flex-shrink: 0; margin-top: 1px; }
.tt-issue-content { flex: 1; min-width: 0; }
.tt-issue-header { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.tt-issue-category {
  font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .5px; color: var(--gray-500);
  background: rgba(0,0,0,.05); padding: 1px 6px; border-radius: 999px;
  flex-shrink: 0;
}
.tt-issue-message { font-weight: 600; color: var(--gray-800); }
.tt-issue-detail { font-size: 12px; color: var(--gray-500); margin-top: 2px; }

/* ── Inverted Table ── */
.tt-inverted-wrapper { overflow-x: auto; }

.tt-inverted-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
  min-width: 640px;
}

.tt-corner-cell {
  background: var(--primary-700);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .5px;
  padding: 12px 16px;
  text-align: left;
  min-width: 110px;
  border-right: 1px solid rgba(255,255,255,.2);
}

.tt-period-header {
  text-align: center;
  padding: 8px 4px;
  font-weight: 700;
  border-bottom: 2px solid var(--border-color);
  min-width: 90px;
}
.tt-period-header.tt-morning {
  background: var(--primary-600);
  color: #fff;
  border-right: 1px solid rgba(255,255,255,.15);
}
.tt-period-header.tt-afternoon {
  background: var(--primary-500);
  color: #fff;
  border-right: 1px solid rgba(255,255,255,.15);
}
.tt-period-num { font-size: 14px; font-weight: 800; }
.tt-period-label { font-size: 9px; opacity: .8; text-transform: uppercase; letter-spacing: .5px; }

.tt-lunch-header {
  background: var(--accent-100);
  color: var(--accent-600);
  text-align: center;
  font-size: 16px;
  padding: 8px 6px;
  min-width: 50px;
  border-right: 2px solid var(--accent-300);
  border-left: 2px solid var(--accent-300);
}

.tt-day-row:hover .tt-entry-cell { background: var(--gray-50); }
.tt-day-row:hover .tt-entry-cell.tt-pm { background: #faf5ff; }

.tt-day-header {
  background: var(--gray-100);
  padding: 10px 16px;
  font-weight: 700;
  border-right: 2px solid var(--border-color);
  border-bottom: 1px solid var(--border-color);
  vertical-align: middle;
}
.tt-day-name { font-size: 13px; font-weight: 700; color: var(--gray-800); }
.tt-day-short { font-size: 10px; color: var(--gray-400); text-transform: uppercase; letter-spacing: .5px; }

.tt-entry-cell {
  padding: 8px 10px;
  border-right: 1px solid var(--border-color);
  border-bottom: 1px solid var(--border-color);
  text-align: center;
  vertical-align: middle;
  transition: background var(--transition);
}
.tt-entry-cell.tt-pm {
  background: rgba(124,58,237,.02);
}

.tt-entry-content {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
}
.tt-subject {
  font-weight: 700; color: var(--gray-800); font-size: 12px;
}
.tt-teacher {
  font-size: 10px; color: var(--gray-500);
  background: var(--gray-100); padding: 1px 5px; border-radius: 3px;
}
.tt-empty-mark { color: var(--gray-300); font-size: 16px; }

.tt-lunch-cell {
  background: var(--accent-50);
  color: var(--accent-600);
  text-align: center;
  font-size: 10px;
  font-weight: 700;
  border-right: 2px solid var(--accent-200);
  border-left: 2px solid var(--accent-200);
  border-bottom: 1px solid var(--border-color);
  writing-mode: vertical-rl;
  padding: 6px 4px;
}

/* ── Conditions Tab ── */
.tt-conditions { display: flex; flex-direction: column; gap: 20px; }

.tt-ai-card .card-header {
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
}

.tt-ai-input-row {
  display: flex; gap: 12px; align-items: flex-end;
}
.tt-ai-textarea {
  flex: 1; min-height: 80px; resize: none;
  font-size: 13px;
}
.tt-ai-submit {
  flex-shrink: 0; height: fit-content; align-self: flex-end;
  padding: 12px 20px; white-space: nowrap;
}

.spinner-sm {
  display: inline-block; width: 12px; height: 12px;
  border: 2px solid rgba(255,255,255,.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin .6s linear infinite;
  margin-right: 6px;
}

.tt-constraints-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 16px;
}

.tt-constraint-group {
  overflow: visible !important;
}

.tt-constraint-group-header {
  display: flex; align-items: center; gap: 8px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border-color);
  background: var(--gray-50);
}
.tt-cat-icon { font-size: 18px; }
.tt-cat-label { font-weight: 700; font-size: 13px; flex: 1; }
.tt-cat-count { font-size: 11px; color: var(--gray-400); font-weight: 600; }

.tt-constraint-list { padding: 8px 0; }

.tt-constraint-item {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 9px 18px;
  cursor: pointer;
  transition: background var(--transition);
  border-bottom: 1px solid var(--border-color);
}
.tt-constraint-item:last-child { border-bottom: none; }
.tt-constraint-item:hover { background: var(--gray-50); }

.tt-constraint-item input[type="checkbox"] {
  width: 16px; height: 16px;
  accent-color: var(--primary-500);
  flex-shrink: 0; margin-top: 2px; cursor: pointer;
}

.tt-constraint-label {
  flex: 1; font-size: 13px; color: var(--gray-700); line-height: 1.5;
  user-select: none;
}

.tt-ai-badge {
  display: inline-flex; align-items: center;
  background: linear-gradient(135deg, var(--accent-500), var(--accent-600));
  color: #fff; font-size: 9px; font-weight: 700;
  padding: 1px 6px; border-radius: 999px;
  flex-shrink: 0; letter-spacing: .5px;
}

.tt-remove-btn {
  background: none; border: none;
  color: var(--gray-400); font-size: 12px;
  cursor: pointer; flex-shrink: 0; padding: 0 4px;
  line-height: 1; transition: color var(--transition);
}
.tt-remove-btn:hover { color: var(--danger); }

.tt-conditions-footer {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 14px 20px;
  text-align: center;
}
.tt-conditions-summary {
  display: flex; gap: 10px; justify-content: center;
  font-size: 13px; color: var(--gray-600); flex-wrap: wrap;
}

/* ── Print ── */
@media print {
  .tt-analysis-panel, .tt-conditions, .tabs,
  .tt-result-banner, .no-print { display: none !important; }
  .tt-inverted-table { font-size: 10px; }
  .tt-period-header.tt-morning { background: #2d6a4f !important; -webkit-print-color-adjust: exact; }
  .tt-period-header.tt-afternoon { background: #1e5c42 !important; -webkit-print-color-adjust: exact; }
}
`;
