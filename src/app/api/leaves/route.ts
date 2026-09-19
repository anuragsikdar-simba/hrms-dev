import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-helpers';
import { logAudit, getClientIp } from '@/lib/audit';
import { rateLimiters } from '@/lib/rate-limit';
import { errorResponse } from '@/lib/api-errors';

/* ------------------------------------------------------------------ */
/*  GET /api/leaves                                                    */
/*  Returns leave requests + leave types/allocations/overrides         */
/* ------------------------------------------------------------------ */

export async function GET(request: NextRequest) {
  try {
    const user = await verifyAuth();
    const db = user.supabase;
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const employeeId = url.searchParams.get('employee_id');

    // Leave requests
    let reqQuery = db.from('leave_requests').select('*, employees!leave_requests_employee_id_fkey(name, employee_id, department_id, department:departments!employees_department_id_fkey(id, name)), leave_types!leave_requests_leave_type_id_fkey(name, key)');

    if (user.role !== 'admin') {
      reqQuery = reqQuery.eq('employee_id', user.uid);
    } else if (employeeId) {
      reqQuery = reqQuery.eq('employee_id', employeeId);
    }
    if (status) reqQuery = reqQuery.eq('status', status);
    reqQuery = reqQuery.order('created_at', { ascending: false });

    // Leave types + allocations + overrides (for the requesting user)
    const targetId = user.role !== 'admin' ? user.uid : (employeeId ?? user.uid);

    const [requests, types, allocations, overrides] = await Promise.all([
      reqQuery,
      db.from('leave_types').select('id, name, key'),
      db.from('leave_allocations').select('leave_type_id, annual_days'),
      db.from('leave_overrides').select('leave_type_id, custom_days').eq('employee_id', targetId),
    ]);

    if (requests.error) throw requests.error;

    return NextResponse.json({
      success: true,
      data: {
        requests: requests.data ?? [],
        leaveTypes: types.data ?? [],
        leaveAllocations: allocations.data ?? [],
        leaveOverrides: overrides.data ?? [],
      },
    });
  } catch (error) {
    return errorResponse(error, 'Failed to fetch leaves. Please try again.');
  }
}

/* ------------------------------------------------------------------ */
/*  POST /api/leaves  — submit leave request                           */
/* ------------------------------------------------------------------ */

export async function POST(request: NextRequest) {
  try {
    const user = await verifyAuth();
    const db = user.supabase;

    // Rate limit: 5 leave requests per minute per user
    const rl = rateLimiters.leave(user.uid);
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many leave requests. Try again shortly.' },
        { status: 429 },
      );
    }

    const body = await request.json();

    // Validate required fields
    const { leave_type_id, from_date, to_date, days } = body;
    if (!leave_type_id || typeof leave_type_id !== 'string') {
      return NextResponse.json({ success: false, error: 'leave_type_id is required' }, { status: 400 });
    }
    if (!from_date || typeof from_date !== 'string') {
      return NextResponse.json({ success: false, error: 'from_date is required' }, { status: 400 });
    }
    if (!to_date || typeof to_date !== 'string') {
      return NextResponse.json({ success: false, error: 'to_date is required' }, { status: 400 });
    }
    if (days == null || typeof days !== 'number' || days <= 0) {
      return NextResponse.json({ success: false, error: 'days must be a positive number' }, { status: 400 });
    }
    if (new Date(from_date) > new Date(to_date)) {
      return NextResponse.json({ success: false, error: 'from_date must be before or equal to to_date' }, { status: 400 });
    }

    const { data, error } = await db
      .from('leave_requests')
      .insert({
        employee_id: user.uid,
        leave_type_id: body.leave_type_id,
        from_date: body.from_date,
        to_date: body.to_date,
        days: body.days,
        half_day: body.half_day ?? false,
        reason: body.reason ?? null,
        status: 'pending',
      })
      .select()
      .single();

    if (error) throw error;

    logAudit({
      performed_by: user.uid,
      action: 'create',
      target_employee: user.uid,
      details: `Submitted leave request (${body.from_date} to ${body.to_date})`,
      ip_address: getClientIp(request),
      after_data: data,
    });

    return NextResponse.json({ success: true, data: { request: data } }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'Failed to submit leave request. Please try again.');
  }
}
