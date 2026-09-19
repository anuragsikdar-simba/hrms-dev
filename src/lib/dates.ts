/**
 * Business-date helpers.
 *
 * Attendance is keyed by a calendar `date` (no time). The company operates in
 * IST (Asia/Kolkata), so the "current day" for attendance must be computed in
 * IST -- NOT in UTC and NOT in the visitor's local browser timezone.
 *
 * Previously the server used `new Date().toISOString().split('T')[0]` (UTC) while
 * the client used the browser's local date. Between IST midnight and 05:30 they
 * disagree by a day, which broke punch-out and session restore. These helpers
 * keep both sides consistent.
 */

export const BUSINESS_TIMEZONE = 'Asia/Kolkata';

/**
 * Returns today's date in the business timezone as a `YYYY-MM-DD` string.
 * Works identically on the server and in the browser regardless of host TZ.
 */
export function businessDate(d: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD; timeZone forces IST.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
