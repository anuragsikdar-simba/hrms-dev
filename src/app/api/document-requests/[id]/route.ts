import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, supabaseAdmin } from '@/lib/auth-helpers';
import { logAudit, getClientIp } from '@/lib/audit';
import { rateLimiters } from '@/lib/rate-limit';
import { errorResponse } from '@/lib/api-errors';

const VALID_STATUSES = ['pending', 'fulfilled', 'rejected'] as const;
type RequestStatus = (typeof VALID_STATUSES)[number];

/* ------------------------------------------------------------------ */
/*  PATCH /api/document-requests/[id]                                  */
/*  Body: { status: 'fulfilled' | 'rejected' | 'pending' }             */
/*  Admin-only (RLS enforces admin-only update).                       */
/* ------------------------------------------------------------------ */

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const user = await verifyAuth();
    const db = user.supabase;

    if (!rateLimiters.mutation(user.uid).allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Try again shortly.' },
        { status: 429 },
      );
    }

    const { status } = (await request.json()) as { status?: RequestStatus };
    if (!status || !VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        { success: false, error: `status must be one of: ${VALID_STATUSES.join(', ')}` },
        { status: 400 },
      );
    }

    // Permission model:
    //  - Admins may set any status on any request (via their RLS-scoped client).
    //  - The employee a request is addressed to may mark it 'fulfilled' (they
    //    just uploaded the document). This is what closes the loop so HR stops
    //    seeing the request as outstanding and stops re-requesting the same doc.
    //    Employees may NOT reject or reopen requests.
    // The document_requests UPDATE RLS policy is admin-only, so for the employee
    // self-fulfil path we must use the service-role client (after verifying the
    // request is genuinely addressed to them). No schema/policy change required.
    let writer = db;
    if (user.role !== 'admin') {
      if (status !== 'fulfilled') {
        return NextResponse.json(
          { success: false, error: 'You can only mark your own requests as fulfilled.' },
          { status: 403 },
        );
      }
      const { data: own, error: ownErr } = await supabaseAdmin
        .from('document_requests')
        .select('id, employee_id')
        .eq('id', id)
        .maybeSingle();
      if (ownErr) throw ownErr;
      if (!own || own.employee_id !== user.uid) {
        return NextResponse.json(
          { success: false, error: 'You can only update requests addressed to you.' },
          { status: 403 },
        );
      }
      writer = supabaseAdmin;
    }

    const { data, error } = await writer
      .from('document_requests')
      .update({
        status,
        fulfilled_by: status === 'fulfilled' ? user.uid : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ success: false, error: 'Document request not found.' }, { status: 404 });
      }
      throw error;
    }

    logAudit({
      performed_by: user.uid,
      action: 'update',
      target_employee: data.employee_id,
      details: `Document request marked ${status}`,
      ip_address: getClientIp(request),
    });

    return NextResponse.json({ success: true, data: { documentRequest: data } });
  } catch (error) {
    return errorResponse(error, 'Failed to update document request. Please try again.');
  }
}

/* ------------------------------------------------------------------ */
/*  DELETE /api/document-requests/[id]                                 */
/*  Admin-only (RLS enforces admin-only delete).                       */
/* ------------------------------------------------------------------ */

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const user = await verifyAuth();
    const db = user.supabase;

    if (!rateLimiters.mutation(user.uid).allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Try again shortly.' },
        { status: 429 },
      );
    }

    if (user.role !== 'admin') {
      return NextResponse.json(
        { success: false, error: 'Only administrators can delete document requests.' },
        { status: 403 },
      );
    }

    const { error } = await db.from('document_requests').delete().eq('id', id);
    if (error) throw error;

    logAudit({
      performed_by: user.uid,
      action: 'delete',
      details: `Deleted document request ${id}`,
      ip_address: getClientIp(request),
    });

    return NextResponse.json({ success: true, data: { message: 'Document request deleted.' } });
  } catch (error) {
    return errorResponse(error, 'Failed to delete document request. Please try again.');
  }
}
