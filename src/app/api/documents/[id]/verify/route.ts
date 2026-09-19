import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-helpers';
import { logAudit, getClientIp } from '@/lib/audit';
import { rateLimiters } from '@/lib/rate-limit';
import { errorResponse } from '@/lib/api-errors';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * PATCH /api/documents/[id]/verify
 * Toggle document verification status. Admin only.
 *
 * Body: { verified: boolean }
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const admin = await requireAdmin();
    const db = admin.supabase;
    if (!rateLimiters.mutation(admin.uid).allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Try again shortly.' },
        { status: 429 },
      );
    }

    const { id } = await params;
    const body = await request.json();

    const verified = body.verified === true;

    // Fetch current document to confirm it exists
    const { data: doc, error: fetchError } = await db
      .from('documents')
      .select('id, name, employee_id, verified')
      .eq('id', id)
      .single();

    if (fetchError || !doc) {
      return NextResponse.json({ success: false, error: 'Document not found' }, { status: 404 });
    }

    const updatePayload = verified
      ? { verified: true, verified_by: admin.uid, verified_at: new Date().toISOString() }
      : { verified: false, verified_by: null, verified_at: null };

    const { data, error } = await db
      .from('documents')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    logAudit({
      performed_by: admin.uid,
      action: verified ? 'verify' : 'unverify',
      target_employee: doc.employee_id,
      details: `${verified ? 'Verified' : 'Unverified'} document "${doc.name}"`,
      ip_address: getClientIp(request),
    });

    return NextResponse.json({ success: true, data: { document: data } });
  } catch (error) {
    return errorResponse(error, 'Failed to update document verification. Please try again.');
  }
}
