import { Routine, RoutineLog, Language } from '../types';

export function getLocalTodayDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getUserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local Timezone';
  } catch {
    return 'Local Timezone';
  }
}

export function addDaysToDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const ny = dt.getFullYear();
  const nm = String(dt.getMonth() + 1).padStart(2, '0');
  const nd = String(dt.getDate()).padStart(2, '0');
  return `${ny}-${nm}-${nd}`;
}

export function formatTime12h(time24: string, lang: Language = 'en'): string {
  if (!time24 || !time24.includes(':')) return time24;
  const [hStr, mStr] = time24.split(':');
  const h = parseInt(hStr, 10);
  if (Number.isNaN(h)) return time24;
  const m = (mStr || '00').padStart(2, '0');
  const isPm = h >= 12;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  if (lang === 'ne') {
    const period = h < 12 ? 'बिहान' : h < 17 ? 'दिउँसो' : h < 20 ? 'बेलुका' : 'राति';
    return `${period} ${h12}:${m}`;
  }
  return `${h12}:${m} ${isPm ? 'PM' : 'AM'}`;
}

export function timeToMinutes(time24: string): number {
  if (!time24 || !time24.includes(':')) return 0;
  const [h, m] = time24.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function minutesToTime24(totalMins: number): string {
  const normalized = ((totalMins % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function buildLocalDateFromDateAndTime(dateStr: string, time24: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = (time24 || '06:00').split(':').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0);
}

export function doesRoutineApplyToDate(routine: Routine, dateStr: string): boolean {
  if (!dateStr || dateStr.length !== 10) return false;
  if (routine.repeatType === 'today') {
    return !routine.targetDate || routine.targetDate === dateStr;
  }
  if (routine.repeatType === 'everyday') {
    return true;
  }
  const [y, m, d] = dateStr.split('-').map(Number);
  const dayOfWeek = new Date(y, m - 1, d).getDay(); // 0 Sun .. 6 Sat
  if (routine.repeatType === 'weekdays') {
    return dayOfWeek >= 1 && dayOfWeek <= 5;
  }
  if (routine.repeatType === 'custom') {
    return Array.isArray(routine.customDays) && routine.customDays.includes(dayOfWeek);
  }
  return true;
}

export interface ScheduledReminderOccurrence {
  routine: Routine;
  dateStr: string;
  triggerDate: Date;
  activityDate: Date;
  triggerTime24: string;
  dedupeKey: string;
  isSnoozed: boolean;
  effectiveOffsetMinutes: number;
}

/**
 * Calculates the next valid local reminder occurrence for a routine,
 * accounting for:
 * - Local date & local timezone (never UTC)
 * - Reminder offset (0, 5, 10, 15 mins before)
 * - Snoozed status on today
 * - Fallback to exact activity time if advance offset already passed when routine was created/edited
 * - Repeating schedules (today, everyday, weekdays, custom days)
 */
export function getNextReminderOccurrence(
  routine: Routine,
  logs: RoutineLog[],
  firedKeys: Set<string>,
  now: Date = new Date()
): ScheduledReminderOccurrence | null {
  const occurrences = getRoutineUpcomingOccurrences(routine, logs, firedKeys, now, 8, 1);
  return occurrences.length > 0 ? occurrences[0] : null;
}

/**
 * Computes up to `maxResults` upcoming (or recently due on wakeup) reminder occurrences
 * for a single routine across `maxDaysAhead` calendar days in the user's local timezone.
 */
export function getRoutineUpcomingOccurrences(
  routine: Routine,
  logs: RoutineLog[],
  firedKeys: Set<string>,
  now: Date = new Date(),
  maxDaysAhead: number = 8,
  maxResults: number = 8
): ScheduledReminderOccurrence[] {
  const results: ScheduledReminderOccurrence[] = [];
  const todayStr = getLocalTodayDate(now);
  const nowMs = now.getTime();
  // Immediate grace window (90s) so a reminder set for the current minute triggers immediately
  const IMMEDIATE_GRACE_MS = 90 * 1000;
  // Startup/wakeup restoration grace window (30 mins) for routines that existed before trigger time
  const RESTORE_GRACE_MS = 30 * 60 * 1000;

  const routineUpdatedMs = routine.updatedAt
    ? new Date(routine.updatedAt).getTime()
    : 0;

  const canFireAtTimestamp = (triggerMs: number): boolean => {
    if (triggerMs >= nowMs) return true;
    const elapsedMs = nowMs - triggerMs;
    if (elapsedMs <= IMMEDIATE_GRACE_MS) return true;
    // If the routine was scheduled before the trigger time (not just created for a past time),
    // allow restoring/catching up within 30 minutes when the app/device wakes up or restarts.
    if (
      elapsedMs <= RESTORE_GRACE_MS &&
      (!routineUpdatedMs || routineUpdatedMs <= triggerMs + 60 * 1000)
    ) {
      return true;
    }
    return false;
  };

  for (let dayOffset = 0; dayOffset < maxDaysAhead; dayOffset++) {
    if (results.length >= maxResults) break;

    const candidateDateStr =
      dayOffset === 0 ? todayStr : addDaysToDateStr(todayStr, dayOffset);

    if (!doesRoutineApplyToDate(routine, candidateDateStr)) {
      continue;
    }

    const log = logs.find(
      (l) => l.routineId === routine.id && l.date === candidateDateStr
    );

    // If already marked Done or Skipped for this date, skip to next occurrence
    if (log && (log.status === 'done' || log.status === 'skipped')) {
      continue;
    }

    const activityDate = buildLocalDateFromDateAndTime(
      candidateDateStr,
      routine.time
    );

    // Handle Snoozed routine on candidate date
    if (log && log.status === 'snoozed' && log.snoozedUntil) {
      const snoozeDate = buildLocalDateFromDateAndTime(
        candidateDateStr,
        log.snoozedUntil
      );
      const snoozeKey = `${candidateDateStr}_${routine.id}_snooze_${log.snoozedUntil}`;
      if (
        !firedKeys.has(snoozeKey) &&
        snoozeDate.getTime() + RESTORE_GRACE_MS >= nowMs
      ) {
        results.push({
          routine,
          dateStr: candidateDateStr,
          triggerDate: snoozeDate,
          activityDate,
          triggerTime24: log.snoozedUntil,
          dedupeKey: snoozeKey,
          isSnoozed: true,
          effectiveOffsetMinutes: 0,
        });
        continue;
      }
    }

    const offsetMins = Number(routine.reminderOffset) || 0;
    const advanceTriggerDate = new Date(
      activityDate.getTime() - offsetMins * 60 * 1000
    );
    const baseKey = `${candidateDateStr}_${routine.id}_${routine.time}_${offsetMins}`;

    if (firedKeys.has(baseKey)) {
      // Already fired for this date/time/offset configuration; check next valid day
      continue;
    }

    // Check if advanceTriggerDate is still upcoming or within valid trigger/restore window
    if (canFireAtTimestamp(advanceTriggerDate.getTime())) {
      const triggerMins = timeToMinutes(routine.time) - offsetMins;
      results.push({
        routine,
        dateStr: candidateDateStr,
        triggerDate: advanceTriggerDate,
        activityDate,
        triggerTime24: minutesToTime24(triggerMins),
        dedupeKey: baseKey,
        isSnoozed: false,
        effectiveOffsetMinutes: offsetMins,
      });
      continue;
    }

    // If advanceTriggerDate (e.g. 10 mins before) has passed, but the actual activityDate
    // is still upcoming or within valid trigger/restore window, fire at the activity time!
    if (offsetMins > 0 && canFireAtTimestamp(activityDate.getTime())) {
      results.push({
        routine,
        dateStr: candidateDateStr,
        triggerDate: activityDate,
        activityDate,
        triggerTime24: routine.time,
        dedupeKey: baseKey,
        isSnoozed: false,
        effectiveOffsetMinutes: 0,
      });
      continue;
    }
  }

  return results;
}

/**
 * Generates all upcoming reminder occurrences across all routines for the next `maxDaysAhead` days,
 * sorted chronologically by `triggerDate`. Used to persist the full schedule in IndexedDB for Service Worker.
 */
export function getAllUpcomingReminderOccurrences(
  routines: Routine[],
  logs: RoutineLog[],
  firedKeys: Set<string>,
  now: Date = new Date(),
  maxDaysAhead: number = 7
): ScheduledReminderOccurrence[] {
  const all: ScheduledReminderOccurrence[] = [];
  for (const rt of routines) {
    const occs = getRoutineUpcomingOccurrences(
      rt,
      logs,
      firedKeys,
      now,
      maxDaysAhead,
      maxDaysAhead
    );
    all.push(...occs);
  }
  return all.sort((a, b) => a.triggerDate.getTime() - b.triggerDate.getTime());
}

export function getEffectiveRoutineStatus(
  routine: Routine,
  dateStr: string,
  logs: RoutineLog[],
  todayStr: string,
  currentMinutes: number
): { status: 'done' | 'skipped' | 'snoozed' | 'missed' | 'upcoming'; snoozedUntil: string } {
  const log = logs.find(
    (l) => l.routineId === routine.id && l.date === dateStr
  );
  if (log) {
    if (log.status === 'snoozed' && dateStr === todayStr && log.snoozedUntil) {
      const snoozeMins = timeToMinutes(log.snoozedUntil);
      if (currentMinutes > snoozeMins + 30) {
        return { status: 'missed', snoozedUntil: log.snoozedUntil };
      }
    }
    return { status: log.status, snoozedUntil: log.snoozedUntil || '' };
  }

  // Automatic Missed status calculation if date is in the past, or today after scheduled time + grace period
  if (dateStr < todayStr) {
    return { status: 'missed', snoozedUntil: '' };
  }
  if (dateStr === todayStr) {
    const scheduledMins = timeToMinutes(routine.time);
    const graceWindow = Math.max(30, routine.duration || 30);
    if (currentMinutes > scheduledMins + graceWindow) {
      return { status: 'missed', snoozedUntil: '' };
    }
  }
  return { status: 'upcoming', snoozedUntil: '' };
}

export function getDaySummary(
  routines: Routine[],
  logs: RoutineLog[],
  dateStr: string,
  todayStr: string,
  currentMinutes: number
) {
  const dayRoutines = routines
    .filter((r) => doesRoutineApplyToDate(r, dateStr))
    .sort((a, b) => a.time.localeCompare(b.time));

  let completed = 0;
  let skipped = 0;
  let missed = 0;
  let upcoming = 0;

  for (const r of dayRoutines) {
    const { status } = getEffectiveRoutineStatus(
      r,
      dateStr,
      logs,
      todayStr,
      currentMinutes
    );
    if (status === 'done') completed++;
    else if (status === 'skipped') skipped++;
    else if (status === 'missed') missed++;
    else upcoming++;
  }

  const planned = dayRoutines.length;
  const completionPct = planned > 0 ? Math.round((completed / planned) * 100) : 0;

  return {
    dayRoutines,
    planned,
    completed,
    skipped,
    missed,
    upcoming,
    completionPct,
  };
}

export function getWeekDatesMondayToSunday(referenceDateStr: string): string[] {
  const [y, m, d] = referenceDateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const day = dt.getDay(); // 0 Sun .. 6 Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  dt.setDate(dt.getDate() + diffToMonday);

  const result: string[] = [];
  for (let i = 0; i < 7; i++) {
    const cur = new Date(dt);
    cur.setDate(dt.getDate() + i);
    const cy = cur.getFullYear();
    const cm = String(cur.getMonth() + 1).padStart(2, '0');
    const cd = String(cur.getDate()).padStart(2, '0');
    result.push(`${cy}-${cm}-${cd}`);
  }
  return result;
}

export function getMonthDates(year: number, monthZeroIndexed: number): string[] {
  const daysInMonth = new Date(year, monthZeroIndexed + 1, 0).getDate();
  const dates: string[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    dates.push(
      `${year}-${String(monthZeroIndexed + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    );
  }
  return dates;
}

// Calculate actual streaks from completed routineLogs
export function calculateRoutineStreaks(
  routines: Routine[],
  logs: RoutineLog[],
  todayStr: string
) {
  // Overall daily streak (days with at least 1 completed routine)
  const doneDatesSet = new Set(
    logs.filter((l) => l.status === 'done').map((l) => l.date)
  );

  let currentOverallStreak = 0;
  let checkDate = doneDatesSet.has(todayStr)
    ? todayStr
    : addDaysToDateStr(todayStr, -1);

  while (doneDatesSet.has(checkDate)) {
    currentOverallStreak++;
    checkDate = addDaysToDateStr(checkDate, -1);
  }

  // Best overall streak across sorted dates
  const sortedDoneDates = Array.from(doneDatesSet).sort();
  let bestOverallStreak = currentOverallStreak;
  let running = 0;
  for (let i = 0; i < sortedDoneDates.length; i++) {
    if (i === 0) {
      running = 1;
    } else {
      const prevExpected = addDaysToDateStr(sortedDoneDates[i], -1);
      if (sortedDoneDates[i - 1] === prevExpected) {
        running++;
      } else {
        running = 1;
      }
    }
    if (running > bestOverallStreak) bestOverallStreak = running;
  }

  // Per-routine streaks
  const habitStreaks = routines.map((rt) => {
    const rtDoneDates = new Set(
      logs
        .filter((l) => l.routineId === rt.id && l.status === 'done')
        .map((l) => l.date)
    );

    let streak = 0;
    let dCursor = rtDoneDates.has(todayStr)
      ? todayStr
      : addDaysToDateStr(todayStr, -1);

    while (rtDoneDates.has(dCursor)) {
      streak++;
      dCursor = addDaysToDateStr(dCursor, -1);
    }

    const sortedRtDates = Array.from(rtDoneDates).sort();
    let best = streak;
    let curRun = 0;
    for (let i = 0; i < sortedRtDates.length; i++) {
      if (i === 0) curRun = 1;
      else if (sortedRtDates[i - 1] === addDaysToDateStr(sortedRtDates[i], -1)) {
        curRun++;
      } else {
        curRun = 1;
      }
      if (curRun > best) best = curRun;
    }

    return {
      routine: rt,
      currentStreak: streak,
      bestStreak: best,
      totalCompletions: rtDoneDates.size,
    };
  });

  return {
    currentOverallStreak,
    bestOverallStreak,
    habitStreaks: habitStreaks.sort((a, b) => b.currentStreak - a.currentStreak),
  };
}
