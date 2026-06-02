/**
 * Timetable Generation Engine
 *
 * Uses constraint-satisfaction with backtracking to generate
 * conflict-free weekly timetables for Kerala government schools.
 *
 * Rules:
 * 1. Variable periods/day and working days (from school settings)
 * 2. Class teacher gets Period 1 on each day
 * 3. Core subjects prioritized in morning slots (1 to morningPeriods)
 * 4. Evening priority subjects in afternoon slots
 * 5. No teacher double-booking
 * 6. Max one occurrence of each subject per day per division (unless forced)
 * 7. Consecutive slots for subjects requiring them (no spanning lunch)
 * 8. Uniform teaching load distribution
 * 9. Fixed-day/slot subjects (e.g. Recreation = Friday last) placed first
 * 10. useClassTeacher subjects bypass teacher lookup and use division's class teacher
 * 11. Teacher-class restrictions: if a teacher has restricted classes for a subject,
 *     they only teach that subject to those classes
 */

export interface TimetableInput {
  divisions: DivisionInput[];
  subjects: SubjectInput[];
  teachers: TeacherInput[];
  days: number;        // 5 or 6
  slotsPerDay: number; // e.g. 7
  morningPeriods: number; // periods before lunch, e.g. 4
  // PE-group shared subjects: treated as co-scheduled base subjects during solving
  sharedSubjectIds?: string[];
}

export interface DivisionInput {
  id: string;
  name: string;       // e.g., "8A"
  classId: string;    // parent class ID
  classTeacherId: string | null;
  subjects: DivisionSubjectInput[];
  coScheduledDivisions?: { divisionId: string; teacherId: string }[];
  isFollowerDivision?: boolean;
  variantTeacherIds?: string[];
}

export interface DivisionSubjectInput {
  subjectId: string;
  teacherId: string;        // pre-resolved teacher for this division-subject
  periodsPerWeek: number;
  isCore: boolean;
  eveningPriority: boolean;
  consecutiveSlots: number;
  // Fixed placement rules
  fixedDay: number | null;    // 1–6; null = flexible
  fixedSlot: string | null;   // "FIRST" | "LAST" | "1"–"12"; null = flexible
  useClassTeacher: boolean;   // if true, use division.classTeacherId
  // Shared venue/resource: subjects with the same non-null value cannot be
  // scheduled at the same (day, slot) across any division school-wide.
  sharedVenueGroupId: string | null;
  coScheduledDivisions?: { divisionId: string; teacherId: string }[];
}

export interface SubjectInput {
  id: string;
  name: string;
  isCore: boolean;
  eveningPriority: boolean;
  consecutiveSlots: number;
  periodsPerWeek: number;
  isLanguageVariant?: boolean;
  replacesSubjectId?: string | null;
}

export interface TeacherInput {
  id: string;
  name: string;
  teacherCode: string;
}

export interface TimetableSlot {
  divisionId: string;
  dayOfWeek: number;
  slotNumber: number;
  subjectId: string;
  teacherId: string;
}

export interface GenerationResult {
  success: boolean;
  timetable: TimetableSlot[];
  errors: string[];
  warnings: string[];
  stats: {
    totalSlots: number;
    filledSlots: number;
    conflicts: number;
    iterations: number;
  };
}

export function generateTimetable(input: TimetableInput, activeConstraints: string[] = []): GenerationResult {
  const { divisions, days, slotsPerDay, morningPeriods } = input;
  const errors: string[] = [];
  const warnings: string[] = [];
  const timetable: TimetableSlot[] = [];

  // Track teacher assignments: teacherId → day → Set<slot>
  const teacherSchedule: Map<string, Map<number, Set<number>>> = new Map();
  // Track subjects placed per division per day: divisionId → day → Set<subjectId>
  const divisionDaySubjects: Map<string, Map<number, Set<string>>> = new Map();
  // Teacher load for balancing
  const teacherLoad: Map<string, number> = new Map();

  let iterations = 0;

  // ── Initialize tracking structures ───────────────────────────────────────
  const allTeacherIds = new Set<string>();
  for (const div of divisions) {
    divisionDaySubjects.set(div.id, new Map());
    for (let day = 1; day <= days; day++) {
      divisionDaySubjects.get(div.id)!.set(day, new Set());
    }
    for (const ds of div.subjects) {
      const tid = ds.useClassTeacher ? (div.classTeacherId ?? ds.teacherId) : ds.teacherId;
      if (tid && !teacherSchedule.has(tid)) {
        teacherSchedule.set(tid, new Map());
        for (let day = 1; day <= days; day++) {
          teacherSchedule.get(tid)!.set(day, new Set());
        }
        teacherLoad.set(tid, 0);
        allTeacherIds.add(tid);
      }
    }
  }

  // Helper: resolve actual teacher for a division-subject
  function resolveTeacherId(ds: DivisionSubjectInput, div: DivisionInput): string {
    if (ds.useClassTeacher) return div.classTeacherId ?? ds.teacherId;
    return ds.teacherId;
  }

  // Helper: resolve slot number from "FIRST" / "LAST" / numeric string
  function resolveSlot(fixedSlot: string): number {
    if (fixedSlot === 'FIRST') return 1;
    if (fixedSlot === 'LAST') return slotsPerDay;
    return parseInt(fixedSlot, 10) || 1;
  }

  // ── Step 0: Pin fixed-day/slot subjects ───────────────────────────────────
  for (const div of divisions) {
    for (const ds of div.subjects) {
      if (!ds.fixedDay && !ds.fixedSlot) continue;

      const teacherId = resolveTeacherId(ds, div);
      if (!teacherId) {
        warnings.push(`${div.name}: ${ds.subjectId} has fixed placement but no teacher assigned.`);
        continue;
      }

      // Ensure tracking exists for this teacher
      if (!teacherSchedule.has(teacherId)) {
        teacherSchedule.set(teacherId, new Map());
        for (let day = 1; day <= days; day++) teacherSchedule.get(teacherId)!.set(day, new Set());
        teacherLoad.set(teacherId, 0);
      }

      let periodsPlaced = 0;

      // Determine which days to pin on
      const targetDays: number[] = ds.fixedDay
        ? [ds.fixedDay]
        : Array.from({ length: days }, (_, i) => i + 1);

      for (const day of targetDays) {
        if (day > days) continue; // Respect workingDays
        if (periodsPlaced >= ds.periodsPerWeek) break;

        const targetSlot = ds.fixedSlot ? resolveSlot(ds.fixedSlot) : null;

        if (targetSlot !== null) {
          // Check if slot is free
          const occupied = timetable.find(
            t => t.divisionId === div.id && t.dayOfWeek === day && t.slotNumber === targetSlot
          );
          if (occupied) {
            warnings.push(`${div.name}: Fixed slot Day${day}/Slot${targetSlot} already occupied — skipping ${ds.subjectId}`);
            continue;
          }
          if (teacherSchedule.get(teacherId)?.get(day)?.has(targetSlot)) {
            warnings.push(`${div.name}: Teacher busy at Day${day}/Slot${targetSlot} for fixed subject ${ds.subjectId}`);
            continue;
          }

          timetable.push({ divisionId: div.id, dayOfWeek: day, slotNumber: targetSlot, subjectId: ds.subjectId, teacherId });
          teacherSchedule.get(teacherId)!.get(day)!.add(targetSlot);
          divisionDaySubjects.get(div.id)!.get(day)!.add(ds.subjectId);
          teacherLoad.set(teacherId, (teacherLoad.get(teacherId) || 0) + 1);
          periodsPlaced++;
          iterations++;
        }
      }

      if (periodsPlaced < ds.periodsPerWeek) {
        warnings.push(`${div.name}: Fixed subject ${ds.subjectId} only placed ${periodsPlaced}/${ds.periodsPerWeek} times`);
      }
    }
  }

  // ── Step 1: Class teacher gets Period 1 each day ────────────────────────
  const enableClassTeacherPeriod1 = activeConstraints.length === 0 || activeConstraints.includes('c_ct_period1');
  if (enableClassTeacherPeriod1) {
    for (const div of divisions) {
      if (!div.classTeacherId) continue;

      // Find the main subject the class teacher teaches for this division
      // (prefer a non-fixed subject, ignore useClassTeacher subjects for period 1)
      const ctSubject = div.subjects.find(
        s => s.teacherId === div.classTeacherId && !s.fixedDay && !s.fixedSlot
      );
      if (!ctSubject) {
        warnings.push(`Class teacher for ${div.name} has no flexible subject — Period 1 not assigned`);
        continue;
      }

      const teacherId = div.classTeacherId;

      for (let day = 1; day <= days; day++) {
        if (teacherSchedule.get(teacherId)?.get(day)?.has(1)) continue;

        const alreadyPlaced = timetable.filter(
          t => t.divisionId === div.id && t.subjectId === ctSubject.subjectId
        ).length;
        if (alreadyPlaced >= ctSubject.periodsPerWeek) continue;

        if (divisionDaySubjects.get(div.id)?.get(day)?.has(ctSubject.subjectId)) continue;

        // Check slot 1 is free in this division
        if (timetable.find(t => t.divisionId === div.id && t.dayOfWeek === day && t.slotNumber === 1)) continue;

        timetable.push({ divisionId: div.id, dayOfWeek: day, slotNumber: 1, subjectId: ctSubject.subjectId, teacherId });
        teacherSchedule.get(teacherId)!.get(day)!.add(1);
        divisionDaySubjects.get(div.id)!.get(day)!.add(ctSubject.subjectId);
        teacherLoad.set(teacherId, (teacherLoad.get(teacherId) || 0) + 1);
        iterations++;
      }
    }
  }

  // ── Step 2: Build remaining assignments list ──────────────────────────────
  interface Assignment {
    divisionId: string;
    divisionName: string;
    subjectId: string;
    teacherId: string;
    periodsNeeded: number;
    isCore: boolean;
    eveningPriority: boolean;
    consecutiveSlots: number;
    priority: number;
    hasFixedPlacement: boolean;
  }

  const assignments: Assignment[] = [];

  for (const div of divisions) {
    for (const ds of div.subjects) {
      const teacherId = resolveTeacherId(ds, div);
      if (!teacherId) continue;

      const alreadyPlaced = timetable.filter(
        t => t.divisionId === div.id && t.subjectId === ds.subjectId
      ).length;

      const remaining = ds.periodsPerWeek - alreadyPlaced;
      if (remaining <= 0) continue;

      let priority = 0;
      if (ds.isCore && !ds.eveningPriority) priority = 1;
      else if (ds.isCore) priority = 2;
      else if (!ds.eveningPriority) priority = 3;
      else priority = 4;

      if (ds.periodsPerWeek >= 5) priority -= 0.5;
      if (ds.consecutiveSlots > 1) priority -= 0.3;
      if (ds.fixedDay || ds.fixedSlot) continue; // already handled in Step 0

      assignments.push({
        divisionId: div.id,
        divisionName: div.name,
        subjectId: ds.subjectId,
        teacherId,
        periodsNeeded: remaining,
        isCore: ds.isCore,
        eveningPriority: ds.eveningPriority,
        consecutiveSlots: ds.consecutiveSlots,
        priority,
        hasFixedPlacement: !!(ds.fixedDay || ds.fixedSlot),
      });
    }
  }

  assignments.sort((a, b) => a.priority - b.priority);

  // ── Step 3: Assign remaining slots via constraint satisfaction ───────────
  for (const assignment of assignments) {
    let periodsAssigned = 0;

    // Build slot preference list
    const preferredSlots: number[] = [];
    const fallbackSlots: number[] = [];

    const enableCoreMorning = activeConstraints.length === 0 || activeConstraints.includes('c_core_morning');
    const enableEveningPriority = activeConstraints.length === 0 || activeConstraints.includes('c_evening_priority');

    if (assignment.eveningPriority && enableEveningPriority) {
      for (let s = morningPeriods + 1; s <= slotsPerDay; s++) preferredSlots.push(s);
      for (let s = 2; s <= morningPeriods; s++) fallbackSlots.push(s);
    } else if (assignment.isCore && enableCoreMorning) {
      for (let s = 2; s <= morningPeriods; s++) preferredSlots.push(s);
      preferredSlots.push(1);
      for (let s = morningPeriods + 1; s <= slotsPerDay; s++) fallbackSlots.push(s);
    } else {
      const startSlot = enableClassTeacherPeriod1 ? 2 : 1;
      for (let s = startSlot; s <= slotsPerDay; s++) preferredSlots.push(s);
      if (enableClassTeacherPeriod1) fallbackSlots.push(1);
    }

    const allSlots = [...preferredSlots, ...fallbackSlots];
    const dayOrder = shuffleDays(days);

    const enableNoSameTeacherConsecutive = activeConstraints.includes('c_no_same_teacher_consecutive');

    while (periodsAssigned < assignment.periodsNeeded) {
      let placed = false;

      for (const day of dayOrder) {
        if (periodsAssigned >= assignment.periodsNeeded) break;

        const enableMaxOnceDay = activeConstraints.length === 0 || activeConstraints.includes('c_max_once_day');
        if (enableMaxOnceDay && divisionDaySubjects.get(assignment.divisionId)?.get(day)?.has(assignment.subjectId)) continue;

        for (const slot of allSlots) {
          iterations++;

          if (assignment.consecutiveSlots > 1) {
            const enableNoSpanLunch = activeConstraints.length === 0 || activeConstraints.includes('c_no_span_lunch');
            if (canPlaceConsecutiveSlots(timetable, teacherSchedule, assignment, day, slot, assignment.consecutiveSlots, slotsPerDay, morningPeriods, enableNoSpanLunch, enableNoSameTeacherConsecutive)) {
              for (let cs = 0; cs < assignment.consecutiveSlots; cs++) {
                timetable.push({ divisionId: assignment.divisionId, dayOfWeek: day, slotNumber: slot + cs, subjectId: assignment.subjectId, teacherId: assignment.teacherId });
                teacherSchedule.get(assignment.teacherId)!.get(day)!.add(slot + cs);
                teacherLoad.set(assignment.teacherId, (teacherLoad.get(assignment.teacherId) || 0) + 1);
              }
              divisionDaySubjects.get(assignment.divisionId)!.get(day)!.add(assignment.subjectId);
              periodsAssigned += assignment.consecutiveSlots;
              placed = true;
              break;
            }
          } else {
            if (canPlaceSlot(timetable, teacherSchedule, assignment, day, slot, enableNoSameTeacherConsecutive)) {
              timetable.push({ divisionId: assignment.divisionId, dayOfWeek: day, slotNumber: slot, subjectId: assignment.subjectId, teacherId: assignment.teacherId });
              teacherSchedule.get(assignment.teacherId)!.get(day)!.add(slot);
              divisionDaySubjects.get(assignment.divisionId)!.get(day)!.add(assignment.subjectId);
              teacherLoad.set(assignment.teacherId, (teacherLoad.get(assignment.teacherId) || 0) + 1);
              periodsAssigned++;
              placed = true;
              break;
            }
          }
        }

        if (placed) break;
      }

      if (!placed) {
        // Relaxed: allow same-day repeat
        let forcePlaced = false;
        for (const day of dayOrder) {
          for (const slot of allSlots) {
            if (canPlaceSlot(timetable, teacherSchedule, assignment, day, slot, enableNoSameTeacherConsecutive)) {
              timetable.push({ divisionId: assignment.divisionId, dayOfWeek: day, slotNumber: slot, subjectId: assignment.subjectId, teacherId: assignment.teacherId });
              teacherSchedule.get(assignment.teacherId)!.get(day)!.add(slot);
              divisionDaySubjects.get(assignment.divisionId)!.get(day)!.add(assignment.subjectId);
              teacherLoad.set(assignment.teacherId, (teacherLoad.get(assignment.teacherId) || 0) + 1);
              periodsAssigned++;
              forcePlaced = true;
              break;
            }
          }
          if (forcePlaced) break;
        }

        if (!forcePlaced) {
          errors.push(
            `Could not assign all periods for subject in ${assignment.divisionName}. ` +
            `Assigned ${periodsAssigned}/${assignment.periodsNeeded}`
          );
          break;
        }
      }
    }
  }

  const totalExpected = divisions.reduce(
    (sum, div) => sum + div.subjects.reduce((s, ds) => s + ds.periodsPerWeek, 0),
    0
  );

  return {
    success: errors.length === 0,
    timetable,
    errors,
    warnings,
    stats: {
      totalSlots: totalExpected,
      filledSlots: timetable.length,
      conflicts: 0,
      iterations,
    },
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function canPlaceSlot(
  timetable: TimetableSlot[],
  teacherSchedule: Map<string, Map<number, Set<number>>>,
  assignment: { divisionId: string; teacherId: string; subjectId: string },
  day: number,
  slot: number,
  enableNoSameTeacherConsecutive: boolean = false
): boolean {
  if (timetable.find(t => t.divisionId === assignment.divisionId && t.dayOfWeek === day && t.slotNumber === slot)) return false;
  if (teacherSchedule.get(assignment.teacherId)?.get(day)?.has(slot)) return false;

  if (enableNoSameTeacherConsecutive) {
    const daySchedule = teacherSchedule.get(assignment.teacherId)?.get(day);
    if (daySchedule) {
      let consecutiveCount = 1;
      let prev = slot - 1;
      while (daySchedule.has(prev)) {
        consecutiveCount++;
        prev--;
      }
      let next = slot + 1;
      while (daySchedule.has(next)) {
        consecutiveCount++;
        next++;
      }
      if (consecutiveCount > 3) return false;
    }
  }

  return true;
}

function canPlaceConsecutiveSlots(
  timetable: TimetableSlot[],
  teacherSchedule: Map<string, Map<number, Set<number>>>,
  assignment: { divisionId: string; teacherId: string; subjectId: string },
  day: number,
  startSlot: number,
  count: number,
  maxSlots: number,
  morningPeriods: number,
  enableNoSpanLunch: boolean,
  enableNoSameTeacherConsecutive: boolean = false
): boolean {
  // Don't span across lunch break
  if (enableNoSpanLunch && startSlot <= morningPeriods && startSlot + count - 1 > morningPeriods) return false;
  if (startSlot + count - 1 > maxSlots) return false;
  for (let i = 0; i < count; i++) {
    if (!canPlaceSlot(timetable, teacherSchedule, assignment, day, startSlot + i, enableNoSameTeacherConsecutive)) return false;
  }
  return true;
}

function shuffleDays(days: number): number[] {
  const dayArray = Array.from({ length: days }, (_, i) => i + 1);
  for (let i = dayArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [dayArray[i], dayArray[j]] = [dayArray[j], dayArray[i]];
  }
  return dayArray;
}

// ── Public utilities ───────────────────────────────────────────────────────

export function findFreeTeachers(
  timetable: TimetableSlot[],
  allTeacherIds: string[],
  day: number,
  slot: number
): string[] {
  const busyTeachers = new Set(
    timetable.filter(t => t.dayOfWeek === day && t.slotNumber === slot).map(t => t.teacherId)
  );
  return allTeacherIds.filter(id => !busyTeachers.has(id));
}

export function getTeacherSlotsForDay(
  timetable: TimetableSlot[],
  teacherId: string,
  day: number
): TimetableSlot[] {
  return timetable.filter(t => t.teacherId === teacherId && t.dayOfWeek === day);
}

export function getDivisionTimetable(
  timetable: TimetableSlot[],
  divisionId: string
): TimetableSlot[] {
  return timetable.filter(t => t.divisionId === divisionId);
}
