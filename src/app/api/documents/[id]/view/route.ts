import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-helpers';
import { errorResponse } from '@/lib/api-errors';
import { getDocumentUrl } from '@/lib/documents';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/documents/[id]/view
 * Returns a short-lived signed URL for viewing/downloading a document.
 * Uses the per-user Supabase client so storage RLS is enforced.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await verifyAuth();
    const db = user.supabase;
    const { id } = await params;

    // Fetch the document record (RLS scopes to own docs or admin sees all)
    const { data: doc, error } = await db
      .from('documents')
      .select('id, employee_id, name, file_url')
      .eq('id', id)
      .single();

    if (error || !doc) {
      return NextResponse.json({ success: false, error: 'Document not found' }, { status: 404 });
    }

    // Access control: employee can only view their own documents
    if (user.role !== 'admin' && user.uid !== doc.employee_id) {
      return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });
    }

    const url = await getDocumentUrl(db, doc.file_url);
    if (!url) {
      return NextResponse.json(
        { success: false, error: 'Could not generate document URL' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, data: { url, name: doc.name } });
  } catch (error) {
    return errorResponse(error, 'Failed to get document URL. Please try again.');
  }
}
