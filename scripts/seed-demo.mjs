#!/usr/bin/env node
/**
 * Demo seed for August HRMS.
 *
 *   node scripts/seed-demo.mjs          # create/refresh demo data
 *   node scripts/seed-demo.mjs --wipe   # remove everything this script created
 *
 * Creates departments, leave types (paid + unpaid), allocations, holidays, a
 * team of employees with real Supabase Auth logins, ~8 weeks of attendance,
 * leave requests, pending approvals, and salary structures — enough for the
 * dashboard, Team Insights, Approvals and Payroll to all render real numbers.
 *
 * Everything it creates is tagged with the @DEMO_DOMAIN below, so --wipe can
 * remove exactly its own rows and nothing else.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(process.cwd(), '.env.local');
if (!existsSync(envPath)) {
  console.error('Error: .env.local not found. Run from the project root.');
  process.exit(1);
}
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const SB_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SVC = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SVC || SB_URL.includes('dummy.supabase.co')) {
  console.error('Set real Supabase credentials in .env.local first.');
  process.exit(1);
}

const db = createClient(SB_URL, SVC, { auth: { persistSession: false } });

const DEMO_DOMAIN = 'august.io';
const DEMO_PASSWORD = 'AugustDemo@2026';
const WIPE = process.argv.includes('--wipe');

/* ------------------------------------------------------------------ */
/*  IST calendar helpers. Attendance is keyed by LOCAL date            */
/*  (BUSINESS_RULES §1) — never by a UTC slice.                        */
/* ------------------------------------------------------------------ */

const IST_OFFSET_MIN = 330;

/** Today's date in IST as YYYY-MM-DD. */
function istToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/** Shift a YYYY-MM-DD string by N days, staying on the calendar. */
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

function dayOfWeek(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 Sun .. 6 Sat
}

/** An IST wall-clock time on a given date, as a UTC ISO instant. */
function istInstant(dateStr, hour, minute) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour, minute) - IST_OFFSET_MIN * 60_000).toISOString();
}

/** Deterministic 0..1 from a string — keeps reruns stable. */
function hash01(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
}

/* ------------------------------------------------------------------ */
/*  Demo cast                                                          */
/* ------------------------------------------------------------------ */

const DEPARTMENTS = ['Engineering', 'Sales', 'Design', 'People Ops', 'Finance'];

const LEAVE_TYPES = [
  { name: 'Casual Leave', key: 'casual', is_paid: true, annual_days: 12 },
  { name: 'Sick Leave', key: 'sick', is_paid: true, annual_days: 8 },
  { name: 'Earned Leave', key: 'earned', is_paid: true, annual_days: 15 },
  { name: 'Loss of Pay', key: 'lop', is_paid: false, annual_days: 0 },
];

const PEOPLE = [
  { first: 'Ananya', last: 'Iyer', dept: 'Engineering', desig: 'Engineering Manager', gross: 145000, joined: '2023-04-03', role: 'employee' },
  { first: 'Rohan', last: 'Deshmukh', dept: 'Engineering', desig: 'Senior Software Engineer', gross: 110000, joined: '2023-09-11', role: 'employee' },
  { first: 'Meera', last: 'Nair', dept: 'Engineering', desig: 'Software Engineer', gross: 72000, joined: '2025-01-06', role: 'employee' },
  { first: 'Kabir', last: 'Sharma', dept: 'Engineering', desig: 'QA Engineer', gross: 58000, joined: '2025-07-21', role: 'employee' },
  { first: 'Priya', last: 'Menon', dept: 'Design', desig: 'Product Designer', gross: 82000, joined: '2024-02-19', role: 'employee' },
  { first: 'Arjun', last: 'Rao', dept: 'Sales', desig: 'Account Executive', gross: 65000, joined: '2024-06-10', role: 'employee' },
  { first: 'Sneha', last: 'Kulkarni', dept: 'Sales', desig: 'Sales Development Rep', gross: 42000, joined: '2026-03-02', role: 'employee' },
  { first: 'Vikram', last: 'Bose', dept: 'Finance', desig: 'Finance Analyst', gross: 68000, joined: '2024-11-04', role: 'employee' },
  { first: 'Divya', last: 'Pillai', dept: 'People Ops', desig: 'HR Business Partner', gross: 76000, joined: '2023-12-01', role: 'admin' },
  { first: 'Farhan', last: 'Qureshi', dept: 'Engineering', desig: 'Intern', gross: 25000, joined: '2026-08-17', role: 'employee' },
];

const BANKS = ['HDFC Bank', 'ICICI Bank', 'Axis Bank', 'State Bank of India', 'Kotak Mahindra Bank'];

const email = (p) => `${p.first}.${p.last}`.toLowerCase().replace(/[^a-z.]/g, '') + `@${DEMO_DOMAIN}`;

/* ------------------------------------------------------------------ */
/*  Wipe                                                               */
/* ------------------------------------------------------------------ */

async function wipe() {
  console.log('Removing demo data...\n');

  const { data: emps } = await db
    .from('employees').select('id, auth_user_id, email').like('email', `%@${DEMO_DOMAIN}`);
  const ids = (emps ?? []).map((e) => e.id);

  if (ids.length) {
    // Children first: FKs to employees have no ON DELETE CASCADE everywhere.
    const { data: att } = await db.from('attendance').select('id').in('employee_id', ids);
    const attIds = (att ?? []).map((a) => a.id);
    if (attIds.length) await db.from('attendance_segments').delete().in('attendance_id', attIds);
    await db.from('attendance').delete().in('employee_id', ids);
    await db.from('leave_requests').delete().in('employee_id', ids);
    await db.from('approval_requests').delete().in('employee_id', ids);
    await db.from('notifications').delete().in('employee_id', ids);
    await db.from('audit_log').delete().in('target_employee', ids);
    await db.from('audit_log').delete().in('performed_by', ids);
    await db.from('documents').delete().in('employee_id', ids);

    const { data: structs } = await db.from('salary_structures').select('id').in('employee_id', ids);
    const sIds = (structs ?? []).map((s) => s.id);
    if (sIds.length) await db.from('salary_structure_items').delete().in('structure_id', sIds);
    await db.from('payslips').delete().in('employee_id', ids);
    await db.from('salary_structures').delete().in('employee_id', ids);

    // Department heads point at employees; clear before deleting people.
    await db.from('departments').update({ head_id: null }).in('head_id', ids);
    await db.from('employees').update({ reporting_to: null }).in('reporting_to', ids);
    await db.from('employees').delete().in('id', ids);

    for (const e of emps ?? []) {
      if (e.auth_user_id) await db.auth.admin.deleteUser(e.auth_user_id).catch(() => {});
    }
    console.log(`  removed ${ids.length} demo employees and their records`);
  }

  // A payroll run is only demo data if no real payslips survive in it.
  const { data: runs } = await db.from('payroll_runs').select('id');
  for (const r of runs ?? []) {
    const { count } = await db.from('payslips').select('*', { count: 'exact', head: true }).eq('payroll_run_id', r.id);
    if (!count) await db.from('payroll_runs').delete().eq('id', r.id);
  }

  await db.from('departments').delete().in('name', DEPARTMENTS);
  const { data: lts } = await db.from('leave_types').select('id').in('key', LEAVE_TYPES.map((l) => l.key));
  const ltIds = (lts ?? []).map((l) => l.id);
  if (ltIds.length) {
    await db.from('leave_allocations').delete().in('leave_type_id', ltIds);
    await db.from('leave_overrides').delete().in('leave_type_id', ltIds);
    await db.from('leave_types').delete().in('id', ltIds);
  }
  await db.from('holidays').delete().eq('financial_year', '2026-27');

  console.log('\nDemo data removed.');
}

/* ------------------------------------------------------------------ */
/*  Seed                                                               */
/* ------------------------------------------------------------------ */

async function seed() {
  const today = istToday();
  console.log(`Seeding August HRMS demo data (today in IST: ${today})\n`);

  // ---- Departments -------------------------------------------------
  await db.from('departments').upsert(
    DEPARTMENTS.map((name) => ({ name })), { onConflict: 'name' },
  );
  const { data: depts } = await db.from('departments').select('id, name');
  const deptId = Object.fromEntries((depts ?? []).map((d) => [d.name, d.id]));
  console.log(`  departments: ${DEPARTMENTS.length}`);

  // ---- Leave types + allocations ------------------------------------
  await db.from('leave_types').upsert(
    LEAVE_TYPES.map(({ name, key, is_paid }) => ({ name, key, is_paid })), { onConflict: 'key' },
  );
  const { data: lts } = await db.from('leave_types').select('id, key');
  const ltId = Object.fromEntries((lts ?? []).map((l) => [l.key, l.id]));
  for (const lt of LEAVE_TYPES) {
    await db.from('leave_allocations').upsert(
      { leave_type_id: ltId[lt.key], annual_days: lt.annual_days }, { onConflict: 'leave_type_id' },
    );
  }
  console.log(`  leave types: ${LEAVE_TYPES.length} (Loss of Pay marked unpaid)`);

  // ---- Holidays (FY 2026-27) ----------------------------------------
  const holidays = [
    { name: 'Independence Day', date: '2026-08-15' },
    { name: 'Ganesh Chaturthi', date: '2026-09-14' },
    { name: 'Gandhi Jayanti', date: '2026-10-02' },
    { name: 'Diwali', date: '2026-11-08' },
    { name: 'Christmas', date: '2026-12-25' },
    { name: 'Republic Day', date: '2027-01-26' },
    { name: 'Holi', date: '2027-03-03' },
  ];
  for (const h of holidays) {
    const { data: found } = await db.from('holidays').select('id').eq('date', h.date).maybeSingle();
    if (!found) {
      await db.from('holidays').insert({ ...h, type: 'mandatory', financial_year: '2026-27' });
    }
  }
  const holidaySet = new Set(holidays.map((h) => h.date));
  console.log(`  holidays: ${holidays.length}`);

  // ---- Employees -----------------------------------------------------
  const created = [];
  let seq = 100;

  for (const p of PEOPLE) {
    const addr = email(p);
    let authUserId;

    const mk = await db.auth.admin.createUser({
      email: addr, password: DEMO_PASSWORD, email_confirm: true,
    });
    if (mk.data?.user) {
      authUserId = mk.data.user.id;
    } else if (/already.*registered|already been registered/i.test(mk.error?.message ?? '')) {
      const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
      const u = list.users.find((x) => x.email?.toLowerCase() === addr);
      authUserId = u?.id;
      if (authUserId) await db.auth.admin.updateUserById(authUserId, { password: DEMO_PASSWORD });
    } else {
      console.log(`  ! auth failed for ${addr}: ${mk.error?.message}`);
      continue;
    }

    const r = hash01(addr);
    const row = {
      employee_id: `AU-${p.joined.slice(0, 4)}-${String(++seq).padStart(4, '0')}`,
      name: `${p.first} ${p.last}`,
      email: addr,
      phone: `98${String(Math.floor(r * 100000000)).padStart(8, '0')}`,
      role: p.role,
      department_id: deptId[p.dept],
      designation: p.desig,
      date_of_joining: p.joined,
      gender: ['Ananya', 'Meera', 'Priya', 'Sneha', 'Divya'].includes(p.first) ? 'female' : 'male',
      status: 'active',
      onboarding_status: 'completed',
      must_reset_password: false,
      tracks_attendance: true,
      auth_user_id: authUserId,
      shift_start: '09:30:00',
      shift_end: '18:30:00',
      pan: `ABCDE${String(1000 + Math.floor(r * 8999))}F`,
      blood_group: ['O+', 'A+', 'B+', 'AB+'][Math.floor(r * 4)],
      bank_details: {
        bankName: BANKS[Math.floor(r * BANKS.length)],
        accountNumber: `${Math.floor(r * 9_000_000_000) + 1_000_000_000}`,
        ifsc: 'HDFC0001234',
        accountType: 'savings',
      },
    };

    const { data: emp, error } = await db
      .from('employees').upsert(row, { onConflict: 'email' }).select('id, name, email').single();
    if (error) { console.log(`  ! ${addr}: ${error.message}`); continue; }
    created.push({ ...emp, ...p, gross: p.gross });
  }
  console.log(`  employees: ${created.length} (password: ${DEMO_PASSWORD})`);

  // Two people mid-onboarding so the dashboard badge is non-zero.
  const onboardingDemo = created.slice(-2);
  for (const e of onboardingDemo) {
    await db.from('employees').update({ onboarding_status: 'in_progress' }).eq('id', e.id);
  }

  // Engineering manager heads the department and others report to her.
  const manager = created.find((e) => e.desig === 'Engineering Manager');
  if (manager) {
    await db.from('departments').update({ head_id: manager.id }).eq('name', 'Engineering');
    const reports = created.filter((e) => e.dept === 'Engineering' && e.id !== manager.id);
    for (const rpt of reports) {
      await db.from('employees').update({ reporting_to: manager.id }).eq('id', rpt.id);
    }
  }

  // ---- Attendance: last 60 calendar days ------------------------------
  const attendanceRows = [];
  for (const e of created) {
    for (let back = 1; back <= 60; back++) {
      const date = addDays(today, -back);
      if (date < e.joined) continue;
      const dow = dayOfWeek(date);
      if (dow === 0 || dow === 6) continue;
      if (holidaySet.has(date)) continue;

      const r = hash01(`${e.email}|${date}`);
      let status = 'present';
      if (r > 0.94) status = 'absent';
      else if (r > 0.88) status = 'half';

      if (status === 'absent') {
        attendanceRows.push({ employee_id: e.id, date, status, worked_hours: 0 });
        continue;
      }

      const inMin = 30 + Math.floor(r * 45);           // 09:30 – 10:15
      const worked = status === 'half' ? 4 + r : 8.4 + r * 1.2;
      const punchIn = istInstant(date, 9, inMin);
      const punchOut = new Date(
        new Date(punchIn).getTime() + (worked + 1) * 3_600_000, // + ~1h break
      ).toISOString();

      attendanceRows.push({
        employee_id: e.id, date, status,
        punch_in: punchIn, punch_out: punchOut,
        worked_hours: Number(worked.toFixed(2)),
      });
    }
  }
  for (let i = 0; i < attendanceRows.length; i += 500) {
    const { error } = await db
      .from('attendance').upsert(attendanceRows.slice(i, i + 500), { onConflict: 'employee_id,date' });
    if (error) console.log('  ! attendance:', error.message);
  }
  console.log(`  attendance rows: ${attendanceRows.length}`);

  // A few people punched in today and are still working, so "present today"
  // and the live dashboard counters are non-zero.
  if (dayOfWeek(today) !== 0 && dayOfWeek(today) !== 6) {
    const live = created.slice(0, 5).map((e) => ({
      employee_id: e.id, date: today, status: 'present',
      punch_in: istInstant(today, 9, 40), punch_out: null, worked_hours: null,
    }));
    await db.from('attendance').upsert(live, { onConflict: 'employee_id,date' });
    console.log(`  open sessions today: ${live.length}`);
  }

  // ---- Leave requests --------------------------------------------------
  await db.from('leave_requests').delete().in('employee_id', created.map((e) => e.id));
  const leaveRows = [];
  const pushLeave = (e, key, from, to, days, status, reason, half = false) => {
    leaveRows.push({
      employee_id: e.id, leave_type_id: ltId[key],
      from_date: from, to_date: to, days, half_day: half,
      reason, status,
      approved_by: status === 'approved' ? (manager?.id ?? null) : null,
      approved_at: status === 'approved' ? istInstant(from, 10, 0) : null,
    });
  };

  if (created.length >= 8) {
    // Pending — these drive the Approvals badge on the dashboard.
    pushLeave(created[1], 'casual', addDays(today, 5), addDays(today, 6), 2, 'pending', 'Family function');
    pushLeave(created[4], 'sick', addDays(today, 2), addDays(today, 2), 1, 'pending', 'Fever');
    pushLeave(created[5], 'earned', addDays(today, 12), addDays(today, 16), 5, 'pending', 'Vacation');
    // Approved history.
    pushLeave(created[0], 'earned', addDays(today, -21), addDays(today, -19), 3, 'approved', 'Short break');
    pushLeave(created[2], 'sick', addDays(today, -12), addDays(today, -12), 1, 'approved', 'Migraine');
    pushLeave(created[3], 'casual', addDays(today, -8), addDays(today, -8), 0.5, 'approved', 'Bank work', true);
    // Unpaid — shows up as LOP in payroll.
    pushLeave(created[6], 'lop', addDays(today, -6), addDays(today, -5), 2, 'approved', 'Personal, unpaid');
    pushLeave(created[7], 'casual', addDays(today, -30), addDays(today, -29), 2, 'rejected', 'Not enough cover');
  }
  if (leaveRows.length) {
    const { error } = await db.from('leave_requests').insert(leaveRows);
    if (error) console.log('  ! leaves:', error.message);
  }
  console.log(`  leave requests: ${leaveRows.length} (3 pending)`);

  // ---- Approval requests (regularisation / WFH) -------------------------
  await db.from('approval_requests').delete().in('employee_id', created.map((e) => e.id));
  const approvals = [
    {
      employee_id: created[2]?.id, type: 'regularisation', status: 'pending',
      reg_date: addDays(today, -3), original_punch: 'No punch out',
      requested_change: '18:45', reason: 'Forgot to punch out',
    },
    {
      employee_id: created[5]?.id, type: 'wfh', status: 'pending',
      wfh_from: addDays(today, 3), wfh_to: addDays(today, 4),
      reason: 'Client visit in the area',
    },
    {
      employee_id: created[1]?.id, type: 'regularisation', status: 'approved',
      reg_date: addDays(today, -15), original_punch: '10:40',
      requested_change: '09:30', reason: 'Traffic; informed manager',
      resolved_by: manager?.id ?? null, resolved_at: istInstant(addDays(today, -14), 11, 0),
    },
  ].filter((a) => a.employee_id);
  if (approvals.length) {
    const { error } = await db.from('approval_requests').insert(approvals);
    if (error) console.log('  ! approvals:', error.message);
  }
  console.log(`  approval requests: ${approvals.length} (2 pending)`);

  // ---- Salary structures ------------------------------------------------
  const { data: existingStructs } = await db
    .from('salary_structures').select('id').in('employee_id', created.map((e) => e.id));
  if (existingStructs?.length) {
    await db.from('salary_structure_items').delete().in('structure_id', existingStructs.map((s) => s.id));
    await db.from('salary_structures').delete().in('id', existingStructs.map((s) => s.id));
  }

  let structureCount = 0;
  for (const e of created) {
    // Effective from the later of the FY start and the joining date, so the
    // structure is always in force for any month we might run payroll on.
    const effective = e.joined > '2026-04-01' ? e.joined : '2026-04-01';
    const { data: s, error } = await db.from('salary_structures').insert({
      employee_id: e.id,
      effective_from: effective,
      monthly_gross: e.gross,
      ctc_annual: e.gross * 12,
      note: 'FY 2026-27 structure',
    }).select('id').single();
    if (error) { console.log(`  ! structure ${e.name}: ${error.message}`); continue; }

    await db.from('salary_structure_items').insert([
      { structure_id: s.id, component_key: 'basic', calc: 'pct_of_gross', percent: 50 },
      { structure_id: s.id, component_key: 'hra', calc: 'pct_of_basic', percent: 40 },
      { structure_id: s.id, component_key: 'conveyance', calc: 'fixed', amount: 1600 },
      { structure_id: s.id, component_key: 'special', calc: 'balance' },
    ]);
    structureCount++;
  }
  console.log(`  salary structures: ${structureCount}`);

  console.log(`
Done.

  Admin login   admin@demandnexus.io / DemandNexus@2026
  Demo staff    <first>.<last>@${DEMO_DOMAIN} / ${DEMO_PASSWORD}
                e.g. ${email(PEOPLE[0])}
  HR admin      ${email(PEOPLE[8])} (also an admin account)

  Payroll: open /payroll, pick last month, Create draft.
  Undo everything: node scripts/seed-demo.mjs --wipe
`);
}

(WIPE ? wipe() : seed()).catch((e) => {
  console.error('\nSeed failed:', e.message || e);
  process.exit(1);
});
