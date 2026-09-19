import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-helpers';
import { logAudit, getClientIp } from '@/lib/audit';
import { errorResponse } from '@/lib/api-errors';

/**
 * POST /api/auth/login-event
 * Records a login audit entry for the currently authenticated user.
 *
 * Authentication itself is handled entirely by Supabase Auth on the client
 * (supabase.auth.signInWithPassword), which sets the session cookie. This
 * endpoint only records the audit trail and confirms the session is valid.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await verifyAuth();

    logAudit({
      performed_by: user.uid,
      action: 'login',
      details: `Login via Supabase Auth (${user.email})`,
      ip_address: getClientIp(request),
    });

    return NextResponse.json({ success: true, data: { uid: user.uid, email: user.email } });
  } catch (error) {
    return errorResponse(error, 'Not authenticated. Please try again.');
  }
}
