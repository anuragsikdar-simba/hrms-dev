/**
 * Fully OFFLINE payroll test -- no database, no Docker, no live data.
 *
 *   node --experimental-strip-types --no-warnings scripts/payroll-offline-test.mjs
 *   (or: npm run test:payroll-offline)
 *
 * Exercises the REAL source in src/lib/payroll.ts against the rules in
 * docs/BUSINESS_RULES.md §8. Every case below defends a rule or a boundary that
 * a plausible bug would cross -- LOP overflow, the calendar-day divisor, the
 * balance component, statutory cut-offs, and structure effective-dating.
 */
import {
  computeLopDays,
  computePaidDays,
  computeFullEarnings,
  prorateEarnings,
  computePf,
  computeEsi,
  computePt,
  computePayslip,
  resolveStructureFor,
  daysInMonth,
  periodEndDate,
} from '../src/lib/payroll.ts';

let failures = 0;
function ok(cond, msg) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures += 1;
}

/* ================================================================== */
/*  Fixtures                                                           */
/* ================================================================== */

const STATUTORY = {
  pf: { enabled: true, employeePercent: 12, wageCeiling: 15000, applyCeiling: true },
  esi: { enabled: true, employeePercent: 0.75, grossLimit: 21000 },
  pt: {
    enabled: true,
    slabs: [
      { upto: 7500, amount: 0 },
      { upto: 10000, amount: 175 },
      { upto: null, amount: 200 },
    ],
  },
};

/** 50% basic, 40%-of-basic HRA, fixed conveyance, special allowance soaks up the rest. */
const ITEMS = [
  { componentKey: 'basic', calc: 'pct_of_gross', percent: 50 },
  { componentKey: 'hra', calc: 'pct_of_basic', percent: 40 },
  { componentKey: 'conveyance', calc: 'fixed', amount: 1600 },
  { componentKey: 'special', calc: 'balance' },
];

/* ================================================================== */
/*  1. Calendar-day divisor (§8.2)                                     */
/* ================================================================== */

ok(daysInMonth(2026, 2) === 28, 'Feb 2026 has 28 days');
ok(daysInMonth(2028, 2) === 29, 'Feb 2028 (leap) has 29 days');
ok(daysInMonth(2026, 1) === 31, 'Jan 2026 has 31 days');
ok(daysInMonth(2026, 4) === 30, 'Apr 2026 has 30 days');
ok(periodEndDate(2026, 2) === '2026-02-28', 'period end date is the last calendar day');

// The divisor must be the real month length, not a flat 30: one LOP day in
// February costs more than one LOP day in January for the same salary.
const febSlip = computePayslip({
  periodYear: 2026, periodMonth: 2, monthlyGross: 56000,
  items: ITEMS, lopDays: 1, statutory: STATUTORY,
});
const janSlip = computePayslip({
  periodYear: 2026, periodMonth: 1, monthlyGross: 56000,
  items: ITEMS, lopDays: 1, statutory: STATUTORY,
});
ok(febSlip.gross < janSlip.gross,
  `one LOP day costs more in Feb than Jan (feb ${febSlip.gross} < jan ${janSlip.gross})`);

/* ================================================================== */
/*  2. LOP is bounded (§8.2 + known bug class §6.6)                    */
/* ================================================================== */

ok(computeLopDays({ unpaidLeaveDays: 99, unexcusedAbsentDays: 99, halfDays: 0 }, 31) === 31,
  'LOP is capped at the length of the month');
ok(computeLopDays({ unpaidLeaveDays: 0, unexcusedAbsentDays: 0, halfDays: 3 }, 31) === 1.5,
  'three half-days = 1.5 LOP days');
ok(computeLopDays({ unpaidLeaveDays: 2, unexcusedAbsentDays: 1, halfDays: 1 }, 30) === 3.5,
  'unpaid leave + absent + half-day accumulate');
ok(computeLopDays({ unpaidLeaveDays: -5, unexcusedAbsentDays: 0, halfDays: 0 }, 30) === 0,
  'negative inputs cannot create negative LOP');
ok(computePaidDays(28, 99) === 0, 'paid days floor at zero, never negative');
ok(computePaidDays(31, 1.5) === 29.5, 'paid days keep the half-day precision');

// A fully absent month must produce zero pay, not negative pay.
const zeroSlip = computePayslip({
  periodYear: 2026, periodMonth: 3, monthlyGross: 56000,
  items: ITEMS, lopDays: 31, statutory: STATUTORY,
});
ok(zeroSlip.paidDays === 0 && zeroSlip.gross === 0 && zeroSlip.netPay === 0,
  'a fully-LOP month yields zero gross and zero net, not negative');

/* ================================================================== */
/*  3. Structure expansion & the balance component (§8.1)              */
/* ================================================================== */

const full = computeFullEarnings(56000, ITEMS, {});
const byKey = Object.fromEntries(full.map((l) => [l.key, l.amount]));
ok(byKey.basic === 28000, `basic = 50% of gross (got ${byKey.basic})`);
ok(byKey.hra === 11200, `HRA = 40% of basic, not of gross (got ${byKey.hra})`);
ok(byKey.conveyance === 1600, 'fixed component passes through');
ok(byKey.special === 56000 - 28000 - 11200 - 1600,
  `balance component absorbs the remainder (got ${byKey.special})`);
ok(full.reduce((s, l) => s + l.amount, 0) === 56000,
  'earning lines sum EXACTLY to the declared gross');

// pct_of_basic must resolve against basic regardless of declaration order.
const reordered = computeFullEarnings(56000, [
  { componentKey: 'hra', calc: 'pct_of_basic', percent: 40 },
  { componentKey: 'special', calc: 'balance' },
  { componentKey: 'conveyance', calc: 'fixed', amount: 1600 },
  { componentKey: 'basic', calc: 'pct_of_gross', percent: 50 },
], {});
const reorderedByKey = Object.fromEntries(reordered.map((l) => [l.key, l.amount]));
ok(reorderedByKey.hra === 11200,
  'HRA still resolves off basic when declared before it (evaluation order is by calc, not array order)');
ok(reordered.reduce((s, l) => s + l.amount, 0) === 56000,
  'reordered structure still sums exactly to gross');
ok(reordered[0].key === 'hra',
  'display order follows the declared item order, not the evaluation order');

// A structure with no balance component must not silently invent money.
const noBalance = computeFullEarnings(56000, [
  { componentKey: 'basic', calc: 'pct_of_gross', percent: 50 },
], {});
ok(noBalance.reduce((s, l) => s + l.amount, 0) === 28000,
  'without a balance component the lines sum to less than gross rather than being padded');

/* ================================================================== */
/*  4. Pro-ration (§8.2)                                               */
/* ================================================================== */

const half = prorateEarnings(full, 15, 30);
ok(half.find((l) => l.key === 'basic').amount === 14000, 'half a month halves basic');
const none = prorateEarnings(full, 0, 30);
ok(none.every((l) => l.amount === 0), 'zero paid days zeroes every earning line');
const over = prorateEarnings(full, 45, 30);
ok(over.find((l) => l.key === 'basic').amount === 28000,
  'pro-ration factor is clamped at 1 — more paid days than the month cannot inflate pay');

/* ================================================================== */
/*  5. Statutory boundaries (§8.3)                                     */
/* ================================================================== */

ok(computePf(28000, STATUTORY.pf) === 1800,
  'PF applies the 15k wage ceiling (12% of 15000 = 1800)');
ok(computePf(28000, { ...STATUTORY.pf, applyCeiling: false }) === 3360,
  'PF without the ceiling is 12% of full basic');
ok(computePf(10000, STATUTORY.pf) === 1200,
  'PF below the ceiling uses actual basic');
ok(computePf(28000, { ...STATUTORY.pf, enabled: false }) === 0, 'PF can be switched off');

ok(computeEsi(21000, STATUTORY.esi) === 158,
  'ESI applies exactly AT the gross limit (0.75% of 21000, rounded)');
ok(computeEsi(21001, STATUTORY.esi) === 0,
  'ESI drops to zero one rupee above the limit');
ok(computeEsi(0, STATUTORY.esi) === 0, 'ESI on zero gross is zero');

ok(computePt(7500, STATUTORY.pt) === 0, 'PT lowest slab is inclusive of its upper bound');
ok(computePt(7501, STATUTORY.pt) === 175, 'PT moves to the next slab one rupee over');
ok(computePt(10000, STATUTORY.pt) === 175, 'PT middle slab is inclusive');
ok(computePt(10001, STATUTORY.pt) === 200, 'PT falls through to the open-ended slab');
ok(computePt(500000, STATUTORY.pt) === 200, 'PT open-ended slab has no upper bound');
ok(computePt(9000, { enabled: true, slabs: [] }) === 0, 'PT with no configured slabs is zero');

// Slabs supplied out of order must still resolve correctly.
ok(computePt(8000, {
  enabled: true,
  slabs: [{ upto: null, amount: 200 }, { upto: 10000, amount: 175 }, { upto: 7500, amount: 0 }],
}) === 175, 'PT sorts slabs itself rather than trusting input order');

/* ================================================================== */
/*  6. Whole payslip: the lines must add up (§8.5)                     */
/* ================================================================== */

const slip = computePayslip({
  periodYear: 2026, periodMonth: 3, monthlyGross: 56000,
  items: ITEMS, lopDays: 0, statutory: STATUTORY, tdsOverride: 2500,
});
ok(slip.gross === slip.earnings.reduce((s, l) => s + l.amount, 0),
  'stated gross equals the sum of the printed earning lines');
ok(slip.totalDeductions === slip.deductions.reduce((s, l) => s + l.amount, 0),
  'stated total deductions equals the sum of the printed deduction lines');
ok(slip.netPay === slip.gross - slip.totalDeductions, 'net = gross - deductions');
ok(slip.deductions.find((l) => l.key === 'tds').amount === 2500,
  'admin TDS override lands on the payslip verbatim');
ok(slip.deductions.every((l) => l.amount > 0),
  'zero-value deductions are omitted rather than printed as blank lines');

// ESI must not appear for a high earner, and TDS must not appear when unset.
const highEarner = computePayslip({
  periodYear: 2026, periodMonth: 3, monthlyGross: 200000,
  items: ITEMS, lopDays: 0, statutory: STATUTORY,
});
ok(!highEarner.deductions.some((l) => l.key === 'esi'),
  'ESI is absent entirely for a gross above the limit');
ok(!highEarner.deductions.some((l) => l.key === 'tds'),
  'TDS line is absent when no override was entered');

// Determinism: the same input must produce byte-identical output, because the
// result is stored as an immutable snapshot (§8.1).
const again = computePayslip({
  periodYear: 2026, periodMonth: 3, monthlyGross: 56000,
  items: ITEMS, lopDays: 0, statutory: STATUTORY, tdsOverride: 2500,
});
ok(JSON.stringify(slip) === JSON.stringify(again),
  'computePayslip is deterministic for identical input');

/* ================================================================== */
/*  7. Effective-dated structures (§8.1)                               */
/* ================================================================== */

const structures = [
  { effectiveFrom: '2025-04-01', monthlyGross: 40000 },
  { effectiveFrom: '2026-07-01', monthlyGross: 56000 },
  { effectiveFrom: '2027-01-01', monthlyGross: 70000 },
];

ok(resolveStructureFor(structures, 2026, 3).monthlyGross === 40000,
  'March 2026 uses the structure in force then, not the latest one');
ok(resolveStructureFor(structures, 2026, 7).monthlyGross === 56000,
  'a hike effective on the 1st applies to that same month');
ok(resolveStructureFor(structures, 2026, 6).monthlyGross === 40000,
  'a future hike does NOT leak into the month before it — reprinting an old payslip is safe');
ok(resolveStructureFor(structures, 2030, 1).monthlyGross === 70000,
  'the most recent past structure carries forward indefinitely');
ok(resolveStructureFor(structures, 2024, 1) === null,
  'a period before any structure resolves to null so the employee is skipped, not paid zero');

// Order of the input array must not matter.
ok(resolveStructureFor([...structures].reverse(), 2026, 3).monthlyGross === 40000,
  'structure resolution is independent of array order');

/* ================================================================== */

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
