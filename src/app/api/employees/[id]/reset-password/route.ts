import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, supabaseAdmin } from '@/lib/auth-helpers';
import { logAudit, getClientIp } from '@/lib/audit';
import { rateLimiters } from '@/lib/rate-limit';
import { errorResponse } from '@/lib/api-errors';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * Generate a reasonably strong, human-shareable temporary password.
 * Avoids visually ambiguous characters (0/O, 1/l/I) so it can be read aloud or
 * copied without confusion. Always satisfies the app's 8+ char policy and
 * includes upper/lower/digit/symbol.
 */
function generateTempPassword(): string {
  const upper = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%&*?';
  const all = upper + lower + digits + symbols;

  const pick = (set: string) => set[Math.floor(Math.random() * set.length)];

  // Guarantee one of each class, then fill to length 14.
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (chars.length < 14) chars.push(pick(all));

  // Fisher-Yates shuffle so the guaranteed chars aren't always in front.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/**
 * POST /api/employees/:id/reset-password
 *
 * Admin-only. Because this deployment has no email service, admins cannot rely
 * on the "forgot password" email flow. This endpoint lets an admin directly set
 * (or auto-generate) a temporary password for an employee and returns it once so
 * the admin can share it with the user out-of-band.
 *
 * The employee is flagged `must_reset_password = true`, so on next login they're
 * forced through the existing /reset-password screen to choose their own
 * password (the temp one is single-use in practice).
 *
 * Body (optional): { password?: string }
 *   - If a password is supplied it's used (must be >= 8 chars).
 *   - Otherwise a strong temp password is generated and returned.
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

    const body = await request.json().catch(() => ({}));
    const customPassword =
      typeof body?.password === 'string' && body.password.trim().length > 0
        ? body.password.trim()
        : null;

    if (customPassword && customPassword.length < 8) {
      return NextResponse.json(
        { success: false, error: 'Password must be at least 8 characters.' },
        { status: 400 },
      );
    }

    // Resolve the employee's linked Supabase Auth user id + a label for the UI.
    const { data: emp, error: empErr } = await supabaseAdmin
      .from('employees')
      .select('id, name, email, auth_user_id')
      .eq('id', id)
      .single();

    if (empErr || !emp) {
      return NextResponse.json(
        { success: false, error: 'Employee not found.' },
        { status: 404 },
      );
    }

    if (!emp.auth_user_id) {
      return NextResponse.json(
        {
          success: false,
          error:
            'This employee has no linked login account yet, so a password cannot be set.',
        },
        { status: 409 },
      );
    }

    const newPassword = customPassword ?? generateTempPassword();

    // 1. Set the new password on the auth user (service-role).
    const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(
      emp.auth_user_id,
      { password: newPassword },
    );
    if (updateErr) throw updateErr;

    // 2. Force the user to choose their own password on next login.
    const { error: flagErr } = await supabaseAdmin
      .from('employees')
      .update({ must_reset_password: true, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (flagErr) throw flagErr;

    // 3. Revoke any existing sessions so old credentials stop working.
    await supabaseAdmin.auth.admin.signOut(emp.auth_user_id, 'global').catch(() => {
      /* non-fatal: the password is already changed */
    });

    logAudit({
      performed_by: admin.uid,
      action: 'update',
      target_employee: id,
      // NEVER log the actual password.
      details: `Admin reset password for ${emp.name} (${emp.email}); user must reset on next login`,
      ip_address: getClientIp(request),
    });

    return NextResponse.json({
      success: true,
      data: {
        employeeId: id,
        employeeName: emp.name,
        email: emp.email,
        // Returned exactly once so the admin can share it. Not stored anywhere.
        tempPassword: newPassword,
        generated: customPassword === null,
        mustResetOnLogin: true,
      },
    });
  } catch (error) {
    return errorResponse(error, 'Failed to reset the employee password. Please try again.');
  }
}
