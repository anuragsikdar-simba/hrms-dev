#!/usr/bin/env node
/**
 * Configure the office geofence (and optionally retire the IP allowlist).
 *
 *   node scripts/set-office-geofence.mjs --lat 21.238xxx --lng 81.650xxx
 *   node scripts/set-office-geofence.mjs --lat .. --lng .. --radius 50 --label "Simba House"
 *   node scripts/set-office-geofence.mjs --show
 *   node scripts/set-office-geofence.mjs --disable-ip      # bypass the IP allowlist
 *   node scripts/set-office-geofence.mjs --enable-ip       # re-enforce it
 *
 * Zones live in the `email_config` kv table under the key `geo_zones`, exactly
 * where Settings -> Punch Locations reads and writes them, so anything set here
 * shows up in the admin UI (and vice versa).
 *
 * Enforcement stays ALLOW-AND-FLAG per BUSINESS_RULES §4b: an out-of-zone punch
 * is recorded and raised as a `location_violation` approval, never refused.
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
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const GEO_ZONES_KEY = 'geo_zones';
const IP_BYPASS_KEY = 'ip_restriction_bypass';

/** Read a flag/option out of argv. */
function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const has = (name) => process.argv.includes(`--${name}`);

async function readKv(key) {
  const { data } = await db.from('email_config').select('value').eq('key', key).maybeSingle();
  return data?.value ?? null;
}

async function writeKv(key, value) {
  const { error } = await db
    .from('email_config')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
}

async function show() {
  const raw = await readKv(GEO_ZONES_KEY);
  const bypass = await readKv(IP_BYPASS_KEY);
  console.log('\nGeofencing');
  if (!raw) {
    console.log('  not configured');
  } else {
    const cfg = JSON.parse(raw);
    console.log(`  enabled: ${cfg.enabled}`);
    for (const z of cfg.zones ?? []) {
      console.log(`  - ${z.label}: ${z.lat}, ${z.lng}  r=${z.radiusM}m`);
      console.log(`    map: https://www.google.com/maps?q=${z.lat},${z.lng}`);
    }
  }
  console.log(`\nIP allowlist`);
  console.log(`  bypass: ${bypass === 'true' ? 'ON  (IP checks disabled)' : 'off (IP checks enforced)'}\n`);
}

async function main() {
  if (has('disable-ip') || has('enable-ip')) {
    const off = has('disable-ip');
    await writeKv(IP_BYPASS_KEY, off ? 'true' : 'false');
    console.log(off
      ? 'IP allowlist bypassed — punches are no longer flagged on IP.'
      : 'IP allowlist re-enforced.');
    if (!arg('lat')) { await show(); return; }
  }

  if (has('show') || (!arg('lat') && !has('disable-ip') && !has('enable-ip'))) {
    await show();
    if (!arg('lat')) return;
  }

  const lat = Number(arg('lat'));
  const lng = Number(arg('lng'));
  const radiusM = Number(arg('radius') ?? 50);
  const label = arg('label') ?? 'Simba House (Head Office)';

  // Validation mirrors parseGeoConfig in src/lib/geo.ts — a zone this file
  // writes must be one that the app will actually accept.
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    console.error('--lat must be a number between -90 and 90'); process.exit(1);
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    console.error('--lng must be a number between -180 and 180'); process.exit(1);
  }
  if (!Number.isFinite(radiusM) || radiusM < 20 || radiusM > 50_000) {
    console.error('--radius must be between 20 and 50000 metres'); process.exit(1);
  }
  // Sanity-check the pin is actually in/near Chhattisgarh, so a transposed or
  // truncated coordinate does not silently fence a field in another state.
  if (lat < 17 || lat > 25 || lng < 78 || lng > 85) {
    console.error(`\nRefusing: ${lat}, ${lng} is nowhere near Raipur (expected ~21.2, ~81.6).`);
    console.error('Check you did not swap latitude and longitude.\n');
    process.exit(1);
  }

  const config = {
    enabled: true,
    zones: [{ id: 'office_simba_house', label, lat, lng, radiusM: Math.round(radiusM) }],
  };
  await writeKv(GEO_ZONES_KEY, JSON.stringify(config));

  console.log(`\nGeofence set: ${label}`);
  console.log(`  centre : ${lat}, ${lng}`);
  console.log(`  radius : ${Math.round(radiusM)} m`);
  console.log(`  verify : https://www.google.com/maps?q=${lat},${lng}`);
  console.log(`
  NOTE: src/lib/geo.ts grants up to 200 m of GPS-accuracy tolerance, so the
  effective fence is about ${Math.round(radiusM) + 200} m. Open the map link and confirm the pin
  is on your building before relying on the flags.
`);
  await show();
}

main().catch((e) => { console.error('\nFailed:', e.message || e); process.exit(1); });
