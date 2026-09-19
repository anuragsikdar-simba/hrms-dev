import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-helpers';
import { logAudit, getClientIp } from '@/lib/audit';
import { rateLimiters } from '@/lib/rate-limit';
import { errorResponse } from '@/lib/api-errors';
import { GEO_ZONES_KEY, parseGeoConfig, type GeoConfig } from '@/lib/geo-check-server';

/* ------------------------------------------------------------------ */
/*  GET /api/geo-zones      -- read zones + enabled flag (admin)       */
/*  POST /api/geo-zones     -- replace config { enabled, zones } (admin)*/
/*                                                                     */
/*  Zones are stored as JSON in the email_config kv table (no schema   */
/*  changes). The punch API evaluates them server-side via evaluateGeo.*/
/* ------------------------------------------------------------------ */

export async function GET() {
  try {
    const admin = await requireAdmin();
    const db = admin.supabase;

    const { data } = await db
      .from('email_config')
      .select('value')
      .eq('key', GEO_ZONES_KEY)
      .maybeSingle();

    let config: GeoConfig = { enabled: false, zones: [] };
    if (data?.value) {
      try { config = parseGeoConfig(JSON.parse(data.value)); } catch { /* corrupt -> defaults */ }
    }
    return NextResponse.json({ success: true, data: { config } });
  } catch (error) {
    return errorResponse(error, 'Failed to load punch locations.');
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin();
    const db = admin.supabase;
    if (!rateLimiters.mutation(admin.uid).allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Try again shortly.' },
        { status: 429 },
      );
    }

    const body = await request.json();
    // parseGeoConfig validates every zone (lat/lng ranges, radius 20m-50km,
    // label required) and drops anything malformed. `enabled` only sticks
    // when at least one valid zone exists.
    const config = parseGeoConfig(body);

    if (body?.enabled === true && config.zones.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Add at least one valid location before enabling geofencing.' },
        { status: 400 },
      );
    }

    const { error } = await db
      .from('email_config')
      .upsert(
        { key: GEO_ZONES_KEY, value: JSON.stringify(config), updated_at: new Date().toISOString() },
        { onConflict: 'key' },
      );
    if (error) throw error;

    logAudit({
      performed_by: admin.uid,
      action: 'update',
      details: `Updated punch locations: ${config.zones.length} zone(s), geofencing ${config.enabled ? 'ENABLED' : 'disabled'}`,
      ip_address: getClientIp(request),
      after_data: config,
    });

    return NextResponse.json({ success: true, data: { config } });
  } catch (error) {
    return errorResponse(error, 'Failed to save punch locations.');
  }
}
