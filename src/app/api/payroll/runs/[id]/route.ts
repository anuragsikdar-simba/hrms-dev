import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, requireAdmin } from '@/lib/auth-helpers';
import { logAudit, getClientIp } from '@/lib/audit';
import { rateLimiters } from '@/lib/rate-limit';
import { errorResponse } from '@/lib/api-errors';
import type { PayrollRunStatus, PayslipRow } from '@/types';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * The one-way run lifecycle (§8.1), enforced here on the SERVER — the UI
 * hiding a button is not enforcement.
 *
 *   draft  -> locked     (figures frozen; payslips become immutable)
 *   locked -> published  (employees can now read their own payslip)
 *   published -> nothing (corrections go out as an adjustment in a later run)
 *
 * Everything else — re-entering a state, going backwards, or skipping the lock
 * — is rejected with 409.
 */
const NEXT_STATUS: Record<PayrollRunStatus, PayrollRunStatus | null> = {
  draft: 'locked',
  locked: 'published',
  published: null,
};

/* ------------------------------------------------------------------ */
/*  GET /api/payroll/runs/[id]                                         */
/*  Admin: the run and every payslip. Employee: only a PUBLISHED run,   */
/*  and only their own payslip inside it (§8.1).                        */
/* ------------------------------------------------------------------ */

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const user = await verifyAuth();
    const db = user.supabase;
    const { id } = await params;

    const runRes = await db.from('payroll_runs').select('*').eq('id', id).maybeSingle();
    if (runRes.error) throw runRes.error;
    if (!runRes.data) {
      return NextResponse.json({ success: false, error: 'Payroll run not found' }, { status: 404 });
    }

    const isAdmin = user.role === 'admin';
    if (!isAdmin && runRes.data.status !== 'published') {
      return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });
    }

    let query = db
      .from('payslips')
      .select('*, employees!payslips_employee_id_fkey(name, employee_id, email)')
      .eq('payroll_run_id', id);
    if (!isAdmin) query = query.eq('employee_id', user.uid);

    const payslipRes = await query;
    if (payslipRes.error) throw payslipRes.error;

    // PostgREST cannot order parent rows by an embedded column, so the
    // employee-name ordering is applied here.
    const payslips: PayslipRow[] = payslipRes.data ?? [];
    payslips.sort((a, b) => (a.employees?.name ?? '').localeCompare(b.employees?.name ?? ''));

    return NextResponse.json({ success: true, data: { run: runRes.data, payslips } });
  } catch (error) {
    return errorResponse(error, 'Failed to load the payroll run. Please try again.');
  }
}

/* ------------------------------------------------------------------ */
/*  PATCH /api/payroll/runs/[id]                                       */
/*  Body: { status: 'locked' | 'published' } — one-way, audited.       */
/* ------------------------------------------------------------------ */

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
    const body: unknown = await request.json();
    const payload = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const target = payload.status;

    if (target !== 'locked' && target !== 'published') {
      return NextResponse.json(
        { success: false, error: "status must be 'locked' or 'published'" },
        { status: 400 },
      );
    }

    const runRes = await db.from('payroll_runs').select('*').eq('id', id).maybeSingle();
    if (runRes.error) throw runRes.error;
    if (!runRes.data) {
      return NextResponse.json({ success: false, error: 'Payroll run not found' }, { status: 404 });
    }

    const current: PayrollRunStatus = runRes.data.status;
    const allowed = NEXT_STATUS[current];
    if (allowed !== target) {
      return NextResponse.json(
        {
          success: false,
          error: allowed
            ? `Cannot move a ${current} run to ${target}. The only legal next step is ${current} -> ${allowed}.`
            : `This run is already published and is final. Issue corrections as an adjustment in a later run.`,
        },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const update: Record<string, unknown> = { status: target, updated_at: now };
    if (target === 'locked') {
      update.locked_by = admin.uid;
      update.locked_at = now;
    } else {
      update.published_at = now;
    }

    const saved = await db.from('payroll_runs').update(update).eq('id', id).select().single();
    if (saved.error) throw saved.error;

    let notified = 0;
    if (target === 'published') {
      // §1: there is no mail provider — this in-app notification is the ONLY
      // delivery. Publish first, then notify, so the payslip is already
      // readable when the employee follows the link.
      const recipients = await db.from('payslips').select('employee_id').eq('payroll_run_id', id);
      if (recipients.error) throw recipients.error;

      const period = new Date(
        Date.UTC(runRes.data.period_year, runRes.data.period_month - 1, 1),
      ).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

      const rows = (recipients.data ?? []).map((row) => ({
        employee_id: row.employee_id,
        title: 'Payslip available',
        message: `Your payslip for ${period} is ready to download.`,
        type: 'info',
        actionable: true,
        action_url: '/payslips',
      }));

      if (rows.length > 0) {
        const inserted = await db.from('notifications').insert(rows);
        // The run IS published; a notification failure must not undo that, but
        // it is the only delivery channel so it must never pass unnoticed.
        if (inserted.error) console.error('[payroll] Publish notifications failed:', inserted.error.message);
        else notified = rows.length;
      }
    }

    logAudit({
      performed_by: admin.uid,
      action: 'update',
      details:
        target === 'published'
          ? `Published payroll run ${runRes.data.period_year}-${String(runRes.data.period_month).padStart(2, '0')} (${notified} employee(s) notified)`
          : `Locked payroll run ${runRes.data.period_year}-${String(runRes.data.period_month).padStart(2, '0')}`,
      ip_address: getClientIp(request),
      before_data: runRes.data,
      after_data: saved.data,
    });

    return NextResponse.json({ success: true, data: { run: saved.data } });
  } catch (error) {
    return errorResponse(error, 'Failed to update the payroll run. Please try again.');
  }
}

/* ------------------------------------------------------------------ */
/*  DELETE /api/payroll/runs/[id]                                      */
/*  Only a draft may be discarded; its payslips cascade.               */
/* ------------------------------------------------------------------ */

export async function DELETE(request: NextRequest, { params }: RouteParams) {
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

    const runRes = await db.from('payroll_runs').select('*').eq('id', id).maybeSingle();
    if (runRes.error) throw runRes.error;
    if (!runRes.data) {
      return NextResponse.json({ success: false, error: 'Payroll run not found' }, { status: 404 });
    }

    const current: PayrollRunStatus = runRes.data.status;
    if (current !== 'draft') {
      return NextResponse.json(
        {
          success: false,
          error: `A ${current} payroll run cannot be deleted. Only a draft can be discarded.`,
        },
        { status: 409 },
      );
    }

    const removed = await db.from('payroll_runs').delete().eq('id', id);
    if (removed.error) throw removed.error;

    logAudit({
      performed_by: admin.uid,
      action: 'delete',
      details: `Deleted draft payroll run ${runRes.data.period_year}-${String(runRes.data.period_month).padStart(2, '0')}`,
      ip_address: getClientIp(request),
      before_data: runRes.data,
    });

    return NextResponse.json({ success: true, data: { deleted: true } });
  } catch (error) {
    return errorResponse(error, 'Failed to delete the payroll run. Please try again.');
  }
}
