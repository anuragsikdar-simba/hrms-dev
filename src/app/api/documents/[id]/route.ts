import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, supabaseAdmin } from '@/lib/auth-helpers';
import { logAudit, getClientIp } from '@/lib/audit';
import { rateLimiters } from '@/lib/rate-limit';
import { errorResponse } from '@/lib/api-errors';
import { DOCUMENTS_BUCKET, toStoragePath } from '@/lib/documents';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * DELETE /api/documents/[id]
 * Removes a document record and its stored file. Admins may delete any
 * document; employees may delete only their own. Storage RLS is enforced via
 * the per-user client.
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await verifyAuth();
    const db = user.supabase;
    if (!rateLimiters.mutation(user.uid).allowed) {
      return NextResponse.json({ success: false, error: 'Rate limit exceeded' }, { status: 429 });
    }

    const { id } = await params;

    // Fetch first (RLS scopes to own docs or admin sees all)
    const { data: doc, error: fetchErr } = await db
      .from('documents')
      .select('id, employee_id, name, file_url')
      .eq('id', id)
      .single();

    if (fetchErr || !doc) {
      return NextResponse.json({ success: false, error: 'Document not found' }, { status: 404 });
    }

    // Access control: employees may only delete their own documents
    if (user.role !== 'admin' && user.uid !== doc.employee_id) {
      return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });
    }

    // Remove the stored file (best-effort; the row is the source of truth).
    const path = toStoragePath(doc.file_url);
    if (path) {
      await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).remove([path]);
    }

    // The documents DELETE RLS policy is admin-only, so an employee deleting
    // their own document through the user-scoped client silently matched 0
    // rows (no error, row survived, but the storage file was already gone).
    // Ownership was verified above, so use the service-role client and check
    // that a row was actually removed.
    const { data: deleted, error: delErr } = await supabaseAdmin
      .from('documents')
      .delete()
      .eq('id', id)
      .select('id');
    if (delErr) throw delErr;
    if (!deleted || deleted.length === 0) {
      return NextResponse.json({ success: false, error: 'Document not found' }, { status: 404 });
    }

    logAudit({
      performed_by: user.uid,
      action: 'delete',
      target_employee: doc.employee_id,
      details: `Deleted document "${doc.name}"`,
      ip_address: getClientIp(request),
      before_data: doc,
    });

    return NextResponse.json({ success: true, data: { deleted: id } });
  } catch (error) {
    return errorResponse(error, 'Failed to delete document. Please try again.');
  }
}
