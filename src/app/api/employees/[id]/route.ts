import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, invalidateEmployeeCache } from '@/lib/auth-helpers';
import { logAudit, getClientIp } from '@/lib/audit';
import { rateLimiters } from '@/lib/rate-limit';
import { errorResponse } from '@/lib/api-errors';

type RouteParams = { params: Promise<{ id: string }> };

/* ------------------------------------------------------------------ */
/*  GET /api/employees/[id]                                            */
/* ------------------------------------------------------------------ */

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await verifyAuth();
    const db = user.supabase;
    const { id } = await params;

    // Employee can only view their own profile
    if (user.role !== 'admin' && user.uid !== id) {
      return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });
    }

    // Fetch employee with department join
    const { data: employee, error } = await db
      .from('employees')
      .select('*, department:departments!employees_department_id_fkey(id, name), reporting_manager:employees(id, name)')
      .eq('id', id)
      .single();

    if (error || !employee) {
      return NextResponse.json({ success: false, error: 'Employee not found' }, { status: 404 });
    }

    // Fetch related data in parallel
    const [leaveTypes, allocations, overrides, leaveRequests, documents, auditLog] = await Promise.all([
      db.from('leave_types').select('id, name, key'),
      db.from('leave_allocations').select('leave_type_id, annual_days'),
      db.from('leave_overrides').select('leave_type_id, custom_days').eq('employee_id', id),
      db.from('leave_requests').select('*').eq('employee_id', id).order('from_date', { ascending: false }),
      db.from('documents').select('*').eq('employee_id', id).order('uploaded_at', { ascending: false }),
      db.from('audit_log').select('action, details, created_at, performed_by, employees!audit_log_performed_by_fkey(name)').or(`performed_by.eq.${id},target_employee.eq.${id}`).order('created_at', { ascending: false }).limit(50),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        employee,
        leaveTypes: leaveTypes.data ?? [],
        leaveAllocations: allocations.data ?? [],
        leaveOverrides: overrides.data ?? [],
        leaveRequests: leaveRequests.data ?? [],
        documents: documents.data ?? [],
        auditLog: auditLog.data ?? [],
      },
    });
  } catch (error) {
    return errorResponse(error, 'Failed to fetch employee. Please try again.');
  }
}

/* ------------------------------------------------------------------ */
/*  PATCH /api/employees/[id]                                          */
/* ------------------------------------------------------------------ */

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await verifyAuth();
    const db = user.supabase;
    const { id } = await params;

    // Only admin can update any employee; employees can update limited own fields
    if (user.role !== 'admin' && user.uid !== id) {
      return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });
    }

    const body = await request.json();

    // Rate limit: 30 mutations per minute per user
    const rl = rateLimiters.mutation(user.uid);
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Try again shortly.' },
        { status: 429 },
      );
    }

    // Whitelist updateable fields per role.
    // Even admins cannot overwrite system-managed columns like id, created_at.
    const ADMIN_FIELDS = new Set([
      'name', 'email', 'phone', 'role', 'department_id', 'designation',
      'date_of_joining', 'status', 'onboarding_status', 'reporting_to',
      'tracks_attendance', 'shift_start', 'shift_end',
      'gender', 'blood_group', 'dob', 'date_of_birth', 'personal_email',
      'pan', 'aadhaar', 'bank_details',
      'permanent_address', 'address', 'current_address',
      'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relation',
      'avatar_url', 'must_reset_password', 'employee_id', 'custom_fields',
    ]);

    const EMPLOYEE_FIELDS = new Set([
      'phone', 'address', 'permanent_address', 'city', 'state', 'pin_code',
      'current_address',
      'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relation',
      'avatar_url',
    ]);

    const allowed = user.role === 'admin' ? ADMIN_FIELDS : EMPLOYEE_FIELDS;
    const keys = Object.keys(body);
    const forbidden = keys.filter(k => !allowed.has(k));

    if (forbidden.length > 0) {
      return NextResponse.json(
        { success: false, error: `Cannot update: ${forbidden.join(', ')}` },
        { status: 403 },
      );
    }

    if (keys.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No fields to update' },
        { status: 400 },
      );
    }

    // Build sanitised update payload (only whitelisted keys)
    const updatePayload: Record<string, unknown> = {};
    for (const k of keys) {
      if (allowed.has(k)) updatePayload[k] = body[k];
    }
    updatePayload.updated_at = new Date().toISOString();

    // Fetch before for audit
    const { data: before } = await db.from('employees').select('*').eq('id', id).single();

    // Safety: never allow demoting the last remaining admin (would lock everyone out).
    if (
      user.role === 'admin' &&
      'role' in updatePayload &&
      updatePayload.role !== 'admin' &&
      before?.role === 'admin'
    ) {
      const { count } = await db
        .from('employees')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'admin')
        .neq('status', 'offboarded');
      if ((count ?? 0) <= 1) {
        return NextResponse.json(
          { success: false, error: 'Cannot revoke admin: at least one active admin is required.' },
          { status: 409 },
        );
      }
    }

    const { data, error } = await db
      .from('employees')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Role/email/status may have changed — drop the cached auth row so the
    // change (e.g. an admin being demoted) takes effect on the next request.
    if (before?.auth_user_id) invalidateEmployeeCache(before.auth_user_id);

    logAudit({
      performed_by: user.uid,
      action: 'update',
      target_employee: id,
      details: `Updated employee fields: ${Object.keys(body).join(', ')}`,
      ip_address: getClientIp(request),
      before_data: before,
      after_data: data,
    });

    return NextResponse.json({ success: true, data: { employee: data } });
  } catch (error: unknown) {
    return errorResponse(error, 'Failed to update employee. Please try again.');
  }
}
