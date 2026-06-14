import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

export interface ConflictDetail {
  type: 'teacher_double_booked' | 'division_slot_occupied' | 'division_locked';
  message: string;
  conflictingEntryId?: string;
}

export interface EditValidationResult {
  entryId: string;
  valid: boolean;
  conflicts: ConflictDetail[];
}

// POST — validate or apply edits
// Body: { action: "validate" | "apply" | "swap", entries?: [...], swap?: { entryId1, entryId2 } }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SCHOOL_ADMIN' || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const tenantId = session.user.tenantId;

  try {
    const body = await req.json();
    const { action } = body;

    if (action === 'swap') {
      return handleSwap(body, tenantId);
    }

    if (action === 'validate' || action === 'apply') {
      return handleEditOrValidate(body, tenantId, action === 'apply');
    }

    return NextResponse.json({ success: false, error: 'Invalid action. Use "validate", "apply", or "swap".' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message }, { status: 500 });
  }
}

// ── Validate / Apply edits ───────────────────────────────────────────────────

async function handleEditOrValidate(
  body: any,
  tenantId: string,
  apply: boolean,
) {
  const { entries } = body;

  if (!Array.isArray(entries) || entries.length === 0) {
    return NextResponse.json({ success: false, error: 'entries array is required' }, { status: 400 });
  }

  // Fetch all current timetable entries for this tenant
  const allEntries = await prisma.timetableEntry.findMany({
    where: { tenantId },
    include: {
      division: { select: { id: true, name: true, timetableLocked: true, class: { select: { name: true } } } },
      subject: { select: { id: true, name: true, code: true } },
      teacher: { select: { id: true, teacherCode: true, user: { select: { name: true } } } },
    },
  });

  const results: EditValidationResult[] = [];
  const pendingUpdates: { id: string; data: any }[] = [];
  const pendingDeletes: string[] = [];
  const pendingCreates: any[] = [];

  // Fetch divisions to check locks and names for CREATE action
  const allDivisions = await prisma.division.findMany({
    where: { class: { tenantId } },
    select: { id: true, name: true, timetableLocked: true, class: { select: { name: true } } },
  });

  for (const edit of entries) {
    const { id, subjectId, teacherId, divisionId, dayOfWeek, slotNumber } = edit;
    const conflicts: ConflictDetail[] = [];

    // 1. DELETE Action (both subjectId and teacherId are null/empty)
    if (id && (!subjectId || !teacherId)) {
      const existing = allEntries.find(e => e.id === id);
      if (!existing) {
        results.push({ entryId: id, valid: false, conflicts: [{ type: 'division_slot_occupied', message: 'Entry not found' }] });
        continue;
      }
      if (existing.division.timetableLocked) {
        conflicts.push({
          type: 'division_locked',
          message: `Division ${existing.division.class.name}${existing.division.name} is locked. Unlock it before editing.`,
        });
      }
      results.push({ entryId: id, valid: conflicts.length === 0, conflicts });
      if (conflicts.length === 0 || (apply && !conflicts.some(c => c.type === 'division_locked'))) {
        pendingDeletes.push(id);
      }
      continue;
    }

    // 2. CREATE Action (no id, but divisionId, day, slot, subject, teacher are provided)
    if (!id) {
      if (!divisionId || !dayOfWeek || !slotNumber || !subjectId || !teacherId) {
        results.push({ entryId: 'new', valid: false, conflicts: [{ type: 'division_slot_occupied', message: 'Missing fields for new entry' }] });
        continue;
      }

      const division = allDivisions.find(d => d.id === divisionId);
      if (!division) {
        results.push({ entryId: 'new', valid: false, conflicts: [{ type: 'division_slot_occupied', message: 'Division not found' }] });
        continue;
      }

      if (division.timetableLocked) {
        conflicts.push({
          type: 'division_locked',
          message: `Division ${division.class.name}${division.name} is locked. Unlock it before editing.`,
        });
      }

      // Check teacher double-booking
      const teacherConflict = allEntries.find(
        e => e.teacherId === teacherId &&
          e.dayOfWeek === dayOfWeek &&
          e.slotNumber === slotNumber
      );
      if (teacherConflict) {
        const teacherObj = teacherConflict.teacher;
        conflicts.push({
          type: 'teacher_double_booked',
          message: `${teacherObj.user.name} (${teacherObj.teacherCode}) is already assigned to ${teacherConflict.division.class.name}${teacherConflict.division.name} at this time slot.`,
          conflictingEntryId: teacherConflict.id,
        });
      }

      results.push({
        entryId: `new:${divisionId}:${dayOfWeek}:${slotNumber}`,
        valid: conflicts.length === 0,
        conflicts,
      });

      if (conflicts.length === 0 || (apply && !conflicts.some(c => c.type === 'division_locked'))) {
        pendingCreates.push({
          tenantId,
          divisionId,
          dayOfWeek,
          slotNumber,
          subjectId,
          teacherId,
        });
      }
      continue;
    }

    // 3. UPDATE Action (existing ID, updating subject and/or teacher)
    const existing = allEntries.find(e => e.id === id);
    if (!existing) {
      results.push({ entryId: id, valid: false, conflicts: [{ type: 'division_slot_occupied', message: 'Entry not found' }] });
      continue;
    }

    // Check division lock
    if (existing.division.timetableLocked) {
      conflicts.push({
        type: 'division_locked',
        message: `Division ${existing.division.class.name}${existing.division.name} is locked. Unlock it before editing.`,
      });
    }

    const newTeacherId = teacherId ?? existing.teacherId;

    // Check teacher double-booking
    if (newTeacherId !== existing.teacherId) {
      const teacherConflict = allEntries.find(
        e => e.id !== id &&
          e.teacherId === newTeacherId &&
          e.dayOfWeek === existing.dayOfWeek &&
          e.slotNumber === existing.slotNumber
      );
      if (teacherConflict) {
        const teacherObj = teacherConflict.teacher;
        conflicts.push({
          type: 'teacher_double_booked',
          message: `${teacherObj.user.name} (${teacherObj.teacherCode}) is already assigned to ${teacherConflict.division.class.name}${teacherConflict.division.name} at this time slot.`,
          conflictingEntryId: teacherConflict.id,
        });
      }
    }

    results.push({
      entryId: id,
      valid: conflicts.length === 0,
      conflicts,
    });

    if (conflicts.length === 0 || (apply && !conflicts.some(c => c.type === 'division_locked'))) {
      pendingUpdates.push({
        id,
        data: {
          ...(subjectId ? { subjectId } : {}),
          ...(teacherId ? { teacherId } : {}),
        },
      });
    }
  }

  // Apply changes
  if (apply) {
    const dbOperations = [];

    // 1. Deletes
    if (pendingDeletes.length > 0) {
      dbOperations.push(
        prisma.timetableEntry.deleteMany({
          where: { id: { in: pendingDeletes } },
        })
      );
    }

    // 2. Creates
    if (pendingCreates.length > 0) {
      dbOperations.push(
        prisma.timetableEntry.createMany({
          data: pendingCreates,
        })
      );
    }

    // 3. Updates
    for (const u of pendingUpdates) {
      dbOperations.push(
        prisma.timetableEntry.update({
          where: { id: u.id },
          data: u.data,
        })
      );
    }

    if (dbOperations.length > 0) {
      await prisma.$transaction(dbOperations);
    }

    return NextResponse.json({
      success: true,
      applied: pendingDeletes.length + pendingCreates.length + pendingUpdates.length,
      results,
    });
  }

  return NextResponse.json({ success: true, results });
}

// ── Swap two entries ─────────────────────────────────────────────────────────

async function handleSwap(body: any, tenantId: string) {
  const { entryId1, entryId2 } = body;

  if (!entryId1 || !entryId2) {
    return NextResponse.json({ success: false, error: 'entryId1 and entryId2 are required' }, { status: 400 });
  }

  const [entry1, entry2] = await Promise.all([
    prisma.timetableEntry.findUnique({
      where: { id: entryId1 },
      include: { division: { select: { timetableLocked: true, name: true, class: { select: { name: true } } } } },
    }),
    prisma.timetableEntry.findUnique({
      where: { id: entryId2 },
      include: { division: { select: { timetableLocked: true, name: true, class: { select: { name: true } } } } },
    }),
  ]);

  if (!entry1 || !entry2 || entry1.tenantId !== tenantId || entry2.tenantId !== tenantId) {
    return NextResponse.json({ success: false, error: 'One or both entries not found' }, { status: 404 });
  }

  const conflicts: ConflictDetail[] = [];

  // Check division locks
  if (entry1.division.timetableLocked) {
    conflicts.push({ type: 'division_locked', message: `${entry1.division.class.name}${entry1.division.name} is locked` });
  }
  if (entry2.division.timetableLocked) {
    conflicts.push({ type: 'division_locked', message: `${entry2.division.class.name}${entry2.division.name} is locked` });
  }

  if (conflicts.length > 0) {
    return NextResponse.json({ success: false, conflicts });
  }

  // Check teacher conflicts after swap
  // After swap: entry1 gets (entry2.subject, entry2.teacher) and vice versa
  const allEntries = await prisma.timetableEntry.findMany({
    where: { tenantId },
    select: { id: true, divisionId: true, teacherId: true, dayOfWeek: true, slotNumber: true },
  });

  // Check: entry2's teacher at entry1's time slot (excluding entry2)
  const conflict1 = allEntries.find(e =>
    e.id !== entryId1 && e.id !== entryId2 &&
    e.teacherId === entry2.teacherId &&
    e.dayOfWeek === entry1.dayOfWeek &&
    e.slotNumber === entry1.slotNumber
  );
  if (conflict1) {
    conflicts.push({
      type: 'teacher_double_booked',
      message: `Teacher from slot 2 is already busy at the time of slot 1`,
      conflictingEntryId: conflict1.id,
    });
  }

  // Check: entry1's teacher at entry2's time slot (excluding entry1)
  const conflict2 = allEntries.find(e =>
    e.id !== entryId1 && e.id !== entryId2 &&
    e.teacherId === entry1.teacherId &&
    e.dayOfWeek === entry2.dayOfWeek &&
    e.slotNumber === entry2.slotNumber
  );
  if (conflict2) {
    conflicts.push({
      type: 'teacher_double_booked',
      message: `Teacher from slot 1 is already busy at the time of slot 2`,
      conflictingEntryId: conflict2.id,
    });
  }

  if (conflicts.length > 0) {
    return NextResponse.json({ success: false, conflicts });
  }

  // Perform the swap
  await prisma.$transaction([
    prisma.timetableEntry.update({
      where: { id: entryId1 },
      data: { subjectId: entry2.subjectId, teacherId: entry2.teacherId },
    }),
    prisma.timetableEntry.update({
      where: { id: entryId2 },
      data: { subjectId: entry1.subjectId, teacherId: entry1.teacherId },
    }),
  ]);

  return NextResponse.json({
    success: true,
    message: 'Entries swapped successfully',
  });
}
