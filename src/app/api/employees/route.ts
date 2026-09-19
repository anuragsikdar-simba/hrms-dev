import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, requireAdmin } from '@/lib/auth-helpers';
import { logAudit, getClientIp } from '@/lib/audit';
import { rateLimiters } from '@/lib/rate-limit';
import { errorResponse } from '@/lib/api-errors';
import { EMPLOYEE_SELECT, validateRow, provisionEmployee } from '@/lib/employee-provision';
import { EMPLOYEE_ID_PREFIX } from '@/lib/employee-id';

/* ------------------------------------------------------------------ */
/*  GET /api/employees                                                 */
/* ------------------------------------------------------------------ */

export async function GET(request: NextRequest) {
  try {
    const user = await verifyAuth();
    const db = user.supabase;

    // Admin-only: preview the next auto-generated employee ID (no allocation).
    if (new URL(request.url).searchParams.get('preview_next_id')) {
      if (user.role !== 'admin') {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
      }
      const { data: nextId, error: previewErr } = await db.rpc('next_employee_id', {
        p_prefix: EMPLOYEE_ID_PREFIX,
      });
      if (previewErr) return errorResponse(previewErr, 'Could not preview the next Employee ID.');
      return NextResponse.json({ success: true, data: { nextId } });
    }

    if (user.role !== 'admin') {
      // Employee can only see their own record
      const { data, error } = await db
        .from('employees')
        .select(EMPLOYEE_SELECT)
        .eq('id', user.uid)
        .single();

      if (error) throw error;
      return NextResponse.json({ success: true, data: { employees: [data] } });
    }

    const { data, error } = await db
      .from('employees')
      .select(EMPLOYEE_SELECT)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return NextResponse.json({ success: true, data: { employees: data ?? [] } });
  } catch (error: unknown) {
    return errorResponse(error, 'Failed to load employees. Please try again.');
  }
}

/* ------------------------------------------------------------------ */
/*  POST /api/employees  -- admin only                                 */
/* ------------------------------------------------------------------ */

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    const db = auth.supabase;

    // Rate limit: 30 mutations per minute per user
    const rl = rateLimiters.mutation(auth.uid);
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Try again shortly.' },
        { status: 429 },
      );
    }

    const body = await request.json();

    // Validate + normalise via the shared helper (same rules as bulk import).
    const { errors, normalised } = validateRow({
      name: body.name,
      email: body.email,
      employee_id: body.employee_id,
      department_id: body.department_id,
      designation: body.designation,
      role: body.role,
      phone: body.phone,
      date_of_joining: body.date_of_joining,
      shift_start: body.shift_start,
      shift_end: body.shift_end,
      tracks_attendance: body.tracks_attendance,
    });
    if (errors.length > 0) {
      return NextResponse.json({ success: false, error: errors[0] }, { status: 400 });
    }

    // Single create accepts a pre-resolved department_id (the form has the id).
    const departmentId = body.department_id ?? null;

    const outcome = await provisionEmployee(db, normalised, departmentId);

    if (outcome.status === 'skipped') {
      // Duplicate email / employee_id -> 409 (preserves prior behaviour).
      return NextResponse.json(
        { success: false, error: `${outcome.message ?? 'Already in use.'} Please choose a different one.` },
        { status: 409 },
      );
    }
    if (outcome.status === 'error' || !outcome.employee) {
      return NextResponse.json(
        { success: false, error: outcome.message ?? 'Failed to create employee. Please try again.' },
        { status: 500 },
      );
    }

    const data = outcome.employee as Record<string, any>;

    // Audit log
    logAudit({
      performed_by: auth.uid,
      action: 'create',
      target_employee: data.id,
      details: `Created employee ${data.employee_id} (${data.name}) with login`,
      ip_address: getClientIp(request),
      after_data: data,
    });

    return NextResponse.json(
      { success: true, data: { employee: data, tempPassword: outcome.tempPassword } },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, 'Failed to create employee. Please try again.');
  }
}
