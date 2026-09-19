import { supabaseAdmin } from './supabase-server';

// -------------------------------------------------------
// Types
// -------------------------------------------------------

interface AuditEntry {
  performed_by: string;        // employee UUID from verifyAuth()
  action: string;              // e.g. 'create', 'update', 'approve', 'reject', 'delete', 'punch_in'
  target_employee?: string;    // employee UUID being acted on (if applicable)
  details?: string;            // human-readable description
  ip_address?: string | null;         // from request headers
  before_data?: unknown;       // snapshot before mutation (for updates/deletes)
  after_data?: unknown;        // snapshot after mutation (for creates/updates)
}

// -------------------------------------------------------
// Audit logger
// -------------------------------------------------------

/**
 * Log an audit entry. Call this after every successful mutation.
 * Intentionally fire-and-forget (don't await) to avoid slowing down the response.
 * If audit logging fails, the mutation still succeeds - we log the error but don't throw.
 */
export function logAudit(entry: AuditEntry): void {
  supabaseAdmin
    .from('audit_log')
    .insert({
      performed_by: entry.performed_by,
      action: entry.action,
      target_employee: entry.target_employee ?? null,
      details: entry.details ?? null,
      ip_address: entry.ip_address ?? null,
      before_data: entry.before_data ?? null,
      after_data: entry.after_data ?? null,
    })
    .then(({ error }) => {
      if (error) console.error('[audit] Failed to log:', error.message, entry);
    });
}

// -------------------------------------------------------
// IP extraction
// -------------------------------------------------------

/**
 * Extract the real client IP from request headers, resistant to client
 * spoofing of `X-Forwarded-For`.
 *
 * SECURITY: `X-Forwarded-For` is a client-controllable, comma-separated chain
 * (`client, proxy1, proxy2, ...`). A malicious client can PREPEND a fake value,
 * so the *leftmost* entry is NOT trustworthy. The trustworthy IP is the one our
 * own edge/proxy appended, plus platform headers the client cannot forge.
 *
 * Order of trust:
 *   1. `x-vercel-forwarded-for` — set by the Vercel edge; clients cannot forge it.
 *   2. `x-real-ip` — set by Vercel / common reverse proxies to the peer address.
 *   3. `x-forwarded-for` — fall back to the RIGHTMOST entry (the value appended
 *      closest to our infrastructure), never the leftmost client-supplied one.
 *
 * On Vercel, (1)/(2) are always present and authoritative. In local dev these
 * may be absent, in which case (3) is used only as a best-effort hint.
 */
export function getClientIp(request: Request): string | null {
  const vercel = request.headers.get('x-vercel-forwarded-for')?.trim();
  if (vercel) return vercel.split(',')[0].trim();

  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;

  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map((p) => p.trim()).filter(Boolean);
    // Rightmost is the hop closest to us; leftmost is attacker-controllable.
    if (parts.length) return parts[parts.length - 1];
  }
  return null;
}
