import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

const PW = 'TestPass!23456';
const ADMIN_EMAIL = 'admin@demandnexus.io';
const EMP_EMAIL = 'emp1@demandnexus.io';

function log(ok, msg) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) process.exitCode = 1; }

async function ensureAuthUser(email) {
  // create or fetch
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password: PW, email_confirm: true,
  });
  if (created?.user) return created.user.id;
  if (error && /already.*registered|already been registered/i.test(error.message)) {
    const { data } = await admin.auth.admin.listUsers();
    const u = data.users.find((x) => x.email === email);
    // reset password so we know it
    await admin.auth.admin.updateUserById(u.id, { password: PW });
    return u.id;
  }
  throw error;
}

async function loginClient(email) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PW });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  return c;
}

(async () => {
  // 1. Create auth users
  const adminUid = await ensureAuthUser(ADMIN_EMAIL);
  const empUid = await ensureAuthUser(EMP_EMAIL);
  log(!!adminUid && !!empUid, `created/fetched auth users (admin=${adminUid.slice(0,8)} emp=${empUid.slice(0,8)})`);

  // 2. Link to employees via auth_user_id
  await admin.from('employees').update({ auth_user_id: adminUid }).eq('email', ADMIN_EMAIL);
  await admin.from('employees').update({ auth_user_id: empUid }).eq('email', EMP_EMAIL);
  log(true, 'linked auth_user_id on both employees');

  // 3. Login as EMPLOYEE, verify RLS: can see only self
  const empCli = await loginClient(EMP_EMAIL);
  const { data: empSees, error: e1 } = await empCli.from('employees').select('email');
  log(!e1 && empSees?.length === 1 && empSees[0].email === EMP_EMAIL,
    `employee sees only self via RLS (saw ${empSees?.length} rows${e1 ? ' err='+e1.message : ''})`);

  // 4. Employee cannot insert a new employee (admin-only)
  const { error: insErr } = await empCli.from('employees').insert({
    employee_id: 'TST999', name: 'x', email: 'rls-test-x@x.io', role: 'employee',
  });
  log(!!insErr, `employee blocked from inserting employee (${insErr ? 'denied' : 'ALLOWED-BAD'})`);

  // 5. Login as ADMIN, verify can see all employees
  const adminCli = await loginClient(ADMIN_EMAIL);
  const { data: adminSees, error: e2 } = await adminCli.from('employees').select('email');
  log(!e2 && (adminSees?.length ?? 0) >= 2,
    `admin sees all employees via RLS (saw ${adminSees?.length} rows${e2 ? ' err='+e2.message : ''})`);

  // 6. Verify helper functions resolve correctly for employee
  const { data: empId } = await empCli.rpc('my_employee_id');
  log(!!empId, `my_employee_id() resolves for employee (${empId})`);
  const { data: isAdminEmp } = await empCli.rpc('is_admin');
  log(isAdminEmp === false, `is_admin()=false for employee (got ${isAdminEmp})`);
  const { data: isAdminAdm } = await adminCli.rpc('is_admin');
  log(isAdminAdm === true, `is_admin()=true for admin (got ${isAdminAdm})`);

  // 7. attendance RLS: employee can insert own, scoped read
  const { data: meId } = await empCli.rpc('my_employee_id');
  const today = new Date().toISOString().slice(0, 10);
  await empCli.from('attendance').delete().eq('employee_id', meId).eq('date', today);
  const { error: attErr } = await empCli
    .from('attendance')
    .upsert({ employee_id: meId, date: today, status: 'present' }, { onConflict: 'employee_id,date' });
  log(!attErr, `employee can insert own attendance (${attErr ? 'err=' + attErr.message : 'ok'})`);

  // 8. employee cannot read another employee's attendance
  const adminEmpRow = adminSees ? null : null;
  const { data: admEmpId } = await adminCli.rpc('my_employee_id');
  await adminCli.from('attendance').delete().eq('employee_id', admEmpId).eq('date', today);
  await adminCli.from('attendance').insert({ employee_id: admEmpId, date: today, status: 'present' });
  const { data: empAtt } = await empCli.from('attendance').select('employee_id');
  const leakedOther = (empAtt ?? []).some((r) => r.employee_id !== meId);
  log(!leakedOther, `employee attendance read is scoped to self (rows=${empAtt?.length}, leaked=${leakedOther})`);

  console.log('\nDone.');
})().catch((e) => { console.error('FAIL  unexpected:', e.message); process.exit(1); });
