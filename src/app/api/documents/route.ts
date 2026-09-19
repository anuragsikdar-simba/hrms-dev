import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, requireAdmin, supabaseAdmin } from '@/lib/auth-helpers';
import { logAudit, getClientIp } from '@/lib/audit';
import { rateLimiters } from '@/lib/rate-limit';
import { errorResponse } from '@/lib/api-errors';

/* ------------------------------------------------------------------ */
/*  GET /api/documents                                                 */
/* ------------------------------------------------------------------ */

export async function GET(request: NextRequest) {
  try {
    const user = await verifyAuth();
    const db = user.supabase;
    const url = new URL(request.url);
    const employeeId = url.searchParams.get('employee_id');

    let query = db.from('documents').select('*');

    if (user.role !== 'admin') {
      query = query.eq('employee_id', user.uid);
    } else if (employeeId) {
      query = query.eq('employee_id', employeeId);
    }

    query = query.order('uploaded_at', { ascending: false });

    const { data, error } = await query;
    if (error) throw error;

    let documents = data ?? [];

    // Admins see documents across all employees; attach the owner's name and
    // department so the UI can group/organise instead of showing a flat dump.
    if (user.role === 'admin' && documents.length > 0) {
      const ids = Array.from(new Set(documents.map((d) => d.employee_id).filter(Boolean)));
      if (ids.length > 0) {
        const { data: emps, error: empErr } = await db
          .from('employees')
          .select('id, name, employee_id, department:departments!employees_department_id_fkey(name)')
          .in('id', ids);
        if (empErr) throw empErr;
        const byId = new Map(
          (emps ?? []).map((e: Record<string, unknown>) => [e.id as string, e]),
        );
        documents = documents.map((d) => {
          const emp = byId.get(d.employee_id) as Record<string, unknown> | undefined;
          const dept = emp?.department as { name?: string } | null | undefined;
          return {
            ...d,
            employee_name: (emp?.name as string) ?? null,
            employee_code: (emp?.employee_id as string) ?? null,
            department_name: dept?.name ?? null,
          };
        });
      }
    }

    return NextResponse.json({ success: true, data: { documents } });
  } catch (error) {
    return errorResponse(error, 'Failed to fetch documents. Please try again.');
  }
}

/* ------------------------------------------------------------------ */
/*  POST /api/documents                                                */
/*  FormData: file, name, category, employee_id                        */
/* ------------------------------------------------------------------ */

export async function POST(request: NextRequest) {
  try {
    const user = await verifyAuth();
    const db = user.supabase;
    if (!rateLimiters.mutation(user.uid).allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Try again shortly.' },
        { status: 429 },
      );
    }

    const formData = await request.formData();

    const file = formData.get('file') as File | null;
    const name = formData.get('name') as string;
    const category = formData.get('category') as string;
    const employeeId = (formData.get('employee_id') as string) || user.uid;
    // Optional: the document request this upload is fulfilling. When present we
    // close that request server-side so HR stops seeing it as outstanding and
    // does not re-request the same document.
    const requestId = (formData.get('request_id') as string) || null;

    // Only admin can upload for other employees
    if (employeeId !== user.uid && user.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Cannot upload for other employees' }, { status: 403 });
    }

    if (!file || !name || !category) {
      return NextResponse.json({ success: false, error: 'Missing file, name, or category' }, { status: 400 });
    }
    // Keep in sync with DocumentCategory in src/types/index.ts.
    const validCategories = ['identity', 'education', 'employment', 'onboarding', 'other'];
    if (!validCategories.includes(category)) {
      return NextResponse.json({ success: false, error: `category must be one of: ${validCategories.join(', ')}` }, { status: 400 });
    }

    // Upload to Supabase Storage (per-user client, RLS-enforced)
    const ext = file.name.split('.').pop() || 'bin';
    const storagePath = `${employeeId}/${Date.now()}_${name.replace(/\s+/g, '_')}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: storageError } = await db.storage
      .from('documents')
      .upload(storagePath, buffer, { contentType: file.type, upsert: false });

    if (storageError) throw storageError;

    const { data: urlData } = db.storage.from('documents').getPublicUrl(storagePath);

    // Insert document record (also RLS-enforced)
    const { data, error } = await db.from('documents').insert({
      employee_id: employeeId,
      name,
      category,
      file_url: storagePath,
      file_size: file.size,
    }).select().single();

    if (error) throw error;

    // Close the originating document request, if any. We use the service-role
    // client because the document_requests UPDATE RLS policy is admin-only, yet
    // the person fulfilling a request is usually the (non-admin) employee. We
    // still verify ownership here so a user can only close a request that is
    // addressed to the employee the document was uploaded for. Best-effort: a
    // failure here must not fail the upload itself.
    if (requestId) {
      try {
        const { data: reqRow } = await supabaseAdmin
          .from('document_requests')
          .select('id, employee_id, status')
          .eq('id', requestId)
          .maybeSingle();
        const canFulfil =
          reqRow &&
          reqRow.status === 'pending' &&
          (user.role === 'admin' || reqRow.employee_id === employeeId);
        if (canFulfil) {
          await supabaseAdmin
            .from('document_requests')
            .update({
              status: 'fulfilled',
              fulfilled_by: user.uid,
              updated_at: new Date().toISOString(),
            })
            .eq('id', requestId);
        }
      } catch {
        /* non-fatal: the document is uploaded; the request can be closed manually */
      }
    }

    logAudit({
      performed_by: user.uid,
      action: 'upload',
      target_employee: employeeId,
      details: `Uploaded document "${name}" (${category})`,
      ip_address: getClientIp(request),
      after_data: { id: data.id, name, category, file_size: file.size },
    });

    return NextResponse.json({ success: true, data: { document: data } }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'Failed to upload document. Please try again.');
  }
}
