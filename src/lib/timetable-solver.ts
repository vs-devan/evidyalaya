/**
 * Sophisticated Timetable Solver for Kerala Government Schools
 *
 * Three-stage hybrid pipeline:
 *   Stage 1 — Constraint Propagation + MRV Greedy Fill (initial feasible solution)
 *   Stage 2 — Simulated Annealing Optimization (8 passes × 80 000 iterations)
 *   Stage 3 — Targeted gap repair (external, via Gemini AI — handled by caller)
 *
 * Hard constraints (always enforced — moves that violate are rejected):
 *   H1  Division-slot uniqueness: max 1 subject per (division, day, slot)
 *   H2  Teacher-time uniqueness:  max 1 assignment per (teacher, day, slot)
 *   H3  Consecutive-slot validity: block doesn't span lunch, all slots available
 *   H4  Fixed placements:         fixedDay / fixedSlot subjects are pinned
 *
 * Soft constraints (scored on an 8-dimension quality metric, 0–100):
 *   S1  Fill rate               — 35 pts
 *   S2  Subject-day uniqueness  — 10 pts
 *   S3  Subject-week spread     —  6 pts
 *   S4  Core-morning preference —  7 pts
 *   S5  Evening-priority pref.  —  4 pts
 *   S6  Teacher load balance    —  8 pts
 *   S7  Class-teacher Period 1  — 18 pts  ← highest priority soft constraint
 *   S8  Consecutive compliance  —  4 pts
 *   S9  No teacher hat-trick    —  8 pts
 */

import type {
  TimetableInput,
  TimetableSlot,
  GenerationResult,
  DivisionInput,
  DivisionSubjectInput,
} from './timetable-engine';

// ═════════════════════════════════════════════════════════════════════════════
//  PUBLIC TYPES
// ═════════════════════════════════════════════════════════════════════════════

export type ProgressCallback = (
  phase: string,
  pct: number,
  label: string,
  detail?: string,
) => void;

export interface ScoreBreakdown {
  total: number;
  fillRate: number;
  subjectDayUniqueness: number;
  subjectWeekSpread: number;
  coreMorning: number;
  eveningPriority: number;
  teacherBalance: number;
  classTeacherP1: number;
  consecutiveCompliance: number;
  teacherDailyConsistency: number;
}

export interface SolverResult extends GenerationResult {
  score: ScoreBreakdown;
}

// ═════════════════════════════════════════════════════════════════════════════
//  INTERNAL TYPES
// ═════════════════════════════════════════════════════════════════════════════

interface Variable {
  idx: number;                // index in the variables array
  divisionId: string;
  subjectId: string;
  teacherId: string;
  blockSize: number;          // 1 = single slot, 2 = consecutive pair
  isCore: boolean;
  eveningPriority: boolean;
  fixedDay: number | null;    // 1–6 or null
  fixedSlot: number | null;   // resolved slot number or null
  classTeacherId: string | null;
  variantTeacherIds: string[];
  coScheduledDivisions?: { divisionId: string; teacherId: string }[];
  sharedVenueGroupId: string | null; // if set, enforces venue exclusivity across all divisions
}

interface Assignment {
  day: number;
  slot: number; // start slot (for blockSize=2, also occupies slot+1)
}

interface SolverConfig {
  days: number;
  slotsPerDay: number;
  morningPeriods: number;
  constraints: Set<string>;
}

// ═════════════════════════════════════════════════════════════════════════════
//  SA CONSTANTS
// ═════════════════════════════════════════════════════════════════════════════

const SA_PASSES         = 20;
const SA_ITERATIONS     = 150_000;
const SA_T_START        = 8.0;
const SA_T_MIN          = 0.0005;
const SA_REHEAT_STALL   = 8_000;   // reheat if no improvement for N iterations
const SA_REHEAT_FACTOR  = 4;       // multiply temp by this on reheat

// Score weights (must sum to 100)
const W_FILL            = 33;
const W_DAY_UNIQUE      =  9;
const W_WEEK_SPREAD     =  5;
const W_CORE_MORNING    =  7;
const W_EVENING         =  4;
const W_TEACHER_BAL     =  6;
const W_CT_P1           = 16;  // ← heavily boosted: CT must own Period 1
const W_CONSECUTIVE     =  4;
const W_NO_TEACHER_HAT  =  6;  // penalise same teacher 3+ consecutive slots
const W_TEACHER_DAILY   = 10;  // teacher daily consistency: ≥4 periods per working day

// ═════════════════════════════════════════════════════════════════════════════
//  STATE CLASS — mutable with O(1) assign / unassign / constraint checks
// ═════════════════════════════════════════════════════════════════════════════

class State {
  vars: Variable[];
  cfg: SolverConfig;

  // Assignments: varIdx → Assignment | undefined (unassigned)
  asgn: (Assignment | undefined)[];

  // Tracking maps (maintained incrementally)
  divGrid: Map<string, number>;       // "divId:d:s" → varIdx
  teacherGrid: Map<string, number>;   // "tid:d:s"   → varIdx
  venueGrid: Map<string, number>;     // "venueGroupId:d:s" → varIdx
  sdCount: Map<string, number>;       // "divId:subId:d" → count
  tLoad: Map<string, number>;         // teacherId → total assigned slots
  tDayLoad: Map<string, number>;      // "teacherId:day" → periods on that day

  assignedCount: number;
  divisionCTs: Map<string, string>;   // divisionId → classTeacherId cache

  constructor(
    vars: Variable[],
    cfg: SolverConfig,
    lockedSlots?: { teacherId: string; day: number; slot: number }[],
    lockedVenueSlots?: { venueGroupId: string; day: number; slot: number }[]
  ) {
    this.vars = vars;
    this.cfg  = cfg;
    this.asgn = new Array(vars.length).fill(undefined);
    this.divGrid     = new Map();
    this.teacherGrid = new Map();
    this.venueGrid   = new Map();
    this.sdCount     = new Map();
    this.tLoad       = new Map();
    this.tDayLoad    = new Map();
    this.assignedCount = 0;

    // Cache division CTs
    this.divisionCTs = new Map();
    for (const v of vars) {
      if (v.classTeacherId) {
        this.divisionCTs.set(v.divisionId, v.classTeacherId);
      }
    }

    // Pre-populate locked teacher slots so they are blocked for other scheduling variables
    if (lockedSlots) {
      for (const ls of lockedSlots) {
        this.teacherGrid.set(`${ls.teacherId}:${ls.day}:${ls.slot}`, -999);
      }
    }

    // Pre-populate locked venue slots so shared resources from locked divisions are blocked
    if (lockedVenueSlots) {
      for (const lv of lockedVenueSlots) {
        this.venueGrid.set(`${lv.venueGroupId}:${lv.day}:${lv.slot}`, -999);
      }
    }
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  divSlotFree(divId: string, d: number, s: number): boolean {
    return !this.divGrid.has(`${divId}:${d}:${s}`);
  }

  teacherFree(tid: string, d: number, s: number): boolean {
    return !this.teacherGrid.has(`${tid}:${d}:${s}`);
  }

  venueFree(venueGroupId: string, d: number, s: number): boolean {
    return !this.venueGrid.has(`${venueGroupId}:${d}:${s}`);
  }

  /** Can variable v be placed at (day, slot) without violating hard constraints? */
  canPlace(v: Variable, d: number, s: number): boolean {
    // H5: Evening-priority subjects (PE, Art, etc.) must NOT be placed in slot 1
    if (v.eveningPriority && s === 1) return false;

    for (let i = 0; i < v.blockSize; i++) {
      const slot = s + i;
      if (slot > this.cfg.slotsPerDay) return false;
      if (!this.divSlotFree(v.divisionId, d, slot)) return false;
      if (!this.teacherFree(v.teacherId, d, slot))  return false;

      // Shared venue constraint: check that no other division is using
      // this venue group at the same (day, slot)
      if (v.sharedVenueGroupId && !this.venueFree(v.sharedVenueGroupId, d, slot)) return false;

      if (v.coScheduledDivisions) {
        for (const co of v.coScheduledDivisions) {
          if (!this.divSlotFree(co.divisionId, d, slot)) return false;
          if (!this.teacherFree(co.teacherId, d, slot))  return false;
        }
      }

      if (v.variantTeacherIds.length > 0) {
        for (const vtId of v.variantTeacherIds) {
          if (!this.teacherFree(vtId, d, slot)) return false;
        }
      }
    }
    // Consecutive block must not span lunch
    if (v.blockSize > 1) {
      const mp = this.cfg.morningPeriods;
      if (s <= mp && s + v.blockSize - 1 > mp) return false;
    }
    return true;
  }

  // ── Mutations ────────────────────────────────────────────────────────────

  place(vi: number, d: number, s: number): void {
    const v = this.vars[vi];
    this.asgn[vi] = { day: d, slot: s };
    for (let i = 0; i < v.blockSize; i++) {
      this.divGrid.set(`${v.divisionId}:${d}:${s + i}`, vi);
      this.teacherGrid.set(`${v.teacherId}:${d}:${s + i}`, vi);

      // Register venue occupancy (school-wide shared resource)
      if (v.sharedVenueGroupId) {
        this.venueGrid.set(`${v.sharedVenueGroupId}:${d}:${s + i}`, vi);
      }

      if (v.coScheduledDivisions) {
        for (const co of v.coScheduledDivisions) {
          this.divGrid.set(`${co.divisionId}:${d}:${s + i}`, vi);
          this.teacherGrid.set(`${co.teacherId}:${d}:${s + i}`, vi);
        }
      }

      if (v.variantTeacherIds.length > 0) {
        for (const vtId of v.variantTeacherIds) {
          this.teacherGrid.set(`${vtId}:${d}:${s + i}`, vi);
        }
      }
    }
    const sdk = `${v.divisionId}:${v.subjectId}:${d}`;
    this.sdCount.set(sdk, (this.sdCount.get(sdk) ?? 0) + 1);
    this.tLoad.set(v.teacherId, (this.tLoad.get(v.teacherId) ?? 0) + v.blockSize);
    // Track per-day teacher load for daily consistency scoring
    const tdlKey = `${v.teacherId}:${d}`;
    this.tDayLoad.set(tdlKey, (this.tDayLoad.get(tdlKey) ?? 0) + v.blockSize);

    if (v.coScheduledDivisions) {
      for (const co of v.coScheduledDivisions) {
        const coSdk = `${co.divisionId}:${v.subjectId}:${d}`;
        this.sdCount.set(coSdk, (this.sdCount.get(coSdk) ?? 0) + 1);
        this.tLoad.set(co.teacherId, (this.tLoad.get(co.teacherId) ?? 0) + v.blockSize);
        const coTdlKey = `${co.teacherId}:${d}`;
        this.tDayLoad.set(coTdlKey, (this.tDayLoad.get(coTdlKey) ?? 0) + v.blockSize);
      }
    }

    this.assignedCount++;
  }

  remove(vi: number): Assignment | undefined {
    const a = this.asgn[vi];
    if (!a) return undefined;
    const v = this.vars[vi];
    this.asgn[vi] = undefined;
    for (let i = 0; i < v.blockSize; i++) {
      this.divGrid.delete(`${v.divisionId}:${a.day}:${a.slot + i}`);
      this.teacherGrid.delete(`${v.teacherId}:${a.day}:${a.slot + i}`);

      // Release venue occupancy
      if (v.sharedVenueGroupId) {
        this.venueGrid.delete(`${v.sharedVenueGroupId}:${a.day}:${a.slot + i}`);
      }

      if (v.coScheduledDivisions) {
        for (const co of v.coScheduledDivisions) {
          this.divGrid.delete(`${co.divisionId}:${a.day}:${a.slot + i}`);
          this.teacherGrid.delete(`${co.teacherId}:${a.day}:${a.slot + i}`);
        }
      }

      if (v.variantTeacherIds.length > 0) {
        for (const vtId of v.variantTeacherIds) {
          this.teacherGrid.delete(`${vtId}:${a.day}:${a.slot + i}`);
        }
      }
    }
    const sdk = `${v.divisionId}:${v.subjectId}:${a.day}`;
    const c = this.sdCount.get(sdk) ?? 0;
    if (c <= 1) this.sdCount.delete(sdk); else this.sdCount.set(sdk, c - 1);
    this.tLoad.set(v.teacherId, (this.tLoad.get(v.teacherId) ?? 0) - v.blockSize);
    // Update per-day teacher load
    const tdlKey = `${v.teacherId}:${a.day}`;
    const tdlC = this.tDayLoad.get(tdlKey) ?? 0;
    if (tdlC <= v.blockSize) this.tDayLoad.delete(tdlKey); else this.tDayLoad.set(tdlKey, tdlC - v.blockSize);

    if (v.coScheduledDivisions) {
      for (const co of v.coScheduledDivisions) {
        const coSdk = `${co.divisionId}:${v.subjectId}:${a.day}`;
        const coC = this.sdCount.get(coSdk) ?? 0;
        if (coC <= 1) this.sdCount.delete(coSdk); else this.sdCount.set(coSdk, coC - 1);
        this.tLoad.set(co.teacherId, (this.tLoad.get(co.teacherId) ?? 0) - v.blockSize);
        const coTdlKey = `${co.teacherId}:${a.day}`;
        const coTdlC = this.tDayLoad.get(coTdlKey) ?? 0;
        if (coTdlC <= v.blockSize) this.tDayLoad.delete(coTdlKey); else this.tDayLoad.set(coTdlKey, coTdlC - v.blockSize);
      }
    }

    this.assignedCount--;
    return a;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  VARIABLE CONSTRUCTION
// ═════════════════════════════════════════════════════════════════════════════

function resolveSlotNumber(fixedSlot: string | null, slotsPerDay: number): number | null {
  if (!fixedSlot) return null;
  if (fixedSlot === 'FIRST') return 1;
  if (fixedSlot === 'LAST')  return slotsPerDay;
  const n = parseInt(fixedSlot, 10);
  return isNaN(n) ? null : n;
}

function buildVariables(input: TimetableInput): Variable[] {
  const vars: Variable[] = [];
  let idx = 0;

  // 1. Map each base subject to its variant subject IDs
  const variantSubjectsByBase = new Map<string, string[]>();
  const baseSubjectIds = new Set<string>();

  // Shared PE-group subjects are co-scheduled like language-variant base subjects
  for (const id of (input.sharedSubjectIds ?? [])) {
    baseSubjectIds.add(id);
  }

  for (const s of input.subjects as any) {
    if (s.isLanguageVariant && s.replacesSubjectId) {
      const baseId = s.replacesSubjectId;
      baseSubjectIds.add(baseId);
      if (!variantSubjectsByBase.has(baseId)) {
        variantSubjectsByBase.set(baseId, []);
      }
      variantSubjectsByBase.get(baseId)!.push(s.id);
    }
  }

  // 2. Map each variant subject to teacher IDs who teach it
  const teachersBySubject = new Map<string, string[]>();
  for (const t of input.teachers as any) {
    const mappings = t.subjectMappings || [];
    for (const subId of mappings) {
      if (!teachersBySubject.has(subId)) {
        teachersBySubject.set(subId, []);
      }
      teachersBySubject.get(subId)!.push(t.id);
    }
  }

  // 3. Map each base subject to its variant teacher IDs
  const variantTeachersByBase = new Map<string, string[]>();
  for (const [baseId, variantSubIds] of variantSubjectsByBase.entries()) {
    const teacherIds = new Set<string>();
    for (const vSubId of variantSubIds) {
      const tIds = teachersBySubject.get(vSubId) || [];
      for (const tId of tIds) {
        teacherIds.add(tId);
      }
    }
    if (teacherIds.size > 0) {
      variantTeachersByBase.set(baseId, Array.from(teacherIds));
    }
  }

  for (const div of input.divisions) {
    for (const ds of div.subjects) {
      // Skip scheduling base subjects for follower divisions
      if (div.isFollowerDivision && baseSubjectIds.has(ds.subjectId)) {
        continue;
      }

      const teacherId = ds.useClassTeacher
        ? (div.classTeacherId ?? ds.teacherId)
        : ds.teacherId;
      if (!teacherId) continue;

      const blockSize = ds.consecutiveSlots > 1 ? ds.consecutiveSlots : 1;
      const numBlocks = Math.floor(ds.periodsPerWeek / blockSize);
      const remainder = ds.periodsPerWeek - numBlocks * blockSize;

      const fixedSlot = resolveSlotNumber(ds.fixedSlot, input.slotsPerDay);
      const variantTeacherIds = baseSubjectIds.has(ds.subjectId) ? (div.variantTeacherIds ?? []) : [];
      const coScheduledDivisions = ds.coScheduledDivisions ||
        (baseSubjectIds.has(ds.subjectId) && !(input.sharedSubjectIds || []).includes(ds.subjectId)
          ? div.coScheduledDivisions
          : undefined);
      const sharedVenueGroupId = ds.sharedVenueGroupId ?? null;

      // Create block-sized variables
      for (let p = 0; p < numBlocks; p++) {
        vars.push({
          idx,
          divisionId: div.id,
          subjectId: ds.subjectId,
          teacherId,
          blockSize,
          isCore: ds.isCore,
          eveningPriority: ds.eveningPriority,
          fixedDay: ds.fixedDay ?? null,
          fixedSlot,
          classTeacherId: div.classTeacherId,
          variantTeacherIds,
          coScheduledDivisions,
          sharedVenueGroupId,
        });
        idx++;
      }

      // Create single-slot variables for remainder
      for (let p = 0; p < remainder; p++) {
        vars.push({
          idx,
          divisionId: div.id,
          subjectId: ds.subjectId,
          teacherId,
          blockSize: 1,
          isCore: ds.isCore,
          eveningPriority: ds.eveningPriority,
          fixedDay: ds.fixedDay ?? null,
          fixedSlot,
          classTeacherId: div.classTeacherId,
          variantTeacherIds,
          coScheduledDivisions,
          sharedVenueGroupId,
        });
        idx++;
      }
    }
  }

  return vars;
}

// ═════════════════════════════════════════════════════════════════════════════
//  DOMAIN COMPUTATION — valid (day, slot) pairs for each variable
// ═════════════════════════════════════════════════════════════════════════════

function computeDomain(v: Variable, cfg: SolverConfig): Assignment[] {
  const domain: Assignment[] = [];
  const days = v.fixedDay ? [v.fixedDay] : range(1, cfg.days);
  const slots = v.fixedSlot ? [v.fixedSlot] : range(1, cfg.slotsPerDay);

  for (const d of days) {
    for (const s of slots) {
      // Block must fit within the day
      if (s + v.blockSize - 1 > cfg.slotsPerDay) continue;
      // Block must not span lunch
      if (v.blockSize > 1 && s <= cfg.morningPeriods && s + v.blockSize - 1 > cfg.morningPeriods) continue;
      // Evening-priority subjects (PE, Art, etc.) must not be placed in slot 1
      if (v.eveningPriority && s === 1) continue;
      domain.push({ day: d, slot: s });
    }
  }
  return domain;
}

// ═════════════════════════════════════════════════════════════════════════════
//  SCORING FUNCTION — 9 weighted dimensions, total 0–100
// ═════════════════════════════════════════════════════════════════════════════

function computeScore(state: State): ScoreBreakdown {
  const { vars, cfg, asgn, sdCount, tLoad } = state;
  const N = vars.length;
  if (N === 0) return emptyScore();

  // ── S1: Fill rate ────────────────────────────────────────────────────────
  const fillRate = state.assignedCount / N;

  // ── S2: Subject-day uniqueness ───────────────────────────────────────────
  let totalDivSubjectDays = 0;
  let uniqueViolations = 0;
  for (const c of sdCount.values()) {
    totalDivSubjectDays++;
    if (c > 1) uniqueViolations += (c - 1);
  }
  const dayUniqueScore = totalDivSubjectDays > 0
    ? Math.max(0, 1 - uniqueViolations / totalDivSubjectDays)
    : 1;

  // ── S3: Subject-week spread ──────────────────────────────────────────────
  const divSubjectDays: Map<string, number[]> = new Map();
  for (let i = 0; i < N; i++) {
    const a = asgn[i];
    if (!a) continue;
    const k = `${vars[i].divisionId}:${vars[i].subjectId}`;
    if (!divSubjectDays.has(k)) divSubjectDays.set(k, []);
    divSubjectDays.get(k)!.push(a.day);
  }
  let spreadTotal = 0, spreadCount = 0;
  for (const [, days] of divSubjectDays) {
    if (days.length < 2) { spreadTotal += 1; spreadCount++; continue; }
    days.sort((a, b) => a - b);
    const idealGap = cfg.days / days.length;
    let gapDeviation = 0;
    for (let j = 1; j < days.length; j++) {
      gapDeviation += Math.abs(days[j] - days[j - 1] - idealGap);
    }
    const maxDeviation = idealGap * (days.length - 1);
    spreadTotal += maxDeviation > 0 ? Math.max(0, 1 - gapDeviation / maxDeviation) : 1;
    spreadCount++;
  }
  const weekSpreadScore = spreadCount > 0 ? spreadTotal / spreadCount : 1;

  // ── S4: Core subjects in morning ─────────────────────────────────────────
  let coreTotal = 0, coreMorning = 0;
  for (let i = 0; i < N; i++) {
    if (!vars[i].isCore || vars[i].eveningPriority) continue;
    const a = asgn[i];
    if (!a) continue;
    coreTotal++;
    if (a.slot <= cfg.morningPeriods) coreMorning++;
  }
  const coreMorningScore = coreTotal > 0 ? coreMorning / coreTotal : 1;

  // ── S5: Evening-priority in afternoon ────────────────────────────────────
  let eveTotal = 0, eveAfternoon = 0;
  for (let i = 0; i < N; i++) {
    if (!vars[i].eveningPriority) continue;
    const a = asgn[i];
    if (!a) continue;
    eveTotal++;
    if (a.slot > cfg.morningPeriods) eveAfternoon++;
  }
  const eveningScore = eveTotal > 0 ? eveAfternoon / eveTotal : 1;

  // ── S6: Teacher load balance ─────────────────────────────────────────────
  const loads = Array.from(tLoad.values()).filter(l => l > 0);
  let balanceScore = 1;
  if (loads.length > 1) {
    const mean = loads.reduce((a, b) => a + b, 0) / loads.length;
    const variance = loads.reduce((s, l) => s + (l - mean) ** 2, 0) / loads.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
    balanceScore = Math.max(0, 1 - cv);
  }

  // ── S7: Class-teacher Period 1 (HEAVILY WEIGHTED) ────────────────────────
  // For each division with a class teacher, count days where CT teaches slot 1
  let ctDays = 0, ctP1Days = 0;
  for (const [divId, ctId] of state.divisionCTs) {
    for (let d = 1; d <= cfg.days; d++) {
      ctDays++;
      const key = `${divId}:${d}:1`;
      const occupant = state.divGrid.get(key);
      if (occupant !== undefined && vars[occupant].teacherId === ctId) {
        ctP1Days++;
      }
    }
  }
  const ctP1Score = ctDays > 0 ? ctP1Days / ctDays : 1;

  // ── S8: Consecutive-slot compliance ──────────────────────────────────────
  let consTotal = 0, consOk = 0;
  for (let i = 0; i < N; i++) {
    if (vars[i].blockSize <= 1) continue;
    consTotal++;
    if (asgn[i]) consOk++;
  }
  const consScore = consTotal > 0 ? consOk / consTotal : 1;

  // ── S9: No teacher hat-trick (same teacher ≥3 consecutive in a division) ─
  let hatTrickSlots = 0, hatTrickViolations = 0;
  for (const [divId] of state.divisionCTs) {
    for (let d = 1; d <= cfg.days; d++) {
      let runLen = 0;
      let lastTeacher = '';
      for (let s = 1; s <= cfg.slotsPerDay; s++) {
        const occ = state.divGrid.get(`${divId}:${d}:${s}`);
        const tid = occ !== undefined ? vars[occ].teacherId : '';
        if (tid && tid === lastTeacher) {
          runLen++;
          if (runLen >= 3) hatTrickViolations++;
        } else {
          runLen = 1;
          lastTeacher = tid;
        }
        hatTrickSlots++;
      }
    }
  }
  const hatTrickScore = hatTrickSlots > 0
    ? Math.max(0, 1 - hatTrickViolations / (hatTrickSlots * 0.1))
    : 1;

  // ── S10: Teacher daily consistency (≥4 periods per working day) ────────────
  // For each teacher, count days they work. On each working day, check if ≥4 periods.
  // Score = avg across all teachers of (days with ≥4 / total working days).
  const teacherWorkingDays = new Map<string, { totalDays: number; goodDays: number }>();
  for (const [key, load] of state.tDayLoad) {
    const tid = key.split(':')[0];
    if (!teacherWorkingDays.has(tid)) {
      teacherWorkingDays.set(tid, { totalDays: 0, goodDays: 0 });
    }
    const entry = teacherWorkingDays.get(tid)!;
    entry.totalDays++;
    if (load >= 4) entry.goodDays++;
  }
  let dailyConsistencyTotal = 0, dailyConsistencyCount = 0;
  for (const [, data] of teacherWorkingDays) {
    if (data.totalDays > 0) {
      dailyConsistencyTotal += data.goodDays / data.totalDays;
      dailyConsistencyCount++;
    }
  }
  const teacherDailyScore = dailyConsistencyCount > 0
    ? dailyConsistencyTotal / dailyConsistencyCount
    : 1;

  // ── Weighted total ───────────────────────────────────────────────────────────
  const total =
    W_FILL            * fillRate         +
    W_DAY_UNIQUE      * dayUniqueScore   +
    W_WEEK_SPREAD     * weekSpreadScore  +
    W_CORE_MORNING    * coreMorningScore +
    W_EVENING         * eveningScore     +
    W_TEACHER_BAL     * balanceScore     +
    W_CT_P1           * ctP1Score        +
    W_CONSECUTIVE     * consScore        +
    W_NO_TEACHER_HAT  * hatTrickScore    +
    W_TEACHER_DAILY   * teacherDailyScore;

  return {
    total,
    fillRate:              round2(fillRate * 100),
    subjectDayUniqueness:  round2(dayUniqueScore * 100),
    subjectWeekSpread:     round2(weekSpreadScore * 100),
    coreMorning:           round2(coreMorningScore * 100),
    eveningPriority:       round2(eveningScore * 100),
    teacherBalance:        round2(balanceScore * 100),
    classTeacherP1:        round2(ctP1Score * 100),
    consecutiveCompliance: round2(consScore * 100),
    teacherDailyConsistency: round2(teacherDailyScore * 100),
  };
}

function emptyScore(): ScoreBreakdown {
  return {
    total: 0, fillRate: 0, subjectDayUniqueness: 100, subjectWeekSpread: 100,
    coreMorning: 100, eveningPriority: 100, teacherBalance: 100,
    classTeacherP1: 100, consecutiveCompliance: 100, teacherDailyConsistency: 100,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
//  INITIAL SOLUTION — MRV Greedy with Forward Checking
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Build an initial feasible solution using:
 *   Phase A — Dedicated Class-Teacher Period 1 placement
 *   Phase B — MRV Greedy Fill for everything else
 */
function buildInitialSolution(state: State): void {
  const { vars, cfg } = state;

  // ══ Phase A: Class-Teacher Period 1 placement (guaranteed) ═══════════════
  // For each division, find all variables taught by the class teacher
  // and pin exactly one to slot 1 for each day of the week.
  for (const [divId, ctId] of state.divisionCTs) {
    // Collect all CT-taught variables for this division, unassigned, blockSize <= 2
    const ctVars = vars
      .filter(v =>
        v.divisionId === divId &&
        v.teacherId === ctId &&
        v.blockSize <= 2 &&
        v.fixedDay === null &&
        v.fixedSlot === null &&
        !state.asgn[v.idx]
      )
      .map(v => v.idx);

    if (ctVars.length === 0) continue;

    // Try to assign one CT variable to slot 1 for each day
    let ctPool = [...ctVars];
    for (let d = 1; d <= cfg.days; d++) {
      if (ctPool.length === 0) break;

      // Pick the CT variable that would best fill slot 1 today
      // Prefer one whose subject hasn't been placed on this day yet and is a single slot
      let bestVi = -1;
      let bestS = -Infinity;
      for (const vi of ctPool) {
        const v = vars[vi];
        if (!state.canPlace(v, d, 1)) continue;

        let s = 0;
        const sdKey = `${v.divisionId}:${v.subjectId}:${d}`;
        if ((state.sdCount.get(sdKey) ?? 0) === 0) s += 10;
        if (v.isCore) s += 3;
        if (v.blockSize === 1) s += 5; // prefer single periods in Period 1

        if (s > bestS) {
          bestS = s;
          bestVi = vi;
        }
      }

      if (bestVi !== -1) {
        state.place(bestVi, d, 1);
        ctPool = ctPool.filter(vi => vi !== bestVi);
      }
    }
  }

  // ══ Phase B: MRV Greedy Fill for remaining variables ═════════════════════
  const domains: Assignment[][] = vars.map(v => computeDomain(v, cfg));

  // Build priority ordering:
  //  1. Fixed-placement variables (smallest domain) first
  //  2. CT variables that still need placement (high priority)
  //  3. Smaller domain = more constrained = earlier
  //  4. Consecutive-block variables before singles
  const order = vars
    .filter(v => !state.asgn[v.idx]) // Skip already-placed CT-P1 vars
    .map(v => v.idx);

  order.sort((a, b) => {
    const va = vars[a], vb = vars[b];
    // Fixed-placement gets highest priority
    const fixedA = (va.fixedDay !== null || va.fixedSlot !== null) ? 0 : 1;
    const fixedB = (vb.fixedDay !== null || vb.fixedSlot !== null) ? 0 : 1;
    if (fixedA !== fixedB) return fixedA - fixedB;
    // CT-taught subjects get priority (so CT has more slots to choose from)
    const ctA = va.teacherId === va.classTeacherId ? 0 : 1;
    const ctB = vb.teacherId === vb.classTeacherId ? 0 : 1;
    if (ctA !== ctB) return ctA - ctB;
    // Smaller domain = more constrained = earlier
    const da = domains[a].length, db = domains[b].length;
    if (da !== db) return da - db;
    // Consecutive before single
    if (va.blockSize !== vb.blockSize) return vb.blockSize - va.blockSize;
    return 0;
  });

  // Greedy assignment with forward checking
  for (const vi of order) {
    const v = vars[vi];
    const domain = domains[vi];

    // Filter domain to currently valid placements
    const valid = domain.filter(a => state.canPlace(v, a.day, a.slot));
    if (valid.length === 0) continue; // Leave unassigned — SA will handle

    // Score each valid placement and pick the best
    let bestVal = valid[0];
    let bestScore = -Infinity;

    for (const val of valid) {
      let score = 0;

      // Prefer unique subject-day (strong preference)
      const sdKey = `${v.divisionId}:${v.subjectId}:${val.day}`;
      const existing = state.sdCount.get(sdKey) ?? 0;
      if (existing === 0) score += 12;
      else score -= 6 * existing;

      // Core subjects prefer morning
      if (v.isCore && !v.eveningPriority && val.slot <= cfg.morningPeriods) score += 5;
      // Evening-priority subjects prefer afternoon
      if (v.eveningPriority && val.slot > cfg.morningPeriods) score += 5;

      // Class-teacher subjects STRONGLY prefer slot 1 (even for non-Phase-A vars)
      if (v.teacherId === v.classTeacherId && val.slot === 1) score += 20;
      // Also give slight preference to slot 1 even for non-CT (preserves CT-P1)
      // by penalizing CT-taught vars going to slot 1 in other divisions
      if (v.teacherId !== v.classTeacherId && val.slot === 1) score -= 2;

      // Prefer lower teacher load on this day (spread load)
      let tDayLoad = 0;
      for (let s = 1; s <= cfg.slotsPerDay; s++) {
        if (!state.teacherFree(v.teacherId, val.day, s)) tDayLoad++;
      }
      score -= tDayLoad;

      if (score > bestScore) {
        bestScore = score;
        bestVal = val;
      }
    }

    state.place(vi, bestVal.day, bestVal.slot);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  SIMULATED ANNEALING — Neighbourhood Operators
// ═════════════════════════════════════════════════════════════════════════════

/**
 * SWAP: Pick two assigned entries in the same division, swap their (day, slot).
 * Returns true if the move was applied (undoable via swapping back).
 */
function trySwap(state: State): { applied: boolean; vi1: number; vi2: number } | null {
  const assigned = assignedIndices(state);
  if (assigned.length < 2) return null;

  const vi1 = assigned[randInt(assigned.length)];
  const v1 = state.vars[vi1];

  // Find another assigned var in the same division with compatible block size
  const candidates = assigned.filter(
    i => i !== vi1 && state.vars[i].divisionId === v1.divisionId && state.vars[i].blockSize === v1.blockSize
  );
  if (candidates.length === 0) return null;

  const vi2 = candidates[randInt(candidates.length)];
  const v2 = state.vars[vi2];

  // Don't swap fixed-placement variables
  if (v1.fixedDay !== null || v1.fixedSlot !== null) return null;
  if (v2.fixedDay !== null || v2.fixedSlot !== null) return null;

  const a1 = state.asgn[vi1]!;
  const a2 = state.asgn[vi2]!;

  // Temporarily remove both
  state.remove(vi1);
  state.remove(vi2);

  // Check if we can place them in swapped positions
  if (state.canPlace(v1, a2.day, a2.slot) && state.canPlace(v2, a1.day, a1.slot)) {
    // Check if v2 can be placed after v1 (since placing v1 changes teacher grid)
    state.place(vi1, a2.day, a2.slot);
    if (state.canPlace(v2, a1.day, a1.slot)) {
      state.place(vi2, a1.day, a1.slot);
      return { applied: true, vi1, vi2 };
    }
    // Undo v1
    state.remove(vi1);
  }

  // Restore originals
  state.place(vi1, a1.day, a1.slot);
  state.place(vi2, a2.day, a2.slot);
  return { applied: false, vi1, vi2 };
}

function undoSwap(state: State, vi1: number, vi2: number): void {
  const a1 = state.asgn[vi1]!;
  const a2 = state.asgn[vi2]!;
  state.remove(vi1);
  state.remove(vi2);
  state.place(vi1, a2.day, a2.slot);
  state.place(vi2, a1.day, a1.slot);
}

/**
 * MOVE: Pick an assigned entry, move to a different empty slot in same division.
 */
function tryMove(state: State): { applied: boolean; vi: number; oldA: Assignment } | null {
  const assigned = assignedIndices(state);
  if (assigned.length === 0) return null;

  const vi = assigned[randInt(assigned.length)];
  const v = state.vars[vi];

  // Don't move fixed variables
  if (v.fixedDay !== null || v.fixedSlot !== null) return null;

  const oldA = state.asgn[vi]!;
  state.remove(vi);

  // Find a random valid placement different from old
  const domain = computeDomain(v, state.cfg);
  const valid = domain.filter(
    a => (a.day !== oldA.day || a.slot !== oldA.slot) && state.canPlace(v, a.day, a.slot)
  );

  if (valid.length === 0) {
    state.place(vi, oldA.day, oldA.slot); // restore
    return { applied: false, vi, oldA };
  }

  const newA = valid[randInt(valid.length)];
  state.place(vi, newA.day, newA.slot);
  return { applied: true, vi, oldA };
}

function undoMove(state: State, vi: number, oldA: Assignment): void {
  state.remove(vi);
  state.place(vi, oldA.day, oldA.slot);
}

/**
 * FILL: Pick an unassigned variable, try to assign to a valid slot.
 */
function tryFill(state: State): { applied: boolean; vi: number } | null {
  const unassigned = unassignedIndices(state);
  if (unassigned.length === 0) return null;

  const vi = unassigned[randInt(unassigned.length)];
  const v = state.vars[vi];

  const domain = computeDomain(v, state.cfg);
  const valid = domain.filter(a => state.canPlace(v, a.day, a.slot));
  if (valid.length === 0) return { applied: false, vi };

  // Pick a slot with good heuristic score
  let best = valid[0];
  let bestS = -Infinity;
  for (const val of valid) {
    let s = 0;
    const sdKey = `${v.divisionId}:${v.subjectId}:${val.day}`;
    if ((state.sdCount.get(sdKey) ?? 0) === 0) s += 8;
    if (v.isCore && !v.eveningPriority && val.slot <= state.cfg.morningPeriods) s += 3;
    if (v.eveningPriority && val.slot > state.cfg.morningPeriods) s += 3;
    // Heavily prefer slot 1 for class-teacher subjects
    if (v.teacherId === v.classTeacherId && val.slot === 1) s += 20;
    if (s > bestS) { bestS = s; best = val; }
  }

  state.place(vi, best.day, best.slot);
  return { applied: true, vi };
}

function undoFill(state: State, vi: number): void {
  state.remove(vi);
}

/**
 * EJECT+FILL: Eject an assigned variable to make room, try to fill an unassigned one,
 * then try to reassign the ejected variable elsewhere.
 */
function tryEjectFill(state: State): {
  applied: boolean;
  ejected?: { vi: number; oldA: Assignment };
  filled?: number;
  ejectedNewA?: Assignment;
} | null {
  const unassigned = unassignedIndices(state);
  if (unassigned.length === 0) return null;

  const fillVi = unassigned[randInt(unassigned.length)];
  const fillV = state.vars[fillVi];

  // Find an assigned variable in the same division that, if ejected, would free a valid slot
  const assigned = assignedIndices(state).filter(
    i => state.vars[i].divisionId === fillV.divisionId &&
      state.vars[i].fixedDay === null && state.vars[i].fixedSlot === null
  );
  if (assigned.length === 0) return null;

  const ejectVi = assigned[randInt(assigned.length)];
  const ejectOldA = state.remove(ejectVi)!;

  // Try to fill the unassigned variable now
  const domain = computeDomain(fillV, state.cfg);
  const valid = domain.filter(a => state.canPlace(fillV, a.day, a.slot));

  if (valid.length === 0) {
    // Restore ejected
    state.place(ejectVi, ejectOldA.day, ejectOldA.slot);
    return { applied: false };
  }

  const fillSlot = valid[randInt(valid.length)];
  state.place(fillVi, fillSlot.day, fillSlot.slot);

  // Try to reassign ejected variable elsewhere
  const ejectV = state.vars[ejectVi];
  const ejectDomain = computeDomain(ejectV, state.cfg);
  const ejectValid = ejectDomain.filter(a => state.canPlace(ejectV, a.day, a.slot));

  if (ejectValid.length > 0) {
    const newA = ejectValid[randInt(ejectValid.length)];
    state.place(ejectVi, newA.day, newA.slot);
    return {
      applied: true,
      ejected: { vi: ejectVi, oldA: ejectOldA },
      filled: fillVi,
      ejectedNewA: newA,
    };
  }

  // Ejected var couldn't be reassigned — undo everything
  state.remove(fillVi);
  state.place(ejectVi, ejectOldA.day, ejectOldA.slot);
  return { applied: false };
}

/**
 * MOVE_CT_TO_P1: Selects a division, day, and moves or swaps a Class Teacher to slot 1.
 */
function tryMoveCTToP1(state: State): {
  applied: boolean;
  vi1?: number; // the CT variable moved to P1
  oldA1?: Assignment;
  vi2?: number; // the variable previously at P1 that was moved/ejected
  oldA2?: Assignment;
  isSwap?: boolean;
} | null {
  const { vars, cfg } = state;

  if (state.divisionCTs.size === 0) return null;

  const divIds = Array.from(state.divisionCTs.keys());
  const divId = divIds[randInt(divIds.length)];
  const ctId = state.divisionCTs.get(divId)!;

  // Pick a random day
  const d = 1 + randInt(cfg.days);

  // Check occupant of slot 1 on this day
  const p1Key = `${divId}:${d}:1`;
  const occupantVi = state.divGrid.get(p1Key);

  if (occupantVi !== undefined && vars[occupantVi].teacherId === ctId) {
    // Already Class Teacher at P1 on this day
    return null;
  }

  // Find all CT-taught variables for this division (blockSize <= 2)
  const ctVars = vars.filter(v =>
    v.divisionId === divId &&
    v.teacherId === ctId &&
    v.blockSize <= 2 &&
    v.fixedDay === null &&
    v.fixedSlot === null
  );
  if (ctVars.length === 0) return null;

  // Pick one CT variable to place in P1.
  // Preferably one that is currently assigned elsewhere (to move it), or unassigned (to fill it).
  shuffleArray(ctVars);
  const targetV = ctVars.find(v => {
    const a = state.asgn[v.idx];
    return !a || a.slot !== 1;
  });
  if (!targetV) return null;

  const vi1 = targetV.idx;
  const oldA1 = state.asgn[vi1]; // might be undefined

  // We want to place targetV at (d, 1).
  // First, check if CT is free at (d, 1) or if CT is only busy with targetV itself.
  if (oldA1) state.remove(vi1);

  const isCTFreeAtP1 = state.teacherFree(ctId, d, 1);
  if (!isCTFreeAtP1) {
    if (oldA1) state.place(vi1, oldA1.day, oldA1.slot); // restore
    return null;
  }

  // Now, what about the occupant of (d, 1)?
  if (occupantVi === undefined) {
    // P1 is completely free!
    if (state.canPlace(targetV, d, 1)) {
      state.place(vi1, d, 1);
      return {
        applied: true,
        vi1,
        oldA1,
      };
    } else {
      if (oldA1) state.place(vi1, oldA1.day, oldA1.slot); // restore
      return null;
    }
  } else {
    // P1 is occupied by occupantVi.
    const v2 = vars[occupantVi];
    if (v2.fixedDay !== null || v2.fixedSlot !== null) {
      // Cannot move a fixed variable
      if (oldA1) state.place(vi1, oldA1.day, oldA1.slot);
      return null;
    }

    // Try to SWAP: place targetV at (d, 1) and occupantVi at targetV's old position (oldA1)
    const oldA2 = state.asgn[occupantVi]!;
    state.remove(occupantVi);

    if (oldA1) {
      // Try to place targetV at (d, 1) and occupantVi at oldA1
      if (state.canPlace(targetV, d, 1) && state.canPlace(v2, oldA1.day, oldA1.slot)) {
        state.place(vi1, d, 1);
        if (state.canPlace(v2, oldA1.day, oldA1.slot)) {
          state.place(occupantVi, oldA1.day, oldA1.slot);
          return {
            applied: true,
            vi1,
            oldA1,
            vi2: occupantVi,
            oldA2,
            isSwap: true,
          };
        }
        state.remove(vi1);
      }
    } else {
      // EJECT+FILL style: targetV was unassigned. We place targetV at (d, 1), and then try to move occupantVi to any other valid slot.
      if (state.canPlace(targetV, d, 1)) {
        state.place(vi1, d, 1);

        const v2Domain = computeDomain(v2, state.cfg);
        const v2Valid = v2Domain.filter(a => (a.day !== oldA2.day || a.slot !== oldA2.slot) && state.canPlace(v2, a.day, a.slot));
        if (v2Valid.length > 0) {
          const newA2 = v2Valid[randInt(v2Valid.length)];
          state.place(occupantVi, newA2.day, newA2.slot);
          return {
            applied: true,
            vi1,
            oldA1: undefined,
            vi2: occupantVi,
            oldA2,
            isSwap: false,
          };
        }
        state.remove(vi1);
      }
    }

    // Restore both
    state.place(occupantVi, oldA2.day, oldA2.slot);
    if (oldA1) state.place(vi1, oldA1.day, oldA1.slot);
    return null;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  SIMULATED ANNEALING — Main Loop
// ═════════════════════════════════════════════════════════════════════════════

function runSAPass(state: State, iterations: number): { score: number; improved: boolean } {
  let currentScore = computeScore(state).total;
  let bestScore = currentScore;
  let temp = SA_T_START;
  const alpha = Math.pow(SA_T_MIN / SA_T_START, 1 / iterations);
  let stallCount = 0;

  for (let iter = 0; iter < iterations; iter++) {
    temp *= alpha;

    // Adaptive operator selection based on fill rate
    const fillRate = state.assignedCount / state.vars.length;
    const r = Math.random();

    let moveApplied = false;
    let undoFn: (() => void) | null = null;

    if (r < 0.15) {
      // MOVE_CT_TO_P1 — target Class Teacher for Period 1
      const result = tryMoveCTToP1(state);
      if (result?.applied) {
        moveApplied = true;
        const { vi1, oldA1, vi2, oldA2 } = result;
        undoFn = () => {
          state.remove(vi1!);
          if (vi2 !== undefined) {
            state.remove(vi2);
            state.place(vi2, oldA2!.day, oldA2!.slot);
          }
          if (oldA1) {
            state.place(vi1!, oldA1.day, oldA1.slot);
          }
        };
      }
    } else if (fillRate < 1 && r < 0.45) {
      // FILL — try to assign unassigned variables
      const result = tryFill(state);
      if (result?.applied) {
        moveApplied = true;
        const capturedVi = result.vi;
        undoFn = () => undoFill(state, capturedVi);
      }
    } else if (fillRate < 1 && r < 0.55) {
      // EJECT+FILL — eject to make room
      const result = tryEjectFill(state);
      if (result?.applied && result.ejected && result.filled !== undefined) {
        moveApplied = true;
        const ej = result.ejected;
        const fi = result.filled;
        undoFn = () => {
          // Undo: remove filled, remove ejected, restore ejected to old position
          if (state.asgn[ej.vi]) state.remove(ej.vi);
          state.remove(fi);
          state.place(ej.vi, ej.oldA.day, ej.oldA.slot);
        };
      }
    } else if (r < (fillRate < 1 ? 0.78 : 0.58)) {
      // SWAP — exchange two entries in same division
      const result = trySwap(state);
      if (result?.applied) {
        moveApplied = true;
        const { vi1, vi2 } = result;
        undoFn = () => undoSwap(state, vi1, vi2);
      }
    } else {
      // MOVE — relocate one entry
      const result = tryMove(state);
      if (result?.applied) {
        moveApplied = true;
        const { vi, oldA } = result;
        undoFn = () => undoMove(state, vi, oldA);
      }
    }

    if (!moveApplied) continue;

    const newScore = computeScore(state).total;
    const delta = newScore - currentScore;

    if (delta >= 0) {
      // Accept improvement
      currentScore = newScore;
      stallCount = 0;
      if (newScore > bestScore) bestScore = newScore;
      if (newScore >= 100) {
        break;
      }
    } else {
      // Accept degradation with probability exp(delta / temp)
      if (Math.random() < Math.exp(delta / temp)) {
        currentScore = newScore;
        stallCount++;
      } else {
        // Reject — undo
        undoFn!();
        stallCount++;
      }
    }

    // Reheat if stalled
    if (stallCount >= SA_REHEAT_STALL) {
      temp = Math.min(temp * SA_REHEAT_FACTOR, SA_T_START);
      stallCount = 0;
    }
  }

  return { score: currentScore, improved: currentScore > bestScore - 0.01 };
}

// ═════════════════════════════════════════════════════════════════════════════
//  MAIN ENTRY POINT
// ═════════════════════════════════════════════════════════════════════════════

export async function solveTimetable(
  input: TimetableInput,
  activeConstraints: string[],
  onProgress?: ProgressCallback,
): Promise<SolverResult> {
  const emit = onProgress ?? (() => {});
  const errors: string[] = [];
  const warnings: string[] = [];
  let totalIterations = 0;

  const cfg: SolverConfig = {
    days: input.days,
    slotsPerDay: input.slotsPerDay,
    morningPeriods: input.morningPeriods,
    constraints: new Set(activeConstraints),
  };

  // ── Phase 1: Build variables ──────────────────────────────────────────────
  emit('constraint_propagation', 20, 'Building constraint model…');
  const vars = buildVariables(input);

  if (vars.length === 0) {
    return {
      success: false,
      timetable: [],
      errors: ['No schedulable subjects found. Please configure subjects and assign teachers.'],
      warnings: [],
      stats: { totalSlots: 0, filledSlots: 0, conflicts: 0, iterations: 0 },
      score: emptyScore(),
    };
  }

  emit('constraint_propagation', 25, `${vars.length} scheduling variables constructed`,
    `${input.divisions.length} divisions × ${input.days} days × ${input.slotsPerDay} slots`);

  // Yield to event loop so SSE progress is flushed
  await yieldControl();

  // ── Phase 2: Initial solution (greedy with MRV) ───────────────────────────
  emit('constraint_propagation', 28, 'Computing initial solution via MRV heuristic…');
  const state = new State(vars, cfg, input.lockedSlots, input.lockedVenueSlots);
  buildInitialSolution(state);

  const initScore = computeScore(state);
  emit('constraint_propagation', 32,
    `Initial solution: ${state.assignedCount}/${vars.length} slots (${initScore.fillRate.toFixed(1)}%)`,
    `Score: ${initScore.total.toFixed(1)}/100`);

  await yieldControl();

  // ── Phase 3: Simulated Annealing (multi-pass) ─────────────────────────────
  let bestState: { asgn: (Assignment | undefined)[]; score: ScoreBreakdown } = {
    asgn: [...state.asgn],
    score: initScore,
  };

  let lastBestScore = initScore.total;
  let noImprovementPasses = 0;
  const PATIENCE = 3;
  const THRESHOLD = 0.01;

  for (let pass = 1; pass <= SA_PASSES; pass++) {
    const pct = 35 + Math.round((pass / SA_PASSES) * 45);
    emit('annealing', pct - 8,
      `Simulated Annealing — Pass ${pass}/${SA_PASSES}`,
      `Temperature: ${SA_T_START}→${SA_T_MIN}, ${SA_ITERATIONS.toLocaleString()} iterations`);

    // If not the first pass, start from the best known state
    if (pass > 1) {
      restoreState(state, bestState.asgn);
      // Adaptive perturbation: increase escape intensity with each stalled pass
      const perturbPct = Math.min(0.03 + noImprovementPasses * 0.01, 0.08);
      perturbState(state, Math.floor(state.assignedCount * perturbPct));
    }

    const result = runSAPass(state, SA_ITERATIONS);
    totalIterations += SA_ITERATIONS;
    const score = computeScore(state);

    emit('annealing', pct,
      `Pass ${pass}/${SA_PASSES}: ${state.assignedCount}/${vars.length} slots — Score ${score.total.toFixed(1)}/100`,
      `Fill: ${score.fillRate.toFixed(1)}% | CT-P1: ${score.classTeacherP1.toFixed(0)}% | Morning: ${score.coreMorning.toFixed(0)}% | Balance: ${score.teacherBalance.toFixed(0)}%`);

    if (score.total > bestState.score.total) {
      bestState = { asgn: [...state.asgn], score };
    }

    // Early exit if we hit near-perfect score
    if (bestState.score.total >= 99.5) {
      emit('annealing', pct, `Near-perfect score achieved (${bestState.score.total.toFixed(1)}/100)! Stopping early.`, `Optimization complete.`);
      break;
    }

    // Check for stabilization (gradient-based patience)
    const improvement = bestState.score.total - lastBestScore;
    if (improvement < THRESHOLD) {
      noImprovementPasses++;
    } else {
      noImprovementPasses = 0;
      lastBestScore = bestState.score.total;
    }

    if (noImprovementPasses >= PATIENCE) {
      emit('annealing', pct, `Score gradient minimized (no improvement >${THRESHOLD} for ${PATIENCE} passes). Stopping.`, `Final score: ${bestState.score.total.toFixed(1)}/100`);
      break;
    }

    await yieldControl();
  }

  // Restore the best state found across all passes
  restoreState(state, bestState.asgn);
  const finalScore = bestState.score;

  emit('annealing', 82,
    `Best result: ${state.assignedCount}/${vars.length} slots — Score ${finalScore.total.toFixed(1)}/100`,
    `Fill: ${finalScore.fillRate.toFixed(1)}% | Unique: ${finalScore.subjectDayUniqueness.toFixed(0)}% | Spread: ${finalScore.subjectWeekSpread.toFixed(0)}%`);

  // ── Build output ──────────────────────────────────────────────────────────
  const timetable: TimetableSlot[] = [];
  for (let i = 0; i < vars.length; i++) {
    const a = state.asgn[i];
    if (!a) continue;
    const v = vars[i];
    for (let b = 0; b < v.blockSize; b++) {
      timetable.push({
        divisionId: v.divisionId,
        dayOfWeek: a.day,
        slotNumber: a.slot + b,
        subjectId: v.subjectId,
        teacherId: v.teacherId,
      });

      if (v.coScheduledDivisions) {
        for (const co of v.coScheduledDivisions) {
          timetable.push({
            divisionId: co.divisionId,
            dayOfWeek: a.day,
            slotNumber: a.slot + b,
            subjectId: v.subjectId,
            teacherId: co.teacherId,
          });
        }
      }
    }
  }

  // Deduplicate (same div+day+slot should only appear once)
  const seen = new Set<string>();
  const dedupedTimetable: TimetableSlot[] = [];
  for (const entry of timetable) {
    const key = `${entry.divisionId}:${entry.dayOfWeek}:${entry.slotNumber}`;
    if (!seen.has(key)) {
      seen.add(key);
      dedupedTimetable.push(entry);
    }
  }

  // Report unassigned variables
  const unassignedCount = vars.length - state.assignedCount;
  if (unassignedCount > 0) {
    errors.push(`${unassignedCount} period(s) could not be assigned due to hard constraints.`);
  }

  // Check for any subject-day uniqueness violations
  for (const [key, count] of state.sdCount) {
    if (count > 1) {
      const [divId, subId, day] = key.split(':');
      const divName = input.divisions.find(d => d.id === divId)?.name ?? divId;
      const subName = input.subjects.find(s => s.id === subId)?.name ?? subId;
      warnings.push(`${divName}: "${subName}" appears ${count} times on day ${day}`);
    }
  }

  return {
    success: errors.length === 0,
    timetable: dedupedTimetable,
    errors,
    warnings,
    stats: {
      totalSlots: vars.length,
      filledSlots: dedupedTimetable.length,
      conflicts: 0,
      iterations: totalIterations,
    },
    score: finalScore,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
//  STATE MANAGEMENT UTILITIES
// ═════════════════════════════════════════════════════════════════════════════

/** Restore state from a saved assignment snapshot */
function restoreState(state: State, snapshot: (Assignment | undefined)[]): void {
  // Remove all current assignments
  for (let i = 0; i < state.vars.length; i++) {
    if (state.asgn[i]) state.remove(i);
  }
  // Restore from snapshot
  for (let i = 0; i < snapshot.length; i++) {
    const a = snapshot[i];
    if (a) state.place(i, a.day, a.slot);
  }
}

/** Randomly perturb the state by removing a few assigned variables */
function perturbState(state: State, count: number): void {
  const assigned = assignedIndices(state);
  const nonFixed = assigned.filter(i => {
    const v = state.vars[i];
    return v.fixedDay === null && v.fixedSlot === null;
  });
  shuffleArray(nonFixed);
  const toRemove = nonFixed.slice(0, Math.min(count, nonFixed.length));
  for (const vi of toRemove) {
    state.remove(vi);
  }
  // Try to reassign them (greedy)
  for (const vi of toRemove) {
    const v = state.vars[vi];
    const domain = computeDomain(v, state.cfg);
    const valid = domain.filter(a => state.canPlace(v, a.day, a.slot));
    if (valid.length > 0) {
      const pick = valid[randInt(valid.length)];
      state.place(vi, pick.day, pick.slot);
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  GENERIC UTILITIES
// ═════════════════════════════════════════════════════════════════════════════

function assignedIndices(state: State): number[] {
  const result: number[] = [];
  for (let i = 0; i < state.vars.length; i++) {
    if (state.asgn[i]) result.push(i);
  }
  return result;
}

function unassignedIndices(state: State): number[] {
  const result: number[] = [];
  for (let i = 0; i < state.vars.length; i++) {
    if (!state.asgn[i]) result.push(i);
  }
  return result;
}

function range(from: number, to: number): number[] {
  const arr: number[] = [];
  for (let i = from; i <= to; i++) arr.push(i);
  return arr;
}

function randInt(max: number): number {
  return Math.floor(Math.random() * max);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function shuffleArray<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function yieldControl(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

// ═════════════════════════════════════════════════════════════════════════════
//  RE-EXPORTS from timetable-engine for backward compatibility
// ═════════════════════════════════════════════════════════════════════════════

export { findFreeTeachers, getTeacherSlotsForDay, getDivisionTimetable } from './timetable-engine';
