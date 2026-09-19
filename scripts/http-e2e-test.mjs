import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const SB_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const BASE = 'http://localhost:3000';
const PW = 'TestPass!23456';

function log(ok, msg) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) process.exitCode = 1; }

// Build the cookie the @supabase/ssr server reads. Project ref from URL.
const ref = new URL(SB_URL).hostname.split('.')[0];

async function sessionFor(email) {
  const c = createClient(SB_URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password: PW });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  return data.session;
}

// @supabase/ssr stores the session as a cookie named sb-<ref>-auth-token,
// value = base64-<base64url(JSON.stringify(session))>, optionally chunked.
function buildCookie(session) {
  const json = JSON.stringify(session);
  const b64 = Buffer.from(json).toString('base64');
  const value = `base64-${b64}`;
  const name = `sb-${ref}-auth-token`;
  // chunk if > ~3180 chars
  const MAX = 3180;
  if (value.length <= MAX) return [`${name}=${value}`];
  const chunks = [];
  for (let i = 0; i < value.length; i += MAX) chunks.push(value.slice(i, i + MAX));
  return chunks.map((ch, i) => `${name}.${i}=${ch}`);
}

async function apiGet(path, cookies) {
  const res = await fetch(`${BASE}${path}`, { headers: { Cookie: cookies.join('; ') } });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

(async () => {
  // ADMIN flow
  const adminSession = await sessionFor('admin@demandnexus.io');
  const adminCookie = buildCookie(adminSession);

  const me = await apiGet('/api/auth/me', adminCookie);
  log(me.status === 200 && me.body?.data?.employee?.email === 'admin@demandnexus.io',
    `admin GET /api/auth/me -> ${me.status} (${me.body?.data?.employee?.email})`);

  const emps = await apiGet('/api/employees', adminCookie);
  const empList = emps.body?.data?.employees ?? emps.body?.employees ?? [];
  log(emps.status === 200 && empList.length >= 2,
    `admin GET /api/employees -> ${emps.status} (${empList.length} employees)`);

  const stats = await apiGet('/api/dashboard/stats', adminCookie);
  log(stats.status === 200, `admin GET /api/dashboard/stats -> ${stats.status}`);

  const dept = await apiGet('/api/departments', adminCookie);
  log(dept.status === 200, `admin GET /api/departments -> ${dept.status}`);

  // EMPLOYEE flow
  const empSession = await sessionFor('emp1@demandnexus.io');
  const empCookie = buildCookie(empSession);

  const meEmp = await apiGet('/api/auth/me', empCookie);
  log(meEmp.status === 200 && meEmp.body?.data?.employee?.email === 'emp1@demandnexus.io',
    `employee GET /api/auth/me -> ${meEmp.status} (${meEmp.body?.data?.employee?.email})`);

  // Employee hitting /api/employees: should succeed but RLS-scoped (only self)
  const empSeesEmps = await apiGet('/api/employees', empCookie);
  const empVisible = empSeesEmps.body?.data?.employees ?? empSeesEmps.body?.employees ?? [];
  log(empSeesEmps.status === 200,
    `employee GET /api/employees -> ${empSeesEmps.status} (sees ${empVisible.length} via RLS)`);

  // No cookie -> 401
  const noauth = await fetch(`${BASE}/api/auth/me`);
  log(noauth.status === 401, `no-cookie GET /api/auth/me -> ${noauth.status} (expect 401)`);

  console.log('\nDone.');
})().catch((e) => { console.error('FAIL  unexpected:', e.message); process.exit(1); });
