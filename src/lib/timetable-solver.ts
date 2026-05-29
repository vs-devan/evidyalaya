/**
 * Sophisticated Timetable Solver for Kerala Government Schools
 *
 * Three-stage hybrid pipeline:
 *   Stage 1 — Constraint Propagation + MRV Greedy Fill (initial feasible solution)
 *   Stage 2 — Simulated Annealing Optimization (5 passes × 40 000 iterations)
 *   Stage 3 — Targeted gap repair (external, via Gemini AI — handled by caller)
 *
 * Hard constraints (always enforced — moves that violate are rejected):
 *   H1  Division-slot uniqueness: max 1 subject per (division, day, slot)
 *   H2  Teacher-time uniqueness:  max 1 assignment per (teacher, day, slot)
 *   H3  Consecutive-slot validity: block doesn't span lunch, all slots available
 *   H4  Fixed placements:         fixedDay / fixedSlot subjects are pinned
 *
 * Soft constraints (scored on an 8-dimension quality metric, 0–100):
 *   S1  Fill rate               — 40 pts
 *   S2  Subject-day uniqueness  — 12 pts
 *   S3  Subject-week spread     —  8 pts
 *   S4  Core-morning preference —  8 pts
 *   S5  Evening-priority pref.  —  5 pts
 *   S6  Teacher load balance    — 10 pts
 *   S7  Class-teacher Period 1  — 12 pts
 *   S8  Consecutive compliance  —  5 pts
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

const SA_PASSES         = 5;
const SA_ITERATIONS     = 40_000;
const SA_T_START        = 5.0;
const SA_T_MIN          = 0.001;
const SA_REHEAT_STALL   = 5_000;   // reheat if no improvement for N iterations
const SA_REHEAT_FACTOR  = 3;       // multiply temp by this on reheat

// Score weights (must sum to 100)
const W_FILL            = 40;
const W_DAY_UNIQUE      = 12;
const W_WEEK_SPREAD     =  8;
const W_CORE_MORNING    =  8;
const W_EVENING         =  5;
const W_TEACHER_BAL     = 10;
const W_CT_P1           = 12;
const W_CONSECUTIVE     =  5;

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
  sdCount: Map<string, number>;       // "divId:subId:d" → count
  tLoad: Map<string, number>;         // teacherId → total assigned slots

  assignedCount: number;

  constructor(vars: Variable[], cfg: SolverConfig) {
    this.vars = vars;
    this.cfg  = cfg;
    this.asgn = new Array(vars.length).fill(undefined);
    this.divGrid     = new Map();
    this.teacherGrid = new Map();
    this.sdCount     = new Map();
    this.tLoad       = new Map();
    this.assignedCount = 0;
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  divSlotFree(divId: string, d: number, s: number): boolean {
    return !this.divGrid.has(`${divId}:${d}:${s}`);
  }

  teacherFree(tid: string, d: number, s: number): boolean {
    return !this.teacherGrid.has(`${tid}:${d}:${s}`);
  }

  /** Can variable v be placed at (day, slot) without violating hard constraints? */
  canPlace(v: Variable, d: number, s: number): boolean {
    for (let i = 0; i < v.blockSize; i++) {
      const slot = s + i;
      if (slot > this.cfg.slotsPerDay) return false;
      if (!this.divSlotFree(v.divisionId, d, slot)) return false;
      if (!this.teacherFree(v.teacherId, d, slot))  return false;
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
    }
    const sdk = `${v.divisionId}:${v.subjectId}:${d}`;
    this.sdCount.set(sdk, (this.sdCount.get(sdk) ?? 0) + 1);
    this.tLoad.set(v.teacherId, (this.tLoad.get(v.teacherId) ?? 0) + v.blockSize);
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
    }
    const sdk = `${v.divisionId}:${v.subjectId}:${a.day}`;
    const c = this.sdCount.get(sdk) ?? 0;
    if (c <= 1) this.sdCount.delete(sdk); else this.sdCount.set(sdk, c - 1);
    this.tLoad.set(v.teacherId, (this.tLoad.get(v.teacherId) ?? 0) - v.blockSize);
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

  for (const div of input.divisions) {
    for (const ds of div.subjects) {
      const teacherId = ds.useClassTeacher
        ? (div.classTeacherId ?? ds.teacherId)
        : ds.teacherId;
      if (!teacherId) continue;

      const blockSize = ds.consecutiveSlots > 1 ? ds.consecutiveSlots : 1;
      const numBlocks = Math.floor(ds.periodsPerWeek / blockSize);
      const remainder = ds.periodsPerWeek - numBlocks * blockSize;

      const fixedSlot = resolveSlotNumber(ds.fixedSlot, input.slotsPerDay);

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
      domain.push({ day: d, slot: s });
    }
  }
  return domain;
}

// ═════════════════════════════════════════════════════════════════════════════
//  SCORING FUNCTION — 8 weighted dimensions, total 0–100
// ═════════════════════════════════════════════════════════════════════════════

function computeScore(state: State): ScoreBreakdown {
  const { vars, cfg, asgn, sdCount, tLoad } = state;
  const N = vars.length;
  if (N === 0) return emptyScore();

  // ── S1: Fill rate ────────────────────────────────────────────────────────
  const fillRate = state.assignedCount / N;

  // ── S2: Subject-day uniqueness ───────────────────────────────────────────
  // Count how many (div, subject, day) triples have count > 1 (violations)
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
  // For each (division, subject), how evenly are assigned days spread?
  // Measure: for subjects with ≥3 periods, compute stddev of day-gap.
  const divSubjectDays: Map<string, number[]> = new Map(); // "div:sub" → sorted days
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
    // Ideal gap = numDays / numPeriods. Actual gaps vary.
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
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0; // coefficient of variation
    balanceScore = Math.max(0, 1 - cv);
  }

  // ── S7: Class-teacher Period 1 ───────────────────────────────────────────
  // For each division with a class teacher, count days where CT teaches slot 1
  const divisionCTs: Map<string, string> = new Map(); // divId → classTeacherId
  for (const v of vars) {
    if (v.classTeacherId) divisionCTs.set(v.divisionId, v.classTeacherId);
  }
  let ctDays = 0, ctP1Days = 0;
  for (const [divId, ctId] of divisionCTs) {
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
    if (asgn[i]) consOk++; // if assigned, it's valid (canPlace enforces validity)
  }
  const consScore = consTotal > 0 ? consOk / consTotal : 1;

  // ── Weighted total ───────────────────────────────────────────────────────
  const total =
    W_FILL         * fillRate         +
    W_DAY_UNIQUE   * dayUniqueScore   +
    W_WEEK_SPREAD  * weekSpreadScore  +
    W_CORE_MORNING * coreMorningScore +
    W_EVENING      * eveningScore     +
    W_TEACHER_BAL  * balanceScore     +
    W_CT_P1        * ctP1Score        +
    W_CONSECUTIVE  * consScore;

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
  };
}

function emptyScore(): ScoreBreakdown {
  return {
    total: 0, fillRate: 0, subjectDayUniqueness: 100, subjectWeekSpread: 100,
    coreMorning: 100, eveningPriority: 100, teacherBalance: 100,
    classTeacherP1: 100, consecutiveCompliance: 100,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
//  INITIAL SOLUTION — MRV Greedy with Forward Checking
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Build an initial feasible solution using the Minimum-Remaining-Values
 * heuristic: always assign the most constrained variable first.
 */
function buildInitialSolution(state: State): void {
  const { vars, cfg } = state;

  // Compute static domains for all variables
  const domains: Assignment[][] = vars.map(v => computeDomain(v, cfg));

  // Build priority ordering:
  //  1. Fixed-placement variables (smallest domain) first
  //  2. Variables whose teacher is very busy (fewer free slots)
  //  3. Consecutive-block variables before singles
  //  4. Higher periodsPerWeek first (more constrained)
  const order = vars.map((_, i) => i);
  order.sort((a, b) => {
    const va = vars[a], vb = vars[b];
    // Fixed-placement gets highest priority
    const fixedA = (va.fixedDay !== null || va.fixedSlot !== null) ? 0 : 1;
    const fixedB = (vb.fixedDay !== null || vb.fixedSlot !== null) ? 0 : 1;
    if (fixedA !== fixedB) return fixedA - fixedB;
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

      // Prefer unique subject-day
      const sdKey = `${v.divisionId}:${v.subjectId}:${val.day}`;
      const existing = state.sdCount.get(sdKey) ?? 0;
      if (existing === 0) score += 10;
      else score -= 5 * existing;

      // Core subjects prefer morning
      if (v.isCore && !v.eveningPriority && val.slot <= cfg.morningPeriods) score += 4;
      // Evening-priority subjects prefer afternoon
      if (v.eveningPriority && val.slot > cfg.morningPeriods) score += 4;

      // Class-teacher subjects prefer slot 1
      if (v.teacherId === v.classTeacherId && val.slot === 1) score += 8;

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
    if (v.teacherId === v.classTeacherId && val.slot === 1) s += 6;
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

    if (fillRate < 1 && r < 0.35) {
      // FILL — try to assign unassigned variables
      const result = tryFill(state);
      if (result?.applied) {
        moveApplied = true;
        const capturedVi = result.vi;
        undoFn = () => undoFill(state, capturedVi);
      }
    } else if (fillRate < 1 && r < 0.50) {
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
    } else if (r < (fillRate < 1 ? 0.75 : 0.50)) {
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
  const state = new State(vars, cfg);
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

  for (let pass = 1; pass <= SA_PASSES; pass++) {
    const pct = 35 + Math.round((pass / SA_PASSES) * 45);
    emit('annealing', pct - 8,
      `Simulated Annealing — Pass ${pass}/${SA_PASSES}`,
      `Temperature: ${SA_T_START}→${SA_T_MIN}, ${SA_ITERATIONS.toLocaleString()} iterations`);

    // If not the first pass, start from the best known state
    if (pass > 1) {
      restoreState(state, bestState.asgn);
      // Add small perturbation to escape local optimum
      perturbState(state, Math.floor(state.assignedCount * 0.05));
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
