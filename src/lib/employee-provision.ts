import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/auth-helpers';
import {
  isValidEmployeeId,
  normalizeEmployeeId,
  bumpEmployeeId,
  EMPLOYEE_ID_PREFIX,
} from '@/lib/employee-id';
import { randomBytes } from 'crypto';

/* ------------------------------------------------------------------ */
/*  Shared employee-provisioning logic                                 */
/*                                                                     */
/*  Used by both POST /api/employees (single) and                      */
/*  POST /api/employees/bulk (batch) so the validation, department     */
/*  resolution, auth-user provisioning, race-safe ID generation and    */
/*  rollback behaviour stay identical.                                 */
/* ------------------------------------------------------------------ */

export const EMPLOYEE_SELECT =
  '*, department:departments!employees_department_id_fkey(id, name)';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The raw, string-valued shape of one row coming from the client. */
export interface RawEmployeeRow {
  name?: string;
  email?: string;
  employee_id?: string;
  /** Department *name* as typed by the admin (resolved against the DB). */
  department?: string;
  /**
   * Pre-resolved department UUID (used by the single "Add Employee" form, which
   * picks from a dropdown of existing departments). When present, it satisfies
   * the "department is required" rule even though `department` (the name) is
   * empty — the bulk-import path uses `department` instead.
   */
  department_id?: string;
  designation?: string;
  role?: string;
  phone?: string;
  date_of_joining?: string;
  shift_start?: string;
  shift_end?: string;
  tracks_attendance?: string | boolean;
}

/** A normalised, validated row ready to be inserted. */
export interface NormalisedRow {
  name: string;
  email: string;
  employee_id: string; // '' = auto-generate
  department: string; // resolved name (or '')
  designation: string | null;
  role: 'admin' | 'employee';
  phone: string | null;
  date_of_joining: string | null;
  shift_start: string | null;
  shift_end: string | null;
  tracks_attendance: boolean;
}

export interface RowValidation {
  errors: string[];
  warnings: string[];
  normalised: NormalisedRow;
}

function asBool(v: unknown, def = true): boolean {
  if (typeof v === 'boolean') return v;
  if (v == null || v === '') return def;
  return !['false', 'no', '0', 'observer'].includes(String(v).trim().toLowerCase());
}

/**
 * Validate and normalise a single raw row in isolation (no DB lookups).
 * DB-dependent checks (duplicate email/ID, department existence) are layered
 * on by the batch endpoint, which has the full set loaded.
 */
export function validateRow(raw: RawEmployeeRow): RowValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  const name = (raw.name ?? '').trim();
  const email = (raw.email ?? '').trim().toLowerCase();
  const rawId = (raw.employee_id ?? '').trim();
  const department = (raw.department ?? '').trim();
  const role = (raw.role ?? '').trim().toLowerCase() === 'admin' ? 'admin' : 'employee';
  const designation = (raw.designation ?? '').trim() || null;
  const phone = (raw.phone ?? '').trim() || null;
  const doj = (raw.date_of_joining ?? '').trim();
  const ss = (raw.shift_start ?? '').trim();
  const se = (raw.shift_end ?? '').trim();

  if (!name) errors.push('name is required');
  if (!email) errors.push('email is required');
  else if (!EMAIL_RE.test(email)) errors.push('email is not valid');

  let employee_id = '';
  if (rawId) {
    const candidate = normalizeEmployeeId(rawId);
    if (!isValidEmployeeId(candidate)) {
      errors.push('employee_id format is invalid (leave blank to auto-generate)');
    } else {
      employee_id = candidate;
    }
  }

  if (doj && !DATE_RE.test(doj)) errors.push('date_of_joining must be YYYY-MM-DD');
  if (ss && !TIME_RE.test(ss)) errors.push('shift_start must be HH:MM');
  if (se && !TIME_RE.test(se)) errors.push('shift_end must be HH:MM');

  // Required to keep the directory clean — mirrors the single "Add Employee"
  // form (name, email, department, designation, date of joining). Bulk import
  // must not be a backdoor for incomplete records. The single-add form supplies
  // a pre-resolved `department_id` instead of a name, so either one satisfies
  // the rule.
  const hasDepartmentId = !!(raw.department_id ?? '').trim();
  if (!department && !hasDepartmentId) errors.push('department is required');
  if (!designation) errors.push('designation is required');
  if (!doj) errors.push('date_of_joining is required');

  return {
    errors,
    warnings,
    normalised: {
      name,
      email,
      employee_id,
      department,
      designation,
      role,
      phone,
      date_of_joining: doj || null,
      shift_start: ss || null,
      shift_end: se || null,
      tracks_attendance: asBool(raw.tracks_attendance, true),
    },
  };
}

function generateTempPassword(): string {
  const base = randomBytes(9).toString('base64').replace(/[+/=]/g, '').slice(0, 10);
  return `Dn${base}!7`;
}

export interface CreateOutcome {
  status: 'created' | 'skipped' | 'error';
  message?: string;
  employee?: Record<string, unknown>;
  tempPassword?: string;
}

/**
 * Provision ONE employee: pre-check duplicates, create the auth login,
 * insert the row (race-safe auto-ID retry), and roll back the auth user on
 * any failure. `db` must be the RLS-scoped admin client.
 *
 * `departmentId` is resolved by the caller (so the batch endpoint creates each
 * new department only once across the whole file).
 */
export async function provisionEmployee(
  db: SupabaseClient,
  row: NormalisedRow,
  departmentId: string | null,
): Promise<CreateOutcome> {
  const email = row.email;
  let employeeId = row.employee_id;
  const autoGenerated = !employeeId;

  // Resolve an auto employee_id up front.
  if (!employeeId) {
    const { data: generated, error: genErr } = await db.rpc('next_employee_id', {
      p_prefix: EMPLOYEE_ID_PREFIX,
    });
    if (genErr || !generated) {
      return { status: 'error', message: 'Could not generate an Employee ID.' };
    }
    employeeId = generated as string;
  }

  // Pre-check duplicates so we don't create an auth user we'd have to roll back.
  // For an AUTO-generated id we only pre-check the email: concurrent requests
  // can momentarily share the same generated id, and the insert retry loop
  // below (bumpEmployeeId) is what resolves those — treating it as a clash here
  // would wrongly skip valid rows under parallel load.
  const dupFilter = autoGenerated
    ? `email.eq.${email}`
    : `email.eq.${email},employee_id.eq.${employeeId}`;
  const { data: clash } = await db
    .from('employees')
    .select('email, employee_id')
    .or(dupFilter)
    .limit(1)
    .maybeSingle();
  if (clash) {
    const field = clash.email === email ? 'email address' : 'Employee ID';
    return { status: 'skipped', message: `That ${field} is already in use.` };
  }

  // Provision the auth login.
  const tempPassword = generateTempPassword();
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
  });
  if (authError || !authData?.user) {
    if (/already.*registered|already been registered/i.test(authError?.message ?? '')) {
      return { status: 'skipped', message: 'That email address is already in use.' };
    }
    return { status: 'error', message: 'Could not create the login account.' };
  }
  const authUserId = authData.user.id;

  const baseRow = {
    auth_user_id: authUserId,
    name: row.name,
    email,
    phone: row.phone,
    role: row.role,
    tracks_attendance: row.tracks_attendance,
    department_id: departmentId,
    designation: row.designation,
    date_of_joining: row.date_of_joining,
    shift_start: row.shift_start,
    shift_end: row.shift_end,
    status: 'active',
    onboarding_status: 'pending',
    must_reset_password: true,
  };

  const MAX_ID_RETRIES = 12;
  let data: Record<string, unknown> | null = null;
  let error: { code?: string; message?: string } | null = null;

  for (let attempt = 0; attempt < MAX_ID_RETRIES; attempt++) {
    const res = await db
      .from('employees')
      .insert({ ...baseRow, employee_id: employeeId })
      .select(EMPLOYEE_SELECT)
      .single();
    data = res.data as Record<string, unknown> | null;
    error = res.error;
    if (!error) break;

    const isUnique = error.code === '23505';
    const isEmployeeIdClash = /employee_id/i.test(error.message ?? '');
    if (autoGenerated && isUnique && isEmployeeIdClash && attempt < MAX_ID_RETRIES - 1) {
      const { data: regen } = await db.rpc('next_employee_id', {
        p_prefix: EMPLOYEE_ID_PREFIX,
      });
      const candidate = (regen as string) ?? employeeId;
      employeeId = candidate === employeeId ? bumpEmployeeId(employeeId) : candidate;
      continue;
    }
    break;
  }

  if (error || !data) {
    // Never orphan a login account.
    await supabaseAdmin.auth.admin.deleteUser(authUserId).catch(() => {});
    if (error?.code === '23505') {
      const field = /email/i.test(error.message ?? '') ? 'email address' : 'Employee ID';
      return { status: 'skipped', message: `That ${field} is already in use.` };
    }
    return { status: 'error', message: 'Failed to create employee.' };
  }

  return { status: 'created', employee: data, tempPassword };
}
