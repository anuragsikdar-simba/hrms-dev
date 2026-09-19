import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-helpers';
import { logAudit, getClientIp } from '@/lib/audit';
import { rateLimiters } from '@/lib/rate-limit';
import { errorResponse } from '@/lib/api-errors';

/* ------------------------------------------------------------------ */
/*  PATCH /api/approvals                                               */
/*  Bulk or single approve/reject for leaves and approval_requests     */
/*  Body: { items: [{id, type}], status, rejection_reason? }           */
/* ------------------------------------------------------------------ */

export async function PATCH(request: NextRequest) {
  try {
    const admin = await requireAdmin();
    const db = admin.supabase;
    if (!rateLimiters.mutation(admin.uid).allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Try again shortly.' },
        { status: 429 },
      );
    }

    const { items, status, rejection_reason } = await request.json() as {
      items: Array<{ id: string; type: 'leave' | 'approval_request' }>;
      status: 'approved' | 'rejected';
      rejection_reason?: string;
    };

    if (!items?.length || !status) {
      return NextResponse.json({ success: false, error: 'Missing items or status' }, { status: 400 });
    }

    const now = new Date().toISOString();
    const leaveIds = items.filter(i => i.type === 'leave').map(i => i.id);
    const approvalIds = items.filter(i => i.type === 'approval_request').map(i => i.id);

    const results: string[] = [];

    if (leaveIds.length > 0) {
      const updateData: Record<string, unknown> = {
        status,
        approved_by: admin.uid,
        approved_at: now,
      };
      if (rejection_reason) updateData.rejection_reason = rejection_reason;

      const { error } = await db
        .from('leave_requests')
        .update(updateData)
        .in('id', leaveIds);

      if (error) throw error;
      results.push(`${leaveIds.length} leave request(s) ${status}`);
    }

    if (approvalIds.length > 0) {
      const updateData: Record<string, unknown> = {
        status,
        resolved_by: admin.uid,
        resolved_at: now,
      };
      if (rejection_reason) updateData.rejection_reason = rejection_reason;

      const { error } = await db
        .from('approval_requests')
        .update(updateData)
        .in('id', approvalIds);

      if (error) throw error;

      // Bulk-approving shift_change requests must also apply the new shift to
      // each employee record (same as the single-approve path).
      if (status === 'approved') {
        const { data: shiftReqs } = await db
          .from('approval_requests')
          .select('id, employee_id, requested_change')
          .in('id', approvalIds)
          .eq('type', 'shift_change');
        for (const req of shiftReqs ?? []) {
          if (!req.requested_change) continue;
          try {
            const change = JSON.parse(req.requested_change) as {
              new_shift_start?: string; new_shift_end?: string;
            };
            if (change.new_shift_start && change.new_shift_end) {
              await db
                .from('employees')
                .update({
                  shift_start: change.new_shift_start,
                  shift_end: change.new_shift_end,
                  updated_at: now,
                })
                .eq('id', req.employee_id);
            }
          } catch {
            /* malformed change payload: skip applying, request stays approved */
          }
        }
      }

      results.push(`${approvalIds.length} approval request(s) ${status}`);
    }

    logAudit({
      performed_by: admin.uid,
      action: status === 'approved' ? 'approve' : 'reject',
      details: `Bulk ${status}: ${results.join(', ')}`,
      ip_address: getClientIp(request),
      after_data: { leaveIds, approvalIds, status, rejection_reason },
    });

    return NextResponse.json({ success: true, data: { message: results.join(', ') } });
  } catch (error) {
    return errorResponse(error, 'Failed to process approvals. Please try again.');
  }
}
