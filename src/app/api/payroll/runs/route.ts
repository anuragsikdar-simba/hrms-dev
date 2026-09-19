import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-helpers';
import { logAudit, getClientIp } from '@/lib/audit';
import { rateLimiters } from '@/lib/rate-limit';
import { errorResponse } from '@/lib/api-errors';
import { businessDate } from '@/lib/dates';
import { deriveLopForPeriod } from '@/lib/payroll-lop';
import {
  computeLopDays,
  computePayslip,
  daysInMonth,
  periodEndDate,
  resolveStructureFor,
  roundRupee,
} from '@/lib/payroll';
import type { PtSlab, StatutorySettings, StructureItem } from '@/lib/payroll';
import type { PayslipLineRow, SalaryComponentCalc } from '@/types';

/* ------------------------------------------------------------------ */
/*  Row shapes                                                         */
/* ------------------------------------------------------------------ */

interface SettingRow {
  key: string;
  value: unknown;
}

interface EmployeeRow {
  id: string;
  employee_id: string;
  name: string;
  designation: string | null;
  pan: string | null;
  bank_details: { bankName?: string | null; accountNumber?: string | null } | null;
  /** Supabase embeds a to-one join as an object; tolerate an array too. */
  department: { name: string | null } | { name: string | null }[] | null;
}

interface StructureItemRow {
  component_key: string;
  calc: SalaryComponentCalc;
  amount: number | string | null;
  percent: number | string | null;
}

interface StructureRow {
  id: string;
  employee_id: string;
  effective_from: string;
  monthly_gross: number | string;
  items: StructureItemRow[] | null;
}

/** `resolveStructureFor` keys on `effectiveFrom`; carry the row alongside. */
interface DatedStructure {
  effectiveFrom: string;
  row: StructureRow;
}

interface PayslipTotalsRow {
  gross: number | string;
  total_deductions: number | string;
  net_pay: number | string;
}

/* ------------------------------------------------------------------ */
/*  Settings mapping                                                   */
/* ------------------------------------------------------------------ */

function readNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Map the snake_case `payroll_settings` JSON onto the camelCase settings the
 * engine expects. A missing row means the deduction is OFF — never guess a
 * statutory rate (§8.3: every rate is configuration, not a magic number).
 */
function toStatutorySettings(rows: SettingRow[]): StatutorySettings {
  const byKey: Record<string, Record<string, unknown>> = {};
  for (const row of rows) {
    if (row.value && typeof row.value === 'object' && !Array.isArray(row.value)) {
      byKey[row.key] = row.value as Record<string, unknown>;
    }
  }

  const pf = byKey.pf;
  const esi = byKey.esi;
  const pt = byKey.pt;

  const rawSlabs: unknown[] = pt && Array.isArray(pt.slabs) ? pt.slabs : [];
  const slabs: PtSlab[] = [];
  for (const entry of rawSlabs) {
    if (!entry || typeof entry !== 'object') continue;
    const slab = entry as Record<string, unknown>;
    slabs.push({
      upto: slab.upto == null ? null : readNumber(slab.upto, 0),
      amount: readNumber(slab.amount, 0),
    });
  }

  return {
    pf: {
      enabled: pf?.enabled === true,
      employeePercent: readNumber(pf?.employee_percent, 0),
      wageCeiling: readNumber(pf?.wage_ceiling, 0),
      applyCeiling: pf?.apply_ceiling === true,
    },
    esi: {
      enabled: esi?.enabled === true,
      employeePercent: readNumber(esi?.employee_percent, 0),
      grossLimit: readNumber(esi?.gross_limit, 0),
    },
    pt: {
      enabled: pt?.enabled === true && slabs.length > 0,
      slabs,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  GET /api/payroll/runs                                              */
/*  All runs, newest period first (admin only — drafts hold            */
/*  mid-calculation figures staff must never see, §8.1).               */
/* ------------------------------------------------------------------ */

export async function GET() {
  try {
    const admin = await requireAdmin();

    const { data, error } = await admin.supabase
      .from('payroll_runs')
      .select('*')
      .order('period_year', { ascending: false })
      .order('period_month', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ success: true, data: { runs: data ?? [] } });
  } catch (error) {
    return errorResponse(error, 'Failed to load payroll runs. Please try again.');
  }
}

/* ------------------------------------------------------------------ */
/*  POST /api/payroll/runs                                             */
/*  Body: { period_year, period_month } -> computes the DRAFT.         */
/*  Re-running a draft recomputes it from current attendance/salary    */
/*  data; a locked or published run is never recomputed (§8.1).        */
/* ------------------------------------------------------------------ */

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin();
    const db = admin.supabase;

    if (!rateLimiters.mutation(admin.uid).allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Try again shortly.' },
        { status: 429 },
      );
    }

    const body: unknown = await request.json();
    const payload = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const periodYear = Number(payload.period_year);
    const periodMonth = Number(payload.period_month);

    if (!Number.isInteger(periodYear) || periodYear < 2000 || periodYear > 2100) {
      return NextResponse.json({ success: false, error: 'period_year is invalid' }, { status: 400 });
    }
    if (!Number.isInteger(periodMonth) || periodMonth < 1 || periodMonth > 12) {
      return NextResponse.json(
        { success: false, error: 'period_month must be between 1 and 12' },
        { status: 400 },
      );
    }

    const periodStart = `${periodYear}-${String(periodMonth).padStart(2, '0')}-01`;
    const periodEnd = periodEndDate(periodYear, periodMonth);
    // "Today" is the IST business day (§1) — never the server's UTC day.
    if (periodStart > businessDate()) {
      return NextResponse.json(
        { success: false, error: 'That payroll period has not started yet.' },
        { status: 400 },
      );
    }

    /* -- 1. Existing run for the period ---------------------------- */

    const existingRes = await db
      .from('payroll_runs')
      .select('*')
      .eq('period_year', periodYear)
      .eq('period_month', periodMonth)
      .maybeSingle();
    if (existingRes.error) throw existingRes.error;

    const existingRun = existingRes.data;
    if (existingRun && existingRun.status !== 'draft') {
      return NextResponse.json(
        {
          success: false,
          error: `This payroll run is ${existingRun.status} and can no longer be recomputed. Issue corrections as an adjustment in a later run.`,
        },
        { status: 409 },
      );
    }

    // An admin who typed a TDS figure must not lose it when the draft is
    // recomputed to pick up corrected attendance.
    const preservedTds: Record<string, number> = {};
    if (existingRun) {
      const priorRes = await db
        .from('payslips')
        .select('employee_id, tds_override')
        .eq('payroll_run_id', existingRun.id);
      if (priorRes.error) throw priorRes.error;

      for (const row of priorRes.data ?? []) {
        if (row.tds_override != null) preservedTds[row.employee_id] = Number(row.tds_override);
      }

      const wipeRes = await db.from('payslips').delete().eq('payroll_run_id', existingRun.id);
      if (wipeRes.error) throw wipeRes.error;
    }

    /* -- 2. Source data (batched) ---------------------------------- */

    const employeesRes = await db
      .from('employees')
      .select(
        'id, employee_id, name, designation, pan, bank_details, department:departments!employees_department_id_fkey(name)',
      )
      .eq('status', 'active')
      .order('name', { ascending: true });
    if (employeesRes.error) throw employeesRes.error;

    const employees: EmployeeRow[] = employeesRes.data ?? [];
    const employeeIds = employees.map((e) => e.id);

    const emptyStructures: { data: StructureRow[]; error: null } = { data: [], error: null };
    const [structuresRes, componentsRes, settingsRes] = await Promise.all([
      // An `in` filter on an empty list is not worth sending at all.
      employeeIds.length > 0
        ? db
            .from('salary_structures')
            .select('id, employee_id, effective_from, monthly_gross, items:salary_structure_items(component_key, calc, amount, percent)')
            .in('employee_id', employeeIds)
            .lte('effective_from', periodEnd)
        : emptyStructures,
      db.from('salary_components').select('key, name'),
      db.from('payroll_settings').select('key, value'),
    ]);
    if (structuresRes.error) throw structuresRes.error;
    if (componentsRes.error) throw componentsRes.error;
    if (settingsRes.error) throw settingsRes.error;

    const structuresByEmployee: Record<string, DatedStructure[]> = {};
    const structureRows: StructureRow[] = structuresRes.data ?? [];
    for (const row of structureRows) {
      const list = structuresByEmployee[row.employee_id];
      const dated: DatedStructure = { effectiveFrom: row.effective_from, row };
      if (list) list.push(dated);
      else structuresByEmployee[row.employee_id] = [dated];
    }

    const labels: Record<string, string> = {};
    for (const component of componentsRes.data ?? []) labels[component.key] = component.name;

    const statutory = toStatutorySettings(settingsRes.data ?? []);
    const lopByEmployee = await deriveLopForPeriod(db, employeeIds, periodYear, periodMonth);
    const totalDays = daysInMonth(periodYear, periodMonth);

    /* -- 3. The run row -------------------------------------------- */

    let run = existingRun;
    if (!run) {
      const created = await db
        .from('payroll_runs')
        .insert({
          period_year: periodYear,
          period_month: periodMonth,
          status: 'draft',
          created_by: admin.uid,
        })
        .select()
        .single();
      if (created.error) throw created.error;
      run = created.data;
    }

    /* -- 4. Compute every payslip ---------------------------------- */

    const skipped: { name: string; reason: string }[] = [];
    const rows: Record<string, unknown>[] = [];
    let totalGross = 0;
    let totalDeductions = 0;
    let totalNet = 0;

    for (const employee of employees) {
      const structure = resolveStructureFor(
        structuresByEmployee[employee.id] ?? [],
        periodYear,
        periodMonth,
      );
      // Never pay someone zero because nobody set their salary up.
      if (!structure) {
        skipped.push({ name: employee.name, reason: 'No salary structure' });
        continue;
      }

      const items: StructureItem[] = (structure.row.items ?? []).map((item) => ({
        componentKey: item.component_key,
        calc: item.calc,
        amount: item.amount == null ? null : Number(item.amount),
        percent: item.percent == null ? null : Number(item.percent),
      }));

      const lopInput = lopByEmployee[employee.id] ?? {
        unpaidLeaveDays: 0,
        unexcusedAbsentDays: 0,
        halfDays: 0,
      };
      const tdsOverride = preservedTds[employee.id] ?? null;

      const result = computePayslip({
        periodYear,
        periodMonth,
        monthlyGross: Number(structure.row.monthly_gross),
        items,
        labels,
        lopDays: computeLopDays(lopInput, totalDays),
        statutory,
        tdsOverride,
      });

      const account = employee.bank_details?.accountNumber ?? '';
      const department = Array.isArray(employee.department)
        ? employee.department[0]?.name ?? null
        : employee.department?.name ?? null;

      totalGross += result.gross;
      totalDeductions += result.totalDeductions;
      totalNet += result.netPay;

      rows.push({
        payroll_run_id: run.id,
        employee_id: employee.id,
        structure_id: structure.row.id,
        period_year: periodYear,
        period_month: periodMonth,
        days_in_month: result.daysInMonth,
        lop_days: result.lopDays,
        paid_days: result.paidDays,
        earnings: result.earnings,
        deductions: result.deductions,
        gross: result.gross,
        total_deductions: result.totalDeductions,
        net_pay: result.netPay,
        tds_override: tdsOverride,
        // Frozen context so the payslip renders identically years later (§8.1).
        // Only the last 4 digits of the account are kept — a payslip must never
        // carry the full number.
        snapshot: {
          name: employee.name,
          employee_code: employee.employee_id,
          designation: employee.designation,
          department,
          pan: employee.pan,
          bank_name: employee.bank_details?.bankName ?? null,
          bank_last4: account.length >= 4 ? account.slice(-4) : null,
          monthly_gross: Number(structure.row.monthly_gross),
          statutory,
        },
      });
    }

    let payslips: unknown[] = [];
    if (rows.length > 0) {
      const inserted = await db.from('payslips').insert(rows).select();
      if (inserted.error) throw inserted.error;
      payslips = inserted.data ?? [];
    }

    const updated = await db
      .from('payroll_runs')
      .update({
        total_gross: totalGross,
        total_deductions: totalDeductions,
        total_net: totalNet,
        employee_count: rows.length,
        updated_at: new Date().toISOString(),
      })
      .eq('id', run.id)
      .select()
      .single();
    if (updated.error) throw updated.error;

    logAudit({
      performed_by: admin.uid,
      action: existingRun ? 'update' : 'create',
      details: `${existingRun ? 'Recomputed' : 'Created'} payroll draft ${periodYear}-${String(periodMonth).padStart(2, '0')}: ${rows.length} payslip(s), ${skipped.length} skipped`,
      ip_address: getClientIp(request),
      before_data: existingRun ?? null,
      after_data: updated.data,
    });

    return NextResponse.json(
      { success: true, data: { run: updated.data, payslips, skipped } },
      { status: existingRun ? 200 : 201 },
    );
  } catch (error) {
    return errorResponse(error, 'Failed to compute the payroll run. Please try again.');
  }
}

/* ------------------------------------------------------------------ */
/*  PATCH /api/payroll/runs                                            */
/*  Body: { payslip_id, tds_override } — manual TDS (§8.3, no tax      */
/*  engine). Allowed only while the run is still a draft.              */
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

    const body: unknown = await request.json();
    const payload = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const payslipId = payload.payslip_id;
    if (typeof payslipId !== 'string' || payslipId.length === 0) {
      return NextResponse.json({ success: false, error: 'payslip_id is required' }, { status: 400 });
    }

    const raw = payload.tds_override;
    let tds: number | null = null;
    if (raw != null && raw !== '') {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return NextResponse.json(
          { success: false, error: 'tds_override must be zero or a positive amount' },
          { status: 400 },
        );
      }
      tds = roundRupee(parsed);
    }

    const current = await db
      .from('payslips')
      .select('*, payroll_runs!payslips_payroll_run_id_fkey(status)')
      .eq('id', payslipId)
      .maybeSingle();
    if (current.error) throw current.error;
    if (!current.data) {
      return NextResponse.json({ success: false, error: 'Payslip not found' }, { status: 404 });
    }

    const joined = current.data.payroll_runs;
    const runStatus: string | null = Array.isArray(joined)
      ? joined[0]?.status ?? null
      : joined?.status ?? null;
    if (runStatus !== 'draft') {
      return NextResponse.json(
        {
          success: false,
          error: `This payslip belongs to a ${runStatus ?? 'finalised'} run and is immutable. Issue a correction in a later run.`,
        },
        { status: 409 },
      );
    }

    // Rebuild the deduction lines the way the engine does: TDS is the last
    // line and a zero deduction is never shown (§8.5 — the lines must add up).
    const previous: PayslipLineRow[] = current.data.deductions ?? [];
    const deductions = previous.filter((line) => line.key !== 'tds');
    if (tds != null && tds > 0) {
      const label = previous.find((line) => line.key === 'tds')?.label ?? 'tds';
      deductions.push({ key: 'tds', label, amount: tds });
    }

    const gross = Number(current.data.gross);
    const deductionTotal = deductions.reduce((sum, line) => sum + line.amount, 0);

    const saved = await db
      .from('payslips')
      .update({
        tds_override: tds,
        deductions,
        total_deductions: deductionTotal,
        net_pay: gross - deductionTotal,
        updated_at: new Date().toISOString(),
      })
      .eq('id', payslipId)
      .select()
      .single();
    if (saved.error) throw saved.error;

    // The run header always mirrors the sum of its payslips.
    const siblings = await db
      .from('payslips')
      .select('gross, total_deductions, net_pay')
      .eq('payroll_run_id', current.data.payroll_run_id);
    if (siblings.error) throw siblings.error;

    const totals = (siblings.data ?? []).reduce(
      (acc: { gross: number; deductions: number; net: number }, row: PayslipTotalsRow) => ({
        gross: acc.gross + Number(row.gross),
        deductions: acc.deductions + Number(row.total_deductions),
        net: acc.net + Number(row.net_pay),
      }),
      { gross: 0, deductions: 0, net: 0 },
    );

    const runUpdate = await db
      .from('payroll_runs')
      .update({
        total_gross: totals.gross,
        total_deductions: totals.deductions,
        total_net: totals.net,
        updated_at: new Date().toISOString(),
      })
      .eq('id', current.data.payroll_run_id);
    if (runUpdate.error) throw runUpdate.error;

    logAudit({
      performed_by: admin.uid,
      action: 'update',
      target_employee: current.data.employee_id,
      details: `Set TDS ${tds == null ? '(cleared)' : tds} on payslip ${payslipId}`,
      ip_address: getClientIp(request),
      before_data: current.data,
      after_data: saved.data,
    });

    return NextResponse.json({ success: true, data: { payslip: saved.data } });
  } catch (error) {
    return errorResponse(error, 'Failed to update the payslip. Please try again.');
  }
}
