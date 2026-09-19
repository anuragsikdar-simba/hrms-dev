import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-helpers';
import { errorResponse } from '@/lib/api-errors';

/**
 * GET /api/auth/me
 * Returns the current user's employee profile.
 * Uses the per-request Supabase client (RLS-enforced via the session cookie).
 */
export async function GET() {
  try {
    const authUser = await verifyAuth();
    const db = authUser.supabase;

    const { data, error } = await db
      .from('employees')
      .select('*, department:departments!employees_department_id_fkey(id, name), reporting_manager:employees(id, name)')
      .eq('id', authUser.uid)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { success: false, error: 'Employee profile not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: { employee: data } });
  } catch (err) {
    return errorResponse(err, 'Authentication failed. Please try again.');
  }
}

/**
 * POST /api/auth/me
 * Self-service profile actions for the current user.
 *
 * Currently supports clearing the forced-password-reset flag after the user
 * has successfully changed their password. We expose this here (rather than
 * letting employees set `must_reset_password` through the general employee
 * PATCH, which is admin-only) so the only thing a user can do is *clear their
 * own* flag. RLS still scopes the update to the caller's own row.
 */
export async function POST(request: Request) {
  try {
    const authUser = await verifyAuth();
    const db = authUser.supabase;

    const body = await request.json().catch(() => ({}));

    if (body?.action !== 'clear_reset_flag') {
      return NextResponse.json(
        { success: false, error: 'Unsupported action.' },
        { status: 400 },
      );
    }

    const { error } = await db
      .from('employees')
      .update({ must_reset_password: false, updated_at: new Date().toISOString() })
      .eq('id', authUser.uid);

    if (error) throw error;

    return NextResponse.json({ success: true, data: { cleared: true } });
  } catch (err) {
    return errorResponse(err, 'Could not update your profile. Please try again.');
  }
}
