import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import type { NextRequest, NextResponse } from 'next/server';

// Defense-in-depth: this module must never run in the browser. If it is ever
// imported into client-side code, fail loudly instead of silently shipping the
// service-role key. (`cookies()` from next/headers already makes a true client
// import impossible, but this guards any bundling edge cases.)
if (typeof window !== 'undefined') {
  throw new Error(
    'supabase-server.ts was imported in a browser context. ' +
      'This module uses the service role key and must stay server-only.',
  );
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Server-only Supabase client using the service role key.
 * Bypasses RLS — use ONLY for operations that genuinely need it
 * (audit logging, storage admin, auth.admin user management).
 *
 * NEVER import this from client-side components.
 */
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * Per-request Supabase client bound to the caller's auth cookies.
 *
 * Reads (and refreshes) the Supabase Auth session from Next.js cookies, so
 * RLS policies see the correct `auth.uid()`. This is the standard SSR client
 * used inside Route Handlers and Server Components.
 */
export async function createServerSupabase(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a Server Component where cookies are read-only.
          // Safe to ignore: the middleware refreshes the session cookies.
        }
      },
    },
  });
}

/**
 * Per-request Supabase client for use inside `middleware.ts`, where cookies
 * are read from the incoming request and written to the outgoing response.
 */
export function createMiddlewareSupabase(
  request: NextRequest,
  response: NextResponse,
): SupabaseClient {
  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });
}
