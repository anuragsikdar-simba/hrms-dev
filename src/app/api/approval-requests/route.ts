import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, requireAdmin } from '@/lib/auth-helpers';
import { logAudit, getClientIp } from '@/lib/audit';
import { rateLimiters } from '@/lib/rate-limit';
import { errorResponse } from '@/lib/api-errors';

/* ------------------------------------------------------------------ */
/*  GET /api/approval-requests                                         */
/* ------------------------------------------------------------------ */

export async function GET(request: NextRequest) {
  try {
    const user = await verifyAuth();
    const db = user.supabase;
    const url = new URL(request.url);
    const type = url.searchParams.get('type');
    const status = url.searchParams.get('status');

    let query = db.from('approval_requests').select('*, employees!approval_requests_employee_id_fkey(name, employee_id, department_id, department:departments!employees_department_id_fkey(id, name))');

    if (user.role !== 'admin') {
      query = query.eq('employee_id', user.uid);
    }
    if (type) query = query.eq('type', type);
    if (status) query = query.eq('status', status);
    query = query.order('created_at', { ascending: false });

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ success: true, data: { requests: data ?? [] } });
  } catch (error) {
    return errorResponse(error, 'Failed to fetch requests. Please try again.');
  }
}

/* ------------------------------------------------------------------ */
/*  POST /api/approval-requests                                        */
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

    const body = await request.json();

    const validTypes = ['regularisation', 'wfh', 'ip_violation', 'profile_change', 'shift_change', 'location_violation'];
    if (!body.type || !validTypes.includes(body.type)) {
      return NextResponse.json({ success: false, error: `type must be one of: ${validTypes.join(', ')}` }, { status: 400 });
    }

    // For profile_change requests, encode field_name + new_value into requested_change.
    // For shift_change requests, encode the current and requested shift times so the
    // approver sees exactly what will change and approval can apply it verbatim.
    let requestedChange: string | null = body.requested_change ?? null;
    if (body.type === 'profile_change') {
      requestedChange = JSON.stringify({ field_name: body.field_name, new_value: body.new_value });
    } else if (body.type === 'shift_change') {
      const { current_shift_start, current_shift_end, new_shift_start, new_shift_end } = body as {
        current_shift_start?: string; current_shift_end?: string;
        new_shift_start?: string; new_shift_end?: string;
      };
      const isTime = (v: unknown): v is string => typeof v === 'string' && /^\d{2}:\d{2}$/.test(v);
      if (!isTime(new_shift_start) || !isTime(new_shift_end)) {
        return NextResponse.json(
          { success: false, error: 'new_shift_start and new_shift_end must be HH:MM times.' },
          { status: 400 },
        );
      }
      if (new_shift_start === new_shift_end) {
        return NextResponse.json(
          { success: false, error: 'Shift start and end cannot be the same time.' },
          { status: 400 },
        );
      }
      requestedChange = JSON.stringify({
        current_shift_start: isTime(current_shift_start) ? current_shift_start : null,
        current_shift_end: isTime(current_shift_end) ? current_shift_end : null,
        new_shift_start,
        new_shift_end,
      });
    }

    const { data, error } = await db
      .from('approval_requests')
      .insert({
        employee_id: user.uid,
        type: body.type,
        detected_ip: body.detected_ip ?? null,
        action_type: body.action_type ?? null,
        reason: body.reason ?? null,
        reg_date: body.reg_date ?? null,
        original_punch: body.original_punch ?? null,
        requested_change: requestedChange,
        status: 'pending',
      })
      .select()
      .single();

    if (error) throw error;

    logAudit({
      performed_by: user.uid,
      action: 'create',
      target_employee: user.uid,
      details: `Created approval request (${body.type})`,
      ip_address: getClientIp(request),
      after_data: data,
    });

    return NextResponse.json({ success: true, data: { request: data } }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'Failed to create request. Please try again.');
  }
}

/* ------------------------------------------------------------------ */
/*  PATCH /api/approval-requests                                       */
/*  Body: { id, status, rejection_reason? }  — admin only              */
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

    const { id, status, rejection_reason } = await request.json();

    if (!id || !status) {
      return NextResponse.json({ success: false, error: 'Missing id or status' }, { status: 400 });
    }

    const updateData: Record<string, unknown> = {
      status,
      resolved_by: admin.uid,
      resolved_at: new Date().toISOString(),
    };
    if (rejection_reason) updateData.rejection_reason = rejection_reason;

    const { data, error } = await db
      .from('approval_requests')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Approving a shift_change actually applies the new shift to the employee
    // record - otherwise the approval would be a no-op and the shift would
    // stay frozen forever (the original complaint). Admin RLS permits this.
    if (status === 'approved' && data.type === 'shift_change' && data.requested_change) {
      try {
        const change = JSON.parse(data.requested_change) as {
          new_shift_start?: string;
          new_shift_end?: string;
        };
        if (change.new_shift_start && change.new_shift_end) {
          const { error: shiftErr } = await db
            .from('employees')
            .update({
              shift_start: change.new_shift_start,
              shift_end: change.new_shift_end,
              updated_at: new Date().toISOString(),
            })
            .eq('id', data.employee_id);
          if (shiftErr) throw shiftErr;
        }
      } catch (applyErr) {
        // Roll the request back to pending so an approval never reads
        // "approved" while the shift was not actually changed.
        await db
          .from('approval_requests')
          .update({ status: 'pending', resolved_by: null, resolved_at: null })
          .eq('id', id);
        throw applyErr;
      }
    }

    logAudit({
      performed_by: admin.uid,
      action: status === 'approved' ? 'approve' : 'reject',
      target_employee: data.employee_id,
      details: `${status === 'approved' ? 'Approved' : 'Rejected'} approval request ${id}`,
      ip_address: getClientIp(request),
      after_data: data,
    });

    return NextResponse.json({ success: true, data: { request: data } });
  } catch (error) {
    return errorResponse(error, 'Failed to update request. Please try again.');
  }
}
