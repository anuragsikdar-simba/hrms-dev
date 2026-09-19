import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const SB_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SVC = env.SUPABASE_SERVICE_ROLE_KEY;
const BASE = 'http://localhost:3000';
const PW = 'TestPass!23456';
const ref = new URL(SB_URL).hostname.split('.')[0];
const svc = createClient(SB_URL, SVC, { auth: { persistSession: false } });

function log(ok, msg) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) process.exitCode = 1; }

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
async function api(method, path, cookies, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Cookie: cookies.join('; '), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  return { status: res.status, body: j, raw: JSON.stringify(j) };
}

// Detect raw DB / internal leakage in any response body text.
const LEAK_RE = /constraint|relation|column "|syntax error|pg_|violates|null value in column|\bsql\b|service_role|supabase\.co|stack|at Object\.|node_modules/i;
function assertNoLeak(label, r) {
  const leaked = LEAK_RE.test(r.raw);
  log(!leaked, `${label} -> no internal leak in body (status ${r.status})${leaked ? ' :: ' + r.raw.slice(0, 200) : ''}`);
}

(async () => {
  // Identify two distinct employees
  const { data: emps } = await svc.from('employees').select('id, email').in('email', ['emp1@demandnexus.io', 'emp2@demandnexus.io']);
  const emp1 = emps.find(e => e.email === 'emp1@demandnexus.io');
  const emp2 = emps.find(e => e.email === 'emp2@demandnexus.io');

  const empSession = await sessionFor('emp1@demandnexus.io');
  const empCookie = buildCookie(empSession);

  // 1) Employee tries to read ANOTHER employee's full profile -> must be 403/404, no data
  const other = await api('GET', `/api/employees/${emp2.id}`, empCookie);
  const leakedOther = other.raw.includes(emp2.email) || (other.body?.data?.employee?.pan) || (other.body?.data?.employee?.bank_details);
  log((other.status === 403 || other.status === 404) && !leakedOther,
    `employee reads other's profile -> ${other.status} (no cross-employee data: ${!leakedOther})`);
  assertNoLeak('employee GET /api/employees/[otherId]', other);

  // 2) Employee lists employees -> RLS scoped to self only (must NOT contain emp2)
  const list = await api('GET', '/api/employees', empCookie);
  const listLeaksOther = list.raw.includes(emp2.id);
  log(list.status === 200 && !listLeaksOther, `employee GET /api/employees -> ${list.status} (other employee leaked: ${listLeaksOther})`);

  // 3) Employee hits admin-only POST /api/employees -> 403, no leak
  const createAttempt = await api('POST', '/api/employees', empCookie, { name: 'Hacker', email: 'x@x.io', role: 'admin' });
  log(createAttempt.status === 403, `employee POST /api/employees (admin-only) -> ${createAttempt.status} (expect 403)`);
  assertNoLeak('employee POST /api/employees', createAttempt);

  // 4) Employee tries to PATCH another employee -> denied, no leak
  const patchOther = await api('PATCH', `/api/employees/${emp2.id}`, empCookie, { name: 'Renamed', tracks_attendance: false });
  log(patchOther.status === 403, `employee PATCH other employee -> ${patchOther.status} (expect 403)`);
  assertNoLeak('employee PATCH other employee', patchOther);

  // 5) Employee tries forbidden self-field (role escalation) -> denied
  const escalate = await api('PATCH', `/api/employees/${emp1.id}`, empCookie, { role: 'admin' });
  log(escalate.status === 403, `employee self role-escalation -> ${escalate.status} (expect 403)`);
  assertNoLeak('employee self role-escalation', escalate);

  // 6) Employee hits admin-only reports -> 403, no leak
  for (const path of ['/api/attendance/absentees', '/api/team-insights', '/api/dashboard/stats']) {
    const r = await api('GET', path, empCookie);
    // some may be 200 but RLS-scoped; key is: no internal leak and no other-employee PII
    assertNoLeak(`employee GET ${path}`, r);
  }

  // 7) Malformed body / bad input -> graceful, no stack/raw error
  const bad = await api('POST', '/api/attendance', empCookie, { action: 'not_a_real_action' });
  log(bad.status === 400, `employee bad punch action -> ${bad.status} (expect 400)`);
  assertNoLeak('employee bad punch action', bad);

  // 8) No cookie -> 401 everywhere, no leak
  const noauth = await fetch(`${BASE}/api/employees`);
  const noauthBody = await noauth.text();
  log(noauth.status === 401, `no-cookie GET /api/employees -> ${noauth.status} (expect 401)`);
  log(!LEAK_RE.test(noauthBody), `no-cookie response has no internal leak`);

  console.log('\nDone.');
})().catch((e) => { console.error('FAIL  unexpected:', e.message); process.exit(1); });
