import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

interface Issue {
  type: 'error' | 'warning' | 'info';
  category: string;
  message: string;
  detail?: string;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const tenantId = session.user.tenantId;
  const issues: Issue[] = [];

  // Fetch timetable entries with all relations
  const entries = await prisma.timetableEntry.findMany({
    where: { tenantId },
    include: {
      subject: true,
      teacher: { include: { user: { select: { name: true } } } },
      division: { include: { class: true, classTeacher: { include: { user: { select: { name: true } } } } } },
    },
    orderBy: [{ dayOfWeek: 'asc' }, { slotNumber: 'asc' }],
  });

  if (entries.length === 0) {
    return NextResponse.json({
      success: true,
      data: { issues: [{ type: 'info', category: 'General', message: 'No timetable generated yet.', detail: 'Generate a timetable first to analyze it.' }], stats: {} },
    });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { periodsPerDay: true, workingDays: true, morningPeriods: true },
  });

  const slotsPerDay = tenant?.periodsPerDay ?? 7;
  const workingDays = tenant?.workingDays ?? 5;
  const morningPeriods = tenant?.morningPeriods ?? 4;

  // --- Fetch subjects & teachers for deeper analysis ---
  const subjects = await prisma.subject.findMany({ where: { tenantId } });
  const teachers = await prisma.teacher.findMany({
    where: { user: { tenantId } },
    include: { user: { select: { name: true } }, subjectMappings: true },
  });

  // --- 1. Teacher Double-Booking Check ---
  const teacherSlotMap = new Map<string, string[]>();
  for (const entry of entries) {
    const key = `${entry.teacherId}:${entry.dayOfWeek}:${entry.slotNumber}`;
    if (!teacherSlotMap.has(key)) teacherSlotMap.set(key, []);
    teacherSlotMap.get(key)!.push(`${entry.division.class.name}${entry.division.name}`);
  }
  for (const [key, divs] of teacherSlotMap) {
    if (divs.length > 1) {
      const [teacherId, day, slot] = key.split(':');
      const teacher = entries.find(e => e.teacherId === teacherId)?.teacher;
      issues.push({
        type: 'error',
        category: 'Teacher Conflict',
        message: `${teacher?.user.name ?? 'A teacher'} is double-booked`,
        detail: `Day ${day}, Period ${slot}: assigned to ${divs.join(' & ')} simultaneously`,
      });
    }
  }

  // --- 2. Same Subject Twice on Same Day per Division ---
  const divDaySubjectMap = new Map<string, string[]>();
  for (const entry of entries) {
    const key = `${entry.divisionId}:${entry.dayOfWeek}`;
    if (!divDaySubjectMap.has(key)) divDaySubjectMap.set(key, []);
    divDaySubjectMap.get(key)!.push(entry.subjectId);
  }
  for (const [key, subjectIds] of divDaySubjectMap) {
    const counts = new Map<string, number>();
    for (const sid of subjectIds) counts.set(sid, (counts.get(sid) ?? 0) + 1);
    for (const [sid, count] of counts) {
      if (count > 1) {
        const [divId, day] = key.split(':');
        const divEntry = entries.find(e => e.divisionId === divId);
        const subj = subjects.find(s => s.id === sid);
        if (subj && subj.consecutiveSlots < 2) {
          issues.push({
            type: 'warning',
            category: 'Subject Distribution',
            message: `"${subj.name}" appears ${count} times on day ${day}`,
            detail: `Division ${divEntry?.division.class.name}${divEntry?.division.name}: subject repeats on the same day`,
          });
        }
      }
    }
  }

  // --- 3. Core Subjects in Evening Slots ---
  for (const entry of entries) {
    if (entry.subject.isCore && entry.slotNumber > morningPeriods && !entry.subject.eveningPriority) {
      issues.push({
        type: 'warning',
        category: 'Slot Priority',
        message: `Core subject "${entry.subject.name}" placed in evening slot`,
        detail: `${entry.division.class.name}${entry.division.name}, Day ${entry.dayOfWeek}, Period ${entry.slotNumber} (after lunch)`,
      });
    }
  }

  // --- 4. Evening Priority Subjects in Morning Slots ---
  for (const entry of entries) {
    if (entry.subject.eveningPriority && entry.slotNumber <= morningPeriods) {
      issues.push({
        type: 'info',
        category: 'Slot Priority',
        message: `Evening-priority subject "${entry.subject.name}" placed in morning`,
        detail: `${entry.division.class.name}${entry.division.name}, Day ${entry.dayOfWeek}, Period ${entry.slotNumber}`,
      });
    }
  }

  // --- 5. Class Teacher Doesn't Have Period 1 ---
  const divisions = await prisma.division.findMany({
    where: { class: { tenantId } },
    include: { class: true, classTeacher: { include: { user: { select: { name: true } } } } },
  });

  for (const div of divisions) {
    if (!div.classTeacherId) continue;
    for (let day = 1; day <= workingDays; day++) {
      const period1 = entries.find(
        e => e.divisionId === div.id && e.dayOfWeek === day && e.slotNumber === 1
      );
      if (!period1) {
        issues.push({
          type: 'warning',
          category: 'Class Teacher',
          message: `Period 1 is empty for ${div.class.name}${div.name} on Day ${day}`,
          detail: `Class teacher ${div.classTeacher?.user.name ?? 'unknown'} should be assigned Period 1`,
        });
      } else if (period1.teacherId !== div.classTeacherId) {
        issues.push({
          type: 'warning',
          category: 'Class Teacher',
          message: `${div.class.name}${div.name}: Period 1 on Day ${day} not taken by class teacher`,
          detail: `Class teacher: ${div.classTeacher?.user.name ?? 'unknown'}, Assigned: ${period1.teacher.user.name}`,
        });
      }
    }
  }

  // --- 6. Uneven Teacher Load Analysis ---
  const teacherLoadMap = new Map<string, number>();
  for (const entry of entries) {
    teacherLoadMap.set(entry.teacherId, (teacherLoadMap.get(entry.teacherId) ?? 0) + 1);
  }
  const loads = Array.from(teacherLoadMap.values());
  if (loads.length > 0) {
    const avg = loads.reduce((a, b) => a + b, 0) / loads.length;
    const maxLoad = Math.max(...loads);
    const minLoad = Math.min(...loads);
    if (maxLoad - minLoad > 5) {
      for (const [teacherId, load] of teacherLoadMap) {
        if (load > avg + 4) {
          const teacher = entries.find(e => e.teacherId === teacherId)?.teacher;
          issues.push({
            type: 'info',
            category: 'Teacher Load',
            message: `${teacher?.user.name ?? 'A teacher'} has heavy load (${load} periods/week)`,
            detail: `Average is ${avg.toFixed(1)} periods/week. Consider redistributing.`,
          });
        } else if (load < avg - 4) {
          const teacher = entries.find(e => e.teacherId === teacherId)?.teacher;
          issues.push({
            type: 'info',
            category: 'Teacher Load',
            message: `${teacher?.user.name ?? 'A teacher'} has light load (${load} periods/week)`,
            detail: `Average is ${avg.toFixed(1)} periods/week. Could take more periods.`,
          });
        }
      }
    }
  }

  // --- 7. Missing Subjects for Divisions ---
  const schedulableSubjects = subjects.filter(s => !s.isLanguageVariant && s.periodsPerWeek > 0);
  for (const div of divisions) {
    const missingSubjects: string[] = [];
    for (const subject of schedulableSubjects) {
      const placed = entries.filter(e => e.divisionId === div.id && e.subjectId === subject.id).length;
      if (placed === 0) {
        missingSubjects.push(subject.name);
      } else if (placed < subject.periodsPerWeek) {
        issues.push({
          type: 'warning',
          category: 'Insufficient Periods',
          message: `"${subject.name}" under-scheduled for ${div.class.name}${div.name}`,
          detail: `Expected ${subject.periodsPerWeek} periods/week, got ${placed}`,
        });
      }
    }

    if (missingSubjects.length > 0) {
      issues.push({
        type: 'warning',
        category: 'Missing Subjects',
        message: `${div.class.name}${div.name} is missing ${missingSubjects.length} subject${missingSubjects.length !== 1 ? 's' : ''}`,
        detail: `Missing: ${missingSubjects.join(', ')}`,
      });
    }
  }

  // --- 8. Empty Slots ---
  for (const div of divisions) {
    let emptyCount = 0;
    for (let day = 1; day <= workingDays; day++) {
      for (let slot = 1; slot <= slotsPerDay; slot++) {
        const found = entries.find(
          e => e.divisionId === div.id && e.dayOfWeek === day && e.slotNumber === slot
        );
        if (!found) emptyCount++;
      }
    }
    if (emptyCount > 0) {
      issues.push({
        type: 'info',
        category: 'Empty Slots',
        message: `${div.class.name}${div.name} has ${emptyCount} empty slot(s)`,
        detail: `${emptyCount} out of ${workingDays * slotsPerDay} total slots are unfilled`,
      });
    }
  }

  // --- Stats summary ---
  const errorCount = issues.filter(i => i.type === 'error').length;
  const warningCount = issues.filter(i => i.type === 'warning').length;
  const infoCount = issues.filter(i => i.type === 'info').length;

  const stats = {
    totalEntries: entries.length,
    errors: errorCount,
    warnings: warningCount,
    info: infoCount,
    teacherCount: teacherLoadMap.size,
    avgLoad: teacherLoadMap.size > 0
      ? (Array.from(teacherLoadMap.values()).reduce((a, b) => a + b, 0) / teacherLoadMap.size).toFixed(1)
      : 0,
  };

  return NextResponse.json({ success: true, data: { issues, stats } });
}
