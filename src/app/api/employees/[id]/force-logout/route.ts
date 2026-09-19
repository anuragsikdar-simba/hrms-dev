import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, supabaseAdmin } from '@/lib/auth-helpers';
import { logAudit, getClientIp } from '@/lib/audit';
import { rateLimiters } from '@/lib/rate-limit';
import { errorResponse } from '@/lib/api-errors';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/employees/:id/force-logout
 * Revokes all active Supabase Auth sessions for the target employee.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;

    const rl = rateLimiters.mutation(admin.uid);
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Try again shortly.' },
        { status: 429 },
      );
    }

    // Resolve the employee's linked Supabase Auth user id.
    const { data: emp } = await supabaseAdmin
      .from('employees')
      .select('auth_user_id')
      .eq('id', id)
      .single();

    if (emp?.auth_user_id) {
      // Revokes all refresh tokens / sessions for this auth user.
      await supabaseAdmin.auth.admin.signOut(emp.auth_user_id, 'global');
    }

    logAudit({
      performed_by: admin.uid,
      action: 'logout',
      target_employee: id,
      details: `Force logout: all sessions revoked for employee ${id}`,
      ip_address: getClientIp(request),
    });

    return NextResponse.json({
      success: true,
      data: {
        employeeId: id,
        message: `All sessions for employee ${id} have been revoked.`,
        revokedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    return errorResponse(error, 'Failed to force logout employee. Please try again.');
  }
}
