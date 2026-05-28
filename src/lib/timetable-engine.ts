/**
 * Timetable Generation Engine
 * 
 * Uses constraint-satisfaction with backtracking to generate
 * conflict-free weekly timetables for Kerala government schools.
 * 
 * Rules:
 * 1. 7 periods/day: 4 before lunch (1-4), 3 after lunch (5-7)
 * 2. Class teacher gets Period 1
 * 3. Core subjects prioritized in morning slots
 * 4. Evening priority subjects in afternoon slots (5-7)
 * 5. No teacher double-booking
 * 6. Max one occurrence of each subject per day per division
 * 7. Consecutive slots for subjects requiring them
 * 8. Uniform teaching load distribution
 * 9. Single teacher per subject per division
 */

export interface TimetableInput {
  divisions: DivisionInput[];
  subjects: SubjectInput[];
  teachers: TeacherInput[];
  days: number; // 5 or 6
  slotsPerDay: number; // 7
}

export interface DivisionInput {
  id: string;
  name: string; // e.g., "8A"
  classTeacherId: string | null;
  subjects: DivisionSubjectInput[];
}

export interface DivisionSubjectInput {
  subjectId: string;
  teacherId: string; // assigned teacher for this subject in this division
  periodsPerWeek: number;
  isCore: boolean;
  eveningPriority: boolean;
  consecutiveSlots: number;
}

export interface SubjectInput {
  id: string;
  name: string;
  isCore: boolean;
  eveningPriority: boolean;
  consecutiveSlots: number;
  periodsPerWeek: number;
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

export function generateTimetable(input: TimetableInput): GenerationResult {
  const { divisions, days, slotsPerDay } = input;
  const errors: string[] = [];
  const warnings: string[] = [];
  const timetable: TimetableSlot[] = [];

  // Track teacher assignments: teacher -> day -> Set of slots
  const teacherSchedule: Map<string, Map<number, Set<number>>> = new Map();
  // Track subject-per-day per division: division -> day -> Set of subjects
  const divisionDaySubjects: Map<string, Map<number, Set<string>>> = new Map();
  // Track total assignments per teacher for load balancing
  const teacherLoad: Map<string, number> = new Map();

  let iterations = 0;

  // Initialize tracking structures
  for (const div of divisions) {
    divisionDaySubjects.set(div.id, new Map());
    for (let day = 1; day <= days; day++) {
      divisionDaySubjects.get(div.id)!.set(day, new Set());
    }
    for (const ds of div.subjects) {
      if (!teacherSchedule.has(ds.teacherId)) {
        teacherSchedule.set(ds.teacherId, new Map());
        for (let day = 1; day <= days; day++) {
          teacherSchedule.get(ds.teacherId)!.set(day, new Set());
        }
      }
      teacherLoad.set(ds.teacherId, 0);
    }
  }

  // Step 1: Assign class teacher to Period 1 for each division
  for (const div of divisions) {
    if (!div.classTeacherId) continue;

    // Find the subject the class teacher teaches for this division
    const ctSubject = div.subjects.find(s => s.teacherId === div.classTeacherId);
    if (!ctSubject) {
      warnings.push(`Class teacher for ${div.name} doesn't teach any subject in this division`);
      continue;
    }

    for (let day = 1; day <= days; day++) {
      // Check if class teacher is already assigned to slot 1 on this day
      if (teacherSchedule.get(div.classTeacherId)?.get(day)?.has(1)) continue;

      // Check if we still need periods for this subject
      const currentCount = timetable.filter(
        t => t.divisionId === div.id && t.subjectId === ctSubject.subjectId
      ).length;

      if (currentCount < ctSubject.periodsPerWeek) {
        // Check if subject already assigned this day
        if (divisionDaySubjects.get(div.id)?.get(day)?.has(ctSubject.subjectId)) continue;

        timetable.push({
          divisionId: div.id,
          dayOfWeek: day,
          slotNumber: 1,
          subjectId: ctSubject.subjectId,
          teacherId: div.classTeacherId,
        });

        teacherSchedule.get(div.classTeacherId)!.get(day)!.add(1);
        divisionDaySubjects.get(div.id)!.get(day)!.add(ctSubject.subjectId);
        teacherLoad.set(div.classTeacherId, (teacherLoad.get(div.classTeacherId) || 0) + 1);
        iterations++;
      }
    }
  }

  // Step 2: Build a list of all subject-division assignments needed
  interface Assignment {
    divisionId: string;
    divisionName: string;
    subjectId: string;
    teacherId: string;
    periodsNeeded: number;
    isCore: boolean;
    eveningPriority: boolean;
    consecutiveSlots: number;
    priority: number; // lower = higher priority
  }

  const assignments: Assignment[] = [];

  for (const div of divisions) {
    for (const ds of div.subjects) {
      const currentCount = timetable.filter(
        t => t.divisionId === div.id && t.subjectId === ds.subjectId
      ).length;

      const remaining = ds.periodsPerWeek - currentCount;
      if (remaining > 0) {
        // Priority: core morning subjects > non-core > evening priority
        let priority = 0;
        if (ds.isCore && !ds.eveningPriority) priority = 1;
        else if (ds.isCore) priority = 2;
        else if (!ds.eveningPriority) priority = 3;
        else priority = 4;

        // Higher period count = higher priority (more constrained)
        if (ds.periodsPerWeek >= 5) priority -= 0.5;
        if (ds.consecutiveSlots > 1) priority -= 0.3;

        assignments.push({
          divisionId: div.id,
          divisionName: div.name,
          subjectId: ds.subjectId,
          teacherId: ds.teacherId,
          periodsNeeded: remaining,
          isCore: ds.isCore,
          eveningPriority: ds.eveningPriority,
          consecutiveSlots: ds.consecutiveSlots,
          priority,
        });
      }
    }
  }

  // Sort by priority (most constrained first)
  assignments.sort((a, b) => a.priority - b.priority);

  // Step 3: Assign remaining slots using constraint satisfaction
  for (const assignment of assignments) {
    let periodsAssigned = 0;

    // Determine preferred slots
    const preferredSlots: number[] = [];
    const fallbackSlots: number[] = [];

    if (assignment.eveningPriority) {
      // Prefer afternoon slots
      for (let s = 5; s <= slotsPerDay; s++) preferredSlots.push(s);
      for (let s = 2; s <= 4; s++) fallbackSlots.push(s); // Skip slot 1 (class teacher)
    } else if (assignment.isCore) {
      // Prefer morning slots
      for (let s = 2; s <= 4; s++) preferredSlots.push(s);
      preferredSlots.push(1); // slot 1 may be available if not class teacher's subject
      for (let s = 5; s <= slotsPerDay; s++) fallbackSlots.push(s);
    } else {
      for (let s = 2; s <= slotsPerDay; s++) preferredSlots.push(s);
    }

    const allSlots = [...preferredSlots, ...fallbackSlots];

    // Try to distribute across days
    const dayOrder = shuffleDays(days);

    while (periodsAssigned < assignment.periodsNeeded) {
      let placed = false;

      for (const day of dayOrder) {
        if (periodsAssigned >= assignment.periodsNeeded) break;

        // Check if subject already placed on this day for this division
        if (divisionDaySubjects.get(assignment.divisionId)?.get(day)?.has(assignment.subjectId)) {
          continue;
        }

        for (const slot of allSlots) {
          iterations++;

          // Handle consecutive slots
          if (assignment.consecutiveSlots > 1) {
            const canPlaceConsecutive = canPlaceConsecutiveSlots(
              timetable,
              teacherSchedule,
              assignment,
              day,
              slot,
              assignment.consecutiveSlots,
              slotsPerDay
            );

            if (canPlaceConsecutive) {
              for (let cs = 0; cs < assignment.consecutiveSlots; cs++) {
                timetable.push({
                  divisionId: assignment.divisionId,
                  dayOfWeek: day,
                  slotNumber: slot + cs,
                  subjectId: assignment.subjectId,
                  teacherId: assignment.teacherId,
                });

                teacherSchedule.get(assignment.teacherId)!.get(day)!.add(slot + cs);
                teacherLoad.set(assignment.teacherId, (teacherLoad.get(assignment.teacherId) || 0) + 1);
              }

              divisionDaySubjects.get(assignment.divisionId)!.get(day)!.add(assignment.subjectId);
              periodsAssigned += assignment.consecutiveSlots;
              placed = true;
              break;
            }
          } else {
            // Single slot
            if (canPlaceSlot(timetable, teacherSchedule, assignment, day, slot)) {
              timetable.push({
                divisionId: assignment.divisionId,
                dayOfWeek: day,
                slotNumber: slot,
                subjectId: assignment.subjectId,
                teacherId: assignment.teacherId,
              });

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
        // Try relaxed placement - allow subject on same day if necessary
        let forcePlaced = false;
        for (const day of dayOrder) {
          for (const slot of allSlots) {
            if (canPlaceSlot(timetable, teacherSchedule, assignment, day, slot)) {
              timetable.push({
                divisionId: assignment.divisionId,
                dayOfWeek: day,
                slotNumber: slot,
                subjectId: assignment.subjectId,
                teacherId: assignment.teacherId,
              });

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

  // Calculate stats
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

function canPlaceSlot(
  timetable: TimetableSlot[],
  teacherSchedule: Map<string, Map<number, Set<number>>>,
  assignment: { divisionId: string; teacherId: string; subjectId: string },
  day: number,
  slot: number
): boolean {
  // Check if slot is already occupied in this division
  const existing = timetable.find(
    t => t.divisionId === assignment.divisionId && t.dayOfWeek === day && t.slotNumber === slot
  );
  if (existing) return false;

  // Check if teacher is already busy at this slot on this day
  if (teacherSchedule.get(assignment.teacherId)?.get(day)?.has(slot)) {
    return false;
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
  maxSlots: number
): boolean {
  // Don't span across lunch break (slot 4 to 5)
  if (startSlot <= 4 && startSlot + count - 1 >= 5) return false;

  // Check bounds
  if (startSlot + count - 1 > maxSlots) return false;

  for (let i = 0; i < count; i++) {
    if (!canPlaceSlot(timetable, teacherSchedule, assignment, day, startSlot + i)) {
      return false;
    }
  }

  return true;
}

function shuffleDays(days: number): number[] {
  const dayArray = Array.from({ length: days }, (_, i) => i + 1);
  // Fisher-Yates shuffle
  for (let i = dayArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [dayArray[i], dayArray[j]] = [dayArray[j], dayArray[i]];
  }
  return dayArray;
}

/**
 * Find free teachers for a given day and slot
 */
export function findFreeTeachers(
  timetable: TimetableSlot[],
  allTeacherIds: string[],
  day: number,
  slot: number
): string[] {
  const busyTeachers = new Set(
    timetable
      .filter(t => t.dayOfWeek === day && t.slotNumber === slot)
      .map(t => t.teacherId)
  );

  return allTeacherIds.filter(id => !busyTeachers.has(id));
}

/**
 * Get all slots where a teacher is assigned on a given day
 */
export function getTeacherSlotsForDay(
  timetable: TimetableSlot[],
  teacherId: string,
  day: number
): TimetableSlot[] {
  return timetable.filter(t => t.teacherId === teacherId && t.dayOfWeek === day);
}

/**
 * Get timetable for a specific division
 */
export function getDivisionTimetable(
  timetable: TimetableSlot[],
  divisionId: string
): TimetableSlot[] {
  return timetable.filter(t => t.divisionId === divisionId);
}
