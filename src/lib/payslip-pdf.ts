/**
 * Payslip PDF rendering.
 *
 * This module is a *renderer*, not a calculator. It draws exactly the figures
 * it is handed — the payslip snapshot computed by the payroll run — and never
 * recomputes or re-derives money (BUSINESS_RULES §8.1: a payslip is a snapshot,
 * not a view).
 *
 * Determinism (§8.4): the same payslip must always produce the same bytes, so
 * the document timestamps are taken from the payslip's own `created_at` and
 * nothing here reads the clock.
 *
 * Encoding note: pdf-lib's StandardFonts are WinAnsi-encoded. The rupee sign
 * (U+20B9) is NOT in WinAnsi and makes `drawText` throw, so amounts are
 * prefixed with `INR ` and every string is folded to WinAnsi before drawing.
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PayslipLineRow, PayslipRow } from '@/types';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/**
 * Employee context as it should appear on the payslip. These values come from
 * the payslip's frozen `snapshot` so an old payslip keeps printing the
 * designation/department the employee had at the time.
 */
export interface PayslipPdfEmployee {
  name: string;
  /** Human-readable staff code (employees.employee_id), not the UUID. */
  employeeCode: string;
  designation: string | null;
  department: string | null;
  pan: string | null;
  bankName: string | null;
  /** Last 4 digits only — a full account number must never reach this module. */
  bankLast4: string | null;
}

export interface PayslipPdfInput {
  /** The stored, already-computed payslip. Rendered verbatim. */
  payslip: PayslipRow;
  employee: PayslipPdfEmployee;
}

// ---------------------------------------------------------------------------
// Page constants
// ---------------------------------------------------------------------------

const ORG_NAME = 'August HRMS';
const FOOTER_TEXT = 'Computer-generated payslip. No signature required.';

/** A4 in PDF points. */
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const COLUMN_GAP = 16;
const COLUMN_WIDTH = (CONTENT_WIDTH - COLUMN_GAP) / 2;
const ROW_HEIGHT = 17;

const INK = rgb(0.08, 0.09, 0.13);
const MUTED = rgb(0.42, 0.45, 0.52);
const LINE = rgb(0.84, 0.85, 0.88);
const BAND = rgb(0.965, 0.97, 0.98);
const HEADER_BG = rgb(0.10, 0.13, 0.22);
const HEADER_FG = rgb(1, 1, 1);
const HEADER_SUB = rgb(0.78, 0.81, 0.88);

const MONTH_NAMES: Record<number, string> = {
  1: 'January',
  2: 'February',
  3: 'March',
  4: 'April',
  5: 'May',
  6: 'June',
  7: 'July',
  8: 'August',
  9: 'September',
  10: 'October',
  11: 'November',
  12: 'December',
};

/** Unicode punctuation that has no WinAnsi codepoint but a safe ASCII twin. */
const TRANSLITERATIONS: Record<string, string> = {
  '\u20B9': 'INR',
  '\u2013': '-',
  '\u2014': '-',
  '\u2018': "'",
  '\u2019': "'",
  '\u201C': '"',
  '\u201D': '"',
  '\u2026': '...',
  '\u00A0': ' ',
};

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Fold arbitrary text down to what a WinAnsi-encoded standard font can draw.
 * Anything outside the encoding (Devanagari names, emoji, the rupee sign)
 * becomes a safe substitute rather than a thrown error mid-render.
 */
function toWinAnsi(value: string): string {
  let out = '';
  for (const char of value) {
    const mapped = TRANSLITERATIONS[char];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    const code = char.codePointAt(0) ?? 0;
    // Printable ASCII, plus the Latin-1 supplement WinAnsi shares with it.
    out += (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) ? char : '?';
  }
  return out;
}

/**
 * Indian-grouped rupees, e.g. `INR 12,34,567.00`. Hand-rolled rather than
 * `Intl` so the output cannot shift with the host's ICU data — identical bytes
 * are a hard requirement (§8.4).
 */
function formatInr(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const negative = safe < 0;
  const [whole, fraction] = Math.abs(safe).toFixed(2).split('.');

  let grouped = whole;
  if (whole.length > 3) {
    const last3 = whole.slice(-3);
    const rest = whole.slice(0, -3);
    grouped = `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`;
  }

  return `${negative ? '-' : ''}INR ${grouped}.${fraction}`;
}

/** Days render as `21` or `20.5`, never `20.50`. */
function formatDays(days: number): string {
  const safe = Number.isFinite(days) ? days : 0;
  return Number.isInteger(safe) ? String(safe) : safe.toFixed(1);
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/**
 * Render a stored payslip to a single-page A4 PDF.
 *
 * Deterministic: called twice with the same input it returns byte-identical
 * output, which is what lets the API cache the file and re-serve it forever.
 */
export async function renderPayslipPdf(input: PayslipPdfInput): Promise<Uint8Array> {
  const { payslip, employee } = input;

  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  const periodLabel = `${MONTH_NAMES[payslip.period_month] ?? 'Unknown'} ${payslip.period_year}`;

  /** Draw right-aligned text ending at `rightX`. */
  const drawRight = (
    value: string,
    rightX: number,
    y: number,
    size: number,
    font: typeof regular,
    color: typeof INK,
  ): void => {
    const text = toWinAnsi(value);
    page.drawText(text, { x: rightX - font.widthOfTextAtSize(text, size), y, size, font, color });
  };

  // -- Header band ---------------------------------------------------------
  const headerHeight = 56;
  const headerTop = PAGE_HEIGHT - MARGIN;
  page.drawRectangle({
    x: MARGIN,
    y: headerTop - headerHeight,
    width: CONTENT_WIDTH,
    height: headerHeight,
    color: HEADER_BG,
  });
  page.drawText(toWinAnsi(ORG_NAME), {
    x: MARGIN + 18,
    y: headerTop - 36,
    size: 19,
    font: bold,
    color: HEADER_FG,
  });
  drawRight('PAYSLIP FOR', PAGE_WIDTH - MARGIN - 18, headerTop - 26, 9, regular, HEADER_SUB);
  drawRight(periodLabel, PAGE_WIDTH - MARGIN - 18, headerTop - 42, 13, bold, HEADER_FG);

  let cursor = headerTop - headerHeight - 28;

  // -- Employee block ------------------------------------------------------
  const bankLine = employee.bankLast4
    ? `${employee.bankName ? `${employee.bankName} ` : ''}XXXX${employee.bankLast4}`
    : '-';

  const employeeFields: [string, string][] = [
    ['Employee', employee.name || '-'],
    ['Employee ID', employee.employeeCode || '-'],
    ['Designation', employee.designation || '-'],
    ['Department', employee.department || '-'],
    ['PAN', employee.pan || '-'],
    ['Bank account', bankLine],
  ];

  for (let i = 0; i < employeeFields.length; i += 2) {
    const rowY = cursor - (i / 2) * 22;
    const pair: ([string, string] | undefined)[] = [employeeFields[i], employeeFields[i + 1]];
    for (const [col, field] of pair.entries()) {
      if (!field) continue;
      const x = MARGIN + col * (COLUMN_WIDTH + COLUMN_GAP);
      page.drawText(toWinAnsi(field[0].toUpperCase()), {
        x,
        y: rowY,
        size: 7.5,
        font: regular,
        color: MUTED,
      });
      page.drawText(toWinAnsi(field[1]), {
        x,
        y: rowY - 12,
        size: 10.5,
        font: bold,
        color: INK,
      });
    }
  }
  cursor -= Math.ceil(employeeFields.length / 2) * 22 + 6;

  // -- Attendance block ----------------------------------------------------
  const attendanceHeight = 40;
  page.drawRectangle({
    x: MARGIN,
    y: cursor - attendanceHeight,
    width: CONTENT_WIDTH,
    height: attendanceHeight,
    color: BAND,
  });

  const attendanceCells: [string, string][] = [
    ['Days in month', formatDays(payslip.days_in_month)],
    ['LOP days', formatDays(payslip.lop_days)],
    ['Paid days', formatDays(payslip.paid_days)],
  ];
  attendanceCells.forEach(([label, value], index) => {
    const x = MARGIN + 18 + index * (CONTENT_WIDTH / 3);
    page.drawText(toWinAnsi(label.toUpperCase()), {
      x,
      y: cursor - 16,
      size: 7.5,
      font: regular,
      color: MUTED,
    });
    page.drawText(toWinAnsi(value), {
      x,
      y: cursor - 31,
      size: 11,
      font: bold,
      color: INK,
    });
  });
  cursor -= attendanceHeight + 26;

  // -- Earnings / deductions ----------------------------------------------
  const rightColumnX = MARGIN + COLUMN_WIDTH + COLUMN_GAP;
  const columnHeads: [string, number][] = [
    ['EARNINGS', MARGIN],
    ['DEDUCTIONS', rightColumnX],
  ];
  for (const [heading, x] of columnHeads) {
    page.drawText(heading, { x, y: cursor, size: 8.5, font: bold, color: MUTED });
    page.drawLine({
      start: { x, y: cursor - 6 },
      end: { x: x + COLUMN_WIDTH, y: cursor - 6 },
      thickness: 1,
      color: LINE,
    });
  }
  cursor -= 6;

  const earnings = Array.isArray(payslip.earnings) ? payslip.earnings : [];
  const deductions = Array.isArray(payslip.deductions) ? payslip.deductions : [];
  const rowCount = Math.max(earnings.length, deductions.length);

  for (let i = 0; i < rowCount; i += 1) {
    const rowTop = cursor - i * ROW_HEIGHT;
    const baseline = rowTop - 13;
    if (i % 2 === 1) {
      page.drawRectangle({
        x: MARGIN,
        y: baseline - 5,
        width: CONTENT_WIDTH,
        height: ROW_HEIGHT,
        color: BAND,
      });
    }
    const pairs: [PayslipLineRow | undefined, number][] = [
      [earnings[i], MARGIN],
      [deductions[i], rightColumnX],
    ];
    for (const [line, x] of pairs) {
      if (!line) continue;
      page.drawText(toWinAnsi(line.label), { x, y: baseline, size: 9.5, font: regular, color: INK });
      drawRight(formatInr(line.amount), x + COLUMN_WIDTH, baseline, 9.5, regular, INK);
    }
  }
  cursor -= rowCount * ROW_HEIGHT + 10;

  // -- Totals --------------------------------------------------------------
  // Straight from the stored snapshot: the server owns the arithmetic (§8.5).
  page.drawLine({
    start: { x: MARGIN, y: cursor + 6 },
    end: { x: PAGE_WIDTH - MARGIN, y: cursor + 6 },
    thickness: 1,
    color: LINE,
  });

  const totals: [string, number, number][] = [
    ['Gross earnings', payslip.gross, MARGIN],
    ['Total deductions', payslip.total_deductions, rightColumnX],
  ];
  for (const [label, amount, x] of totals) {
    page.drawText(toWinAnsi(label), { x, y: cursor - 10, size: 9.5, font: bold, color: INK });
    drawRight(formatInr(amount), x + COLUMN_WIDTH, cursor - 10, 9.5, bold, INK);
  }
  cursor -= 32;

  const netHeight = 40;
  page.drawRectangle({
    x: MARGIN,
    y: cursor - netHeight,
    width: CONTENT_WIDTH,
    height: netHeight,
    color: HEADER_BG,
  });
  page.drawText(toWinAnsi('NET PAY'), {
    x: MARGIN + 18,
    y: cursor - 25,
    size: 11,
    font: bold,
    color: HEADER_FG,
  });
  drawRight(formatInr(payslip.net_pay), PAGE_WIDTH - MARGIN - 18, cursor - 27, 15, bold, HEADER_FG);

  // -- Footer --------------------------------------------------------------
  const footer = toWinAnsi(FOOTER_TEXT);
  page.drawText(footer, {
    x: (PAGE_WIDTH - regular.widthOfTextAtSize(footer, 8)) / 2,
    y: MARGIN,
    size: 8,
    font: regular,
    color: MUTED,
  });

  // -- Metadata ------------------------------------------------------------
  // Fixed timestamps keep the bytes reproducible; never Date.now() here (§8.4).
  const stamped = new Date(payslip.created_at);
  const timestamp = Number.isNaN(stamped.getTime()) ? new Date(0) : stamped;

  pdf.setTitle(toWinAnsi(`Payslip ${periodLabel} - ${employee.name}`));
  pdf.setAuthor(ORG_NAME);
  pdf.setSubject(toWinAnsi(`Payslip for ${periodLabel}`));
  pdf.setProducer(ORG_NAME);
  pdf.setCreator(ORG_NAME);
  pdf.setCreationDate(timestamp);
  pdf.setModificationDate(timestamp);

  return pdf.save();
}
