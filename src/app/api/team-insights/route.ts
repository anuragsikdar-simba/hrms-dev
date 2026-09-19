import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-helpers';
import { errorResponse } from '@/lib/api-errors';

/* ------------------------------------------------------------------ */
/*  GET /api/team-insights                                             */
/*  Admin only. Query: period (this_week, this_month, last_month, etc) */
/* ------------------------------------------------------------------ */

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getPeriodDates(period: string): { start: string; end: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();

  switch (period) {
    case 'this_week': {
      const day = now.getDay();
      const diff = d - day + (day === 0 ? -6 : 1);
      const monday = new Date(y, m, diff);
      return { start: fmt(monday), end: fmt(now) };
    }
    case 'last_month': {
      const firstLast = new Date(y, m - 1, 1);
      const lastLast = new Date(y, m, 0);
      return { start: fmt(firstLast), end: fmt(lastLast) };
    }
    case 'last_3_months': {
      const threeAgo = new Date(y, m - 3, 1);
      return { start: fmt(threeAgo), end: fmt(now) };
    }
    case 'this_quarter': {
      const qMonth = Math.floor(m / 3) * 3;
      return { start: fmt(new Date(y, qMonth, 1)), end: fmt(now) };
    }
    case 'this_year':
      return { start: `${y}-01-01`, end: fmt(now) };
    default:
      // this_month
      return { start: `${y}-${String(m + 1).padStart(2, '0')}-01`, end: fmt(now) };
  }
}

export async function GET(request: NextRequest) {
  try {
    const authUser = await requireAdmin();
    const db = authUser.supabase;
    const url = new URL(request.url);
    const period = url.searchParams.get('period') ?? 'this_month';

    const { start, end } = getPeriodDates(period);

    // Fetch all independent data in parallel (one round-trip).
    const [allEmps, newHires, offboarded, pendingOnboarding, allActiveEmps, leaveTypesRes] = await Promise.all([
      db.from('employees').select('id, status').not('status', 'eq', 'offboarded'),
      db.from('employees').select('id').eq('status', 'active').gte('date_of_joining', start).lte('date_of_joining', end),
      db.from('employees').select('id').eq('status', 'offboarded').gte('updated_at', start),
      db.from('employees').select('id').neq('onboarding_status', 'completed').neq('status', 'offboarded'),
      db.from('employees').select('id, name, department_id, department:departments!employees_department_id_fkey(id, name), date_of_joining, status').eq('tracks_attendance', true),
      db.from('leave_types').select('id, name, key, leave_allocations(annual_days)'),
    ]);
    const leaveTypes = leaveTypesRes.data;

    const activeEmps = (allActiveEmps.data ?? []).filter(e => e.status === 'active');
    const activeIds = activeEmps.map(e => e.id);

    // Attendance, leaves, regularisations, leave types
    let attendanceData: any[] = [];
    let leaveData: any[] = [];
    let regData: any[] = [];

    if (activeIds.length > 0) {
      const [att, lv, reg] = await Promise.all([
        db.from('attendance').select('employee_id, worked_hours, punch_in, status, date').gte('date', start).lte('date', end).in('employee_id', activeIds),
        db.from('leave_requests').select('employee_id, leave_type_id, days').eq('status', 'approved').gte('from_date', start).lte('to_date', end).in('employee_id', activeIds),
        db.from('approval_requests').select('employee_id').eq('type', 'regularisation').gte('created_at', start).in('employee_id', activeIds),
      ]);
      attendanceData = att.data ?? [];
      leaveData = lv.data ?? [];
      regData = reg.data ?? [];
    }

    // Leave types were fetched above in the first parallel batch.

    return NextResponse.json({
      employeeCounts: {
        total: (allEmps.data ?? []).length,
        active: activeEmps.length,
        newHires: (newHires.data ?? []).length,
        offboarded: (offboarded.data ?? []).length,
        pendingOnboarding: (pendingOnboarding.data ?? []).length,
      },
      employees: activeEmps,
      attendance: attendanceData,
      leaves: leaveData,
      regularisations: regData,
      leaveTypes: leaveTypes ?? [],
      period,
      dateRange: { start, end },
    });
  } catch (error) {
    return errorResponse(error, 'Failed to load team insights. Please try again.');
  }
}
