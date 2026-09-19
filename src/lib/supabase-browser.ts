'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Browser Supabase client (singleton).
 *
 * Uses @supabase/ssr so the auth session is stored in cookies that are
 * automatically shared with the server (middleware + route handlers).
 * This is the standard Supabase Auth pattern for Next.js App Router.
 *
 * NEVER use the service role key here — only the public anon key.
 */
let _client: SupabaseClient | null = null;

export function getSupabaseBrowser(): SupabaseClient {
  if (_client) return _client;
  _client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  return _client;
}
