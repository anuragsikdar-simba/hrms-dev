/**
 * Server-side geofencing for attendance punches.
 *
 * Admins define circular zones (lat/lng + radius). When geofencing is enabled,
 * punch-in coordinates are checked against the zones server-side. Punches from
 * outside every zone (or with no coordinates) are ALLOWED but FLAGGED for
 * admin review - mirroring the IP allowlist's allow-and-flag philosophy, since
 * browser GPS can be inaccurate indoors and a hard block would strand
 * legitimate employees.
 *
 * IMPORTANT TRUST NOTE: unlike the request IP, coordinates are client-reported
 * (browser geolocation) and therefore spoofable by a determined user. This is
 * a deterrent + audit trail, not cryptographic proof of presence. It layers
 * with the IP allowlist for defense in depth.
 *
 * Storage: zones + toggle live in the existing `email_config` kv table
 * (project rule: no schema changes). Key: 'geo_zones' ->
 * JSON { enabled: boolean, zones: [{ id, label, lat, lng, radiusM }] }.
 *
 * Pure math/validation lives in src/lib/geo.ts (unit-tested offline).
 */
import { supabaseAdmin } from '@/lib/supabase-server';
import { parseGeoConfig, evaluateGeoWithConfig, type GeoConfig, type GeoDecision } from '@/lib/geo';

export { parseGeoConfig, evaluateGeoWithConfig } from '@/lib/geo';
export type { GeoConfig, GeoZone, GeoDecision } from '@/lib/geo';

export const GEO_ZONES_KEY = 'geo_zones';

/** Load the stored geofencing config (service-role; kv is admin-only under RLS). */
export async function loadGeoConfig(): Promise<GeoConfig> {
  const { data } = await supabaseAdmin
    .from('email_config')
    .select('value')
    .eq('key', GEO_ZONES_KEY)
    .maybeSingle();
  if (!data?.value) return { enabled: false, zones: [] };
  try {
    return parseGeoConfig(JSON.parse(data.value));
  } catch {
    return { enabled: false, zones: [] };
  }
}

/** Load config and evaluate in one step (the API entry point). */
export async function evaluateGeo(
  lat: number | null,
  lng: number | null,
  accuracyM: number | null = null,
): Promise<GeoDecision> {
  const config = await loadGeoConfig();
  return evaluateGeoWithConfig(config, lat, lng, accuracyM);
}
