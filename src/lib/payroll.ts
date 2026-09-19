/**
 * Payroll computation — pure logic, no DB, no I/O.
 *
 * Every rule here is specified in docs/BUSINESS_RULES.md §8. Keep the two in
 * sync: if you change a rule, change the document in the same commit.
 *
 * Design notes:
 * - Nothing in this file reads the clock. Callers pass the period explicitly so
 *   results are deterministic and testable (§5 offline harness).
 * - Money is rupees. Each line is rounded at computation and the total is the
 *   sum of already-rounded lines (§8.5), so a payslip always adds up.
 * - Statutory rates are CONFIGURATION passed in, never constants here (§8.3).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ComponentKind = 'earning' | 'deduction';

export type ComponentCalc = 'fixed' | 'pct_of_basic' | 'pct_of_gross' | 'balance';

/** One line of an employee's salary structure. */
export interface StructureItem {
  componentKey: string;
  calc: ComponentCalc;
  /** Used when calc === 'fixed'. */
  amount?: number | null;
  /** Used when calc === 'pct_of_basic' | 'pct_of_gross'. */
  percent?: number | null;
}

/** A computed payslip line. */
export interface PayslipLine {
  key: string;
  label: string;
  amount: number;
}

export interface PfSettings {
  enabled: boolean;
  employeePercent: number;
  wageCeiling: number;
  applyCeiling: boolean;
}

export interface EsiSettings {
  enabled: boolean;
  employeePercent: number;
  grossLimit: number;
}

/** `upto: null` marks the final, open-ended slab. */
export interface PtSlab {
  upto: number | null;
  amount: number;
}

export interface PtSettings {
  enabled: boolean;
  slabs: PtSlab[];
}

export interface StatutorySettings {
  pf: PfSettings;
  esi: EsiSettings;
  pt: PtSettings;
}

/** Raw attendance/leave counts for the period, already keyed by IST date. */
export interface LopInput {
  /** Days of approved leave whose leave type has is_paid = false. */
  unpaidLeaveDays: number;
  /** Days marked absent with no approved leave covering them. */
  unexcusedAbsentDays: number;
  /** Days worked below the grace threshold (each costs half a day). */
  halfDays: number;
}

export interface PayslipInput {
  periodYear: number;
  /** 1-12. */
  periodMonth: number;
  monthlyGross: number;
  items: StructureItem[];
  /** Display names by component key; falls back to the key itself. */
  labels?: Record<string, string>;
  lopDays: number;
  statutory: StatutorySettings;
  /** Admin-entered TDS for this employee, this run (§8.3). No tax engine. */
  tdsOverride?: number | null;
}

export interface PayslipResult {
  periodYear: number;
  periodMonth: number;
  daysInMonth: number;
  lopDays: number;
  paidDays: number;
  earnings: PayslipLine[];
  deductions: PayslipLine[];
  gross: number;
  totalDeductions: number;
  netPay: number;
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Round to the nearest rupee. Half-up, and stable for negative zero. */
export function roundRupee(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
}

/**
 * Calendar days in a period. `month` is 1-12.
 *
 * Uses UTC internally purely as a calendar lookup (day 0 of next month = last
 * day of this month). This is NOT a timezone-sensitive "what day is it"
 * question, so it is exempt from the IST keying rule in §1 — the number of days
 * in March is 31 in every timezone.
 */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Last calendar date of the period as `YYYY-MM-DD`. Used to resolve which
 *  salary structure was in force (§8.1). */
export function periodEndDate(year: number, month: number): string {
  const d = daysInMonth(year, month);
  return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Loss of pay (§8.2)
// ---------------------------------------------------------------------------

/**
 * Total LOP days for a period, bounded to the month.
 *
 * The cap is not defensive decoration: §6.6 lists unbounded derived values as a
 * known bug class in this codebase (the runaway break bug), and an uncapped LOP
 * would produce negative pay.
 */
export function computeLopDays(input: LopInput, totalDaysInMonth: number): number {
  const raw =
    Math.max(0, input.unpaidLeaveDays) +
    Math.max(0, input.unexcusedAbsentDays) +
    Math.max(0, input.halfDays) * 0.5;

  const bounded = Math.min(raw, totalDaysInMonth);
  // Keep to one decimal: half-days are the only fractional unit.
  return Math.round(bounded * 10) / 10;
}

/** Paid days = calendar days − LOP, never negative (§8.2). */
export function computePaidDays(totalDaysInMonth: number, lopDays: number): number {
  const paid = totalDaysInMonth - Math.min(Math.max(lopDays, 0), totalDaysInMonth);
  return Math.round(Math.max(paid, 0) * 10) / 10;
}

// ---------------------------------------------------------------------------
// Earnings (§8.1)
// ---------------------------------------------------------------------------

/**
 * Expand a salary structure into full-month earning lines.
 *
 * Evaluation order is deliberate and not the array order:
 *   1. `pct_of_gross`  — needs only the gross (this is how `basic` is defined)
 *   2. `fixed`
 *   3. `pct_of_basic`  — needs basic to already exist
 *   4. `balance`       — soaks up whatever is left of the gross
 *
 * A `balance` component is what makes the lines sum exactly to the gross
 * instead of drifting by rounding. At most one is honoured; any further
 * `balance` lines resolve to 0 because the remainder is already consumed.
 */
export function computeFullEarnings(
  monthlyGross: number,
  items: StructureItem[],
  labels: Record<string, string> = {},
): PayslipLine[] {
  const gross = Math.max(0, monthlyGross);
  const amounts: Record<string, number> = {};

  for (const item of items) {
    if (item.calc === 'pct_of_gross') {
      amounts[item.componentKey] = roundRupee((gross * (item.percent ?? 0)) / 100);
    }
  }

  for (const item of items) {
    if (item.calc === 'fixed') {
      amounts[item.componentKey] = roundRupee(item.amount ?? 0);
    }
  }

  const basic = amounts.basic ?? 0;
  for (const item of items) {
    if (item.calc === 'pct_of_basic') {
      amounts[item.componentKey] = roundRupee((basic * (item.percent ?? 0)) / 100);
    }
  }

  for (const item of items) {
    if (item.calc !== 'balance') continue;
    let consumed = 0;
    for (const [key, value] of Object.entries(amounts)) {
      if (key !== item.componentKey) consumed += value;
    }
    amounts[item.componentKey] = Math.max(0, roundRupee(gross - consumed));
  }

  // Preserve the caller's declared order for display.
  return items.map((item) => ({
    key: item.componentKey,
    label: labels[item.componentKey] ?? item.componentKey,
    amount: amounts[item.componentKey] ?? 0,
  }));
}

/**
 * Pro-rate full-month earnings down to the days actually paid.
 * Each line is rounded individually (§8.5).
 */
export function prorateEarnings(
  lines: PayslipLine[],
  paidDays: number,
  totalDaysInMonth: number,
): PayslipLine[] {
  if (totalDaysInMonth <= 0) return lines.map((l) => ({ ...l, amount: 0 }));
  const factor = Math.min(Math.max(paidDays / totalDaysInMonth, 0), 1);
  return lines.map((l) => ({ ...l, amount: roundRupee(l.amount * factor) }));
}

// ---------------------------------------------------------------------------
// Statutory deductions (§8.3)
// ---------------------------------------------------------------------------

/** Employee PF on earned basic, optionally capped at the wage ceiling. */
export function computePf(earnedBasic: number, settings: PfSettings): number {
  if (!settings.enabled) return 0;
  const base = settings.applyCeiling
    ? Math.min(Math.max(earnedBasic, 0), Math.max(settings.wageCeiling, 0))
    : Math.max(earnedBasic, 0);
  return roundRupee((base * settings.employeePercent) / 100);
}

/** Employee ESI, applicable only while earned gross is within the limit. */
export function computeEsi(earnedGross: number, settings: EsiSettings): number {
  if (!settings.enabled) return 0;
  if (earnedGross > settings.grossLimit) return 0;
  return roundRupee((Math.max(earnedGross, 0) * settings.employeePercent) / 100);
}

/**
 * Professional tax from admin-maintained slabs. Slabs are sorted here rather
 * than trusting input order, and the first matching `upto` wins. A slab with
 * `upto: null` is the open-ended top band.
 */
export function computePt(earnedGross: number, settings: PtSettings): number {
  if (!settings.enabled || settings.slabs.length === 0) return 0;
  const gross = Math.max(earnedGross, 0);

  const bounded = settings.slabs
    .filter((s) => s.upto !== null)
    .sort((a, b) => (a.upto as number) - (b.upto as number));

  for (const slab of bounded) {
    if (gross <= (slab.upto as number)) return roundRupee(slab.amount);
  }

  const open = settings.slabs.find((s) => s.upto === null);
  return open ? roundRupee(open.amount) : 0;
}

// ---------------------------------------------------------------------------
// Full payslip
// ---------------------------------------------------------------------------

/**
 * Compute one payslip. Deterministic: same input, same output, forever — which
 * is what lets us store the result as an immutable snapshot (§8.1).
 */
export function computePayslip(input: PayslipInput): PayslipResult {
  const totalDays = daysInMonth(input.periodYear, input.periodMonth);
  const lopDays = Math.min(Math.max(input.lopDays, 0), totalDays);
  const paidDays = computePaidDays(totalDays, lopDays);
  const labels = input.labels ?? {};

  const earningItems = input.items.filter((i) => i.componentKey !== 'tds');
  const fullEarnings = computeFullEarnings(input.monthlyGross, earningItems, labels);
  const earnings = prorateEarnings(fullEarnings, paidDays, totalDays);

  const gross = earnings.reduce((sum, l) => sum + l.amount, 0);
  const earnedBasic = earnings.find((l) => l.key === 'basic')?.amount ?? 0;

  // Zero-value deductions are omitted so a payslip never shows a ₹0 line.
  const statutoryAmounts: Record<string, number> = {
    pf: computePf(earnedBasic, input.statutory.pf),
    esi: computeEsi(gross, input.statutory.esi),
    pt: computePt(gross, input.statutory.pt),
    tds: roundRupee(input.tdsOverride ?? 0),
  };

  const deductions: PayslipLine[] = Object.entries(statutoryAmounts)
    .filter(([, amount]) => amount > 0)
    .map(([key, amount]) => ({ key, label: labels[key] ?? key, amount }));

  const totalDeductions = deductions.reduce((sum, l) => sum + l.amount, 0);

  return {
    periodYear: input.periodYear,
    periodMonth: input.periodMonth,
    daysInMonth: totalDays,
    lopDays,
    paidDays,
    earnings,
    deductions,
    gross,
    totalDeductions,
    netPay: gross - totalDeductions,
  };
}

/**
 * Pick the salary structure in force for a period: the latest one whose
 * `effectiveFrom` is on or before the period's last day (§8.1). Returns null
 * when the employee had no structure yet — the caller must skip them rather
 * than paying them zero.
 */
export function resolveStructureFor<T extends { effectiveFrom: string }>(
  structures: T[],
  periodYear: number,
  periodMonth: number,
): T | null {
  const cutoff = periodEndDate(periodYear, periodMonth);
  let best: T | null = null;
  for (const s of structures) {
    if (s.effectiveFrom > cutoff) continue;
    if (!best || s.effectiveFrom > best.effectiveFrom) best = s;
  }
  return best;
}
