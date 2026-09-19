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

function log(ok, msg) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) process.exitCode = 1; }

const svc = createClient(SB_URL, SVC, { auth: { persistSession: false } });

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
  return { status: res.status, body: j };
}

(async () => {
  // Find emp2 employee row
  const { data: emp2 } = await svc.from('employees').select('id, name, tracks_attendance').eq('email', 'emp2@demandnexus.io').single();
  if (!emp2) throw new Error('emp2 not found');
  const originalTracks = emp2.tracks_attendance;

  // --- Make emp2 an observer ---
  await svc.from('employees').update({ tracks_attendance: false }).eq('id', emp2.id);
  // Clean any attendance row for today so punch_in path is reached
  const today = new Date().toISOString().split('T')[0];
  await svc.from('attendance').delete().eq('employee_id', emp2.id).eq('date', today);

  const emp2Session = await sessionFor('emp2@demandnexus.io');
  const emp2Cookie = buildCookie(emp2Session);

  // 1) Observer punch_in must be rejected with 403
  const punch = await api('POST', '/api/attendance', emp2Cookie, { action: 'punch_in' });
  log(punch.status === 403, `observer punch_in -> ${punch.status} (expect 403): ${punch.body?.error ?? ''}`);
  // Ensure no attendance row got created
  const { data: rowsAfter } = await svc.from('attendance').select('id').eq('employee_id', emp2.id).eq('date', today);
  log((rowsAfter?.length ?? 0) === 0, `no attendance row created for observer (rows=${rowsAfter?.length ?? 0})`);

  // 2) Observer excluded from absentees report (admin)
  const adminSession = await sessionFor('admin@demandnexus.io');
  const adminCookie = buildCookie(adminSession);
  const abs = await api('GET', `/api/attendance/absentees?date=${today}`, adminCookie);
  const absList = JSON.stringify(abs.body);
  log(abs.status === 200 && !absList.includes(emp2.id), `observer excluded from absentees -> ${abs.status} (present=${absList.includes(emp2.id)})`);

  // 3) Observer excluded from team-insights active denominator
  const ti = await api('GET', '/api/team-insights', adminCookie);
  const tiStr = JSON.stringify(ti.body);
  log(ti.status === 200 && !tiStr.includes(emp2.id), `team-insights does not reference observer id -> ${ti.status}`);

  // --- Restore: make emp2 track attendance again, verify punch works ---
  await svc.from('employees').update({ tracks_attendance: originalTracks ?? true }).eq('id', emp2.id);
  await svc.from('attendance').delete().eq('employee_id', emp2.id).eq('date', today);
  const punch2 = await api('POST', '/api/attendance', emp2Cookie, { action: 'punch_in' });
  log(punch2.status === 200 || punch2.status === 201, `non-observer punch_in works after restore -> ${punch2.status}`);
  // cleanup the punch we just made
  await svc.from('attendance').delete().eq('employee_id', emp2.id).eq('date', today);

  console.log('\nDone.');
})().catch((e) => { console.error('FAIL  unexpected:', e.message); process.exit(1); });
