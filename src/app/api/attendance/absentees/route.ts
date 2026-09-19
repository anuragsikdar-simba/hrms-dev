import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-helpers';
import { logAudit, getClientIp } from '@/lib/audit';
import { rateLimiters } from '@/lib/rate-limit';
import { errorResponse } from '@/lib/api-errors';
import { businessDate } from '@/lib/dates';

/* ------------------------------------------------------------------ */
/*  GET /api/attendance/absentees?date=YYYY-MM-DD                      */
/*  Returns employees who have no attendance and no approved leave      */
/*  for the given date (defaults to today). Excludes holidays.         */
/* ------------------------------------------------------------------ */

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdmin();
    const db = admin.supabase;
    const url = new URL(request.url);
    const date = url.searchParams.get('date') ?? businessDate();

    // Parallel: active employees, attendance for date, OPEN overnight sessions
    // (punched in on an earlier date, still working - e.g. night shift that
    // started yesterday 22:00 and is still going), approved leaves covering
    // date, holidays on date
    const [empRes, attRes, openRes, leaveRes, holidayRes] = await Promise.all([
      db.from('employees')
        .select('id, employee_id, name, department_id, department:departments!employees_department_id_fkey(name)')
        .eq('status', 'active')
        .eq('tracks_attendance', true),
      db.from('attendance')
        .select('employee_id')
        .eq('date', date),
      db.from('attendance')
        .select('employee_id')
        .is('punch_out', null)
        .not('punch_in', 'is', null),
      db.from('leave_requests')
        .select('employee_id')
        .eq('status', 'approved')
        .lte('from_date', date)
        .gte('to_date', date),
      db.from('holidays')
        .select('id')
        .eq('date', date)
        .eq('type', 'mandatory'),
    ]);

    // If it's a mandatory holiday, no one is absent
    if ((holidayRes.data ?? []).length > 0) {
      return NextResponse.json({
        success: true,
        data: { absentees: [], date, isHoliday: true },
      });
    }

    // Also skip weekends (Saturday=6, Sunday=0)
    const dayOfWeek = new Date(date + 'T00:00:00').getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return NextResponse.json({
        success: true,
        data: { absentees: [], date, isWeekend: true },
      });
    }

    const punchedIds = new Set((attRes.data ?? []).map((a) => a.employee_id));
    // Anyone with a currently-open session is working right now, even if the
    // record is dated an earlier day (overnight shift): not absent.
    for (const o of openRes.data ?? []) punchedIds.add(o.employee_id);
    const onLeaveIds = new Set((leaveRes.data ?? []).map((l) => l.employee_id));

    const absentees = (empRes.data ?? [])
      .filter((e) => !punchedIds.has(e.id) && !onLeaveIds.has(e.id))
      .map((e) => ({
        id: e.id,
        employeeId: e.employee_id,
        name: e.name,
        department: (e.department as { name?: string })?.name ?? 'Unassigned',
      }));

    return NextResponse.json({
      success: true,
      data: { absentees, date, isHoliday: false, isWeekend: false },
    });
  } catch (error) {
    return errorResponse(error, 'Failed to fetch absentees. Please try again.');
  }
}

/* ------------------------------------------------------------------ */
/*  POST /api/attendance/mark-absent                                   */
/*  Admin marks an employee as absent for a specific date.             */
/*                                                                     */
/*  Body: {                                                            */
/*    employee_id: string,                                             */
/*    date: string (YYYY-MM-DD),                                       */
/*    action: 'lop' | 'deduct_leave',                                  */
/*    leave_type_id?: string (required if action='deduct_leave')       */
/*  }                                                                  */
/*                                                                     */
/*  - 'lop': Creates an attendance record with status='absent_lop'     */
/*  - 'deduct_leave': Creates a 1-day leave request (auto-approved)    */
/*    and an attendance record with status='absent_leave_deducted'      */
/* ------------------------------------------------------------------ */

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin();
    const db = admin.supabase;

    // Rate limit: 30 mutations/min per admin
    if (!rateLimiters.mutation(admin.uid).allowed) {
      return NextResponse.json(
        { success: false, error: 'Rate limit exceeded. Try again later.' },
        { status: 429 },
      );
    }

    const body = await request.json();

    const { employee_id, date, action, leave_type_id } = body as {
      employee_id?: string;
      date?: string;
      action?: 'lop' | 'deduct_leave';
      leave_type_id?: string;
    };

    if (!employee_id || !date || !action) {
      return NextResponse.json(
        { success: false, error: 'employee_id, date, and action are required' },
        { status: 400 },
      );
    }

    if (action === 'deduct_leave' && !leave_type_id) {
      return NextResponse.json(
        { success: false, error: 'leave_type_id is required when action is deduct_leave' },
        { status: 400 },
      );
    }

    // Check employee exists
    const { data: emp } = await db
      .from('employees')
      .select('id, name, employee_id')
      .eq('id', employee_id)
      .single();

    if (!emp) {
      return NextResponse.json({ success: false, error: 'Employee not found' }, { status: 404 });
    }

    // Check no attendance record already exists
    const { data: existing } = await db
      .from('attendance')
      .select('id')
      .eq('employee_id', employee_id)
      .eq('date', date)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { success: false, error: 'Attendance record already exists for this date' },
        { status: 409 },
      );
    }

    const ip = getClientIp(request);

    if (action === 'deduct_leave') {
      // Create auto-approved leave request for 1 day
      const { error: leaveError } = await db
        .from('leave_requests')
        .insert({
          employee_id,
          leave_type_id,
          from_date: date,
          to_date: date,
          days: 1,
          half_day: false,
          reason: 'Absent without notice - leave deducted by admin',
          status: 'approved',
          approved_by: admin.uid,
        });

      if (leaveError) throw leaveError;

      // Create attendance record
      const { data: attRecord, error: attError } = await db
        .from('attendance')
        .insert({
          employee_id,
          date,
          status: 'absent_leave_deducted',
          worked_hours: 0,
        })
        .select()
        .single();

      if (attError) throw attError;

      // Get leave type name for audit
      const { data: lt } = await db
        .from('leave_types')
        .select('name')
        .eq('id', leave_type_id)
        .single();

      logAudit({
        performed_by: admin.uid,
        action: 'mark_absent',
        target_employee: employee_id,
        details: `Marked ${emp.name} (${emp.employee_id}) absent on ${date}. Deducted 1 day from ${lt?.name ?? 'leave'}.`,
        ip_address: ip,
      });

      return NextResponse.json({
        success: true,
        data: { attendance: attRecord, action: 'deduct_leave', leaveType: lt?.name },
      }, { status: 201 });
    }

    // action === 'lop'
    const { data: attRecord, error: attError } = await db
      .from('attendance')
      .insert({
        employee_id,
        date,
        status: 'absent_lop',
        worked_hours: 0,
      })
      .select()
      .single();

    if (attError) throw attError;

    logAudit({
      performed_by: admin.uid,
      action: 'mark_absent',
      target_employee: employee_id,
      details: `Marked ${emp.name} (${emp.employee_id}) absent (LOP) on ${date}.`,
      ip_address: ip,
    });

    return NextResponse.json({
      success: true,
      data: { attendance: attRecord, action: 'lop' },
    }, { status: 201 });
  } catch (error: unknown) {
    return errorResponse(error, 'Failed to mark absent. Please try again.');
  }
}
