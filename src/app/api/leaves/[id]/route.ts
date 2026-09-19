import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-helpers';
import { logAudit, getClientIp } from '@/lib/audit';
import { rateLimiters } from '@/lib/rate-limit';
import { errorResponse } from '@/lib/api-errors';

type RouteParams = { params: Promise<{ id: string }> };

/* ------------------------------------------------------------------ */
/*  PATCH /api/leaves/[id]                                             */
/*  Body: { status, rejection_reason? }                                */
/* ------------------------------------------------------------------ */

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await verifyAuth();
    const db = user.supabase;
    if (!rateLimiters.mutation(user.uid).allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Try again shortly.' },
        { status: 429 },
      );
    }

    const { id } = await params;
    const { status, rejection_reason } = await request.json();

    if (!status) {
      return NextResponse.json({ success: false, error: 'Missing status' }, { status: 400 });
    }

    // Fetch the leave request to check ownership
    const { data: lr } = await db
      .from('leave_requests')
      .select('*')
      .eq('id', id)
      .single();

    if (!lr) {
      return NextResponse.json({ success: false, error: 'Leave request not found' }, { status: 404 });
    }

    // Employee can only cancel their own request
    if (user.role !== 'admin') {
      if (lr.employee_id !== user.uid) {
        return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });
      }
      if (status !== 'cancelled') {
        return NextResponse.json({ success: false, error: 'Employees can only cancel requests' }, { status: 403 });
      }
    }

    const updateData: Record<string, unknown> = { status };
    if (status === 'approved' || status === 'rejected') {
      updateData.approved_by = user.uid;
      updateData.approved_at = new Date().toISOString();
    }
    if (rejection_reason) updateData.rejection_reason = rejection_reason;

    const { data, error } = await db
      .from('leave_requests')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    logAudit({
      performed_by: user.uid,
      action: status === 'approved' ? 'approve' : status === 'rejected' ? 'reject' : 'update',
      target_employee: lr.employee_id,
      details: `Leave request ${id} ${status}${rejection_reason ? `: ${rejection_reason}` : ''}`,
      ip_address: getClientIp(request),
      before_data: lr,
      after_data: data,
    });

    return NextResponse.json({ success: true, data: { request: data } });
  } catch (error) {
    return errorResponse(error, 'Failed to update leave request. Please try again.');
  }
}
