import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { autoCloseAllStaleSessions } from '@/lib/attendance';

/* ------------------------------------------------------------------ */
/*  GET /api/cron/close-sessions                                       */
/*                                                                     */
/*  Scheduled (Vercel Cron) job that closes every stale open           */
/*  attendance session org-wide. This is the robust, server-driven     */
/*  replacement for the per-browser-tab auto punch-out timer: sessions */
/*  are capped even if the user closed their browser or never came     */
/*  back. Runs with the service-role client (bypasses RLS) and is      */
/*  protected by a shared CRON_SECRET so it cannot be triggered by an  */
/*  unauthenticated caller.                                            */
/* ------------------------------------------------------------------ */

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;

  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. We also accept a
  // `?secret=` query param as a fallback for manual/uptime triggers. If no
  // CRON_SECRET is configured the endpoint refuses to run (fail closed).
  if (!secret) {
    return NextResponse.json(
      { success: false, error: 'CRON_SECRET not configured' },
      { status: 503 },
    );
  }
  const authHeader = request.headers.get('authorization');
  const querySecret = request.nextUrl.searchParams.get('secret');
  const provided = authHeader?.replace(/^Bearer\s+/i, '') ?? querySecret ?? '';
  if (provided !== secret) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const closed = await autoCloseAllStaleSessions(supabaseAdmin, new Date());
    return NextResponse.json({ success: true, data: { closed } });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to close sessions' },
      { status: 500 },
    );
  }
}
