/**
 * Browser E2E: punch-card state survives logout + re-login.
 *
 * Reproduces the reported bug where, after punching in & out, logging out and
 * back in showed "Punch In" again (so the user could re-punch / got a 409
 * "already completed your shift"). Verifies the card restores to the
 * "Punched out for today" done-state on a fresh login.
 *
 * Requires the dev server on :3000 and Playwright chromium installed.
 */
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const SB_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SVC = env.SUPABASE_SERVICE_ROLE_KEY;
const BASE = 'http://localhost:3000';
const PW = 'TestPass!23456';
const EMAIL = 'emp1@demandnexus.io';

const svc = createClient(SB_URL, SVC, { auth: { persistSession: false } });
function log(ok, m) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${m}`);
  if (!ok) process.exitCode = 1;
}

const { data: e1 } = await svc.from('employees').select('id').eq('email', EMAIL).single();
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
await svc.from('attendance').delete().eq('employee_id', e1.id).eq('date', today);
await svc.from('employees').update({ must_reset_password: false }).eq('id', e1.id);

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();

async function fillLogin() {
  await page.waitForSelector('input[type="email"]', { timeout: 10000 });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PW);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3000);
}
async function cardState() {
  for (const s of ['Punched out for today', 'Currently punched in', 'On a break', 'Not punched in']) {
    if (await page.getByText(s, { exact: true }).count()) return s;
  }
  return '(none)';
}

try {
  // Hard load + login, then punch in and out (with the Yes confirmation).
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await fillLogin();
  await page.getByRole('button', { name: /^punch in$/i }).first().click({ timeout: 8000 });
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /^punch out$/i }).first().click({ timeout: 8000 });
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: /^yes$/i }).first().click({ timeout: 5000 });
  await page.waitForTimeout(2500);

  const { data: row } = await svc
    .from('attendance')
    .select('punch_in, punch_out')
    .eq('employee_id', e1.id)
    .eq('date', today)
    .maybeSingle();
  log(!!row?.punch_in && !!row?.punch_out, `punch in + out persisted (in=${!!row?.punch_in}, out=${!!row?.punch_out})`);

  // Soft logout via in-app button (no page reload), then log in again.
  await page
    .getByRole('button', { name: /sign out/i })
    .first()
    .click({ timeout: 5000 })
    .catch(async () => {
      await page.locator('header button').last().click().catch(() => {});
      await page.getByText(/log ?out|sign ?out/i).first().click().catch(() => {});
    });
  await page.waitForURL(/login/, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await fillLogin();

  const finalState = await cardState();
  log(finalState === 'Punched out for today', `punch card restores DONE after re-login (got "${finalState}")`);
} finally {
  await browser.close();
  await svc.from('attendance').delete().eq('employee_id', e1.id).eq('date', today);
}

console.log('\nDone.');
