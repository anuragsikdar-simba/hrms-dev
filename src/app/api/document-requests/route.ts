import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-helpers';
import { logAudit, getClientIp } from '@/lib/audit';
import { rateLimiters } from '@/lib/rate-limit';
import { errorResponse } from '@/lib/api-errors';

/* ------------------------------------------------------------------ */
/*  GET /api/document-requests?employee_id=&status=                    */
/*  - Employees see their own requests.                                */
/*  - Admins see all, optionally filtered by employee_id / status.     */
/* ------------------------------------------------------------------ */

export async function GET(request: NextRequest) {
  try {
    const user = await verifyAuth();
    const db = user.supabase;

    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employee_id');
    const status = searchParams.get('status');

    let query = db
      .from('document_requests')
      .select('*')
      .order('created_at', { ascending: false });

    // Non-admins are always scoped to their own record (RLS also enforces this).
    if (user.role !== 'admin') {
      query = query.eq('employee_id', user.uid);
    } else if (employeeId) {
      query = query.eq('employee_id', employeeId);
    }

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ success: true, data: { documentRequests: data ?? [] } });
  } catch (error) {
    return errorResponse(error, 'Failed to load document requests. Please try again.');
  }
}

/* ------------------------------------------------------------------ */
/*  POST /api/document-requests                                        */
/*  Admin requests a document FROM an employee (RLS: admin-only).      */
/* ------------------------------------------------------------------ */

export async function POST(request: NextRequest) {
  try {
    const user = await verifyAuth();
    const db = user.supabase;
    const rl = rateLimiters.mutation(user.uid);
    if (!rl.allowed) {
      return NextResponse.json({ success: false, error: 'Rate limit exceeded' }, { status: 429 });
    }

    const { description, employee_id } = await request.json();
    if (!description?.trim()) {
      return NextResponse.json({ success: false, error: 'description is required' }, { status: 400 });
    }

    // Document requests are HR asking an employee to provide a document.
    // The document_requests INSERT RLS policy is admin-only, and the UI only
    // offers this action to admins - a non-admin reaching here previously fell
    // through to the insert and got an opaque RLS 500. Enforce it clearly.
    if (user.role !== 'admin') {
      return NextResponse.json(
        { success: false, error: 'Only administrators can send document requests.' },
        { status: 403 },
      );
    }

    // Who the document is being requested FROM (defaults to self if omitted).
    const targetEmployeeId = employee_id || user.uid;

    const { data, error } = await db
      .from('document_requests')
      .insert({
        employee_id: targetEmployeeId,
        description: description.trim(),
      })
      .select()
      .single();
    if (error) throw error;

    // Notify the employee that a document has been requested from them.
    // Best-effort: a notification failure must not fail the request itself.
    try {
      await db.from('notifications').insert({
        employee_id: targetEmployeeId,
        title: 'Document requested',
        message: description.trim().slice(0, 300),
        type: 'document',
        actionable: true,
        action_url: '/documents',
      });
    } catch {
      /* non-fatal */
    }

    logAudit({
      performed_by: user.uid,
      action: 'create',
      target_employee: targetEmployeeId,
      details: `Requested document: "${description.trim().slice(0, 100)}"`,
      ip_address: getClientIp(request),
    });

    return NextResponse.json({ success: true, data: { documentRequest: data } }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'Failed to submit document request. Please try again.');
  }
}
