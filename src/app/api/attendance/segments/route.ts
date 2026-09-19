import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-helpers';
import { logAudit, getClientIp } from '@/lib/audit';
import { rateLimiters } from '@/lib/rate-limit';
import { errorResponse } from '@/lib/api-errors';

/* ------------------------------------------------------------------ */
/*  POST /api/attendance/segments                                      */
/*  Body: { attendance_id }  — start a break                           */
/* ------------------------------------------------------------------ */

export async function POST(request: NextRequest) {
  try {
    const user = await verifyAuth();
    const db = user.supabase;
    if (!rateLimiters.mutation(user.uid).allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Try again shortly.' },
        { status: 429 },
      );
    }

    const { attendance_id } = (await request.json()) as { attendance_id: string };

    if (!attendance_id) {
      return NextResponse.json({ success: false, error: 'Missing attendance_id' }, { status: 400 });
    }

    const now = new Date().toISOString();
    const { data, error } = await db
      .from('attendance_segments')
      .insert({ attendance_id, segment_start: now })
      .select()
      .single();

    if (error) throw error;

    logAudit({
      performed_by: user.uid,
      action: 'update',
      target_employee: user.uid,
      details: `Started break (segment ${data.id})`,
      ip_address: getClientIp(request),
    });

    return NextResponse.json({ success: true, data: { segment: data } }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'Failed to start break. Please try again.');
  }
}

/* ------------------------------------------------------------------ */
/*  PATCH /api/attendance/segments                                     */
/*  Body: { segment_id }  — end a break                                */
/* ------------------------------------------------------------------ */

export async function PATCH(request: NextRequest) {
  try {
    const user = await verifyAuth();
    const db = user.supabase;
    if (!rateLimiters.mutation(user.uid).allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Try again shortly.' },
        { status: 429 },
      );
    }

    const { segment_id } = (await request.json()) as { segment_id: string };

    if (!segment_id) {
      return NextResponse.json({ success: false, error: 'Missing segment_id' }, { status: 400 });
    }

    const now = new Date().toISOString();
    const { data, error } = await db
      .from('attendance_segments')
      .update({ segment_end: now })
      .eq('id', segment_id)
      .select()
      .single();

    if (error) throw error;

    logAudit({
      performed_by: user.uid,
      action: 'update',
      target_employee: user.uid,
      details: `Ended break (segment ${segment_id})`,
      ip_address: getClientIp(request),
    });

    return NextResponse.json({ success: true, data: { segment: data } });
  } catch (error) {
    return errorResponse(error, 'Failed to end break. Please try again.');
  }
}
