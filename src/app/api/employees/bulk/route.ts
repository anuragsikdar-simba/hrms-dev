import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-helpers';
import { logAudit, getClientIp } from '@/lib/audit';
import { rateLimiters } from '@/lib/rate-limit';
import { errorResponse } from '@/lib/api-errors';
import {
  validateRow,
  provisionEmployee,
  type RawEmployeeRow,
  type NormalisedRow,
} from '@/lib/employee-provision';

/* ------------------------------------------------------------------ */
/*  POST /api/employees/bulk   (admin only)                            */
/*                                                                     */
/*  Body: { rows: RawEmployeeRow[], validateOnly?: boolean }           */
/*                                                                     */
/*  - validateOnly:true  -> dry run. Validates every row against the   */
/*    live DB (existing departments, duplicate email/ID) and against   */
/*    duplicates *within the file*, returning a per-row report. No      */
/*    writes happen.                                                   */
/*  - validateOnly:false -> creates each row server-side: creates any   */
/*    genuinely-new department exactly once, then provisions each       */
/*    employee (auth login + row) and returns a per-row result with     */
/*    temp passwords plus a summary.                                   */
/* ------------------------------------------------------------------ */

const MAX_ROWS = 500;

interface RowReport {
  line: number; // 1-based index in the submitted array
  name: string;
  email: string;
  status: 'ok' | 'created' | 'skipped' | 'error';
  errors: string[];
  warnings: string[];
  /** Resolved department disposition for the review UI. */
  department?: { name: string; action: 'matched' | 'create' | 'none' };
  message?: string;
  tempPassword?: string;
  employeeId?: string;
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin();
    const db = admin.supabase;

    // One rate-limit token covers the whole batch (it's a single request).
    const rl = rateLimiters.mutation(admin.uid);
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Try again shortly.' },
        { status: 429 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const validateOnly = body?.validateOnly === true;
    const rows: RawEmployeeRow[] = Array.isArray(body?.rows) ? body.rows : [];

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'No rows provided.' }, { status: 400 });
    }
    if (rows.length > MAX_ROWS) {
      return NextResponse.json(
        { success: false, error: `Too many rows. Import at most ${MAX_ROWS} at a time.` },
        { status: 400 },
      );
    }

    /* ---- Load live DB context once (RLS-scoped) ---- */

    const { data: deptRows } = await db.from('departments').select('id, name');
    const deptByName = new Map<string, { id: string; name: string }>();
    for (const d of deptRows ?? []) deptByName.set(d.name.trim().toLowerCase(), d);

    const { data: existing } = await db.from('employees').select('email, employee_id');
    const existingEmails = new Set((existing ?? []).map((e) => (e.email ?? '').toLowerCase()));
    const existingIds = new Set((existing ?? []).map((e) => e.employee_id).filter(Boolean));

    /* ---- Per-row validation (DB-aware) + in-file dedup ---- */

    const seenEmails = new Map<string, number>(); // email -> first line
    const seenIds = new Map<string, number>();

    const validated: { line: number; norm: NormalisedRow; report: RowReport }[] = [];

    rows.forEach((raw, i) => {
      const line = i + 1;
      const { errors, warnings, normalised } = validateRow(raw);

      // Duplicate email: DB or earlier-in-file.
      if (normalised.email) {
        if (existingEmails.has(normalised.email)) {
          errors.push('email already exists in the system');
        } else if (seenEmails.has(normalised.email)) {
          errors.push(`duplicate email (also on row ${seenEmails.get(normalised.email)})`);
        } else {
          seenEmails.set(normalised.email, line);
        }
      }

      // Duplicate explicit employee_id: DB or earlier-in-file.
      if (normalised.employee_id) {
        if (existingIds.has(normalised.employee_id)) {
          errors.push('employee_id already exists in the system');
        } else if (seenIds.has(normalised.employee_id)) {
          errors.push(`duplicate employee_id (also on row ${seenIds.get(normalised.employee_id)})`);
        } else {
          seenIds.set(normalised.employee_id, line);
        }
      }

      // Department disposition (matched existing / would create / none).
      let department: RowReport['department'];
      if (!normalised.department) {
        department = { name: '', action: 'none' };
      } else if (deptByName.has(normalised.department.toLowerCase())) {
        department = { name: deptByName.get(normalised.department.toLowerCase())!.name, action: 'matched' };
      } else {
        department = { name: normalised.department, action: 'create' };
      }

      validated.push({
        line,
        norm: normalised,
        report: {
          line,
          name: normalised.name,
          email: normalised.email,
          status: errors.length > 0 ? 'error' : 'ok',
          errors,
          warnings,
          department,
        },
      });
    });

    /* ---- VALIDATE-ONLY: return the report, no writes ---- */

    if (validateOnly) {
      const reports = validated.map((v) => v.report);
      return NextResponse.json({
        success: true,
        data: {
          rows: reports,
          summary: {
            total: reports.length,
            valid: reports.filter((r) => r.status === 'ok').length,
            invalid: reports.filter((r) => r.status === 'error').length,
            newDepartments: [
              ...new Set(
                reports
                  .filter((r) => r.department?.action === 'create')
                  .map((r) => r.department!.name.toLowerCase()),
              ),
            ].length,
          },
        },
      });
    }

    /* ---- COMMIT: refuse if ANY row is invalid (all-or-clean) ---- */

    const invalid = validated.filter((v) => v.report.errors.length > 0);
    if (invalid.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `${invalid.length} row(s) have validation errors. Fix them and try again.`,
          data: { rows: validated.map((v) => v.report) },
        },
        { status: 400 },
      );
    }

    /* ---- Create new departments exactly once (deduped) ---- */

    const deptIdByName = new Map<string, string>();
    for (const [key, val] of deptByName) deptIdByName.set(key, val.id);

    const toCreate = [
      ...new Set(
        validated
          .filter((v) => v.norm.department && !deptIdByName.has(v.norm.department.toLowerCase()))
          .map((v) => v.norm.department.trim()),
      ),
    ];
    for (const name of toCreate) {
      const key = name.toLowerCase();
      if (deptIdByName.has(key)) continue;
      const { data: dept, error: dErr } = await db
        .from('departments')
        .insert({ name })
        .select('id, name')
        .single();
      if (dErr || !dept) {
        // If it raced into existence, re-read it; otherwise surface the error.
        const { data: again } = await db
          .from('departments')
          .select('id')
          .ilike('name', name)
          .maybeSingle();
        if (again?.id) deptIdByName.set(key, again.id);
        else {
          return errorResponse(dErr, `Could not create department "${name}".`);
        }
      } else {
        deptIdByName.set(key, dept.id);
      }
    }

    /* ---- Provision each employee ---- */

    const results: RowReport[] = [];
    let created = 0;
    let skipped = 0;
    let failed = 0;

    for (const v of validated) {
      const deptId = v.norm.department
        ? deptIdByName.get(v.norm.department.toLowerCase()) ?? null
        : null;

      const outcome = await provisionEmployee(db, v.norm, deptId);
      const rep: RowReport = {
        line: v.line,
        name: v.norm.name,
        email: v.norm.email,
        status: outcome.status,
        errors: [],
        warnings: v.report.warnings,
        message: outcome.message,
      };
      if (outcome.status === 'created') {
        created++;
        rep.tempPassword = outcome.tempPassword;
        rep.employeeId = (outcome.employee as { employee_id?: string })?.employee_id;
      } else if (outcome.status === 'skipped') {
        skipped++;
      } else {
        failed++;
      }
      results.push(rep);
    }

    logAudit({
      performed_by: admin.uid,
      action: 'create',
      details: `Bulk import: ${created} created, ${skipped} skipped, ${failed} failed (of ${rows.length})`,
      ip_address: getClientIp(request),
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          rows: results,
          summary: { total: rows.length, created, skipped, failed },
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, 'Bulk import failed. Please try again.');
  }
}
