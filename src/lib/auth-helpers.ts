import { createServerSupabase, supabaseAdmin } from '@/lib/supabase-server';
import type { EmployeeRole } from '@/types';
import type { SupabaseClient } from '@supabase/supabase-js';

// -------------------------------------------------------
// Types
// -------------------------------------------------------

export interface AuthUser {
  /** Supabase employee UUID (employees.id — used as employee_id in all tables). */
  uid: string;
  /** Supabase Auth user id (auth.users.id). */
  authUserId: string;
  email: string;
  role: EmployeeRole;
  /** Per-request Supabase client (RLS enforced via the session cookie). */
  supabase: SupabaseClient;
}

// -------------------------------------------------------
// Auth verification
// -------------------------------------------------------

/**
 * Short-lived cache for the auth-user -> employee mapping.
 *
 * `getUser()` already revalidates the session JWT against Supabase Auth on
 * every request (so this stays secure), but the linked employee row
 * (id / email / role) changes very rarely. Caching it for a few seconds avoids
 * a second Supabase round-trip (~150-200ms) on every single API call, which is
 * the dominant cost when a page fires several endpoints at once.
 *
 * Only non-sensitive identity fields are cached; nothing bypasses RLS.
 */
interface CachedEmployee {
  uid: string;
  email: string;
  role: EmployeeRole;
  expires: number;
}
const EMPLOYEE_CACHE_TTL_MS = 30_000;
const employeeCache = new Map<string, CachedEmployee>();

/** Invalidate a user's cached employee row (call after role/email changes). */
export function invalidateEmployeeCache(authUserId?: string): void {
  if (authUserId) employeeCache.delete(authUserId);
  else employeeCache.clear();
}

/**
 * Verifies the Supabase Auth session and resolves the linked employee record.
 *
 * The session lives in cookies (managed by @supabase/ssr). `auth.getUser()`
 * validates the JWT against Supabase Auth on every call, so this is safe to
 * trust server-side. The returned `supabase` client is RLS-scoped to this user.
 *
 * IMPORTANT: `uid` returns the **employees.id** (not the auth user id) so that
 * `.eq('employee_id', user.uid)` keeps working everywhere.
 */
export async function verifyAuth(): Promise<AuthUser> {
  const supabase = await createServerSupabase();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error('No authentication session found');
  }

  // Fast path: reuse the recently-resolved employee row for this auth user.
  const cached = employeeCache.get(user.id);
  if (cached && cached.expires > Date.now()) {
    return {
      uid: cached.uid,
      authUserId: user.id,
      email: cached.email,
      role: cached.role,
      supabase,
    };
  }

  // Resolve the employee linked to this auth user.
  const { data: emp } = await supabase
    .from('employees')
    .select('id, email, role')
    .eq('auth_user_id', user.id)
    .single();

  if (!emp) {
    throw new Error('No employee account found for this user');
  }

  const role = (emp.role as EmployeeRole) ?? 'employee';
  const email = emp.email ?? user.email ?? '';
  employeeCache.set(user.id, {
    uid: emp.id,
    email,
    role,
    expires: Date.now() + EMPLOYEE_CACHE_TTL_MS,
  });

  return {
    uid: emp.id,
    authUserId: user.id,
    email,
    role,
    supabase,
  };
}

// -------------------------------------------------------
// Role guard
// -------------------------------------------------------

/**
 * Verifies authentication and ensures the user has the `admin` role.
 * Throws if the user is not authenticated or not an admin.
 */
export async function requireAdmin(): Promise<AuthUser> {
  const user = await verifyAuth();
  if (user.role !== 'admin') {
    throw new Error('Admin access required');
  }
  return user;
}

// Re-export so callers that only need the admin client can import from here.
export { supabaseAdmin };
