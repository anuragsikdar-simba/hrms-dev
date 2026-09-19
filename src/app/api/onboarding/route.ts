import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, requireAdmin } from '@/lib/auth-helpers';
import { FIELD_TO_COLUMN, isKnownField, FILE_UPLOAD_FIELDS } from '@/lib/field-mapping';
import { logAudit, getClientIp } from '@/lib/audit';
import { rateLimiters } from '@/lib/rate-limit';
import { errorResponse } from '@/lib/api-errors';
import { resolveSubmissionDocumentUrls } from '@/lib/documents';

/* ------------------------------------------------------------------ */
/*  GET /api/onboarding                                                */
/*  Admin: list pending employees + submissions                        */
/*  Employee: own submission status                                    */
/* ------------------------------------------------------------------ */

export async function GET(request: NextRequest) {
  try {
    const user = await verifyAuth();
    const db = user.supabase;
    const url = new URL(request.url);
    const employeeId = url.searchParams.get('employee_id');

    if (user.role === 'admin') {
      // Admin review queue: only employees who have actually SUBMITTED their
      // onboarding (a submission row with status 'submitted'). Newly-added
      // employees sit at onboarding_status 'pending' with no submission and
      // must not clutter the review queue until they submit.
      const { data: pendingSubs } = await db
        .from('onboarding_submissions')
        .select('employee_id')
        .eq('status', 'submitted');

      const pendingIds = (pendingSubs ?? [])
        .map((s) => s.employee_id)
        .filter(Boolean);

      let employees: unknown[] = [];
      if (pendingIds.length > 0) {
        const { data } = await db
          .from('employees')
          .select('id, employee_id, name, email, department_id, department:departments!employees_department_id_fkey(id, name), onboarding_status, date_of_joining')
          .in('id', pendingIds)
          .order('created_at', { ascending: false });
        employees = data ?? [];
      }

      // If specific employee requested, get their submission
      let submission = null;
      if (employeeId) {
        const { data: sub } = await db
          .from('onboarding_submissions')
          .select('*')
          .eq('employee_id', employeeId)
          .maybeSingle();
        if (sub) {
          sub.documents = await resolveSubmissionDocumentUrls(db, sub.documents);
        }
        submission = sub;
      }

      return NextResponse.json({
        success: true,
        data: { employees, submission },
      });
    }

    // Employee: get own submission
    const { data: submission } = await db
      .from('onboarding_submissions')
      .select('*')
      .eq('employee_id', user.uid)
      .maybeSingle();

    if (submission) {
      submission.documents = await resolveSubmissionDocumentUrls(db, submission.documents);
    }

    const { data: emp } = await db
      .from('employees')
      .select('onboarding_status')
      .eq('id', user.uid)
      .single();

    return NextResponse.json({
      success: true,
      data: { submission, onboarding_status: emp?.onboarding_status ?? 'pending' },
    });
  } catch (error) {
    return errorResponse(error, 'Failed to fetch onboarding data. Please try again.');
  }
}

/* ------------------------------------------------------------------ */
/*  POST /api/onboarding  — employee submits onboarding form           */
/*  Body: { responses, documents, config_version }                     */
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

    const body = await request.json();

    const { responses, documents, config_version } = body as {
      responses: Record<string, string>;
      documents: Array<{ fieldId: string; label: string; url: string; fileName: string; docId?: string }>;
      config_version: number;
    };

    // Upsert onboarding submission
    const { data, error } = await db
      .from('onboarding_submissions')
      .upsert({
        employee_id: user.uid,
        config_version,
        responses,
        documents,
        status: 'submitted',
        submitted_at: new Date().toISOString(),
      }, { onConflict: 'employee_id' })
      .select()
      .single();

    if (error) throw error;

    // Update employee onboarding status to in_progress (submitted, awaiting review)
    await db
      .from('employees')
      .update({ onboarding_status: 'in_progress' })
      .eq('id', user.uid);

    logAudit({
      performed_by: user.uid,
      action: 'create',
      target_employee: user.uid,
      details: 'Submitted onboarding form',
      ip_address: getClientIp(request),
      after_data: data,
    });

    return NextResponse.json({ success: true, data: { submission: data } }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'Failed to submit onboarding. Please try again.');
  }
}

/* ------------------------------------------------------------------ */
/*  PATCH /api/onboarding  — admin approves onboarding                 */
/*  Body: { employee_id, department_id, responses? }                      */
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

    const body = await request.json();
    const { employee_id, department_id, action, notes, flagged_fields } = body as {
      employee_id: string;
      department_id: string;
      action?: 'approve' | 'reject';
      notes?: string;
      /** Field ids the admin flagged for correction (field-level rejection). */
      flagged_fields?: string[];
    };

    if (!employee_id) {
      return NextResponse.json({ success: false, error: 'Missing employee_id' }, { status: 400 });
    }

    // ---- Reject path: send the submission back to the employee to fix ----
    if (action === 'reject') {
      const { data: sub } = await db
        .from('onboarding_submissions')
        .select('id')
        .eq('employee_id', employee_id)
        .maybeSingle();

      if (!sub?.id) {
        return NextResponse.json(
          { success: false, error: 'No onboarding submission found for this employee.' },
          { status: 404 },
        );
      }

      // Put the employee back into the editable onboarding state; record why.
      await db
        .from('employees')
        .update({ onboarding_status: 'pending' })
        .eq('id', employee_id);

      // Field-level rejection: when the admin flags specific fields, encode
      // them together with the note as JSON in admin_notes (no schema change;
      // plain-text notes from older rejections remain readable - the client
      // falls back to treating admin_notes as free text if JSON.parse fails).
      const cleanNote = (notes ?? '').trim();
      const flags = Array.isArray(flagged_fields)
        ? flagged_fields.filter((f): f is string => typeof f === 'string' && f.length > 0).slice(0, 100)
        : [];
      const adminNotes =
        flags.length > 0
          ? JSON.stringify({ note: cleanNote || null, flagged_fields: flags })
          : cleanNote || null;

      await db
        .from('onboarding_submissions')
        .update({
          status: 'rejected',
          admin_notes: adminNotes,
          reviewed_by: admin.uid,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', sub.id);

      logAudit({
        performed_by: admin.uid,
        action: 'reject',
        target_employee: employee_id,
        details: `Rejected onboarding${cleanNote ? `: ${cleanNote}` : ''}${flags.length ? ` (flagged: ${flags.join(', ')})` : ''}`,
        ip_address: getClientIp(request),
      });

      return NextResponse.json({ success: true, data: { message: 'Onboarding rejected' } });
    }

    // ---- Approve path (default) ----
    // Fetch submission
    const { data: sub } = await db
      .from('onboarding_submissions')
      .select('*')
      .eq('employee_id', employee_id)
      .maybeSingle();

    // department_id must be a UUID FK; reject anything else (e.g. a name)
    // with a clear 400 instead of leaking a raw Postgres uuid syntax error.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (department_id && !UUID_RE.test(department_id)) {
      return NextResponse.json(
        { success: false, error: 'Invalid department selection. Please pick a department from the list.' },
        { status: 400 },
      );
    }

    const updatePayload: Record<string, unknown> = {
      onboarding_status: 'completed',
      department_id: department_id || undefined,
    };
    const customFields: Record<string, string> = {};

    if (sub?.responses) {
      const r = sub.responses as Record<string, string>;

      for (const [fieldId, value] of Object.entries(r)) {
        if (!value || fieldId.startsWith('_')) continue;
        if (FILE_UPLOAD_FIELDS.has(fieldId)) continue;

        if (isKnownField(fieldId)) {
          const col = FIELD_TO_COLUMN[fieldId];
          if (col.startsWith('bank_details.')) continue;
          updatePayload[col] = value;
        } else {
          customFields[fieldId] = value;
        }
      }

      // Bank details
      if (r.bank_name || r.account_number || r.ifsc_code || r.account_type) {
        updatePayload.bank_details = {
          bankName: r.bank_name ?? '',
          accountNumber: r.account_number ?? '',
          ifsc: r.ifsc_code ?? '',
          accountType: r.account_type ?? '',
        };
      }

      // Merge custom fields
      if (Object.keys(customFields).length > 0) {
        const { data: existing } = await db
          .from('employees')
          .select('custom_fields')
          .eq('id', employee_id)
          .single();
        updatePayload.custom_fields = {
          ...((existing?.custom_fields as Record<string, string>) ?? {}),
          ...customFields,
        };
      }
    }

    // Update employee
    const { error: updateError } = await db
      .from('employees')
      .update(updatePayload)
      .eq('id', employee_id);
    if (updateError) throw updateError;

    // Update submission status
    if (sub?.id) {
      await db.from('onboarding_submissions').update({
        status: 'approved',
        reviewed_by: admin.uid,
        reviewed_at: new Date().toISOString(),
      }).eq('id', sub.id);
    }

    logAudit({
      performed_by: admin.uid,
      action: 'approve',
      target_employee: employee_id,
      details: 'Approved onboarding',
      ip_address: getClientIp(request),
      after_data: updatePayload,
    });

    return NextResponse.json({ success: true, data: { message: 'Onboarding approved' } });
  } catch (error) {
    return errorResponse(error, 'Failed to approve onboarding. Please try again.');
  }
}
