import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-helpers';
import { errorResponse } from '@/lib/api-errors';
import type { PayslipRow } from '@/types';

/* ------------------------------------------------------------------ */
/*  GET /api/payroll/payslips?employee_id=&year=                       */
/*  Payslips visible to the caller.                                    */
/*                                                                     */
/*  Admins may list anyone's. Employees get ONLY their own, and ONLY   */
/*  from published runs (BUSINESS_RULES §8.1) — draft/locked figures   */
/*  are mid-calculation and must never reach staff. RLS already says   */
/*  this; the route says it again on purpose (§6.2 defence in depth).  */
/* ------------------------------------------------------------------ */

export async function GET(request: NextRequest) {
  try {
    const user = await verifyAuth();
    const db = user.supabase;
    const url = new URL(request.url);
    const requestedEmployeeId = url.searchParams.get('employee_id');
    const yearParam = url.searchParams.get('year');

    // `!inner` so the run status filter applies to the payslip rows themselves
    // rather than merely emptying the embedded object.
    let query = db
      .from('payslips')
      .select(
        '*, employees!payslips_employee_id_fkey(name, employee_id, email), payroll_runs!inner(status)',
      );

    if (user.role === 'admin') {
      if (requestedEmployeeId) query = query.eq('employee_id', requestedEmployeeId);
    } else {
      // Forced, not merely defaulted: whatever employee_id was asked for is ignored.
      query = query.eq('employee_id', user.uid).eq('payroll_runs.status', 'published');
    }

    const year = yearParam ? Number(yearParam) : NaN;
    if (Number.isInteger(year)) query = query.eq('period_year', year);

    const { data, error } = await query
      .order('period_year', { ascending: false })
      .order('period_month', { ascending: false });

    if (error) throw error;

    return NextResponse.json({
      success: true,
      data: { payslips: (data ?? []) as PayslipRow[] },
    });
  } catch (error) {
    return errorResponse(error, 'Failed to load payslips. Please try again.');
  }
}
