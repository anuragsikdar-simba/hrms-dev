import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, requireAdmin } from '@/lib/auth-helpers';
import { logAudit, getClientIp } from '@/lib/audit';
import { rateLimiters } from '@/lib/rate-limit';
import { errorResponse } from '@/lib/api-errors';

/* ------------------------------------------------------------------ */
/*  GET /api/onboarding/config                                         */
/*  ?version=N for specific version, otherwise latest published        */
/* ------------------------------------------------------------------ */

export async function GET(request: NextRequest) {
  try {
    const authUser = await verifyAuth();
    const db = authUser.supabase;
    const url = new URL(request.url);
    const version = url.searchParams.get('version');

    let query = db.from('onboarding_config').select('*');

    if (version) {
      query = query.eq('version', parseInt(version, 10));
    } else {
      query = query.eq('is_active', true).order('version', { ascending: false }).limit(1);
    }

    const { data, error } = await query;
    if (error) throw error;

    const config = data?.[0] ?? null;
    return NextResponse.json({ success: true, data: { config } });
  } catch (error) {
    return errorResponse(error, 'Failed to fetch config. Please try again.');
  }
}

/* ------------------------------------------------------------------ */
/*  POST /api/onboarding/config  -- save new version (admin)           */
/* ------------------------------------------------------------------ */

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

    if (!body.sections || !Array.isArray(body.sections)) {
      return NextResponse.json({ success: false, error: 'sections (array) is required' }, { status: 400 });
    }
    if (body.version != null && typeof body.version !== 'number') {
      return NextResponse.json({ success: false, error: 'version must be a number' }, { status: 400 });
    }

    // "Save Configuration" in the form builder is meant to take effect
    // immediately, so a save publishes by default. (Pass published:false
    // explicitly to store a draft.) The GET endpoint only ever returns the
    // single active config, so the new version must be activated AND every
    // older version deactivated, otherwise the builder would reload a stale
    // active config after refresh and the just-saved fields would "disappear".
    const publish = body.published ?? true;

    // Determine the version server-side from the current max so concurrent or
    // stale-client saves never collide / regress (the client's optimistic
    // version is only a hint). This keeps "latest version" monotonic.
    const { data: latest } = await db
      .from('onboarding_config')
      .select('version')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = Math.max(
      (latest?.version ?? 0) + 1,
      typeof body.version === 'number' ? body.version : 0,
    );

    if (publish) {
      const { error: deactivateError } = await db
        .from('onboarding_config')
        .update({ is_active: false })
        .eq('is_active', true);
      if (deactivateError) throw deactivateError;
    }

    const { data, error } = await db
      .from('onboarding_config')
      .insert({
        version: nextVersion,
        sections: body.sections,
        is_active: publish,
      })
      .select()
      .single();

    if (error) throw error;

    logAudit({
      performed_by: admin.uid,
      action: 'create',
      details: `Saved onboarding config v${data.version}${data.is_active ? ' (published)' : ' (draft)'}`,
      ip_address: getClientIp(request),
      after_data: { version: data.version, published: data.is_active, sectionCount: data.sections?.length },
    });

    return NextResponse.json({ success: true, data: { config: data } }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'Failed to save config. Please try again.');
  }
}

/* ------------------------------------------------------------------ */
/*  PATCH /api/onboarding/config  -- publish a version (admin)         */
/* ------------------------------------------------------------------ */

export async function PATCH(request: NextRequest) {
  try {
    const admin = await requireAdmin();
    const db = admin.supabase;
    if (!rateLimiters.mutation(admin.uid).allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Try again shortly.' },
        { status: 429 },
      );
    }

    const { version } = await request.json();

    if (!version) {
      return NextResponse.json({ success: false, error: 'Missing version' }, { status: 400 });
    }

    const { data, error } = await db
      .from('onboarding_config')
      .update({ is_active: true })
      .eq('version', version)
      .select()
      .single();

    if (error) throw error;

    logAudit({
      performed_by: admin.uid,
      action: 'update',
      details: `Published onboarding config v${version}`,
      ip_address: getClientIp(request),
      after_data: data,
    });

    return NextResponse.json({ success: true, data: { config: data } });
  } catch (error) {
    return errorResponse(error, 'Failed to publish config. Please try again.');
  }
}
