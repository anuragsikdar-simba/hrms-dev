/**
 * Employee ID generation e2e (npm run test:employee-id).
 *
 * Covers the auto-generated/overridable employee_id scheme end to end against
 * the running dev server + cloud DB:
 *   - admin can preview the next id; non-admins are forbidden (403)
 *   - blank id auto-generates a canonical AU-YYYY-NNNN, strictly sequential
 *     (legacy DN-YYYY-NNNN ids stay valid but are no longer allocated)
 *   - a valid custom override is kept; lowercase is normalised to upper-case
 *   - invalid overrides (bad chars / no digit) are rejected with 400
 *   - a duplicate custom id is a clean 409
 *   - non-admins cannot create employees (403)
 *   - concurrent blank creates all succeed with distinct, canonical ids
 *     (exercises the unique-violation retry/bump path)
 *
 * All created rows are torn down FK-safely (attendance + audit_log first).
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { deleteEmployees } from './lib/teardown.mjs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const SB_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SVC = env.SUPABASE_SERVICE_ROLE_KEY;
const BASE = 'http://localhost:3000';
const PW = 'TestPass!23456';
const ref = new URL(SB_URL).hostname.split('.')[0];
const svc = createClient(SB_URL, SVC, { auth: { persistSession: false } });

function log(ok, m) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${m}`); if (!ok) process.exitCode = 1; }

async function sessionFor(email) {
  const c = createClient(SB_URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password: PW });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  return data.session;
}
function buildCookie(session) {
  const value = `base64-${Buffer.from(JSON.stringify(session)).toString('base64')}`;
  const name = `sb-${ref}-auth-token`;
  const MAX = 3180;
  if (value.length <= MAX) return [`${name}=${value}`];
  const chunks = [];
  for (let i = 0; i < value.length; i += MAX) chunks.push(value.slice(i, i + MAX));
  return chunks.map((ch, i) => `${name}.${i}=${ch}`);
}
async function api(method, path, cookie, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Cookie: cookie.join('; '), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const unwrap = (b) => b?.data ?? b;

(async () => {
  const ckAdmin = buildCookie(await sessionFor('admin@demandnexus.io'));
  const ckEmp = buildCookie(await sessionFor('emp1@demandnexus.io'));
  const created = [];
  let n = 0;
  const mk = (extra) => ({
    name: 'EID Test',
    email: `eid_${Date.now()}_${n++}_${Math.random().toString(36).slice(2, 6)}@demandnexus.io`,
    ...extra,
  });
  async function create(body) {
    const r = await api('POST', '/api/employees', ckAdmin, body);
    const emp = unwrap(r.body)?.employee;
    if (emp) created.push(emp);
    return { status: r.status, emp, err: unwrap(r.body)?.error };
  }
  const year = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()).slice(0, 4);
  // Prefix for newly allocated ids. Mirrors EMPLOYEE_ID_PREFIX in src/lib/employee-id.ts
  // (this script is plain .mjs and cannot import the TS module).
  const PREFIX = 'AU';
  const canon = new RegExp(`^${PREFIX}-${year}-\\d{4}$`);

  try {
    const pv = await api('GET', '/api/employees?preview_next_id=1', ckAdmin, null);
    log(new RegExp(`^${PREFIX}-\\d{4}-\\d{4}$`).test(unwrap(pv.body)?.nextId), `admin preview next id -> ${unwrap(pv.body)?.nextId}`);

    const pvEmp = await api('GET', '/api/employees?preview_next_id=1', ckEmp, null);
    log(pvEmp.status === 403, `non-admin preview -> 403 (got ${pvEmp.status})`);

    const a = await create(mk({}));
    log(a.status === 201 && canon.test(a.emp?.employee_id), `blank -> auto ${a.emp?.employee_id}`);
    const b = await create(mk({}));
    const na = Number(a.emp.employee_id.split('-')[2]);
    const nb = Number(b.emp.employee_id.split('-')[2]);
    log(nb === na + 1, `sequential ${na} -> ${nb}`);

    const c = await create(mk({ employee_id: 'LEGACY-007' }));
    log(c.status === 201 && c.emp?.employee_id === 'LEGACY-007', `valid custom kept (${c.emp?.employee_id})`);
    const d = await create(mk({ employee_id: 'mig-2024-9' }));
    log(d.status === 201 && d.emp?.employee_id === 'MIG-2024-9', `custom normalised (${d.emp?.employee_id})`);
    const e = await create(mk({ employee_id: 'no spaces!' }));
    log(e.status === 400, `invalid custom -> 400`);
    const f = await create(mk({ employee_id: 'ABCDEF' }));
    log(f.status === 400, `custom without digit -> 400`);
    const g = await create(mk({ employee_id: 'LEGACY-007' }));
    log(g.status === 409, `duplicate custom -> 409`);

    const h = await api('POST', '/api/employees', ckEmp, mk({}));
    log(h.status === 403, `non-admin create -> 403 (got ${h.status})`);

    const par = await Promise.all(Array.from({ length: 8 }).map(() => create(mk({}))));
    const ok201 = par.filter((r) => r.status === 201).length;
    const ids = par.filter((r) => r.status === 201).map((r) => r.emp.employee_id);
    log(ok201 === 8, `8 parallel blank creates -> all 201 (got ${ok201})`);
    log(new Set(ids).size === ids.length, `parallel ids all distinct (${new Set(ids).size}/${ids.length})`);
    log(ids.every((id) => canon.test(id)), `parallel ids all canonical`);
  } finally {
    await deleteEmployees(svc, created);
    console.log(`\nDone. (cleaned up ${created.length} test employees)`);
  }
})().catch((e) => { console.error('FAIL  unexpected:', e.message); process.exit(1); });
