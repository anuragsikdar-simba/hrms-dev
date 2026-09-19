/**
 * Loss-of-Pay derivation for a payroll period (docs/BUSINESS_RULES.md §8.2).
 *
 * This is the only place that turns raw leave/attendance rows into the
 * `LopInput` the pure engine in `src/lib/payroll.ts` consumes. The engine never
 * touches the DB; this module never does money math.
 *
 * Rules implemented here:
 * - Approved leave on a type with `is_paid = false` costs 1.0/day (0.5 for a
 *   half-day request). A request may straddle the month boundary — only the
 *   in-period share is charged to this period.
 * - An `absent` attendance row costs 1.0, but ONLY when no approved leave
 *   covers that day: an approved absence is never charged twice (§8.2).
 * - A half-day attendance row costs 0.5 (the engine applies the 0.5 factor).
 * - Holidays, weekends and plain missing rows are NOT loss of pay. Only an
 *   explicit `absent` row counts, so a day nobody recorded stays paid.
 *
 * Date keying: `attendance.date`, `leave_requests.from_date/to_date` are DATE
 * columns — already the IST local day. They are compared as literal calendar
 * days and never round-tripped through an instant (§1 / §6.5).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { LopInput } from '@/lib/payroll';
import { periodEndDate } from '@/lib/payroll';

const MS_PER_DAY = 86_400_000;

/**
 * Attendance statuses that cost pay.
 *
 * `attendance.status` carries values the UI enum never knew about
 * (`auto_punched_out`, `active`, ...) — §6.4 enum drift. The mapping is
 * therefore explicit and exhaustive-by-omission: an unrecognised status costs
 * nothing rather than throwing or silently becoming an absence.
 */
const LOP_ATTENDANCE_STATUS: Record<string, 'absent' | 'half'> = {
  absent: 'absent',
  half: 'half',
  half_day: 'half',
  halfday: 'half',
};

interface LeaveRow {
  employee_id: string;
  from_date: string;
  to_date: string;
  days: number | null;
  half_day: boolean | null;
  /** Supabase embeds a to-one join as an object; tolerate an array too. */
  leave_types: { is_paid: boolean | null } | { is_paid: boolean | null }[] | null;
}

interface AttendanceRow {
  employee_id: string;
  date: string;
  status: string | null;
}

/**
 * `YYYY-MM-DD` -> whole days since the epoch, or null when unparseable.
 *
 * Pure calendar arithmetic on the literal Y-M-D of a DATE column: no instant
 * and no timezone conversion is involved, so the result is identical on every
 * host. This is NOT the UTC-slicing bug in §6.5 — nothing is being derived from
 * a timestamp here.
 */
function dayNumber(date: string): number | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!parts) return null;
  const ms = Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  return Number.isFinite(ms) ? Math.round(ms / MS_PER_DAY) : null;
}

/**
 * LOP inputs for every requested employee, for one period.
 *
 * One batched query per source table (never one per employee). Employees with
 * no leave and no attendance still get a zeroed entry, so callers can index the
 * result without null checks.
 */
export async function deriveLopForPeriod(
  db: SupabaseClient,
  employeeIds: string[],
  year: number,
  month: number,
): Promise<Record<string, LopInput>> {
  const result: Record<string, LopInput> = {};
  for (const id of employeeIds) {
    result[id] = { unpaidLeaveDays: 0, unexcusedAbsentDays: 0, halfDays: 0 };
  }
  if (employeeIds.length === 0) return result;

  const periodStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const periodEnd = periodEndDate(year, month);
  const firstDay = dayNumber(periodStart);
  const lastDay = dayNumber(periodEnd);
  if (firstDay === null || lastDay === null) return result;

  const [leaveRes, attendanceRes] = await Promise.all([
    db
      .from('leave_requests')
      .select(
        'employee_id, from_date, to_date, days, half_day, leave_types!leave_requests_leave_type_id_fkey(is_paid)',
      )
      .in('employee_id', employeeIds)
      .eq('status', 'approved')
      // Overlaps the period: starts on or before its last day and ends on or
      // after its first. This is what picks up a straddling request.
      .lte('from_date', periodEnd)
      .gte('to_date', periodStart),
    db
      .from('attendance')
      .select('employee_id, date, status')
      .in('employee_id', employeeIds)
      .gte('date', periodStart)
      .lte('date', periodEnd),
  ]);

  if (leaveRes.error) throw leaveRes.error;
  if (attendanceRes.error) throw attendanceRes.error;

  const leaveRows: LeaveRow[] = leaveRes.data ?? [];
  const attendanceRows: AttendanceRow[] = attendanceRes.data ?? [];

  // Every approved leave day in the period, paid or unpaid. An absence covered
  // by leave is not "unexcused", and an unpaid day must not be charged twice.
  const coveredByLeave: Record<string, Set<number>> = {};

  for (const row of leaveRows) {
    const bucket = result[row.employee_id];
    if (!bucket) continue;

    const from = dayNumber(row.from_date);
    const to = dayNumber(row.to_date);
    if (from === null || to === null || to < from) continue;

    const clampedFrom = Math.max(from, firstDay);
    const clampedTo = Math.min(to, lastDay);
    const inPeriod = clampedTo - clampedFrom + 1;
    if (inPeriod <= 0) continue;

    let covered = coveredByLeave[row.employee_id];
    if (!covered) {
      covered = new Set<number>();
      coveredByLeave[row.employee_id] = covered;
    }
    for (let day = clampedFrom; day <= clampedTo; day++) covered.add(day);

    const joined = row.leave_types;
    const leaveType = Array.isArray(joined) ? joined[0] : joined;
    // `leave_types.is_paid` defaults to true: a type nobody marked stays paid.
    if (leaveType?.is_paid !== false) continue;

    const span = to - from + 1;
    const declared = Number(row.days);
    // `days` is the authoritative length (it can exclude non-working days);
    // fall back to the calendar span, halved for a half-day request.
    const total =
      Number.isFinite(declared) && declared > 0 ? declared : span * (row.half_day ? 0.5 : 1);
    bucket.unpaidLeaveDays += (total * inPeriod) / span;
  }

  for (const row of attendanceRows) {
    const bucket = result[row.employee_id];
    if (!bucket) continue;

    const day = dayNumber(row.date);
    if (day === null || day < firstDay || day > lastDay) continue;
    // Approved leave already accounted for this day (paid = not LOP at all,
    // unpaid = already charged above).
    if (coveredByLeave[row.employee_id]?.has(day)) continue;

    const kind = LOP_ATTENDANCE_STATUS[String(row.status ?? '').toLowerCase()];
    if (kind === 'absent') bucket.unexcusedAbsentDays += 1;
    else if (kind === 'half') bucket.halfDays += 1;
  }

  // Half-days are the only fractional unit; keep the prorated leave share to
  // one decimal so the stored lop_days matches what the payslip shows.
  for (const id of employeeIds) {
    result[id].unpaidLeaveDays = Math.round(result[id].unpaidLeaveDays * 10) / 10;
  }

  return result;
}
