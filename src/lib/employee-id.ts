/**
 * Employee ID scheme.
 *
 * Canonical format: AU-YYYY-NNNN  (e.g. AU-2026-0042)
 *   - AU     : organisation prefix for all newly generated ids
 *   - YYYY   : 4-digit year (cohort grouping)
 *   - NNNN   : zero-padded sequence within that year (>= 4 digits)
 *
 * Legacy prefix: `DN` (see `LEGACY_EMPLOYEE_ID_PREFIXES`). Employee records
 * provisioned before the rename still carry `DN-YYYY-NNNN` ids, so those stay
 * fully valid: they validate, import, and bump as canonical ids. Only the
 * prefix used for *new* allocations changed — an existing id is never
 * rewritten from one prefix to the other.
 *
 * IDs are auto-generated server-side (atomic, race-safe) when the admin leaves
 * the field blank, but an admin may also supply a custom value as long as it
 * passes `isValidEmployeeId` and is unique.
 */

export const EMPLOYEE_ID_PREFIX = 'AU';

/**
 * Prefixes retained from before the rename. Still accepted everywhere a
 * canonical id is accepted, but never used for new allocations.
 */
export const LEGACY_EMPLOYEE_ID_PREFIXES = ['DN'] as const;

/** Every prefix that forms a canonical id: the current one plus the legacy ones. */
export const CANONICAL_EMPLOYEE_ID_PREFIXES = [
  EMPLOYEE_ID_PREFIX,
  ...LEGACY_EMPLOYEE_ID_PREFIXES,
] as const;

const PREFIX_ALTERNATION = CANONICAL_EMPLOYEE_ID_PREFIXES.join('|');

/** Canonical, system-generated format: AU-2026-0042 (or legacy DN-2026-0042). */
export const CANONICAL_EMPLOYEE_ID_RE = new RegExp(
  `^(?:${PREFIX_ALTERNATION})-\\d{4}-\\d{4,}$`
);

/**
 * Accepted format for a *custom* (admin-typed) employee ID. We allow a bit
 * more flexibility than the canonical form so legacy/migrated codes still work,
 * while still rejecting free-form junk: 3-20 chars, uppercase letters, digits
 * and dashes, must start with a letter and contain at least one digit.
 */
export const CUSTOM_EMPLOYEE_ID_RE = /^(?=.*\d)[A-Z][A-Z0-9-]{2,19}$/;

export function normalizeEmployeeId(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isValidEmployeeId(raw: string): boolean {
  const v = normalizeEmployeeId(raw);
  return CANONICAL_EMPLOYEE_ID_RE.test(v) || CUSTOM_EMPLOYEE_ID_RE.test(v);
}

export const EMPLOYEE_ID_HELP =
  `Leave blank to auto-generate (${EMPLOYEE_ID_PREFIX}-YYYY-NNNN). To override: uppercase letters/digits/dashes, must start with a letter and include a number.`;

/**
 * Increment the numeric suffix of a canonical `AU-YYYY-NNNN` id (or a legacy
 * `DN-YYYY-NNNN` one), preserving both the original prefix and the
 * zero-padding width. Used as a converging fallback when the atomic allocator
 * hands back a value that a concurrent (uncommitted) insert already took.
 * Returns the input unchanged if it is not in canonical form.
 */
const BUMPABLE_EMPLOYEE_ID_RE = new RegExp(
  `^((?:${PREFIX_ALTERNATION})-\\d{4}-)(\\d+)$`
);

export function bumpEmployeeId(id: string): string {
  const m = BUMPABLE_EMPLOYEE_ID_RE.exec(id);
  if (!m) return id;
  const width = m[2].length;
  const next = (parseInt(m[2], 10) + 1).toString().padStart(width, '0');
  return `${m[1]}${next}`;
}
