import { NextRequest, NextResponse } from 'next/server';
import { createMiddlewareSupabase } from '@/lib/supabase-server';

/**
 * Public routes that don't require authentication.
 * Routes ending with '*' are prefix-matched, otherwise exact-matched.
 */
const PUBLIC_ROUTES = [
  '/login*',
  '/forgot-password*',
  '/reset-password*',
  '/api/ip-check', // caller's own IP -- intentionally public
  '/api/cron/*', // scheduled jobs; protected by CRON_SECRET, not session auth
];

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some((route) => {
    if (route.endsWith('*')) {
      const prefix = route.slice(0, -1);
      return pathname === prefix || pathname.startsWith(prefix);
    }
    return pathname === route;
  });
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Prepare a response that the Supabase client can write refreshed
  // session cookies onto.
  const response = NextResponse.next({ request });
  const supabase = createMiddlewareSupabase(request, response);

  // IMPORTANT: getUser() refreshes the session and is the auth check.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Public routes: let through (with possibly-refreshed cookies).
  if (isPublicRoute(pathname)) {
    return response;
  }

  if (!user) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 },
      );
    }
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all routes except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - public assets
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
