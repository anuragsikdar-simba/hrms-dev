import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, requireAdmin } from '@/lib/auth-helpers';
import { logAudit, getClientIp } from '@/lib/audit';
import { rateLimiters } from '@/lib/rate-limit';
import { errorResponse } from '@/lib/api-errors';

/* ------------------------------------------------------------------ */
/*  GET /api/holidays                                                  */
/* ------------------------------------------------------------------ */

export async function GET(request: NextRequest) {
  try {
    const authUser = await verifyAuth();
    const db = authUser.supabase;
    const url = new URL(request.url);
    const fy = url.searchParams.get('financial_year');

    let query = db.from('holidays').select('*');
    if (fy) query = query.eq('financial_year', fy);
    query = query.order('date', { ascending: true });

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ success: true, data: { holidays: data ?? [] } });
  } catch (error) {
    return errorResponse(error, 'Failed to fetch holidays. Please try again.');
  }
}

/* ------------------------------------------------------------------ */
/*  POST /api/holidays  -- admin only                                  */
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

    if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
      return NextResponse.json({ success: false, error: 'name is required' }, { status: 400 });
    }
    if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      return NextResponse.json({ success: false, error: 'date is required (YYYY-MM-DD)' }, { status: 400 });
    }
    if (!body.financial_year || typeof body.financial_year !== 'string') {
      return NextResponse.json({ success: false, error: 'financial_year is required' }, { status: 400 });
    }
    if (body.type && !['mandatory', 'optional'].includes(body.type)) {
      return NextResponse.json({ success: false, error: 'type must be mandatory or optional' }, { status: 400 });
    }

    const { data, error } = await db
      .from('holidays')
      .insert({
        name: body.name,
        date: body.date,
        type: body.type ?? 'mandatory',
        financial_year: body.financial_year,
      })
      .select()
      .single();

    if (error) throw error;

    logAudit({
      performed_by: admin.uid,
      action: 'create',
      details: `Created holiday "${data.name}" on ${data.date}`,
      ip_address: getClientIp(request),
      after_data: data,
    });

    return NextResponse.json({ success: true, data: { holiday: data } }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'Failed to create holiday. Please try again.');
  }
}

/* ------------------------------------------------------------------ */
/*  PATCH /api/holidays  -- admin only                                 */
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

    const { id, ...fields } = await request.json();

    if (!id) {
      return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 });
    }

    const { data: before } = await db.from('holidays').select('*').eq('id', id).single();

    const { data, error } = await db
      .from('holidays')
      .update(fields)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    logAudit({
      performed_by: admin.uid,
      action: 'update',
      details: `Updated holiday "${data.name}"`,
      ip_address: getClientIp(request),
      before_data: before,
      after_data: data,
    });

    return NextResponse.json({ success: true, data: { holiday: data } });
  } catch (error) {
    return errorResponse(error, 'Failed to update holiday. Please try again.');
  }
}

/* ------------------------------------------------------------------ */
/*  DELETE /api/holidays  -- admin only                                */
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

    const { id } = await request.json();

    if (!id) {
      return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 });
    }

    const { data: before } = await db.from('holidays').select('*').eq('id', id).single();

    const { error } = await db.from('holidays').delete().eq('id', id);
    if (error) throw error;

    logAudit({
      performed_by: admin.uid,
      action: 'delete',
      details: `Deleted holiday "${before?.name}" on ${before?.date}`,
      ip_address: getClientIp(request),
      before_data: before,
    });

    return NextResponse.json({ success: true, data: { deleted: id } });
  } catch (error) {
    return errorResponse(error, 'Failed to delete holiday. Please try again.');
  }
}
