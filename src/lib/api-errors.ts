/**
 * Centralized API error handling.
 *
 * Turns raw database / Supabase errors into safe, human-readable messages so
 * users never see internal details like
 *   `duplicate key value violates unique constraint "employees_employee_id_key"`.
 *
 * Usage in a route handler:
 *   } catch (error) {
 *     return errorResponse(error, 'Failed to create employee');
 *   }
 */
import { NextResponse } from 'next/server';

/** Maps a unique-constraint name to the field a user would recognise. */
const UNIQUE_CONSTRAINT_LABELS: Record<string, string> = {
  employees_employee_id_key: 'Employee ID',
  employees_email_key: 'email address',
  employees_auth_user_id_key: 'login account',
  departments_name_key: 'department name',
  leave_types_name_key: 'leave type',
  holidays_date_key: 'holiday date',
  attendance_employee_id_date_key: 'attendance record for this date',
  onboarding_submissions_employee_id_key: 'onboarding submission',
};

interface PgLikeError {
  code?: string;
  message?: string;
  details?: string;
  constraint?: string;
  hint?: string;
}

function asPgError(error: unknown): PgLikeError {
  if (error && typeof error === 'object') return error as PgLikeError;
  return {};
}

/** Try to extract a constraint name from a Supabase/Postgres error. */
function extractConstraint(err: PgLikeError): string | undefined {
  if (err.constraint) return err.constraint;
  // Supabase often flattens the detail into the message text.
  const text = `${err.message ?? ''} ${err.details ?? ''}`;
  const m = text.match(/constraint "([^"]+)"/);
  return m?.[1];
}

/**
 * Returns a user-safe message for any error. Known DB conditions get a
 * specific explanation; everything else falls back to the provided default.
 */
export function toUserMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const err = asPgError(error);
  const msg = err.message ?? '';

  // Auth/role guards thrown by verifyAuth()/requireAdmin().
  if (/no authentication session|authentication required|not authenticated/i.test(msg)) {
    return 'Your session has expired. Please sign in again.';
  }
  if (/admin access required/i.test(msg)) {
    return 'You do not have permission to perform this action.';
  }
  if (/no employee account found/i.test(msg)) {
    return 'No employee account is linked to this login. Contact your administrator.';
  }

  // Postgres unique violation (23505).
  if (err.code === '23505' || /duplicate key value/i.test(msg)) {
    const constraint = extractConstraint(err);
    const label = constraint ? UNIQUE_CONSTRAINT_LABELS[constraint] : undefined;
    if (label) return `That ${label} is already in use. Please choose a different one.`;
    return 'A record with these details already exists. Please use different values.';
  }

  // Foreign key violation (23503) -- e.g. selecting a department that was deleted.
  if (err.code === '23503' || /violates foreign key constraint/i.test(msg)) {
    return 'A selected value is no longer valid. Please refresh and try again.';
  }

  // Not-null violation (23502).
  if (err.code === '23502' || /null value in column/i.test(msg)) {
    const m = msg.match(/column "([^"]+)"/);
    const col = m?.[1]?.replace(/_/g, ' ');
    return col ? `${col} is required.` : 'A required field is missing.';
  }

  // Check / value violations.
  if (err.code === '23514') {
    return 'One of the values entered is not allowed. Please review and try again.';
  }

  // RLS denial -- the user is not allowed to read/write this row.
  if (/row-level security|permission denied/i.test(msg)) {
    return 'You do not have permission to perform this action.';
  }

  // Rate limiting bubbled up as a message.
  if (/too many requests|rate limit/i.test(msg)) {
    return 'Too many requests. Please wait a moment and try again.';
  }

  // Avoid leaking obviously-internal text; use the fallback instead.
  if (
    !msg ||
    /constraint|relation|column|syntax error|pg_|violates|null value|sql/i.test(msg)
  ) {
    return fallback;
  }

  return msg;
}

/** Picks an appropriate HTTP status for a given error. */
export function statusForError(error: unknown): number {
  const err = asPgError(error);
  const msg = err.message ?? '';

  if (/no authentication session|authentication required|not authenticated|session has expired/i.test(msg)) return 401;
  if (/admin access required|permission|row-level security/i.test(msg)) return 403;
  if (err.code === '23505' || /duplicate key value/i.test(msg)) return 409;
  if (err.code === '23503' || /foreign key/i.test(msg)) return 409;
  if (err.code === '23502' || err.code === '23514') return 400;
  if (/too many requests|rate limit/i.test(msg)) return 429;
  return 500;
}

/**
 * Builds a standardized JSON error response with a user-safe message and a
 * sensible status code. Logs the raw error server-side for debugging.
 */
export function errorResponse(error: unknown, fallback?: string): NextResponse {
  const message = toUserMessage(error, fallback);
  const status = statusForError(error);
  // Keep the full detail in server logs only.
  console.error('[API error]', status, (error as PgLikeError)?.message ?? error);
  return NextResponse.json({ success: false, error: message }, { status });
}
