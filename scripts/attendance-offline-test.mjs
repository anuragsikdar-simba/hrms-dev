/**
 * Fully OFFLINE attendance test -- no database, no Docker, no live data.
 *
 *   node --experimental-strip-types scripts/attendance-offline-test.mjs
 *   (or: npm run test:attendance-offline)
 *
 * It exercises the REAL source in src/lib/attendance.ts (auto punch-out cap,
 * shift credit, trigger window, worked-ms) and src/lib/dates.ts (business
 * date), plus it drives the actual autoClose* functions against a tiny
 * in-memory fake Supabase client so the DB-shaped code paths are covered too.
 *
 * Finally it reproduces the IST day-boundary "shows Punch In again" bug at the
 * data layer: an open session that started before midnight must still be found
 * by the open-session lookup after the business date rolls over.
 */
import {
  shiftDurationHours,
  shiftCreditHours,
  autoPunchOutTriggerHours,
  workedMsFromSegments,
  autoCloseStaleSessions,
  autoCloseAllStaleSessions,
  DEFAULT_SHIFT_HOURS,
  SHIFT_GRACE_HOURS,
  MAX_BREAK_HOURS,
} from '../src/lib/attendance.ts';
import { businessDate } from '../src/lib/dates.ts';
import { distanceMeters, parseGeoConfig, evaluateGeoWithConfig } from '../src/lib/geo.ts';

let failures = 0;
function ok(cond, msg) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures += 1;
}
const H = 3_600_000; // ms per hour
const approx = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;

/* ================================================================== */
/*  In-memory fake Supabase client                                     */
/*  Supports just the chained calls the attendance helpers use:        */
/*  from().select().eq().is().not().lte().order().limit()              */
/*  .maybeSingle() and from().update().eq().is()                       */
/* ================================================================== */
function makeFakeDb(tables) {
  // tables: { employees: [...], attendance: [...], attendance_segments: [...] }
  function query(name) {
    let rows = tables[name];
    const filters = [];
    let orderKey = null, orderAsc = true, limitN = null;
    let mode = 'select', updatePayload = null;

    const apply = () => {
      let out = rows.filter((r) => filters.every((f) => f(r)));
      if (orderKey) {
        out = [...out].sort((a, b) => {
          const av = a[orderKey] ?? '', bv = b[orderKey] ?? '';
          return (av < bv ? -1 : av > bv ? 1 : 0) * (orderAsc ? 1 : -1);
        });
      }
      if (limitN != null) out = out.slice(0, limitN);
      return out;
    };

    const builder = {
      select() { mode = 'select'; return builder; },
      update(p) { mode = 'update'; updatePayload = p; return builder; },
      eq(k, v) { filters.push((r) => r[k] === v); return builder; },
      is(k, v) { filters.push((r) => (v === null ? r[k] == null : r[k] === v)); return builder; },
      not(k, _op, v) { filters.push((r) => !(v === null ? r[k] == null : r[k] === v)); return builder; },
      lte(k, v) { filters.push((r) => r[k] != null && r[k] <= v); return builder; },
      gte(k, v) { filters.push((r) => r[k] != null && r[k] >= v); return builder; },
      order(k, opt) { orderKey = k; orderAsc = opt?.ascending ?? true; return builder; },
      limit(n) { limitN = n; return builder; },
      async maybeSingle() { const out = apply(); return { data: out[0] ?? null, error: null }; },
      async single() { const out = apply(); return { data: out[0] ?? null, error: null }; },
      // Awaiting the builder runs select (returns array) or update (mutates).
      then(resolve) {
        if (mode === 'update') {
          const matched = apply();
          for (const r of matched) Object.assign(r, updatePayload);
          resolve({ data: matched, error: null });
        } else {
          resolve({ data: apply(), error: null });
        }
      },
    };
    return builder;
  }
  return { from: (name) => query(name) };
}

/* ================================================================== */
/*  1. Pure logic: cap / credit / trigger                              */
/* ================================================================== */
console.log('\n--- 1. Cap / credit / trigger ---');
ok(DEFAULT_SHIFT_HOURS === 9, `DEFAULT_SHIFT_HOURS = 9 (got ${DEFAULT_SHIFT_HOURS})`);
ok(SHIFT_GRACE_HOURS === 5.5, `SHIFT_GRACE_HOURS = 5.5 (got ${SHIFT_GRACE_HOURS})`);
ok(shiftDurationHours('09:00', '18:00') === 9, '9h day shift duration = 9');
ok(shiftDurationHours('21:00', '06:00') === 9, 'overnight 21->06 duration = 9');
ok(shiftCreditHours('09:00', '18:00') === 9, '9h shift credit = 9');
ok(shiftCreditHours(null, null) === 9, 'no shift -> credit = 9 (default)');
ok(shiftCreditHours('10:00', '18:00') === 8, '8h shift credit = 8');
ok(autoPunchOutTriggerHours('09:00', '18:00') === 14.5, '9h shift trigger = 14.5');
ok(autoPunchOutTriggerHours(null, null) === 14.5, 'no shift trigger = 14.5');
ok(autoPunchOutTriggerHours('10:00', '18:00') === 13.5, '8h shift trigger = 13.5');

/* ================================================================== */
/*  2. workedMsFromSegments excludes breaks                            */
/* ================================================================== */
console.log('\n--- 2. Worked-ms from segments (break excluded) ---');
{
  const now = new Date('2026-06-15T16:00:00Z');
  const punchIn = '2026-06-15T12:00:00Z';
  // 1h work, 1h break, then open segment from 14:00 -> now(16:00) = 2h. Total 3h.
  const segs = [
    { segment_start: '2026-06-15T12:00:00Z', segment_end: '2026-06-15T13:00:00Z' },
    { segment_start: '2026-06-15T14:00:00Z', segment_end: null },
  ];
  const ms = workedMsFromSegments(segs, punchIn, now);
  ok(approx(ms / H, 3), `1h+break+2h open -> 3h worked (got ${(ms / H).toFixed(2)}h), span is 4h`);
}

/* ================================================================== */
/*  3. autoCloseStaleSessions (per-user) credits SHIFT, not overrun    */
/* ================================================================== */
console.log('\n--- 3. Per-user auto punch-out credits shift, not overrun ---');
{
  const now = new Date('2026-06-16T03:00:00Z'); // 15h after punch-in
  const punchIn = '2026-06-15T12:00:00Z';
  const empId = 'emp-1';
  const att = { id: 'att-1', employee_id: empId, date: '2026-06-15', punch_in: punchIn, punch_out: null, worked_hours: null, status: 'present', notes: null };
  const db = makeFakeDb({
    employees: [{ id: empId, shift_start: null, shift_end: null }], // no shift -> 9h credit, 14.5h trigger
    attendance: [att],
    attendance_segments: [{ id: 'seg-1', attendance_id: 'att-1', segment_start: punchIn, segment_end: null }],
  });
  const closed = await autoCloseStaleSessions(db, empId, now);
  ok(closed === 1, `closed 1 stale session (got ${closed})`);
  ok(att.punch_out != null, 'punch_out was set');
  ok(approx(att.worked_hours, 9), `worked_hours credited 9h, NOT 15h overrun (got ${att.worked_hours})`);
  const poDelta = (new Date(att.punch_out).getTime() - new Date(punchIn).getTime()) / H;
  ok(approx(poDelta, 9), `punch_out = punch_in + 9h (got +${poDelta.toFixed(2)}h)`);
  ok(att.status === 'auto_punched_out', `status = auto_punched_out (got "${att.status}")`);
}
{
  // Under the trigger window -> must NOT close.
  const now = new Date('2026-06-16T01:00:00Z'); // 13h after punch-in (< 14.5h)
  const punchIn = '2026-06-15T12:00:00Z';
  const att = { id: 'att-2', employee_id: 'emp-2', date: '2026-06-15', punch_in: punchIn, punch_out: null, worked_hours: null, status: 'present' };
  const db = makeFakeDb({
    employees: [{ id: 'emp-2', shift_start: '09:00', shift_end: '18:00' }],
    attendance: [att],
    attendance_segments: [{ id: 's2', attendance_id: 'att-2', segment_start: punchIn, segment_end: null }],
  });
  const closed = await autoCloseStaleSessions(db, 'emp-2', now);
  ok(closed === 0 && att.punch_out == null, `13h session under 14.5h trigger stays OPEN (closed=${closed})`);
}

/* ================================================================== */
/*  4. autoCloseAllStaleSessions (org-wide cron) per-employee trigger  */
/* ================================================================== */
console.log('\n--- 4. Org-wide cron sweep ---');
{
  const now = new Date('2026-06-16T05:00:00Z');
  const mk = (id, emp, hoursAgo, shift) => {
    const punchIn = new Date(now.getTime() - hoursAgo * H).toISOString();
    return {
      att: { id, employee_id: emp, date: '2026-06-15', punch_in: punchIn, punch_out: null, worked_hours: null, status: 'present', employees: shift },
      seg: { id: `s-${id}`, attendance_id: id, segment_start: punchIn, segment_end: null },
      punchIn,
    };
  };
  const a = mk('A', 'eA', 16, { shift_start: '09:00', shift_end: '18:00' }); // 16h > 14.5h -> close, credit 9
  const b = mk('B', 'eB', 13, { shift_start: '09:00', shift_end: '18:00' }); // 13h < 14.5h -> stay open
  const c = mk('C', 'eC', 20, null);                                          // 20h > 14.5h (default) -> close, credit 9
  const db = makeFakeDb({
    employees: [],
    attendance: [a.att, b.att, c.att],
    attendance_segments: [a.seg, b.seg, c.seg],
  });
  const closed = await autoCloseAllStaleSessions(db, now);
  ok(closed === 2, `cron closed exactly 2 of 3 sessions (got ${closed})`);
  ok(a.att.punch_out != null && approx(a.att.worked_hours, 9), `A (16h, 9h shift) closed & credited 9h (got ${a.att.worked_hours})`);
  ok(b.att.punch_out == null, 'B (13h) left open (under trigger)');
  ok(c.att.punch_out != null && approx(c.att.worked_hours, 9), `C (20h, no shift) closed & credited 9h (got ${c.att.worked_hours})`);
}

/* ================================================================== */
/*  5. IST day-boundary: open session must be found after midnight     */
/*     (reproduces the "shows Punch In again" UI bug at data layer)    */
/* ================================================================== */
console.log('\n--- 5. Overnight open-session lookup across IST midnight ---');
{
  // Punched in 2026-06-15 23:00 IST (= 17:30 UTC). Now it is 2026-06-16
  // 01:00 IST (= 2026-06-15 19:30 UTC). Business date has rolled to 06-16.
  const punchInUtc = '2026-06-15T17:30:00Z';
  const nowUtc = new Date('2026-06-15T19:30:00Z');
  const startDate = businessDate(new Date(punchInUtc));
  const nowDate = businessDate(nowUtc);
  ok(startDate === '2026-06-15', `punch-in business date = 2026-06-15 (got ${startDate})`);
  ok(nowDate === '2026-06-16', `current business date rolled to 2026-06-16 (got ${nowDate})`);
  ok(startDate !== nowDate, 'day boundary crossed (this is the bug scenario)');

  const att = { id: 'ovn', employee_id: 'eN', date: startDate, punch_in: punchInUtc, punch_out: null };
  const db = makeFakeDb({ employees: [], attendance: [att], attendance_segments: [] });

  // OLD (buggy) behaviour: query by today's date -> finds nothing -> UI shows Punch In.
  const { data: byToday } = await db.from('attendance').select().eq('employee_id', 'eN').eq('date', nowDate);
  ok(byToday.length === 0, 'querying by TODAY finds nothing (old bug -> wrongly shows Punch In)');

  // NEW behaviour: open-session lookup (no punch_out, any date) -> finds it.
  const { data: open } = await db
    .from('attendance').select()
    .eq('employee_id', 'eN')
    .is('punch_out', null)
    .not('punch_in', 'is', null)
    .order('date', { ascending: false })
    .limit(1);
  ok(open.length === 1 && open[0].id === 'ovn', 'open-session lookup FINDS the overnight session -> shows Punch Out');
}

/* ================================================================== */
/*  6. Punch-in guard blocks a 2nd punch-in while a session is open    */
/*     (the live bug: open record dated yesterday let a new punch-in    */
/*      slip through on a new date -> two simultaneous open sessions)   */
/* ================================================================== */
console.log('\n--- 6. Punch-in blocked while an open session exists (any day) ---');

// Mirrors the server punch-in guard in src/app/api/attendance/route.ts:
// before inserting a new punch-in we look for ANY open session (no punch_out),
// independent of `today`. If one exists, the punch-in is rejected (409).
async function openSessionGuard(db, employeeId) {
  const { data } = await db
    .from('attendance')
    .select('id, date, punch_in')
    .eq('employee_id', employeeId)
    .is('punch_out', null)
    .not('punch_in', 'is', null)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data; // truthy => block punch-in
}

{
  // Open session dated YESTERDAY, today is a new date, only 12h elapsed
  // (< 14.5h trigger so auto-close does NOT fire yet).
  const yesterday = '2026-06-18';
  const today = '2026-06-19';
  const openYesterday = { id: 'y1', employee_id: 'eG', date: yesterday, punch_in: '2026-06-18T17:30:00Z', punch_out: null };
  const db = makeFakeDb({ employees: [], attendance: [openYesterday], attendance_segments: [] });

  const blocked = await openSessionGuard(db, 'eG');
  ok(!!blocked && blocked.id === 'y1', `2nd punch-in BLOCKED while yesterday's session is open (the live bug is fixed)`);

  // After punching out yesterday's session, a fresh punch-in IS allowed.
  openYesterday.punch_out = '2026-06-19T02:00:00Z';
  const allowed = await openSessionGuard(db, 'eG');
  ok(!allowed, 'after punch-out, a new punch-in is allowed again');
  void today;
}
{
  // No open session at all -> punch-in allowed.
  const db = makeFakeDb({ employees: [], attendance: [], attendance_segments: [] });
  const blocked = await openSessionGuard(db, 'eFresh');
  ok(!blocked, 'no open session -> punch-in allowed');
}

/* ------------------------------------------------------------------ */
/*  7. Break (pause) time: derive break as span - work, capped         */
/* ------------------------------------------------------------------ */
console.log('\n--- 7. Break time = span − work, capped at MAX_BREAK_HOURS ---');
{
  // Mirror the client helpers calcActiveMs / calcBreakMs (pure logic).
  const calcActiveMs = (segments, asOf) => {
    let total = 0;
    for (const s of segments) {
      const end = s.end ? new Date(s.end).getTime() : asOf;
      total += end - new Date(s.start).getTime();
    }
    return Math.max(0, total);
  };
  const calcBreakMs = (session, asOf) => {
    const spanEnd = session.punchOutTime ? new Date(session.punchOutTime).getTime() : asOf;
    const spanMs = spanEnd - new Date(session.punchInTime).getTime();
    return Math.max(0, spanMs - calcActiveMs(session.segments, asOf));
  };

  // (a) Happy path: work 10:00-10:30, break to 11:00, work 11:00-12:00.
  {
    const session = {
      punchInTime: '2026-06-20T10:00:00Z',
      punchOutTime: '2026-06-20T12:00:00Z',
      segments: [
        { start: '2026-06-20T10:00:00Z', end: '2026-06-20T10:30:00Z' },
        { start: '2026-06-20T11:00:00Z', end: '2026-06-20T12:00:00Z' },
      ],
    };
    const asOf = new Date('2026-06-20T12:00:00Z').getTime();
    ok(approx(calcActiveMs(session.segments, asOf) / H, 1.5), 'work = 1.5h (happy path)');
    ok(approx(calcBreakMs(session, asOf) / H, 0.5), 'break = 0.5h (gap between segments)');
  }

  // (b) The reported bug: punch OUT while still on break (trailing break).
  // Old gap-between-segments logic returned 0; span−work correctly returns 1h.
  {
    const session = {
      punchInTime: '2026-06-20T10:00:00Z',
      punchOutTime: '2026-06-20T12:00:00Z',
      segments: [{ start: '2026-06-20T10:00:00Z', end: '2026-06-20T11:00:00Z' }],
    };
    const asOf = new Date('2026-06-20T12:00:00Z').getTime();
    ok(approx(calcActiveMs(session.segments, asOf) / H, 1.0), 'work = 1.0h (one segment)');
    ok(approx(calcBreakMs(session, asOf) / H, 1.0), 'trailing break = 1.0h survives (old bug returned 0)');
  }

  // (c) Live ongoing break stops growing once it exceeds MAX_BREAK_HOURS.
  {
    const session = {
      punchInTime: '2026-06-20T10:00:00Z',
      punchOutTime: null,
      segments: [{ start: '2026-06-20T10:00:00Z', end: '2026-06-20T11:00:00Z' }],
    };
    const MAX_BREAK_MS_T = MAX_BREAK_HOURS * H;
    // 5h after the break started -> raw break = 5h, but capped to MAX_BREAK_HOURS.
    const asOf = new Date('2026-06-20T16:00:00Z').getTime();
    const raw = calcBreakMs(session, asOf);
    ok(raw / H > MAX_BREAK_HOURS, 'raw ongoing break exceeds the cap (would grow forever)');
    ok(approx(Math.min(raw, MAX_BREAK_MS_T) / H, MAX_BREAK_HOURS), `displayed break capped at ${MAX_BREAK_HOURS}h`);
    ok(raw >= MAX_BREAK_MS_T, 'break >= cap triggers auto punch-out');
  }
}

console.log('\n--- 8. Geofencing math + decisions ---');
{
  // Known distance: Pune Shaniwar Wada (18.5195, 73.8553) to Pune station
  // (18.5286, 73.8746) is ~2.26 km.
  const d = distanceMeters(18.5195, 73.8553, 18.5286, 73.8746);
  ok(d > 2000 && d < 2600, `haversine sanity (~2.26km, got ${(d / 1000).toFixed(2)}km)`);
  ok(distanceMeters(10, 20, 10, 20) === 0, 'zero distance for identical points');

  const config = parseGeoConfig({
    enabled: true,
    zones: [{ id: 'hq', label: 'HQ', lat: 18.5195, lng: 73.8553, radiusM: 250 }],
  });
  ok(config.enabled && config.zones.length === 1, 'valid config parses');

  // Inside the zone -> not flagged
  const inside = evaluateGeoWithConfig(config, 18.5196, 73.8554, 10);
  ok(inside.enforced && !inside.flagged && inside.matchedZone === 'HQ', 'inside zone passes');

  // 2km away -> flagged with distance detail
  const outside = evaluateGeoWithConfig(config, 18.5286, 73.8746, 10);
  ok(outside.flagged && outside.nearestDistanceM > 1500, 'outside zone flagged with distance');

  // Just outside radius but accuracy circle overlaps -> benefit of the doubt
  const edge = evaluateGeoWithConfig(config, 18.5219, 73.8553, 100); // ~267m north
  ok(!edge.flagged, 'accuracy tolerance covers the zone edge');

  // Huge claimed accuracy cannot whitelist the whole city (capped at 200m)
  const spoofAcc = evaluateGeoWithConfig(config, 18.5286, 73.8746, 5000);
  ok(spoofAcc.flagged, '5km "accuracy" does not bypass the fence');

  // No coordinates while enabled -> flagged (allow-and-flag policy)
  const noCoords = evaluateGeoWithConfig(config, null, null, null);
  ok(noCoords.flagged && noCoords.detail.includes('unavailable'), 'missing coords flagged');

  // Disabled -> nothing enforced even with far coords
  const off = evaluateGeoWithConfig({ enabled: false, zones: config.zones }, 0, 0);
  ok(!off.enforced && !off.flagged, 'disabled geofencing never flags');

  // Malformed zones are dropped; enabled cannot stick without valid zones
  const bad = parseGeoConfig({ enabled: true, zones: [{ label: 'x', lat: 999, lng: 0, radiusM: 100 }] });
  ok(!bad.enabled && bad.zones.length === 0, 'invalid zone dropped, enabled forced off');
}

console.log(`\n${failures === 0 ? 'ALL PASSED ✅' : `${failures} FAILED ❌`}`);
process.exit(failures === 0 ? 0 : 1);
