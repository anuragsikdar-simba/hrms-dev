import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, supabaseAdmin } from '@/lib/auth-helpers';
import { logAudit, getClientIp } from '@/lib/audit';
import { errorResponse } from '@/lib/api-errors';
import { DOCUMENTS_BUCKET, getDocumentUrl } from '@/lib/documents';
import { renderPayslipPdf } from '@/lib/payslip-pdf';
import type { PayslipRow } from '@/types';

type RouteParams = { params: Promise<{ id: string }> };

const PAYSLIP_SELECT =
  '*, employees!payslips_employee_id_fkey(name, employee_id, email), payroll_runs!inner(status)';

/* ------------------------------------------------------------------ */
/*  GET /api/payroll/payslips/[id]                                     */
/*  One payslip plus a short-lived signed URL for its PDF.             */
/*                                                                     */
/*  Authorisation (BUSINESS_RULES §8.1):                               */
/*    admin                                  -> any payslip, any run   */
/*    employee, own payslip, run published   -> allowed                */
/*    employee, own payslip, draft/locked    -> 403                    */
/*    employee, someone else's payslip       -> 403, no data in body   */
/*                                                                     */
/*  RLS already enforces this; the route enforces it again and, when   */
/*  the RLS read comes back empty, probes with the service-role client */
/*  purely to answer 403-vs-404. A denial never carries payslip data.  */
/* ------------------------------------------------------------------ */

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await verifyAuth();
    const db = user.supabase;
    const { id } = await params;

    const { data: row } = await db
      .from('payslips')
      .select(PAYSLIP_SELECT)
      .eq('id', id)
      .maybeSingle();

    if (!row) {
      // Distinguish "does not exist" from "not yours / not published yet"
      // without returning any of the row's figures.
      const { data: probe } = await supabaseAdmin
        .from('payslips')
        .select('id')
        .eq('id', id)
        .maybeSingle();
      if (!probe) {
        return NextResponse.json({ success: false, error: 'Payslip not found' }, { status: 404 });
      }
      return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });
    }

    const payslip = row as PayslipRow;
    const runStatus = payslip.payroll_runs?.status ?? null;
    const isAdmin = user.role === 'admin';

    if (!isAdmin && (payslip.employee_id !== user.uid || runStatus !== 'published')) {
      return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });
    }

    // ---- PDF: generate once on first request, then always reuse ---------
    let pdfPath = payslip.pdf_path;

    if (!pdfPath && runStatus === 'published') {
      // The employee context is read from the payslip's frozen snapshot so an
      // old payslip keeps printing the details it was issued with (§8.1).
      const snapshot = payslip.snapshot ?? {};
      const snapText = (key: string): string | null => {
        const value = snapshot[key];
        return typeof value === 'string' && value.trim().length > 0 ? value : null;
      };

      const bytes = await renderPayslipPdf({
        payslip,
        employee: {
          name: snapText('name') ?? payslip.employees?.name ?? '',
          employeeCode: snapText('employee_code') ?? payslip.employees?.employee_id ?? '',
          designation: snapText('designation'),
          department: snapText('department'),
          pan: snapText('pan'),
          bankName: snapText('bank_name'),
          bankLast4: snapText('bank_last4'),
        },
      });

      const month = String(payslip.period_month).padStart(2, '0');
      const path = `payslips/${payslip.employee_id}/${payslip.period_year}-${month}.pdf`;

      // Service-role from here on: the `documents` bucket is private and the
      // payslips UPDATE policy is admin-only, yet the owner of the payslip is
      // usually not an admin. Ownership was verified above, so this escalation
      // is the pattern BUSINESS_RULES §1 permits — verify first, then escalate.
      const { error: uploadErr } = await supabaseAdmin.storage
        .from(DOCUMENTS_BUCKET)
        .upload(path, bytes, { contentType: 'application/pdf', upsert: true });
      if (uploadErr) throw uploadErr;

      // Only the PDF pointer is written; the money columns stay untouched.
      const { error: updateErr } = await supabaseAdmin
        .from('payslips')
        .update({ pdf_path: path, updated_at: new Date().toISOString() })
        .eq('id', payslip.id);
      if (updateErr) throw updateErr;

      payslip.pdf_path = path;
      pdfPath = path;
    }

    const downloadUrl = pdfPath ? await getDocumentUrl(db, pdfPath) : null;

    if (downloadUrl) {
      logAudit({
        performed_by: user.uid,
        action: 'view',
        target_employee: payslip.employee_id,
        details: `Downloaded payslip ${payslip.period_year}-${String(payslip.period_month).padStart(2, '0')}`,
        ip_address: getClientIp(request),
      });
    }

    return NextResponse.json({ success: true, data: { payslip, downloadUrl } });
  } catch (error) {
    return errorResponse(error, 'Failed to load payslip. Please try again.');
  }
}
