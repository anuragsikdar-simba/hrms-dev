/**
 * Server-side IP enforcement for attendance.
 *
 * SECURITY: the client is never trusted to report its own IP or whether that
 * IP is allowed. The server reads the real client IP from the request headers,
 * matches it against the admin-managed allowlist / blocklist, and applies the
 * (server-stored) bypass setting. The client supplies zero input into this.
 */
import { supabaseAdmin } from '@/lib/supabase-server';

/** Convert dotted-decimal IPv4 to a 32-bit number, or null if malformed. */
function ipToNumber(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let num = 0;
  for (const part of parts) {
    const n = parseInt(part, 10);
    if (Number.isNaN(n) || n < 0 || n > 255) return null;
    num = (num << 8) | n;
  }
  return num >>> 0;
}

/** Parse CIDR notation into base IP and mask, or null if malformed. */
function parseCidr(cidr: string): { base: number; mask: number } | null {
  const [addr, bitsStr] = cidr.split('/');
  if (bitsStr === undefined) return null;
  const ip = ipToNumber(addr);
  if (ip === null) return null;
  const bits = parseInt(bitsStr, 10);
  if (Number.isNaN(bits) || bits < 0 || bits > 32) return null;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return { base: (ip & mask) >>> 0, mask };
}

/** True if `userIp` matches an allow/block rule (exact IPv4 or CIDR). */
export function ipMatches(userIp: string, rule: string): boolean {
  if (userIp === rule) return true;
  if (rule.includes('/')) {
    const cidr = parseCidr(rule);
    const ipNum = ipToNumber(userIp);
    if (cidr && ipNum !== null) {
      return ((ipNum & cidr.mask) >>> 0) === cidr.base;
    }
  }
  return false;
}

/** Server-stored key for the IP-restriction bypass toggle (email_config kv). */
export const IP_BYPASS_KEY = 'ip_restriction_bypass';

export interface IpDecision {
  /** The real client IP as seen by the server (may be null in some envs). */
  ip: string | null;
  /** Whether the IP is on the explicit blocklist (punch must be refused). */
  blocked: boolean;
  /** Whether the punch is allowed (in allowlist, or bypass on). */
  allowed: boolean;
  /** Whether the punch should be flagged for admin review. */
  flagged: boolean;
  /** Matched allowlist label, if any. */
  matchedLabel: string | null;
  /** Whether the admin bypass is currently enabled. */
  bypassed: boolean;
}

/**
 * Decide, entirely server-side, whether a punch from `ip` is allowed and/or
 * should be flagged.
 *
 * Rules:
 *  - On the blocklist  -> blocked (refuse).
 *  - Bypass enabled    -> allowed, not flagged.
 *  - On the allowlist  -> allowed, not flagged.
 *  - Otherwise         -> allowed but flagged for admin review.
 *
 * Uses the service-role client so the allowlist/blocklist/bypass can be read
 * regardless of the punching user's role (those tables/settings are otherwise
 * admin-only under RLS). This runs server-side only.
 */
export async function evaluateIp(ip: string | null): Promise<IpDecision> {
  const db = supabaseAdmin;
  const [allowRes, blockRes, bypassRes] = await Promise.all([
    db.from('ip_allowlist').select('ip, label'),
    db.from('ip_blocklist').select('ip'),
    db.from('email_config').select('value').eq('key', IP_BYPASS_KEY).maybeSingle(),
  ]);

  const bypassed = bypassRes.data?.value === 'true';

  // No resolvable IP: don't block (avoid lock-out), but flag for review unless
  // bypass is on.
  if (!ip) {
    return { ip: null, blocked: false, allowed: true, flagged: !bypassed, matchedLabel: null, bypassed };
  }

  const blocked = (blockRes.data ?? []).some((r) => ipMatches(ip, r.ip));
  if (blocked) {
    return { ip, blocked: true, allowed: false, flagged: true, matchedLabel: null, bypassed };
  }

  if (bypassed) {
    return { ip, blocked: false, allowed: true, flagged: false, matchedLabel: 'Bypass enabled (Admin)', bypassed };
  }

  let matchedLabel: string | null = null;
  for (const net of allowRes.data ?? []) {
    if (ipMatches(ip, net.ip)) {
      matchedLabel = net.label;
      break;
    }
  }

  const allowed = true; // unknown IPs are allowed but flagged (mirrors prior UX)
  return { ip, blocked: false, allowed, flagged: matchedLabel === null, matchedLabel, bypassed };
}
