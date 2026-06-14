'use client';

import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { getDayName } from '@/lib/utils';

// ─── Types ─────────────────────────────────────────────────────────────────

type ViewMode = 'weekly' | 'daily' | 'conditions' | 'report' | 'teacher';

interface Constraint {
  id: string;
  label: string;
  category: string;
  enabled: boolean;
  source: 'builtin' | 'ai';
}

interface PEGroup {
  id: string;         // local uuid
  subjectId: string;
  subjectName: string;
  divisionIds: string[];
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
  const [checkedDivisions, setCheckedDivisions] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<any>(null);
  const [genProgress, setGenProgress] = useState<GenProgress | null>(null);

  // Variant teacher map: subjectId → teacherCode (for SAN/ARA parallel display)
  const [variantTeacherMap, setVariantTeacherMap] = useState<Record<string, string>>({});

  // Constraints state
  const [constraints, setConstraints] = useState<Constraint[]>(BUILTIN_CONSTRAINTS);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  // Analysis state
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [issueFilter, setIssueFilter] = useState<'all' | 'error' | 'warning' | 'info'>('all');
  const [showAnalysis, setShowAnalysis] = useState(false);

  // Report state
  const [report, setReport] = useState<any | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const [reportDivFilter, setReportDivFilter] = useState('');
  const [reportExpandedDiv, setReportExpandedDiv] = useState<string | null>(null);
  const [reportTab, setReportTab] = useState<'overview' | 'divisions' | 'subjects' | 'teachers'>('overview');

  // Locking states
  const [locked, setLocked] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordPurpose, setPasswordPurpose] = useState<'unlock_only' | 'unlock_and_generate'>('unlock_only');

  // PE Group state
  const [peGroups, setPeGroups] = useState<PEGroup[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [showPeGroupForm, setShowPeGroupForm] = useState(false);
  const [peFormSubjectId, setPeFormSubjectId] = useState('');
  const [peFormDivIds, setPeFormDivIds] = useState<Record<string, boolean>>({});

  // Teacher View state
  const [teachers, setTeachers] = useState<any[]>([]);
  const [checkedTeachers, setCheckedTeachers] = useState<Record<string, boolean>>({});

  // Edit Mode states
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedCell, setSelectedCell] = useState<{
    divId: string;
    day: number;
    slot: number;
    entry: any; // the timetable entry itself
  } | null>(null);
  const [isSwapping, setIsSwapping] = useState(false); // true when waiting for second cell selection
  const [editSubjectId, setEditSubjectId] = useState('');
  const [editTeacherId, setEditTeacherId] = useState('');
  const [editConflicts, setEditConflicts] = useState<any[]>([]);
  const [editValidating, setEditValidating] = useState(false);
  const [editSaving, setEditSaving] = useState(false);

  async function validateEdit(subjectId: string, teacherId: string) {
    if (!selectedCell) return;
    setEditValidating(true);
    setEditConflicts([]);
    try {
      const payload: any = {
        action: 'validate',
        entries: [
          {
            id: selectedCell.entry?.id || undefined, // undefined for CREATE
            divisionId: selectedCell.divId,
            dayOfWeek: selectedCell.day,
            slotNumber: selectedCell.slot,
            subjectId: subjectId || null,
            teacherId: teacherId || null,
          }
        ]
      };
      const res = await fetch('/api/timetable/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success && data.results) {
        setEditConflicts(data.results[0]?.conflicts || []);
      }
    } catch (err) {
      console.error('Validation error:', err);
    }
    setEditValidating(false);
  }

  async function saveEdit() {
    if (!selectedCell) return;
    setEditSaving(true);
    try {
      const payload: any = {
        action: 'apply',
        entries: [
          {
            id: selectedCell.entry?.id || undefined, // undefined for CREATE
            divisionId: selectedCell.divId,
            dayOfWeek: selectedCell.day,
            slotNumber: selectedCell.slot,
            subjectId: editSubjectId || null,
            teacherId: editTeacherId || null,
          }
        ]
      };
      const res = await fetch('/api/timetable/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        // If there were locked conflicts, it won't apply
        const divisionLocked = data.results?.some((r: any) => r.conflicts.some((c: any) => c.type === 'division_locked'));
        if (divisionLocked) {
          alert('Failed: Division is locked.');
        } else {
          await fetchAll();
          setSelectedCell(null);
        }
      } else {
        alert(data.error || 'Failed to save changes.');
      }
    } catch (err) {
      console.error('Error saving edit:', err);
      alert('Network error saving changes.');
    }
    setEditSaving(false);
  }

  async function performSwap(day2: number, slot2: number) {
    if (!selectedCell) return;
    const entry2 = getEntry(selectedCell.divId, day2, slot2);
    if (!selectedCell.entry || !entry2) {
      alert('Both slots must contain entries to perform a swap.');
      setIsSwapping(false);
      setSelectedCell(null);
      return;
    }
    
    setEditSaving(true);
    try {
      const res = await fetch('/api/timetable/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'swap',
          entryId1: selectedCell.entry.id,
          entryId2: entry2.id,
        })
      });
      const data = await res.json();
      if (data.success) {
        await fetchAll();
      } else {
        if (data.conflicts && data.conflicts.length > 0) {
          const conflictMsgs = data.conflicts.map((c: any) => c.message).join('\n');
          alert(`Could not swap slots due to conflicts:\n${conflictMsgs}`);
        } else {
          alert(data.error || 'Failed to swap slots.');
        }
      }
    } catch (err) {
      console.error('Error swapping:', err);
      alert('Network error swapping slots.');
    }
    setIsSwapping(false);
    setSelectedCell(null);
    setEditSaving(false);
  }

  useEffect(() => { fetchAll(); }, []);

  // Automatically check all divisions by default once classes load
  useEffect(() => {
    if (classes.length > 0) {
      const initialChecked: Record<string, boolean> = {};
      classes.forEach((c: any) => {
        c.divisions?.forEach((d: any) => {
          initialChecked[d.id] = true;
        });
      });
      setCheckedDivisions(initialChecked);
    }
  }, [classes]);

  async function fetchAll() {
    setLoading(true);
    const [tRes, cRes, lRes, tchRes, subRes] = await Promise.all([
      fetch('/api/timetable').then(r => r.json()),
      fetch('/api/classes').then(r => r.json()),
      fetch('/api/timetable/lock').then(r => r.json()).catch(() => ({ success: false, locked: false })),
      fetch('/api/teachers').then(r => r.json()),
      fetch('/api/subjects').then(r => r.json()).catch(() => ({ success: false, data: [] })),
    ]);
    if (tRes.success) setEntries(tRes.data);
    if (cRes.success) setClasses(cRes.data);
    if (lRes.success) setLocked(lRes.locked);
    if (subRes.success && Array.isArray(subRes.data)) setSubjects(subRes.data);

    // Build variant teacher map and teacher list
    if (tchRes.success && Array.isArray(tchRes.data)) {
      setTeachers(tchRes.data);
      // Auto-check all teachers
      const allChecked: Record<string, boolean> = {};
      tchRes.data.forEach((t: any) => { allChecked[t.id] = true; });
      setCheckedTeachers(allChecked);

      const map: Record<string, string> = {};
      for (const t of tchRes.data) {
        for (const sm of (t.subjectMappings || [])) {
          if (!map[sm.subjectId]) map[sm.subjectId] = t.teacherCode;
        }
      }
      setVariantTeacherMap(map);
    }
    
    // Build default PE groups if not configured
    if (subRes.success && Array.isArray(subRes.data) && cRes.success && Array.isArray(cRes.data)) {
      const peSub = subRes.data.find((s: any) => 
        s.code === 'PE' || s.code === 'PET' || s.name.toLowerCase().includes('physical education')
      );
      if (peSub) {
        const allDivs = cRes.data.flatMap((c: any) => 
          c.divisions?.map((d: any) => ({ ...d, className: c.name, label: `${c.name}${d.name}` })) || []
        );
        
        const div5A = allDivs.find((d: any) => d.label === '5A');
        const div5B = allDivs.find((d: any) => d.label === '5B');
        const div6A = allDivs.find((d: any) => d.label === '6A');
        const div6B = allDivs.find((d: any) => d.label === '6B');
        
        const defaults: PEGroup[] = [];
        if (div5A && div5B) {
          defaults.push({
            id: 'default-5-pe',
            subjectId: peSub.id,
            subjectName: `${peSub.name} (${peSub.code})`,
            divisionIds: [div5A.id, div5B.id],
          });
        }
        if (div6A && div6B) {
          defaults.push({
            id: 'default-6-pe',
            subjectId: peSub.id,
            subjectName: `${peSub.name} (${peSub.code})`,
            divisionIds: [div6A.id, div6B.id],
          });
        }
        setPeGroups(defaults);
      }
    }

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
        body: JSON.stringify({
          constraints: activeConstraints,
          password,
          peGroups: peGroups.map(g => ({ subjectId: g.subjectId, divisionIds: g.divisionIds })),
        }),
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
    return entries.find((e: any) => e.divisionId === divId && e.dayOfWeek === day && e.slotNumber === slot && !e.subject?.isLanguageVariant)
      || entries.find((e: any) => e.divisionId === divId && e.dayOfWeek === day && e.slotNumber === slot);
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

  const lockedDivsCount = allDivisions.filter((d: any) => d.timetableLocked).length;
  const unlockedDivsCount = allDivisions.length - lockedDivsCount;

  return (
    <DashboardLayout>
      <div className="page-header">
        <div>
          <h2>Timetable</h2>
          <p>Generate, view and manage weekly timetables</p>
          {lockedDivsCount > 0 && (
            <p style={{ margin: '4px 0 0 0', fontSize: '12.5px', color: '#dc2626', fontWeight: 600 }}>
              🔒 {lockedDivsCount} division(s) locked ({allDivisions.filter((d: any) => d.timetableLocked).map((d: any) => d.label).join(', ')}). Only the other {unlockedDivsCount} division(s) will be regenerated.
            </p>
          )}
        </div>
        <div className="page-header-actions">
          {entries.length > 0 && (
            <button
              className="btn btn-secondary"
              onClick={runAnalysis}
              disabled={analyzing}
              id="btn-analyze-timetable"
            >
              {analyzing ? '⏳' : '🔍'} Analyze
            </button>
          )}
          {entries.length > 0 && !locked && (
            <button
              className={`btn ${isEditMode ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => {
                setIsEditMode(!isEditMode);
                setSelectedCell(null);
                setIsSwapping(false);
              }}
              id="btn-edit-mode"
            >
              {isEditMode ? '✍️ Editing Mode' : '✏️ Edit Mode'}
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
            {generating ? '⏳ Generating...' : (lockedDivsCount > 0 ? '🔄 Regenerate Unlocked' : '🔄 Generate')}
          </button>
          <button className="btn btn-secondary" onClick={() => window.print()} id="btn-print-timetable">
            🖨️ Print
          </button>
        </div>
      </div>

      <div className="page-body">

        {/* ─── Generation Progress Overlay ─────────────────────────────── */}
        {generating && genProgress && (
          <div className="tt-progress-overlay">
            <div className="tt-progress-modal">
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
              <div className="tt-score-grid">
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
          <button
            className={`tab ${viewMode === 'report' ? 'active' : ''}`}
            onClick={async () => {
              setViewMode('report');
              if (!report && !reportLoading) {
                setReportLoading(true);
                setReportError('');
                try {
                  const res = await fetch('/api/timetable/report');
                  const data = await res.json();
                  if (data.success) setReport(data.data);
                  else setReportError(data.error || 'Failed to load report');
                } catch { setReportError('Network error'); }
                setReportLoading(false);
              }
            }}
            id="tab-report"
          >
            📊 Report
          </button>
          <button
            className={`tab ${viewMode === 'teacher' ? 'active' : ''}`}
            onClick={() => setViewMode('teacher')}
            id="tab-teacher-view"
          >
            👩‍🏫 Teacher View
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

            {/* Checkbox Selector for Selective Division Printing */}
            {selectedDivision === '' && allDivisions.length > 0 && (
              <div className="no-print" style={{ 
                marginBottom: 20, 
                background: 'var(--bg-card, #ffffff)', 
                padding: '16px', 
                borderRadius: 'var(--radius-lg, 12px)', 
                border: '1px solid var(--border-color, #e2e8f0)',
                boxShadow: 'var(--shadow-sm, 0 1px 2px 0 rgba(0, 0, 0, 0.05))'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span style={{ fontWeight: 600, fontSize: '13.5px', color: 'var(--text-primary)' }}>
                    🖨️ Select Divisions to Print / View:
                  </span>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button 
                      type="button" 
                      className="btn btn-ghost btn-sm" 
                      style={{ fontSize: '11px', padding: '2px 8px' }}
                      onClick={() => {
                        const allChecked: Record<string, boolean> = {};
                        allDivisions.forEach((d: any) => { allChecked[d.id] = true; });
                        setCheckedDivisions(allChecked);
                      }}
                    >
                      Select All
                    </button>
                    <button 
                      type="button" 
                      className="btn btn-ghost btn-sm" 
                      style={{ fontSize: '11px', padding: '2px 8px' }}
                      onClick={() => {
                        setCheckedDivisions({});
                      }}
                    >
                      Clear All
                    </button>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px 16px', flexWrap: 'wrap' }}>
                  {allDivisions.map((d: any) => {
                    const isChecked = checkedDivisions[d.id] !== false;
                    return (
                      <label 
                        key={d.id} 
                        style={{ 
                          display: 'inline-flex', 
                          alignItems: 'center', 
                          gap: 8, 
                          fontSize: '13px', 
                          fontWeight: 500,
                          cursor: 'pointer', 
                          userSelect: 'none',
                          padding: '6px 12px',
                          borderRadius: '6px',
                          background: isChecked ? 'var(--primary-50, #f0fdf4)' : 'var(--gray-50, #f8fafc)',
                          border: `1px solid ${isChecked ? 'var(--primary-200, #bbf7d0)' : 'var(--border-color, #e2e8f0)'}`,
                          color: isChecked ? 'var(--primary-700, #15803d)' : 'var(--gray-600, #475569)',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          style={{ cursor: 'pointer', accentColor: 'var(--primary-color)' }}
                          onChange={(e) => {
                            setCheckedDivisions(prev => ({
                              ...prev,
                              [d.id]: e.target.checked
                            }));
                          }}
                        />
                        Class {d.label}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Division Locks Control Box */}
            {selectedDivision === '' && allDivisions.length > 0 && (
              <div className="no-print" style={{ 
                marginBottom: 20, 
                background: 'var(--bg-card, #ffffff)', 
                padding: '16px', 
                borderRadius: 'var(--radius-lg, 12px)', 
                border: '1px solid var(--border-color, #e2e8f0)',
                boxShadow: 'var(--shadow-sm, 0 1px 2px 0 rgba(0, 0, 0, 0.05))'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span style={{ fontWeight: 600, fontSize: '13.5px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>🔒</span> Division Timetable Locks (Regeneration Protection):
                  </span>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button 
                      type="button" 
                      className="btn btn-ghost btn-sm" 
                      style={{ fontSize: '11px', padding: '2px 8px' }}
                      onClick={async () => {
                        const updates = allDivisions.map((d: any) => ({ divisionId: d.id, locked: true }));
                        setClasses(prev => prev.map(c => ({
                          ...c,
                          divisions: c.divisions.map((d: any) => ({ ...d, timetableLocked: true }))
                        })));
                        await fetch('/api/timetable/division-lock', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ divisions: updates })
                        });
                      }}
                    >
                      Lock All
                    </button>
                    <button 
                      type="button" 
                      className="btn btn-ghost btn-sm" 
                      style={{ fontSize: '11px', padding: '2px 8px' }}
                      onClick={async () => {
                        const updates = allDivisions.map((d: any) => ({ divisionId: d.id, locked: false }));
                        setClasses(prev => prev.map(c => ({
                          ...c,
                          divisions: c.divisions.map((d: any) => ({ ...d, timetableLocked: false }))
                        })));
                        await fetch('/api/timetable/division-lock', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ divisions: updates })
                        });
                      }}
                    >
                      Unlock All
                    </button>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px 16px', flexWrap: 'wrap' }}>
                  {allDivisions.map((d: any) => {
                    const isLocked = !!d.timetableLocked;
                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={async () => {
                          const newStatus = !isLocked;
                          setClasses(prev => prev.map(c => ({
                            ...c,
                            divisions: c.divisions.map((div: any) => div.id === d.id ? { ...div, timetableLocked: newStatus } : div)
                          })));
                          
                          await fetch('/api/timetable/division-lock', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              divisions: [{ divisionId: d.id, locked: newStatus }]
                            })
                          });
                        }}
                        style={{ 
                          display: 'inline-flex', 
                          alignItems: 'center', 
                          gap: 8, 
                          fontSize: '13px', 
                          fontWeight: 500,
                          cursor: 'pointer', 
                          userSelect: 'none',
                          padding: '6px 12px',
                          borderRadius: '6px',
                          background: isLocked ? '#fef2f2' : 'var(--gray-50, #f8fafc)',
                          border: `1px solid ${isLocked ? '#fca5a5' : 'var(--border-color, #e2e8f0)'}`,
                          color: isLocked ? '#dc2626' : 'var(--gray-600, #475569)',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <span>{isLocked ? '🔒' : '🔓'}</span>
                        Class {d.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {entries.length === 0 ? (
              <EmptyState />
            ) : (
              (selectedDivision
                ? [allDivisions.find((d: any) => d.id === selectedDivision)]
                : allDivisions
              ).filter(Boolean)
               .filter((div: any) => selectedDivision !== '' || checkedDivisions[div.id] !== false)
               .map((div: any) => (
                 <div 
                   key={div.id} 
                   className="card tt-print-card" 
                   style={{ 
                     marginBottom: 16,
                     borderLeft: div.timetableLocked ? '4px solid #ef4444' : undefined,
                     opacity: div.timetableLocked ? 0.98 : 1
                   }}
                 >
                   <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                     <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                       <h3>Class {div.label}</h3>
                       <span className="badge badge-green">{div.className}</span>
                       {div.timetableLocked && (
                         <span 
                           style={{ 
                             fontSize: '11px', 
                             background: '#fef2f2', 
                             color: '#dc2626', 
                             padding: '2px 8px', 
                             borderRadius: '4px', 
                             fontWeight: 600,
                             border: '1px solid #fca5a5',
                             display: 'inline-flex',
                             alignItems: 'center',
                             gap: 4
                           }}
                         >
                           🔒 Protected from Regeneration
                         </span>
                       )}
                     </div>
                     <button
                       type="button"
                       className="btn btn-ghost btn-sm no-print"
                       style={{ fontSize: '12px', padding: '4px 8px', color: div.timetableLocked ? '#dc2626' : 'var(--gray-500)' }}
                       onClick={async () => {
                         const newStatus = !div.timetableLocked;
                         setClasses(prev => prev.map(c => ({
                           ...c,
                           divisions: c.divisions.map((d: any) => d.id === div.id ? { ...d, timetableLocked: newStatus } : d)
                         })));
                         await fetch('/api/timetable/division-lock', {
                           method: 'POST',
                           headers: { 'Content-Type': 'application/json' },
                           body: JSON.stringify({
                             divisions: [{ divisionId: div.id, locked: newStatus }]
                           })
                         });
                       }}
                     >
                       {div.timetableLocked ? '🔓 Unlock Class' : '🔒 Lock Class'}
                     </button>
                   </div>
                   <div className="card-body" style={{ padding: '0', overflowX: 'auto' }}>
                     {/* Inverted table: Days as rows, Periods as columns */}
                     <InvertedTimetableGrid
                       div={div}
                       days={days}
                       slots={slots}
                       getEntry={getEntry}
                       entries={entries}
                       isEditMode={isEditMode}
                       selectedCell={selectedCell}
                       isSwapping={isSwapping}
                       onCellClick={(divId, day, slot, entry) => {
                         setSelectedCell({ divId, day, slot, entry });
                         setEditSubjectId(entry?.subjectId || '');
                         setEditTeacherId(entry?.teacherId || '');
                         setEditConflicts([]);
                       }}
                       performSwap={performSwap}
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

            {/* Checkbox Selector for Selective Division Printing */}
            {allDivisions.length > 0 && (
              <div className="no-print" style={{ 
                marginBottom: 20, 
                background: 'var(--bg-card, #ffffff)', 
                padding: '16px', 
                borderRadius: 'var(--radius-lg, 12px)', 
                border: '1px solid var(--border-color, #e2e8f0)',
                boxShadow: 'var(--shadow-sm, 0 1px 2px 0 rgba(0, 0, 0, 0.05))'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span style={{ fontWeight: 600, fontSize: '13.5px', color: 'var(--text-primary)' }}>
                    🖨️ Select Divisions to Print / View:
                  </span>
                  <div style={{ display: 'flex', gap: 10, marginLeft: 'auto' }}>
                    <button 
                      type="button" 
                      className="btn btn-ghost btn-sm" 
                      style={{ fontSize: '11px', padding: '2px 8px' }}
                      onClick={() => {
                        const allChecked: Record<string, boolean> = {};
                        allDivisions.forEach((d: any) => { allChecked[d.id] = true; });
                        setCheckedDivisions(allChecked);
                      }}
                    >
                      Select All
                    </button>
                    <button 
                      type="button" 
                      className="btn btn-ghost btn-sm" 
                      style={{ fontSize: '11px', padding: '2px 8px' }}
                      onClick={() => {
                        setCheckedDivisions({});
                      }}
                    >
                      Clear All
                    </button>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px 16px', flexWrap: 'wrap' }}>
                  {allDivisions.map((d: any) => {
                    const isChecked = checkedDivisions[d.id] !== false;
                    return (
                      <label 
                        key={d.id} 
                        style={{ 
                          display: 'inline-flex', 
                          alignItems: 'center', 
                          gap: 8, 
                          fontSize: '13px', 
                          fontWeight: 500,
                          cursor: 'pointer', 
                          userSelect: 'none',
                          padding: '6px 12px',
                          borderRadius: '6px',
                          background: isChecked ? 'var(--primary-50, #f0fdf4)' : 'var(--gray-50, #f8fafc)',
                          border: `1px solid ${isChecked ? 'var(--primary-200, #bbf7d0)' : 'var(--border-color, #e2e8f0)'}`,
                          color: isChecked ? 'var(--primary-700, #15803d)' : 'var(--gray-600, #475569)',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          style={{ cursor: 'pointer', accentColor: 'var(--primary-color)' }}
                          onChange={(e) => {
                            setCheckedDivisions(prev => ({
                              ...prev,
                              [d.id]: e.target.checked
                            }));
                          }}
                        />
                        Class {d.label}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

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
                    divisions={allDivisions.filter((div: any) => checkedDivisions[div.id] !== false)}
                    slots={slots}
                    selectedDay={selectedDay}
                    getEntry={getEntry}
                    entries={entries}
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

            {/* PE Class Groups Card */}
            <div className="card" style={{ marginTop: 0 }}>
              <div className="card-header" style={{ background: 'linear-gradient(135deg,#0f766e,#0d9488)' }}>
                <h3 style={{ color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>🏃</span> PE Class Groups
                </h3>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,.75)' }}>Schedule PE at the same time for small classes</span>
              </div>
              <div className="card-body">
                <p style={{ fontSize: 13, color: 'var(--gray-600)', marginBottom: 14 }}>
                  Group divisions so their Physical Education (or any shared activity) period is scheduled simultaneously. Ideal for small classes like 5th and 6th.
                </p>

                {/* Existing groups */}
                {peGroups.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                    {peGroups.map(group => (
                      <div key={group.id} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '10px 14px', borderRadius: 10,
                        background: 'rgba(15,118,110,.06)', border: '1px solid rgba(15,118,110,.2)',
                      }}>
                        <span style={{ fontSize: 18 }}>🏃</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>{group.subjectName}</div>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                            {group.divisionIds.map(divId => {
                              const div = allDivisions.find((d: any) => d.id === divId);
                              return div ? (
                                <span key={divId} style={{
                                  fontSize: 11, fontWeight: 600, padding: '2px 8px',
                                  background: 'rgba(15,118,110,.1)', color: '#0f766e',
                                  borderRadius: 999, border: '1px solid rgba(15,118,110,.2)',
                                }}>
                                  Class {div.label}
                                </span>
                              ) : null;
                            })}
                          </div>
                        </div>
                        <button
                          className="tt-remove-btn"
                          style={{ fontSize: 16, padding: '2px 6px', color: 'var(--gray-400)' }}
                          onClick={() => setPeGroups(prev => prev.filter(g => g.id !== group.id))}
                          title="Remove this group"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add group form */}
                {showPeGroupForm ? (
                  <div style={{
                    padding: 14, borderRadius: 12, border: '1px solid var(--border-color)',
                    background: 'var(--surface-bg, #f8f9fc)',
                  }}>
                    <div className="form-group" style={{ marginBottom: 12 }}>
                      <label className="form-label">Subject (PE / Activity)</label>
                      <select
                        className="form-select"
                        value={peFormSubjectId}
                        onChange={e => setPeFormSubjectId(e.target.value)}
                        id="pe-group-subject-select"
                      >
                        <option value="">— Select subject —</option>
                        {subjects.filter((s: any) => !s.isLanguageVariant).map((s: any) => (
                          <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group" style={{ marginBottom: 12 }}>
                      <label className="form-label">Select Divisions to Group</label>
                      <div style={{ display: 'flex', gap: '6px 12px', flexWrap: 'wrap', marginTop: 6 }}>
                        {allDivisions.map((div: any) => {
                          const checked = !!peFormDivIds[div.id];
                          return (
                            <label
                              key={div.id}
                              style={{
                                display: 'inline-flex', alignItems: 'center', gap: 6,
                                fontSize: 13, fontWeight: 500, cursor: 'pointer',
                                padding: '5px 10px', borderRadius: 6,
                                background: checked ? 'rgba(15,118,110,.1)' : 'var(--gray-50, #f8fafc)',
                                border: `1px solid ${checked ? 'rgba(15,118,110,.3)' : 'var(--border-color)'}`,
                                color: checked ? '#0f766e' : 'var(--gray-600)',
                                transition: 'all .15s ease',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                style={{ accentColor: '#0f766e' }}
                                onChange={e => setPeFormDivIds(prev => ({ ...prev, [div.id]: e.target.checked }))}
                              />
                              Class {div.label}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        className="btn btn-primary"
                        style={{ background: '#0f766e', borderColor: '#0f766e', fontSize: 13 }}
                        disabled={!peFormSubjectId || Object.values(peFormDivIds).filter(Boolean).length < 2}
                        onClick={() => {
                          const sub = subjects.find((s: any) => s.id === peFormSubjectId);
                          if (!sub) return;
                          const divIds = Object.entries(peFormDivIds).filter(([, v]) => v).map(([k]) => k);
                          if (divIds.length < 2) return;
                          setPeGroups(prev => [...prev, {
                            id: Math.random().toString(36).slice(2),
                            subjectId: peFormSubjectId,
                            subjectName: `${sub.name} (${sub.code})`,
                            divisionIds: divIds,
                          }]);
                          setShowPeGroupForm(false);
                          setPeFormSubjectId('');
                          setPeFormDivIds({});
                        }}
                      >
                        ✓ Add Group
                      </button>
                      <button
                        className="btn btn-secondary"
                        style={{ fontSize: 13 }}
                        onClick={() => { setShowPeGroupForm(false); setPeFormSubjectId(''); setPeFormDivIds({}); }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="btn btn-secondary"
                    style={{ fontSize: 13 }}
                    onClick={() => setShowPeGroupForm(true)}
                    id="btn-add-pe-group"
                  >
                    + Add PE Group
                  </button>
                )}
              </div>
            </div>

            {/* Summary footer */}
            <div className="tt-conditions-footer">
              <div className="tt-conditions-summary">
                <span>✅ <strong>{constraints.filter(c => c.enabled).length}</strong> active constraints</span>
                <span>·</span>
                <span>🔒 <strong>{constraints.filter(c => !c.enabled).length}</strong> disabled</span>
                <span>·</span>
                <span>✨ <strong>{constraints.filter(c => c.source === 'ai').length}</strong> AI-generated</span>
                {peGroups.length > 0 && (
                  <><span>·</span><span>🏃 <strong>{peGroups.length}</strong> PE group{peGroups.length !== 1 ? 's' : ''}</span></>
                )}
              </div>
              <p style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 6 }}>
                These constraints are informational guides for the generation algorithm. The engine always respects hard rules (no double-booking, no spanning lunch).
              </p>
            </div>
          </div>
        )}


        {/* ── TEACHER VIEW TAB ─────────────────────────────────────────── */}
        {viewMode === 'teacher' && (
          <>
            {/* Checkbox Selector */}
            <div className="no-print" style={{
              marginBottom: 20,
              background: 'var(--bg-card, #ffffff)',
              padding: '16px',
              borderRadius: 'var(--radius-lg, 12px)',
              border: '1px solid var(--border-color, #e2e8f0)',
              boxShadow: 'var(--shadow-sm)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontWeight: 600, fontSize: '13.5px', color: 'var(--text-primary)' }}>
                  👩‍🏫 Select Teachers to View / Print:
                </span>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: '11px', padding: '2px 8px' }}
                    onClick={() => {
                      const all: Record<string, boolean> = {};
                      teachers.forEach((t: any) => { all[t.id] = true; });
                      setCheckedTeachers(all);
                    }}
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: '11px', padding: '2px 8px' }}
                    onClick={() => setCheckedTeachers({})}
                  >
                    Clear All
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px 12px', flexWrap: 'wrap' }}>
                {teachers.map((t: any) => {
                  const isChecked = checkedTeachers[t.id] !== false && checkedTeachers[t.id] !== undefined
                    ? !!checkedTeachers[t.id] : false;
                  const hasSlots = entries.some((e: any) => e.teacherId === t.id);
                  return (
                    <label
                      key={t.id}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 7,
                        fontSize: '13px', fontWeight: 500,
                        cursor: 'pointer', userSelect: 'none',
                        padding: '5px 11px', borderRadius: '6px',
                        background: isChecked ? 'var(--primary-50, #eff6ff)' : 'var(--gray-50, #f8fafc)',
                        border: `1px solid ${isChecked ? 'var(--primary-200, #bfdbfe)' : 'var(--border-color)'}`,
                        color: isChecked ? 'var(--primary-700, #1d4ed8)' : hasSlots ? 'var(--gray-700)' : 'var(--gray-400)',
                        transition: 'all 0.15s ease',
                        opacity: hasSlots ? 1 : 0.6,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        style={{ cursor: 'pointer', accentColor: 'var(--primary-color)' }}
                        onChange={e => setCheckedTeachers(prev => ({ ...prev, [t.id]: e.target.checked }))}
                      />
                      <span>{t.user?.name || t.teacherCode}</span>
                      <span style={{
                        fontSize: 10, fontWeight: 700,
                        background: isChecked ? 'var(--primary-100)' : 'var(--gray-100)',
                        color: isChecked ? 'var(--primary-600)' : 'var(--gray-500)',
                        padding: '0px 5px', borderRadius: 999,
                      }}>
                        {t.teacherCode}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Teacher timetable cards */}
            {entries.length === 0 ? (
              <EmptyState />
            ) : (
              teachers
                .filter((t: any) => checkedTeachers[t.id])
                .map((teacher: any) => {
                  const teacherEntries = entries.filter((e: any) => e.teacherId === teacher.id);
                  return (
                    <div key={teacher.id} className="card tt-print-card" style={{ marginBottom: 16 }}>
                      <div className="card-header">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{
                            width: 38, height: 38, borderRadius: '50%',
                            background: 'linear-gradient(135deg, var(--primary-600), var(--primary-500))',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: '#fff', fontWeight: 800, fontSize: 15, flexShrink: 0,
                          }}>
                            {(teacher.user?.name || teacher.teacherCode).charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <h3 style={{ margin: 0 }}>{teacher.user?.name || teacher.teacherCode}</h3>
                            <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>
                              Code: <strong>{teacher.teacherCode}</strong>
                              {teacher.designation && ` · ${teacher.designation}`}
                              {' · '}
                              <span style={{ color: teacherEntries.length > 0 ? '#16a34a' : 'var(--gray-400)' }}>
                                {teacherEntries.length} period{teacherEntries.length !== 1 ? 's' : ''}/week
                              </span>
                            </span>
                          </div>
                        </div>
                        <span className={`badge ${teacherEntries.length > 0 ? 'badge-green' : 'badge-gray'}`}>
                          {teacherEntries.length > 0 ? 'Active' : 'No periods'}
                        </span>
                      </div>
                      <div className="card-body" style={{ padding: 0, overflowX: 'auto' }}>
                        {teacherEntries.length === 0 ? (
                          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--gray-400)', fontSize: 13 }}>
                            😴 No periods scheduled for this teacher
                          </div>
                        ) : (
                          <TeacherTimetableGrid
                            teacher={teacher}
                            entries={teacherEntries}
                            allDivisions={allDivisions}
                            days={days}
                            slots={slots}
                          />
                        )}
                      </div>
                    </div>
                  );
                })
            )}
            {teachers.filter((t: any) => checkedTeachers[t.id]).length === 0 && entries.length > 0 && (
              <div className="card">
                <div className="empty-state">
                  <div className="empty-state-icon">👩‍🏫</div>
                  <h3>No Teachers Selected</h3>
                  <p>Use the checkboxes above to select teachers to view their timetables.</p>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── REPORT TAB ──────────────────────────────────────────────── */}
        {viewMode === 'report' && (
          <div className="tt-report-tab">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>🗂️ Generation Input Report</h3>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--gray-500)' }}>
                  All data feeding into the timetable generator — use this to diagnose unfilled slots.
                </p>
              </div>
              <button
                className="btn btn-secondary"
                style={{ fontSize: 12 }}
                onClick={async () => {
                  setReport(null);
                  setReportLoading(true);
                  setReportError('');
                  try {
                    const res = await fetch('/api/timetable/report');
                    const data = await res.json();
                    if (data.success) setReport(data.data);
                    else setReportError(data.error || 'Failed to load report');
                  } catch { setReportError('Network error'); }
                  setReportLoading(false);
                }}
                id="btn-refresh-report"
              >
                🔄 Refresh
              </button>
            </div>

            {reportLoading && (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--gray-500)' }}>
                <div className="spinner" style={{ margin: '0 auto 12px' }} />
                Loading report data…
              </div>
            )}
            {reportError && (
              <div style={{ padding: 16, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 10, color: '#dc2626', fontSize: 13 }}>
                ❌ {reportError}
              </div>
            )}

            {report && (
              <>
                {/* School Config Banner */}
                <div className="tt-report-config-banner">
                  {[
                    { icon: '📅', label: 'Working Days', value: report.schoolConfig.workingDays },
                    { icon: '🕐', label: 'Periods / Day', value: report.schoolConfig.periodsPerDay },
                    { icon: '🌅', label: 'Morning Periods', value: report.schoolConfig.morningPeriods },
                    { icon: '🌇', label: 'Afternoon Periods', value: report.schoolConfig.afternoonPeriods },
                    { icon: '📦', label: 'Slots / Division', value: report.schoolConfig.totalCapacityPerDivision },
                    { icon: '🏫', label: 'Total Divisions', value: report.summary.divisionCount },
                    { icon: '📚', label: 'Schedulable Subjects', value: report.summary.schedulableSubjectCount },
                    { icon: '👩‍🏫', label: 'Teachers', value: report.summary.teacherCount },
                  ].map(item => (
                    <div key={item.label} className="tt-report-config-tile">
                      <span className="tt-config-icon">{item.icon}</span>
                      <span className="tt-config-value">{item.value}</span>
                      <span className="tt-config-label">{item.label}</span>
                    </div>
                  ))}
                </div>

                {/* Alert chips */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                  {report.summary.subjectsWithNoTeacher > 0 && (
                    <span className="tt-report-chip error">🔴 {report.summary.subjectsWithNoTeacher} subject(s) with no teacher</span>
                  )}
                  {report.summary.overloadedDivisions > 0 && (
                    <span className="tt-report-chip error">🔴 {report.summary.overloadedDivisions} over-capacity division(s)</span>
                  )}
                  {report.summary.overloadedTeachers > 0 && (
                    <span className="tt-report-chip warning">🟠 {report.summary.overloadedTeachers} overloaded teacher(s)</span>
                  )}
                  {report.summary.idleTeachers > 0 && (
                    <span className="tt-report-chip info">🔵 {report.summary.idleTeachers} idle teacher(s)</span>
                  )}
                  {report.summary.overloadedDivisions === 0 && report.summary.subjectsWithNoTeacher === 0 && (
                    <span className="tt-report-chip success">✅ No critical issues detected</span>
                  )}
                  <span className="tt-report-chip neutral">
                    📊 Expected {report.summary.totalExpectedSlots} / {report.summary.totalCapacityAllDivisions} total slots ({report.summary.overallFillRate}% fill)
                  </span>
                </div>

                {/* Inner Sub-tabs */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 16, borderBottom: '2px solid var(--border-color)', paddingBottom: 8 }}>
                  {(['overview', 'divisions', 'subjects', 'teachers'] as const).map(t => (
                    <button
                      key={t}
                      className={`tt-report-subtab ${reportTab === t ? 'active' : ''}`}
                      onClick={() => setReportTab(t)}
                      id={`report-subtab-${t}`}
                    >
                      {t === 'overview' ? '📋 Overview' : t === 'divisions' ? '🏫 Divisions' : t === 'subjects' ? '📚 Subjects' : '👩‍🏫 Teachers'}
                    </button>
                  ))}
                </div>

                {/* OVERVIEW SUB-TAB */}
                {reportTab === 'overview' && (
                  <div className="tt-report-overview">
                    <div className="card" style={{ marginBottom: 16 }}>
                      <div className="card-header"><h3>📋 Division Demand vs Capacity</h3></div>
                      <div style={{ overflowX: 'auto' }}>
                        <table className="tt-report-table">
                          <thead>
                            <tr>
                              <th>Division</th>
                              <th>Subjects</th>
                              <th>Demand (periods)</th>
                              <th>Capacity</th>
                              <th>Fill %</th>
                              <th>Flags</th>
                            </tr>
                          </thead>
                          <tbody>
                            {report.divisions.map((d: any) => {
                              const pct = d.fillRate;
                              const color = pct > 100 ? '#dc2626' : pct >= 90 ? '#16a34a' : pct >= 70 ? '#d97706' : '#6b7280';
                              return (
                                <tr key={d.divisionId}>
                                  <td><strong>{d.divisionLabel}</strong></td>
                                  <td>{d.subjectCount}</td>
                                  <td style={{ fontWeight: 700, color: d.totalDemand > d.totalCapacity ? '#dc2626' : 'inherit' }}>
                                    {d.totalDemand}
                                  </td>
                                  <td>{d.totalCapacity}</td>
                                  <td>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                      <div style={{ width: 60, height: 6, background: 'var(--border-color)', borderRadius: 99, overflow: 'hidden' }}>
                                        <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: color, borderRadius: 99 }} />
                                      </div>
                                      <span style={{ fontSize: 12, fontWeight: 700, color }}>{pct}%</span>
                                    </div>
                                  </td>
                                  <td>
                                    {d.flags.map((f: any, i: number) => (
                                      <span key={i} className={`tt-report-chip ${f.type}`} style={{ display: 'block', marginBottom: 2, fontSize: 11 }}>
                                        {f.type === 'error' ? '🔴' : f.type === 'warning' ? '🟠' : 'ℹ️'} {f.message}
                                      </span>
                                    ))}
                                    {d.flags.length === 0 && <span style={{ color: '#16a34a', fontSize: 12 }}>✅ OK</span>}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

                {/* DIVISIONS SUB-TAB */}
                {reportTab === 'divisions' && (
                  <div>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                      <select
                        className="form-select"
                        style={{ width: 200, fontSize: 13 }}
                        value={reportDivFilter}
                        onChange={e => setReportDivFilter(e.target.value)}
                        id="report-division-filter"
                      >
                        <option value="">All Divisions</option>
                        {report.divisions.map((d: any) => (
                          <option key={d.divisionId} value={d.divisionId}>{d.divisionLabel}</option>
                        ))}
                      </select>
                      <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>Click a division to expand subject detail</span>
                    </div>

                    {report.divisions
                      .filter((d: any) => !reportDivFilter || d.divisionId === reportDivFilter)
                      .map((d: any) => (
                        <div key={d.divisionId} className="card" style={{ marginBottom: 12 }}>
                          {/* Division Header */}
                          <div
                            className="card-header"
                            style={{ cursor: 'pointer', userSelect: 'none' }}
                            onClick={() => setReportExpandedDiv(reportExpandedDiv === d.divisionId ? null : d.divisionId)}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <span style={{ fontSize: 18 }}>{reportExpandedDiv === d.divisionId ? '▾' : '▸'}</span>
                              <div>
                                <h3 style={{ margin: 0 }}>Class {d.divisionLabel}</h3>
                                <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>
                                  CT: {d.classTeacher ? `${d.classTeacher.name} (${d.classTeacher.code})` : '—'}
                                </span>
                              </div>
                              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                                <span className={`badge ${d.totalDemand > d.totalCapacity ? 'badge-red' : d.fillRate >= 90 ? 'badge-green' : 'badge-gold'}`}>
                                  {d.totalDemand}/{d.totalCapacity} periods ({d.fillRate}%)
                                </span>
                                {d.flags.filter((f: any) => f.type === 'error').length > 0 && (
                                  <span className="badge badge-red">🔴 {d.flags.filter((f: any) => f.type === 'error').length} error(s)</span>
                                )}
                                {d.flags.filter((f: any) => f.type === 'warning').length > 0 && (
                                  <span className="badge badge-yellow">🟠 {d.flags.filter((f: any) => f.type === 'warning').length} warning(s)</span>
                                )}
                              </div>
                            </div>
                          </div>

                          {reportExpandedDiv === d.divisionId && (
                            <div className="card-body" style={{ padding: 0 }}>
                              {/* Flags */}
                              {d.flags.length > 0 && (
                                <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  {d.flags.map((f: any, i: number) => (
                                    <div key={i} style={{
                                      padding: '6px 10px', borderRadius: 6, fontSize: 12,
                                      background: f.type === 'error' ? '#fef2f2' : f.type === 'warning' ? '#fffbeb' : '#f0f9ff',
                                      borderLeft: `3px solid ${f.type === 'error' ? '#dc2626' : f.type === 'warning' ? '#d97706' : '#0ea5e9'}`,
                                    }}>
                                      {f.type === 'error' ? '🔴' : f.type === 'warning' ? '🟠' : 'ℹ️'} {f.message}
                                    </div>
                                  ))}
                                </div>
                              )}
                              {/* Subject table */}
                              <div style={{ overflowX: 'auto' }}>
                                <table className="tt-report-table">
                                  <thead>
                                    <tr>
                                      <th>Subject</th>
                                      <th>Code</th>
                                      <th>Periods/Week</th>
                                      <th>Consecutive</th>
                                      <th>Core</th>
                                      <th>Evening</th>
                                      <th>Fixed Day</th>
                                      <th>Fixed Slot</th>
                                      <th>Overridden</th>
                                      <th>Assigned Teacher</th>
                                      <th>Resolved Via</th>
                                      <th>Status</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {d.subjects.map((s: any) => (
                                      <tr key={s.subjectId} style={{ opacity: s.skippedFromEngine ? 0.5 : 1 }}>
                                        <td><strong>{s.subjectName}</strong></td>
                                        <td><span className="badge badge-gray">{s.subjectCode}</span></td>
                                        <td>
                                          <span style={{ fontWeight: 700 }}>{s.periodsPerWeek}</span>
                                          {s.isOverridden && (
                                            <span style={{ fontSize: 10, color: '#7c3aed', marginLeft: 4 }}>
                                              (was {s.originalPeriodsPerWeek})
                                            </span>
                                          )}
                                        </td>
                                        <td style={{ textAlign: 'center' }}>{s.consecutiveSlots > 1 ? `${s.consecutiveSlots}×` : '—'}</td>
                                        <td style={{ textAlign: 'center' }}>{s.isCore ? '✅' : '—'}</td>
                                        <td style={{ textAlign: 'center' }}>{s.eveningPriority ? '🌇' : '—'}</td>
                                        <td style={{ textAlign: 'center' }}>{s.fixedDay != null ? `Day ${s.fixedDay}` : '—'}</td>
                                        <td style={{ textAlign: 'center' }}>{s.fixedSlot != null ? `Slot ${s.fixedSlot}` : '—'}</td>
                                        <td style={{ textAlign: 'center' }}>{s.isOverridden ? <span className="badge" style={{ background: '#f3e8ff', color: '#7c3aed' }}>Yes</span> : '—'}</td>
                                        <td>{s.teacher ? `${s.teacher.name} (${s.teacher.code})` : <span style={{ color: '#dc2626' }}>⚠️ None</span>}</td>
                                        <td style={{ fontSize: 11, color: 'var(--gray-500)' }}>
                                          {s.teacher ? {
                                            class_teacher_flag: 'CT flag',
                                            class_teacher: 'CT (maps subject)',
                                            subject_mapping: 'Subject map',
                                            fallback_restriction_relaxed: '⚠️ Restriction relaxed',
                                          }[s.teacher.resolvedVia as string] ?? s.teacher.resolvedVia : '—'}
                                        </td>
                                        <td>
                                          {s.skippedFromEngine
                                            ? <span className="badge badge-red">Skipped: {s.skipReason}</span>
                                            : <span className="badge badge-green">Scheduled</span>}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              {/* Excluded subjects */}
                              {d.excludedSubjects.length > 0 && (
                                <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border-color)', fontSize: 12, color: 'var(--gray-500)' }}>
                                  <strong>Excluded subjects:</strong>{' '}
                                  {d.excludedSubjects.map((s: any) => (
                                    <span key={s.subjectId} style={{ marginRight: 8, background: '#f3f4f6', padding: '2px 6px', borderRadius: 4 }}>
                                      {s.subjectName} ({s.subjectCode})
                                    </span>
                                  ))}
                                </div>
                              )}
                              {/* Teacher load within division */}
                              {d.teacherDemand.length > 0 && (
                                <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border-color)' }}>
                                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-600)', marginBottom: 6 }}>Teacher load in this division:</div>
                                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                    {d.teacherDemand.map((t: any) => (
                                      <span key={t.id} style={{
                                        fontSize: 12, padding: '4px 10px', borderRadius: 99,
                                        background: 'var(--surface-bg, #f3f4f6)', border: '1px solid var(--border-color)',
                                      }}>
                                        <strong>{t.code}</strong> — {t.periods} period(s)
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))
                    }
                  </div>
                )}

                {/* SUBJECTS SUB-TAB */}
                {reportTab === 'subjects' && (
                  <div className="card">
                    <div className="card-header"><h3>📚 All Schedulable Subjects</h3></div>
                    <div style={{ overflowX: 'auto' }}>
                      <table className="tt-report-table">
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>Code</th>
                            <th>Periods/Week</th>
                            <th>Consecutive</th>
                            <th>Core</th>
                            <th>Evening Priority</th>
                            <th>Use CT</th>
                            <th>Fixed Day</th>
                            <th>Fixed Slot</th>
                            <th>Assigned Teachers</th>
                            <th>Issue</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.subjects.map((s: any) => (
                            <tr key={s.id}>
                              <td><strong>{s.name}</strong></td>
                              <td><span className="badge badge-gray">{s.code}</span></td>
                              <td style={{ fontWeight: 700 }}>{s.periodsPerWeek}</td>
                              <td>{s.consecutiveSlots > 1 ? `${s.consecutiveSlots}×` : '—'}</td>
                              <td>{s.isCore ? '✅' : '—'}</td>
                              <td>{s.eveningPriority ? '🌇' : '—'}</td>
                              <td>{s.useClassTeacher ? '✅' : '—'}</td>
                              <td>{s.fixedDay != null ? `Day ${s.fixedDay}` : '—'}</td>
                              <td>{s.fixedSlot != null ? `Slot ${s.fixedSlot}` : '—'}</td>
                              <td>
                                {s.teachers.length === 0
                                  ? <span style={{ color: '#dc2626' }}>⚠️ None</span>
                                  : s.teachers.map((t: any) => (
                                    <span key={t.id} style={{ marginRight: 6, fontSize: 12 }}>{t.name} ({t.code})</span>
                                  ))}
                              </td>
                              <td>
                                {s.hasNoTeacher
                                  ? <span className="badge badge-red">No teacher → will be skipped</span>
                                  : <span className="badge badge-green">OK</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* TEACHERS SUB-TAB */}
                {reportTab === 'teachers' && (
                  <div>
                    {report.teachers.map((t: any) => (
                      <div key={t.id} className="card" style={{ marginBottom: 12 }}>
                        <div className="card-header">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{
                              width: 36, height: 36, borderRadius: '50%',
                              background: t.isOverloaded ? '#fef2f2' : t.isIdle ? '#f3f4f6' : '#f0fdf4',
                              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0,
                            }}>
                              {t.isOverloaded ? '🔴' : t.isIdle ? '😴' : '👩‍🏫'}
                            </div>
                            <div>
                              <div style={{ fontWeight: 700 }}>{t.name} <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--gray-500)' }}>({t.code})</span></div>
                              <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>
                                Teaches: {t.subjects.map((s: any) => s.subjectName).join(', ') || '—'}
                              </div>
                            </div>
                            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                              <div style={{ textAlign: 'right' }}>
                                <div style={{
                                  fontSize: 20, fontWeight: 800,
                                  color: t.isOverloaded ? '#dc2626' : t.utilisation >= 90 ? '#16a34a' : t.utilisation >= 70 ? '#d97706' : '#6b7280',
                                }}>
                                  {t.totalDemand}/{t.totalCapacity}
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--gray-500)' }}>periods/week ({t.utilisation}%)</div>
                              </div>
                            </div>
                          </div>
                          {/* Utilisation bar */}
                          <div style={{ marginTop: 8 }}>
                            <div style={{ height: 6, borderRadius: 99, background: 'var(--border-color)', overflow: 'hidden' }}>
                              <div style={{
                                height: '100%', borderRadius: 99,
                                width: `${Math.min(t.utilisation, 100)}%`,
                                background: t.isOverloaded ? '#dc2626' : t.utilisation >= 90 ? '#16a34a' : '#d97706',
                                transition: 'width 0.4s ease',
                              }} />
                            </div>
                            {t.isOverloaded && (
                              <div style={{ fontSize: 11, color: '#dc2626', marginTop: 4 }}>
                                ⚠️ Overloaded by {t.totalDemand - t.totalCapacity} period(s) — some classes will be unscheduled
                              </div>
                            )}
                          </div>
                        </div>
                        {/* Division breakdown */}
                        {t.divisionBreakdown.length > 0 && (
                          <div className="card-body" style={{ paddingTop: 8, paddingBottom: 8 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-600)', marginBottom: 6 }}>Division breakdown:</div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              {t.divisionBreakdown.map((b: any, i: number) => (
                                <span key={i} style={{
                                  fontSize: 12, padding: '3px 9px', borderRadius: 99,
                                  background: 'var(--surface-bg, #f3f4f6)', border: '1px solid var(--border-color)',
                                }}>
                                  <strong>{b.divisionLabel}</strong> — {b.subjectName} ({b.periods}p)
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {t.isIdle && (
                          <div className="card-body" style={{ paddingTop: 4 }}>
                            <span style={{ fontSize: 12, color: '#6b7280' }}>😴 No periods assigned — teacher has no matching subject-division pairs.</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
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

      {/* Swap Mode Banner */}
      {isSwapping && selectedCell && (
        <div className="no-print" style={{
          position: 'fixed',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'linear-gradient(90deg, var(--primary-600), var(--primary-500))',
          color: '#fff',
          padding: '14px 24px',
          borderRadius: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3)',
          zIndex: 1000,
          whiteSpace: 'nowrap',
        }}>
          <span style={{ fontSize: 18 }}>🔄</span>
          <div>
            Select another slot in <strong>Class {allDivisions.find((d: any) => d.id === selectedCell.divId)?.label}</strong> to swap with <strong>{getDayName(selectedCell.day)} Period {selectedCell.slot}</strong>
          </div>
          <button
            className="btn btn-sm"
            style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: 'none', padding: '4px 10px', fontSize: 11 }}
            onClick={() => {
              setIsSwapping(false);
              setSelectedCell(null);
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Manual Slot Edit Modal */}
      {selectedCell && !isSwapping && (
        <div className="modal-overlay" onClick={() => setSelectedCell(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div className="modal-header">
              <h3>✍️ Edit Timetable Slot</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setSelectedCell(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ marginBottom: 16, padding: '10px 14px', background: 'var(--surface-bg, #f8f9fc)', borderRadius: 8, border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: 11, color: 'var(--gray-500)', textTransform: 'uppercase', fontWeight: 600 }}>Class & Day:</div>
                <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', marginTop: 2 }}>
                  Class {allDivisions.find((d: any) => d.id === selectedCell.divId)?.label || ''} · {getDayName(selectedCell.day)} Period {selectedCell.slot}
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 16 }}>
                <label className="form-label">Subject</label>
                <select
                  className="form-select"
                  value={editSubjectId}
                  onChange={e => {
                    const subId = e.target.value;
                    setEditSubjectId(subId);
                    if (!subId) {
                      setEditTeacherId('');
                      setEditConflicts([]);
                    } else {
                      const mappedTeacher = teachers.find(t => t.subjectMappings?.some((sm: any) => sm.subjectId === subId));
                      const nextTeacherId = editTeacherId || mappedTeacher?.id || '';
                      if (mappedTeacher && !editTeacherId) {
                        setEditTeacherId(mappedTeacher.id);
                      }
                      validateEdit(subId, nextTeacherId);
                    }
                  }}
                  id="edit-subject-select"
                >
                  <option value="">— Unassigned / Free Period —</option>
                  {subjects.map((sub: any) => (
                    <option key={sub.id} value={sub.id}>{sub.name} ({sub.code})</option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: 16 }}>
                <label className="form-label">Teacher</label>
                <select
                  className="form-select"
                  value={editTeacherId}
                  disabled={!editSubjectId}
                  onChange={e => {
                    const tId = e.target.value;
                    setEditTeacherId(tId);
                    validateEdit(editSubjectId, tId);
                  }}
                  id="edit-teacher-select"
                >
                  <option value="">— Select Teacher —</option>
                  {teachers
                    .filter((t: any) => !editSubjectId || t.subjectMappings?.some((sm: any) => sm.subjectId === editSubjectId))
                    .map((t: any) => (
                      <option key={t.id} value={t.id}>{t.user?.name || t.teacherCode} ({t.teacherCode})</option>
                    ))}
                </select>
              </div>

              {editValidating && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--gray-500)', margin: '12px 0' }}>
                  <span className="spinner-sm" style={{ borderTopColor: 'var(--primary-color)' }} />
                  Checking for schedule conflicts...
                </div>
              )}

              {!editValidating && editConflicts.length > 0 && (
                <div style={{ padding: '10px 14px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fca5a5', margin: '12px 0' }}>
                  <div style={{ fontWeight: 700, color: '#dc2626', fontSize: 13, marginBottom: 4 }}>⚠️ Scheduling Warnings:</div>
                  {editConflicts.map((c, idx) => (
                    <div key={idx} style={{ fontSize: 12, color: '#b91c1c', marginTop: 2 }}>
                      • {c.message}
                    </div>
                  ))}
                </div>
              )}

              {!editValidating && editSubjectId && editTeacherId && editConflicts.length === 0 && (
                <div style={{ color: '#16a34a', fontSize: 12.5, fontWeight: 500, margin: '12px 0', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span>✓</span> No conflicts detected. Safe to save.
                </div>
              )}
            </div>
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between' }}>
              {selectedCell.entry ? (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ background: 'rgba(124,58,237,.06)', color: 'var(--primary-600)', borderColor: 'rgba(124,58,237,.2)' }}
                  onClick={() => setIsSwapping(true)}
                  id="btn-trigger-swap"
                >
                  🔄 Swap Slot
                </button>
              ) : <div />}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setSelectedCell(null)}>Cancel</button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={saveEdit}
                  disabled={editSaving || editValidating || (editConflicts.length > 0 && editConflicts.some(c => c.type === 'division_locked'))}
                >
                  {editSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{timetableStyles}</style>
    </DashboardLayout>
  );
}

// ─── Inverted Timetable Grid (Weekly View) ────────────────────────────────
// Layout: Rows = Days, Columns = Periods

// ─── Helper: build parallel cell label for MAL1/SAN/ARA ────────────────────
function buildParallelCell(entry: any, divisionId: string, day: number, slot: number, allEntries: any[]) {
  if (!entry) return null;
  if (entry.subject?.isLanguageVariant) return null;

  const cellEntries = allEntries.filter(
    (e: any) => e.divisionId === divisionId && e.dayOfWeek === day && e.slotNumber === slot
  );
  if (cellEntries.length <= 1) return null;

  // Enforce consistent sorting: base subject first, then variants alphabetically by code
  cellEntries.sort((a: any, b: any) => {
    const aIsVar = a.subject?.isLanguageVariant ? 1 : 0;
    const bIsVar = b.subject?.isLanguageVariant ? 1 : 0;
    if (aIsVar !== bIsVar) return aIsVar - bIsVar;
    return (a.subject?.code || '').localeCompare(b.subject?.code || '');
  });

  const codes = cellEntries.map((e: any) => e.subject?.code || e.subject?.name || '?');
  const teacherCodes = cellEntries.map((e: any) => e.teacher?.teacherCode || '?');
  return { codes, teacherCodes };
}

function InvertedTimetableGrid({
  div,
  days,
  slots,
  getEntry,
  entries,
  isEditMode,
  selectedCell,
  isSwapping,
  onCellClick,
  performSwap,
}: {
  div: any;
  days: number[];
  slots: number[];
  getEntry: (divId: string, day: number, slot: number) => any;
  entries: any[];
  isEditMode: boolean;
  selectedCell: any;
  isSwapping: boolean;
  onCellClick: (divId: string, day: number, slot: number, entry: any) => void;
  performSwap: (day: number, slot: number) => void;
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
            const parallel = buildParallelCell(entry, div.id, activeDay, slot, entries);

            return (
              <div key={slot} className={`tt-mobile-slot-card ${entry ? 'filled' : 'empty'}`}>
                <div className="tt-slot-time">Period {slot}</div>
                <div className="tt-slot-info">
                  {entry ? (
                    parallel ? (
                      <>
                        <div className="tt-slot-subject tt-parallel-subject">{parallel.codes.join('/')}</div>
                        <div className="tt-slot-teacher">👩‍🏫 {parallel.teacherCodes.join('/')}</div>
                      </>
                    ) : (
                      <>
                        <div className="tt-slot-subject">{entry.subject?.name} ({entry.subject?.code})</div>
                        <div className="tt-slot-teacher">
                          👩‍🏫 {entry.teacher?.user?.name || entry.teacher?.teacherCode}
                        </div>
                      </>
                    )
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
                const parallel = buildParallelCell(entry, div.id, day, slot, entries);
                
                const isClickable = isEditMode && !div.timetableLocked;
                const isOrigin = selectedCell && selectedCell.divId === div.id && selectedCell.day === day && selectedCell.slot === slot;
                const isTarget = isSwapping && selectedCell && selectedCell.divId === div.id && !isOrigin;

                let cellClass = `tt-entry-cell ${entry ? 'filled' : 'empty'}`;
                if (isClickable) cellClass += ' tt-editable-cell';
                if (isOrigin) cellClass += ' tt-swapping-origin';
                if (isTarget) cellClass += ' tt-swapping-target';

                return (
                  <td 
                    key={slot} 
                    className={cellClass}
                    onClick={() => {
                      if (!isClickable) return;
                      if (isSwapping) {
                        performSwap(day, slot);
                      } else {
                        onCellClick(div.id, day, slot, entry);
                      }
                    }}
                  >
                    {entry ? (
                      parallel ? (
                        <div className="tt-entry-content tt-parallel-cell">
                          <span className="tt-subject tt-parallel-label">{parallel.codes.join('/')}</span>
                          <span className="tt-teacher">{parallel.teacherCodes.join('/')}</span>
                        </div>
                      ) : (
                        <div className="tt-entry-content">
                          <span className="tt-subject">{entry.subject?.code || entry.subject?.name}</span>
                          <span className="tt-teacher">{entry.teacher?.teacherCode}</span>
                        </div>
                      )
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
                const parallel = buildParallelCell(entry, div.id, day, slot, entries);
                
                const isClickable = isEditMode && !div.timetableLocked;
                const isOrigin = selectedCell && selectedCell.divId === div.id && selectedCell.day === day && selectedCell.slot === slot;
                const isTarget = isSwapping && selectedCell && selectedCell.divId === div.id && !isOrigin;

                let cellClass = `tt-entry-cell tt-pm ${entry ? 'filled' : 'empty'}`;
                if (isClickable) cellClass += ' tt-editable-cell';
                if (isOrigin) cellClass += ' tt-swapping-origin';
                if (isTarget) cellClass += ' tt-swapping-target';

                return (
                  <td 
                    key={slot} 
                    className={cellClass}
                    onClick={() => {
                      if (!isClickable) return;
                      if (isSwapping) {
                        performSwap(day, slot);
                      } else {
                        onCellClick(div.id, day, slot, entry);
                      }
                    }}
                  >
                    {entry ? (
                      parallel ? (
                        <div className="tt-entry-content tt-parallel-cell">
                          <span className="tt-subject tt-parallel-label">{parallel.codes.join('/')}</span>
                          <span className="tt-teacher">{parallel.teacherCodes.join('/')}</span>
                        </div>
                      ) : (
                        <div className="tt-entry-content">
                          <span className="tt-subject">{entry.subject?.code || entry.subject?.name}</span>
                          <span className="tt-teacher">{entry.teacher?.teacherCode}</span>
                        </div>
                      )
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

function DailyInvertedGrid({ divisions, slots, selectedDay, getEntry, entries }: {
  divisions: any[];
  slots: number[];
  selectedDay: number;
  getEntry: (divId: string, day: number, slot: number) => any;
  entries: any[];
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
              const parallel = buildParallelCell(entry, selectedDiv.id, selectedDay, slot, entries);

              return (
                <div key={slot} className={`tt-mobile-slot-card ${entry ? 'filled' : 'empty'}`}>
                  <div className="tt-slot-time">Period {slot}</div>
                  <div className="tt-slot-info">
                    {entry ? (
                      parallel ? (
                        <>
                          <div className="tt-slot-subject tt-parallel-subject">{parallel.codes.join('/')}</div>
                          <div className="tt-slot-teacher">👩‍🏫 {parallel.teacherCodes.join('/')}</div>
                        </>
                      ) : (
                        <>
                          <div className="tt-slot-subject">{entry.subject?.name} ({entry.subject?.code})</div>
                          <div className="tt-slot-teacher">
                            👩‍🏫 {entry.teacher?.user?.name || entry.teacher?.teacherCode}
                          </div>
                        </>
                      )
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
                const parallel = buildParallelCell(entry, div.id, selectedDay, slot, entries);
                return (
                  <td key={slot} className={`tt-entry-cell ${entry ? 'filled' : 'empty'}`}>
                    {entry ? (
                      parallel ? (
                        <div className="tt-entry-content tt-parallel-cell">
                          <span className="tt-subject tt-parallel-label">{parallel.codes.join('/')}</span>
                          <span className="tt-teacher">{parallel.teacherCodes.join('/')}</span>
                        </div>
                      ) : (
                        <div className="tt-entry-content">
                          <span className="tt-subject">{entry.subject?.code || entry.subject?.name}</span>
                          <span className="tt-teacher">{entry.teacher?.teacherCode}</span>
                        </div>
                      )
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
                const parallel = buildParallelCell(entry, div.id, selectedDay, slot, entries);
                return (
                  <td key={slot} className={`tt-entry-cell tt-pm ${entry ? 'filled' : 'empty'}`}>
                    {entry ? (
                      parallel ? (
                        <div className="tt-entry-content tt-parallel-cell">
                          <span className="tt-subject tt-parallel-label">{parallel.codes.join('/')}</span>
                          <span className="tt-teacher">{parallel.teacherCodes.join('/')}</span>
                        </div>
                      ) : (
                        <div className="tt-entry-content">
                          <span className="tt-subject">{entry.subject?.code || entry.subject?.name}</span>
                          <span className="tt-teacher">{entry.teacher?.teacherCode}</span>
                        </div>
                      )
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

// ─── Teacher Timetable Grid ─────────────────────────────────────────────────
// Layout: Rows = Days, Columns = Periods. Each cell shows Class/Division + Subject.

function TeacherTimetableGrid({ entries, allDivisions, days, slots }: {
  teacher?: any;
  entries: any[];
  allDivisions: any[];
  days: number[];
  slots: number[];
}) {
  const morningSlots = slots.filter((s: number) => s <= 4);
  const afternoonSlots = slots.filter((s: number) => s > 4);

  function getTeacherEntry(day: number, slot: number) {
    return entries.find((e: any) => e.dayOfWeek === day && e.slotNumber === slot);
  }

  function getDivLabel(divId: string) {
    const div = allDivisions.find((d: any) => d.id === divId);
    return div ? (div.label || `${div.className || ''}${div.name || ''}`.trim()) : '?';
  }

  const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const DAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="tt-inverted-wrapper">
      <table className="tt-inverted-table">
        <thead>
          <tr>
            <th className="tt-corner-cell">Day \ Period</th>
            {morningSlots.map((slot: number) => (
              <th key={slot} className="tt-period-header tt-morning">
                <div className="tt-period-num">P{slot}</div>
                <div className="tt-period-label">Period {slot}</div>
              </th>
            ))}
            <th className="tt-lunch-header">🍴</th>
            {afternoonSlots.map((slot: number) => (
              <th key={slot} className="tt-period-header tt-afternoon">
                <div className="tt-period-num">P{slot}</div>
                <div className="tt-period-label">Period {slot}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((day: number) => (
            <tr key={day} className="tt-day-row">
              <td className="tt-day-header">
                <div className="tt-day-name">{DAY_NAMES[day]}</div>
                <div className="tt-day-short">{DAY_SHORT[day]}</div>
              </td>
              {morningSlots.map((slot: number) => {
                const entry = getTeacherEntry(day, slot);
                return (
                  <td key={slot} className={`tt-entry-cell ${entry ? 'filled' : 'empty'}`}>
                    {entry ? (
                      <div className="tt-entry-content">
                        <span className="tt-subject" style={{ color: 'var(--primary-700)', fontSize: 12 }}>
                          {entry.subject?.code || entry.subject?.name || '?'}
                        </span>
                        <span className="tt-teacher" style={{
                          background: 'var(--primary-100)', color: 'var(--primary-700)',
                          fontWeight: 700, fontSize: 11,
                        }}>
                          {getDivLabel(entry.divisionId)}
                        </span>
                      </div>
                    ) : (
                      <span className="tt-empty-mark">—</span>
                    )}
                  </td>
                );
              })}
              <td className="tt-lunch-cell"><span>Lunch</span></td>
              {afternoonSlots.map((slot: number) => {
                const entry = getTeacherEntry(day, slot);
                return (
                  <td key={slot} className={`tt-entry-cell tt-pm ${entry ? 'filled' : 'empty'}`}>
                    {entry ? (
                      <div className="tt-entry-content">
                        <span className="tt-subject" style={{ color: 'var(--primary-700)', fontSize: 12 }}>
                          {entry.subject?.code || entry.subject?.name || '?'}
                        </span>
                        <span className="tt-teacher" style={{
                          background: 'var(--primary-100)', color: 'var(--primary-700)',
                          fontWeight: 700, fontSize: 11,
                        }}>
                          {getDivLabel(entry.divisionId)}
                        </span>
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

/* ── Parallel MAL1/SAN/ARA cell ── */
.tt-parallel-cell {
  align-items: center;
}
.tt-parallel-label {
  font-size: 11px !important;
  font-weight: 800 !important;
  letter-spacing: .3px;
  color: var(--primary-700) !important;
  background: linear-gradient(135deg, var(--primary-50), #e0f2fe);
  border: 1px solid var(--primary-200);
  border-radius: 4px;
  padding: 2px 5px;
  text-align: center;
  line-height: 1.3;
}
.tt-parallel-teachers {
  display: flex; flex-wrap: wrap; gap: 2px; justify-content: center;
  margin-top: 1px;
}
/* Mobile parallel */
.tt-parallel-subject {
  font-weight: 800;
  font-size: 14px;
  color: var(--primary-700);
  letter-spacing: .5px;
}
.tt-parallel-code {
  display: inline-flex;
  align-items: center;
  background: var(--primary-100);
  color: var(--primary-800);
  font-size: 11px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 3px;
  margin: 0 2px;
}

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

/* ── Tablet ── */
@media (max-width: 1024px) {
  .tt-constraints-grid { grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
}

/* ── Mobile responsive for timetable ── */
@media (max-width: 640px) {
  .tt-inverted-wrapper { border-radius: 0; }
  .tt-corner-cell { min-width: 80px; font-size: 9px; padding: 8px 10px; }
  .tt-period-header { min-width: 72px; padding: 6px 3px; }
  .tt-period-num { font-size: 12px; }
  .tt-period-label { display: none; }
  .tt-day-header { padding: 8px 10px; }
  .tt-day-name { font-size: 11px; }
  .tt-entry-cell { padding: 6px 4px; }
  .tt-subject { font-size: 11px; }
  .tt-parallel-label { font-size: 9px !important; letter-spacing: 0; }
  .tt-parallel-teachers .tt-teacher { font-size: 9px; padding: 0 3px; }
  .tt-lunch-cell { font-size: 9px; }
}

/* ── Report Tab ── */
.tt-report-tab { display: flex; flex-direction: column; gap: 0; }

.tt-report-config-banner {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 10px;
  margin-bottom: 16px;
}
.tt-report-config-tile {
  display: flex; flex-direction: column; align-items: center;
  padding: 12px 8px; border-radius: 12px; text-align: center;
  background: var(--bg-card); border: 1px solid var(--border-color);
  gap: 4px;
}
.tt-config-icon { font-size: 20px; }
.tt-config-value { font-size: 22px; font-weight: 800; color: var(--primary-600); line-height: 1; }
.tt-config-label { font-size: 10px; color: var(--gray-500); font-weight: 600; text-transform: uppercase; letter-spacing: .4px; }

.tt-report-chip {
  display: inline-flex; align-items: center;
  padding: 4px 12px; border-radius: 999px;
  font-size: 12px; font-weight: 600; white-space: nowrap;
}
.tt-report-chip.error { background: #fef2f2; color: #dc2626; border: 1px solid rgba(220,38,38,.2); }
.tt-report-chip.warning { background: #fffbeb; color: #d97706; border: 1px solid rgba(217,119,6,.2); }
.tt-report-chip.info { background: #eff6ff; color: #2563eb; border: 1px solid rgba(37,99,235,.2); }
.tt-report-chip.success { background: #f0fdf4; color: #16a34a; border: 1px solid rgba(22,163,74,.2); }
.tt-report-chip.neutral { background: var(--gray-100); color: var(--gray-600); border: 1px solid var(--border-color); }

.tt-report-subtab {
  padding: 8px 16px; font-size: 13px; font-weight: 600;
  color: var(--gray-500); border: none; background: none;
  border-bottom: 2px solid transparent; margin-bottom: -2px;
  cursor: pointer; transition: all var(--transition);
  white-space: nowrap;
}
.tt-report-subtab:hover { color: var(--gray-800); }
.tt-report-subtab.active { color: var(--primary-600); border-bottom-color: var(--primary-600); }

.tt-report-table {
  width: 100%; border-collapse: collapse; font-size: 12.5px;
  min-width: 700px;
}
.tt-report-table thead tr th {
  background: var(--gray-50); border-bottom: 2px solid var(--border-color);
  padding: 9px 12px; text-align: left; font-weight: 700;
  font-size: 11px; text-transform: uppercase; letter-spacing: .4px;
  color: var(--gray-600); white-space: nowrap;
}
.tt-report-table tbody tr td {
  padding: 9px 12px; border-bottom: 1px solid var(--border-color);
  vertical-align: middle;
}
.tt-report-table tbody tr:hover td { background: var(--gray-50); }
.tt-report-table tbody tr:last-child td { border-bottom: none; }

/* ── Print ── */
@media print {
  .tt-analysis-panel, .tt-conditions, .tabs,
  .tt-result-banner, .no-print { display: none !important; }
  
  /* Force containers to show all overflowing content without clipping or scrollbars */
  .card-body, .card, .tt-inverted-wrapper {
    overflow: visible !important;
    overflow-x: visible !important;
  }
  
  /* Allow table and cells to compress and auto-fit the page width */
  .tt-inverted-table {
    width: 100% !important;
    min-width: auto !important;
    font-size: 10px !important;
    table-layout: fixed !important;
  }
  
  .tt-corner-cell {
    min-width: auto !important;
    width: 12% !important;
    padding: 6px 4px !important;
    font-size: 9px !important;
  }
  
  .tt-period-header {
    min-width: auto !important;
    width: 11% !important;
    padding: 6px 2px !important;
  }
  
  .tt-lunch-header {
    min-width: auto !important;
    width: 11% !important;
    padding: 6px 2px !important;
  }
  
  .tt-lunch-cell {
    min-width: auto !important;
    padding: 6px 2px !important;
  }
  
  .tt-period-num {
    font-size: 11px !important;
  }
  
  .tt-period-label {
    font-size: 8px !important;
  }
  
  .tt-day-header {
    padding: 6px 4px !important;
  }
  
  .tt-day-name {
    font-size: 10px !important;
  }
  
  .tt-entry-cell {
    padding: 4px 2px !important;
  }
  
  .tt-subject {
    font-size: 9px !important;
    word-break: break-all !important;
  }
  
  .tt-teacher {
    font-size: 8px !important;
    padding: 0 2px !important;
  }

  /* Parallel MAL1/SAN/ARA styles for print */
  .tt-parallel-cell {
    padding: 2px !important;
  }
  
  .tt-parallel-label {
    background: #e0f2fe !important;
    -webkit-print-color-adjust: exact;
    color: #004d40 !important;
    font-size: 8px !important;
    padding: 1px 3px !important;
    line-height: 1.1 !important;
    letter-spacing: 0 !important;
  }
  
  .tt-parallel-teachers {
    gap: 1px !important;
  }
  
  .tt-parallel-teachers .tt-teacher {
    font-size: 8px !important;
    padding: 0 2px !important;
  }
  
  .tt-period-header.tt-morning { background: #2d6a4f !important; -webkit-print-color-adjust: exact; }
  .tt-period-header.tt-afternoon { background: #1e5c42 !important; -webkit-print-color-adjust: exact; }
  
  .tt-print-card {
    break-inside: avoid !important;
    page-break-inside: avoid !important;
    margin-bottom: 24px !important;
  }
}
`;
