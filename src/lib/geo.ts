/**
 * Pure geofencing math + config validation (no DB/env deps, unit-testable).
 * Server integration lives in geo-check-server.ts.
 */

export interface GeoZone {
  id: string;
  label: string;
  lat: number;
  lng: number;
  /** Radius in meters. */
  radiusM: number;
}

export interface GeoConfig {
  enabled: boolean;
  zones: GeoZone[];
}

export interface GeoDecision {
  /** Whether geofencing was enforced for this punch. */
  enforced: boolean;
  /** Whether the punch should be flagged for admin review. */
  flagged: boolean;
  /** Matched zone label when inside a zone. */
  matchedZone: string | null;
  /** Distance to the nearest zone edge in meters (when outside, for context). */
  nearestDistanceM: number | null;
  /** Why the decision came out as it did (for the flag reason / audit). */
  detail: string;
}

/** Haversine distance in meters between two WGS84 coordinates. */
export function distanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6_371_000; // Earth mean radius, meters
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Validate + normalize a raw zones payload (admin input or stored JSON). */
export function parseGeoConfig(raw: unknown): GeoConfig {
  const fallback: GeoConfig = { enabled: false, zones: [] };
  if (!raw || typeof raw !== 'object') return fallback;
  const obj = raw as { enabled?: unknown; zones?: unknown };
  const zones: GeoZone[] = [];
  if (Array.isArray(obj.zones)) {
    for (const z of obj.zones.slice(0, 50)) {
      if (!z || typeof z !== 'object') continue;
      const { id, label, lat, lng, radiusM } = z as Record<string, unknown>;
      if (
        typeof label === 'string' && label.trim() &&
        typeof lat === 'number' && lat >= -90 && lat <= 90 &&
        typeof lng === 'number' && lng >= -180 && lng <= 180 &&
        typeof radiusM === 'number' && radiusM >= 20 && radiusM <= 50_000
      ) {
        zones.push({
          id: typeof id === 'string' && id ? id : `zone_${zones.length}`,
          label: label.trim().slice(0, 80),
          lat,
          lng,
          radiusM: Math.round(radiusM),
        });
      }
    }
  }
  return { enabled: obj.enabled === true && zones.length > 0, zones };
}

/**
 * Decide whether a punch at (lat, lng) should be flagged.
 * Pure function over a config - unit-testable without a DB.
 */
export function evaluateGeoWithConfig(
  config: GeoConfig,
  lat: number | null,
  lng: number | null,
  accuracyM: number | null = null,
): GeoDecision {
  if (!config.enabled || config.zones.length === 0) {
    return { enforced: false, flagged: false, matchedZone: null, nearestDistanceM: null, detail: 'geofencing disabled' };
  }
  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) {
    // No coordinates (permission denied / unsupported device). Allow but flag
    // so the admin can follow up - blocking would strand employees with a
    // broken GPS or strict browser settings.
    return {
      enforced: true,
      flagged: true,
      matchedZone: null,
      nearestDistanceM: null,
      detail: 'location unavailable or permission denied',
    };
  }

  let nearest = Infinity;
  for (const z of config.zones) {
    const d = distanceMeters(lat, lng, z.lat, z.lng);
    // GPS accuracy tolerance: if the reported accuracy circle overlaps the
    // zone, give the benefit of the doubt (capped so a 5km "accuracy" cannot
    // whitelist the whole city).
    const tolerance = Math.min(Math.max(accuracyM ?? 0, 0), 200);
    if (d <= z.radiusM + tolerance) {
      return { enforced: true, flagged: false, matchedZone: z.label, nearestDistanceM: 0, detail: `inside ${z.label}` };
    }
    nearest = Math.min(nearest, d - z.radiusM);
  }

  const nearestM = Math.round(nearest);
  return {
    enforced: true,
    flagged: true,
    matchedZone: null,
    nearestDistanceM: nearestM,
    detail: `outside all approved locations (${nearestM >= 1000 ? `${(nearestM / 1000).toFixed(1)}km` : `${nearestM}m`} from nearest)`,
  };
}
