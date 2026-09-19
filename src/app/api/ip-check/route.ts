import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/ip-check
 *
 * Returns the caller's public IP address.
 *
 * INTENTIONALLY UNAUTHENTICATED -- this is called before login to
 * determine whether the user is on an allowed network. It only exposes
 * the caller's own IP, not any internal data.
 *
 * In production (behind a reverse proxy / Vercel), the IP comes from
 * x-forwarded-for. In local dev it's usually 127.0.0.1 or ::1.
 */
export async function GET(req: NextRequest) {
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : "127.0.0.1";

  return NextResponse.json({ ip });
}
