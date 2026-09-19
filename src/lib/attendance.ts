/**
 * Attendance domain helpers shared by API routes.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Default shift length (hours) used to credit an auto punch-out when the
 * employee has NO shift configured. Auto punch-out never credits the grace
 * window; it credits the shift (or this default).
 */
export const DEFAULT_SHIFT_HOURS = 9;

/**
 * Grace added on top of the shift before auto punch-out is *triggered*. This is
 * only a detection window so the hourly sweep reliably catches a forgotten
 * session; it is NOT credited as worked time.
 */
export const SHIFT_GRACE_HOURS = 5.5;

/**
 * Maximum continuous break (pause) length, in hours, before the session is
 * considered abandoned. A break is not meant to run forever: if the user pauses
 * and never resumes, the live break timer would otherwise climb indefinitely.
 * Once a single break exceeds this cap the client auto punches the user out
 * (crediting only real worked segments), and the displayed break time is capped
 * at this value so it stops growing.
 */
export const MAX_BREAK_HOURS = 2;

/** Parse a "HH:MM" or "HH:MM:SS" time string into minutes since midnight. */
function timeToMinutes(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Returns a shift's scheduled length in hours, correctly handling overnight
 * shifts where the end time is on the next calendar day (e.g. 21:00 -> 06:00
 * = 9h). Returns null when the shift is not configured / unparseable.
 */
export function shiftDurationHours(
  shiftStart: string | null | undefined,
  shiftEnd: string | null | undefined,
): number | null {
  if (!shiftStart || !shiftEnd) return null;
  const start = timeToMinutes(shiftStart);
  const end = timeToMinutes(shiftEnd);
  if (start === null || end === null) return null;
  // end <= start  ->  overnight shift, add a full day.
  const span = end > start ? end - start : end + 24 * 60 - start;
  return Math.round((span / 60) * 100) / 100;
}

/**
 * The number of hours an auto punch-out should CREDIT as worked time.
 *
 * This is always the employee's scheduled shift length (or DEFAULT_SHIFT_HOURS
 * when no shift is configured). The grace window is never credited: someone who
 * forgets to punch out is paid for their shift, not for the time the session
 * stayed open. (Manual punch-out is unaffected and credits real worked time.)
 */
export function shiftCreditHours(
  shiftStart: string | null | undefined,
  shiftEnd: string | null | undefined,
): number {
  const dur = shiftDurationHours(shiftStart, shiftEnd);
  return dur === null ? DEFAULT_SHIFT_HOURS : dur;
}

/**
 * The number of hours after punch_in at which an open session becomes eligible
 * for auto punch-out: shift length + grace (e.g. 9h shift -> 14.5h). The grace
 * is purely a detection window so the hourly sweep reliably catches forgotten
 * sessions; it does NOT change what gets credited (see shiftCreditHours).
 */
export function autoPunchOutTriggerHours(
  shiftStart: string | null | undefined,
  shiftEnd: string | null | undefined,
): number {
  return shiftCreditHours(shiftStart, shiftEnd) + SHIFT_GRACE_HOURS;
}

/**
 * Computes worked milliseconds for an attendance record from its work
 * segments. Segments are WORK intervals; gaps between them are breaks, so
 * summing segment durations naturally excludes break time. An open segment
 * (no `segment_end`) is counted up to `asOf`.
 *
 * Falls back to the raw punch span when there are no segments (legacy rows).
 */
export function workedMsFromSegments(
  segments: { segment_start: string; segment_end: string | null }[],
  punchIn: string,
  asOf: Date = new Date(),
): number {
  if (segments.length > 0) {
    let total = 0;
    for (const s of segments) {
      const start = new Date(s.segment_start).getTime();
      const end = s.segment_end ? new Date(s.segment_end).getTime() : asOf.getTime();
      if (end > start) total += end - start;
    }
    return total;
  }
  return Math.max(0, asOf.getTime() - new Date(punchIn).getTime());
}

/**
 * Force-closes any of THIS user's attendance records that have stayed open
 * (no punch_out) past their auto punch-out trigger (shift + grace).
 *
 * This is the server-side safety net for auto punch-out: it does NOT rely on
 * the browser tab staying open. When a session is force-closed the employee is
 * credited their SHIFT length only (not the time the session stayed open and
 * not the grace window): punch_out is set to punch_in + shift and worked_hours
 * is the shift length. Manual punch-out is unaffected and credits real time.
 *
 * Runs RLS-scoped (the passed `db` is the user's client), so it only ever
 * touches the caller's own records. Safe to call on every attendance request.
 */
export async function autoCloseStaleSessions(
  db: SupabaseClient,
  employeeId: string,
  now: Date = new Date(),
): Promise<number> {
  // Per-employee shift (overnight-aware). Credit = shift length; the session is
  // only eligible to auto-close after shift + grace has elapsed.
  const { data: emp } = await db
    .from('employees')
    .select('shift_start, shift_end')
    .eq('id', employeeId)
    .maybeSingle();
  const creditHours = shiftCreditHours(emp?.shift_start, emp?.shift_end);
  const triggerHours = creditHours + SHIFT_GRACE_HOURS;
  const creditMs = creditHours * 60 * 60 * 1000;
  const triggerMs = triggerHours * 60 * 60 * 1000;
  const cutoff = new Date(now.getTime() - triggerMs).toISOString();

  // Find open records whose punch_in is older than the trigger window.
  const { data: stale } = await db
    .from('attendance')
    .select('id, punch_in')
    .eq('employee_id', employeeId)
    .is('punch_out', null)
    .not('punch_in', 'is', null)
    .lte('punch_in', cutoff);

  if (!stale || stale.length === 0) return 0;

  let closed = 0;
  for (const rec of stale) {
    if (!rec.punch_in) continue;
    // Credit the shift only: punch_out = punch_in + shift, worked = shift.
    const punchOut = new Date(new Date(rec.punch_in).getTime() + creditMs).toISOString();

    // Close any still-open segments at the credited punch_out so stored
    // segment data is consistent with worked_hours.
    await db
      .from('attendance_segments')
      .update({ segment_end: punchOut })
      .eq('attendance_id', rec.id)
      .is('segment_end', null);

    const workedHours = creditHours;

    await db
      .from('attendance')
      .update({ punch_out: punchOut, worked_hours: workedHours, status: 'auto_punched_out', notes: 'Auto punched out (forgot to punch out; credited shift hours)' })
      .eq('id', rec.id)
      .is('punch_out', null);

    closed += 1;
  }
  return closed;
}

/**
 * Close EVERY stale open attendance session org-wide (across all employees).
 *
 * This is the robust, server-driven counterpart to the per-tab browser timer
 * in the dashboards: it runs from a scheduled job (see /api/cron/close-sessions)
 * so sessions are closed even if the employee closed their browser, the device
 * slept, or they never returned. Each session becomes eligible after that
 * employee's shift + grace, and is credited their SHIFT length only (the grace
 * window and any overrun are never counted as worked time).
 *
 * Returns the number of sessions closed.
 */
export async function autoCloseAllStaleSessions(
  db: SupabaseClient,
  now: Date = new Date(),
): Promise<number> {
  // Only employees with an open session can possibly be stale; we fetch all
  // open sessions and apply each employee's precise trigger window below.
  const { data: open } = await db
    .from('attendance')
    .select('id, employee_id, punch_in, employees!attendance_employee_id_fkey(shift_start, shift_end)')
    .is('punch_out', null)
    .not('punch_in', 'is', null);

  if (!open || open.length === 0) return 0;

  let closed = 0;
  for (const rec of open) {
    if (!rec.punch_in) continue;
    const emp = (rec as { employees?: { shift_start?: string | null; shift_end?: string | null } | { shift_start?: string | null; shift_end?: string | null }[] }).employees;
    const empObj = Array.isArray(emp) ? emp[0] : emp;
    const creditHours = shiftCreditHours(empObj?.shift_start ?? null, empObj?.shift_end ?? null);
    const triggerHours = creditHours + SHIFT_GRACE_HOURS;
    const creditMs = creditHours * 60 * 60 * 1000;
    const triggerMs = triggerHours * 60 * 60 * 1000;
    const punchInMs = new Date(rec.punch_in).getTime();

    // Not yet past the trigger window for this employee -> leave it open.
    if (now.getTime() - punchInMs < triggerMs) continue;

    // Credit the shift only: punch_out = punch_in + shift, worked = shift.
    const punchOut = new Date(punchInMs + creditMs).toISOString();

    await db
      .from('attendance_segments')
      .update({ segment_end: punchOut })
      .eq('attendance_id', rec.id)
      .is('segment_end', null);

    const workedHours = creditHours;

    await db
      .from('attendance')
      .update({ punch_out: punchOut, worked_hours: workedHours, status: 'auto_punched_out', notes: 'Auto punched out (forgot to punch out; credited shift hours)' })
      .eq('id', rec.id)
      .is('punch_out', null);

    closed += 1;
  }
  return closed;
}
