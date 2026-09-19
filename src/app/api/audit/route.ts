import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-helpers';
import { errorResponse } from '@/lib/api-errors';

/* ------------------------------------------------------------------ */
/*  GET /api/audit                                                     */
/* ------------------------------------------------------------------ */

export async function GET(request: NextRequest) {
  try {
    const authUser = await requireAdmin();
    const db = authUser.supabase;
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') ?? '1', 10);
    const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
    const action = url.searchParams.get('action');
    const offset = (page - 1) * limit;

    let query = db
      .from('audit_log')
      .select('*, performer:employees!audit_log_performed_by_fkey(name), target:employees!audit_log_target_employee_fkey(name)', { count: 'exact' });

    if (action) query = query.eq('action', action);
    query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

    const { data, count, error } = await query;
    if (error) throw error;

    return NextResponse.json({
      success: true,
      data: { auditLogs: data ?? [], total: count ?? 0, page, limit },
    });
  } catch (error) {
    return errorResponse(error, 'Failed to fetch audit log. Please try again.');
  }
}
