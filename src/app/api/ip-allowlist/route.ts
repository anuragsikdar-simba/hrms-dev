import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, requireAdmin } from '@/lib/auth-helpers';
import { logAudit, getClientIp } from '@/lib/audit';
import { rateLimiters } from '@/lib/rate-limit';
import { errorResponse } from '@/lib/api-errors';
import { IP_BYPASS_KEY } from '@/lib/ip-check-server';

/* ------------------------------------------------------------------ */
/*  GET /api/ip-allowlist                                              */
/* ------------------------------------------------------------------ */

export async function GET(request: NextRequest) {
  try {
    const authUser = await verifyAuth();
    const db = authUser.supabase;

    const [allowlist, blocklist, bypass] = await Promise.all([
      db.from('ip_allowlist').select('id, ip, label, added_by, created_at, added_by_employee:employees!ip_allowlist_added_by_fkey(name)').order('created_at', { ascending: false }),
      db.from('ip_blocklist').select('id, ip, reason, created_at').order('created_at', { ascending: false }),
      db.from('email_config').select('value').eq('key', IP_BYPASS_KEY).maybeSingle(),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        allowlist: allowlist.data ?? [],
        blocklist: blocklist.data ?? [],
        bypassed: bypass.data?.value === 'true',
      },
    });
  } catch (error) {
    return errorResponse(error, 'Failed to fetch IP lists. Please try again.');
  }
}

/* ------------------------------------------------------------------ */
/*  PATCH /api/ip-allowlist  -- toggle the IP-restriction bypass        */
/*  Body: { bypass: boolean }  (admin only)                            */
/*                                                                     */
/*  SECURITY: the bypass is a server-stored, admin-only flag. It is no */
/*  longer a browser-local localStorage value that any user could set. */
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

    const { bypass } = (await request.json()) as { bypass?: boolean };
    if (typeof bypass !== 'boolean') {
      return NextResponse.json({ success: false, error: 'bypass must be a boolean' }, { status: 400 });
    }

    const { error } = await db
      .from('email_config')
      .upsert({ key: IP_BYPASS_KEY, value: String(bypass), updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw error;

    logAudit({
      performed_by: admin.uid,
      action: 'update',
      details: `IP restriction bypass ${bypass ? 'ENABLED' : 'disabled'}`,
      ip_address: getClientIp(request),
    });

    return NextResponse.json({ success: true, data: { bypassed: bypass } });
  } catch (error) {
    return errorResponse(error, 'Failed to update bypass setting. Please try again.');
  }
}

/* ------------------------------------------------------------------ */
/*  POST /api/ip-allowlist  -- add to allowlist (admin only)           */
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

    const { ip, label } = await request.json();

    if (!ip || !label) {
      return NextResponse.json({ success: false, error: 'Missing ip or label' }, { status: 400 });
    }
    // Basic IP/CIDR format validation
    const ipPattern = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
    if (!ipPattern.test(ip)) {
      return NextResponse.json({ success: false, error: 'Invalid IP address format' }, { status: 400 });
    }

    const { data, error } = await db
      .from('ip_allowlist')
      .insert({ ip, label, added_by: admin.uid })
      .select()
      .single();

    if (error) throw error;

    logAudit({
      performed_by: admin.uid,
      action: 'create',
      details: `Added IP ${ip} (${label}) to allowlist`,
      ip_address: getClientIp(request),
      after_data: data,
    });

    return NextResponse.json({ success: true, data: { entry: data } }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'Failed to add IP. Please try again.');
  }
}

/* ------------------------------------------------------------------ */
/*  DELETE /api/ip-allowlist  -- block or unblock (admin only)          */
/*  Body: { id, action: 'block' | 'unblock', ip?, reason?, label? }    */
/* ------------------------------------------------------------------ */

export async function DELETE(request: NextRequest) {
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
    const { id, action, ip, reason, label } = body as {
      id: string;
      action: 'block' | 'unblock' | 'remove';
      ip?: string;
      reason?: string;
      label?: string;
    };

    if (!id || !action) {
      return NextResponse.json({ success: false, error: 'Missing id or action' }, { status: 400 });
    }

    if (action === 'remove') {
      // Simply remove from allowlist without adding to blocklist
      await db.from('ip_allowlist').delete().eq('id', id);
    } else if (action === 'block') {
      // Move from allowlist to blocklist
      await db.from('ip_allowlist').delete().eq('id', id);
      if (ip) {
        await db.from('ip_blocklist').insert({ ip, reason: reason ?? 'Blocked by admin' });
      }
    } else {
      // unblock: Move from blocklist to allowlist
      await db.from('ip_blocklist').delete().eq('id', id);
      if (ip && label) {
        await db.from('ip_allowlist').insert({ ip, label });
      }
    }

    logAudit({
      performed_by: admin.uid,
      action: action === 'block' ? 'delete' : 'create',
      details: `IP ${ip} ${action}ed${reason ? `: ${reason}` : ''}`,
      ip_address: getClientIp(request),
    });

    return NextResponse.json({ success: true, data: { message: `IP ${action}ed` } });
  } catch (error) {
    return errorResponse(error, 'Failed to update IP. Please try again.');
  }
}
