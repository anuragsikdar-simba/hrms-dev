'use client';

import { useState, useEffect, useCallback } from 'react';
import { ipAllowlist, approvalRequests } from '@/lib/api-client';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface AllowedNetwork {
  ip: string;      // single IP or CIDR (e.g. "203.122.45.10" or "49.36.128.0/24")
  label: string;
}

export interface IpCheckResult {
  /** The user's detected IP */
  detectedIp: string | null;
  /** Whether IP is in the allowlist */
  isAllowed: boolean;
  /** The matched network label (e.g. "Office WiFi - Main") */
  matchedNetwork: string | null;
  /** Whether the check is still loading */
  loading: boolean;
  /** Whether IP restriction is bypassed (admin toggle) */
  bypassed: boolean;
  /** Re-run the IP check */
  recheck: () => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Parse CIDR notation into base IP and mask bits */
function parseCidr(cidr: string): { base: number; mask: number } | null {
  const parts = cidr.split('/');
  if (parts.length !== 2) return null;
  const ip = ipToNumber(parts[0]);
  if (ip === null) return null;
  const bits = parseInt(parts[1], 10);
  if (isNaN(bits) || bits < 0 || bits > 32) return null;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return { base: (ip & mask) >>> 0, mask };
}

/** Convert dotted-decimal IP to 32-bit number */
function ipToNumber(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let num = 0;
  for (const part of parts) {
    const n = parseInt(part, 10);
    if (isNaN(n) || n < 0 || n > 255) return null;
    num = (num << 8) | n;
  }
  return num >>> 0;
}

/** Check if an IP matches a rule (exact or CIDR) */
export function ipMatches(userIp: string, rule: string): boolean {
  // Exact match
  if (userIp === rule) return true;

  // CIDR match (IPv4 only)
  if (rule.includes('/')) {
    const cidr = parseCidr(rule);
    const ipNum = ipToNumber(userIp);
    if (cidr && ipNum !== null) {
      return ((ipNum & cidr.mask) >>> 0) === cidr.base;
    }
  }

  return false;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/*                                                                     */
/*  IMPORTANT: this hook is DISPLAY-ONLY. The authoritative IP check,  */
/*  flagging and bypass decisions all happen server-side in            */
/*  /api/attendance using the real request IP. Nothing this hook       */
/*  reports is trusted by the server, and the punch handlers no longer */
/*  send any IP/flag to the API. The `bypassed` value is read from the */
/*  server (admin-managed) setting, never from localStorage.           */
/* ------------------------------------------------------------------ */

export function useIpCheck(): IpCheckResult {
  const [detectedIp, setDetectedIp] = useState<string | null>(null);
  const [allowedNetworks, setAllowedNetworks] = useState<AllowedNetwork[]>([]);
  const [loading, setLoading] = useState(true);
  const [bypassed, setBypassed] = useState(false);

  // Fetch allowed networks + the server-side bypass setting.
  useEffect(() => {
    async function fetchConfig() {
      try {
        const { allowlist, bypassed: serverBypass } = await ipAllowlist.list();
        if (allowlist) {
          setAllowedNetworks(allowlist.map((row: any) => ({ ip: row.ip, label: row.label })));
        }
        setBypassed(Boolean(serverBypass));
      } catch { /* ignore */ }
    }
    fetchConfig();
  }, []);

  const fetchIp = useCallback(async () => {
    setLoading(true);
    let ip = 'unknown';

    // Helper: fetch with a hard timeout so a hanging request can never
    // leave the punch button permanently disabled.
    const fetchWithTimeout = async (url: string, ms: number) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), ms);
      try {
        return await fetch(url, { signal: ctrl.signal });
      } finally {
        clearTimeout(t);
      }
    };

    try {
      // Display only: show the user which public IP they appear to be on.
      // The server does its own authoritative detection on punch.
      const res = await fetchWithTimeout('https://api.ipify.org?format=json', 5000);
      if (res.ok) {
        const data = await res.json();
        ip = data.ip;
      }
    } catch {
      try {
        const res = await fetchWithTimeout('/api/ip-check', 5000);
        if (res.ok) {
          const data = await res.json();
          ip = data.ip;
        }
      } catch { /* ignore */ }
    }

    // Re-fetch config on each recheck so allowlist/bypass changes are reflected.
    try {
      const { allowlist, bypassed: serverBypass } = await ipAllowlist.list();
      if (allowlist) {
        setAllowedNetworks(allowlist.map((row: any) => ({ ip: row.ip, label: row.label })));
      }
      setBypassed(Boolean(serverBypass));
    } catch { /* ignore */ }

    setDetectedIp(ip);
    setLoading(false);
  }, []);

  useEffect(() => { fetchIp(); }, [fetchIp]);

  // Display-only allowlist match against the (informational) detected IP.
  let isAllowed = false;
  let matchedNetwork: string | null = null;

  if (detectedIp && detectedIp !== 'unknown') {
    for (const net of allowedNetworks) {
      if (ipMatches(detectedIp, net.ip)) {
        isAllowed = true;
        matchedNetwork = net.label;
        break;
      }
    }
  }

  return {
    detectedIp,
    isAllowed: bypassed || isAllowed,
    matchedNetwork: bypassed ? 'Bypass enabled (Admin)' : matchedNetwork,
    loading,
    bypassed,
    recheck: fetchIp,
  };
}

/* ------------------------------------------------------------------ */
/*  IP Violation -- persisted to DB via approval_requests API          */
/*                                                                     */
/*  NOTE: violations are now created SERVER-SIDE by /api/attendance     */
/*  when a flagged punch is recorded. This client helper is retained    */
/*  for backward compatibility but is no longer the source of truth.    */
/* ------------------------------------------------------------------ */
export async function addIpViolation(params: {
  detectedIp: string;
  actionType: 'punch-in' | 'punch-out';
  reason?: string;
}): Promise<void> {
  try {
    await approvalRequests.create({
      type: 'ip_violation',
      detected_ip: params.detectedIp,
      action_type: params.actionType,
      reason: params.reason ?? `IP violation during ${params.actionType}`,
    });
  } catch (err) {
    console.error('[IP Violation] Failed to submit:', err);
  }
}
