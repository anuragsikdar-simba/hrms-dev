/**
 * Simple in-memory sliding-window rate limiter.
 *
 * Not distributed -- works per-process. Fine for single-instance
 * deployments (Vercel serverless has per-function isolation anyway).
 * For multi-instance, swap to Redis/Upstash.
 */

interface WindowEntry {
  timestamps: number[];
}

const store = new Map<string, WindowEntry>();

// Clean up stale entries every 5 minutes to prevent memory leaks
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanup(windowMs: number) {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;

  const cutoff = now - windowMs;
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
    if (entry.timestamps.length === 0) store.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

/**
 * Check and consume a rate limit token.
 *
 * @param key     Unique identifier (e.g. IP, user ID, or combination).
 * @param limit   Maximum requests allowed in the window.
 * @param windowMs  Window size in milliseconds (default 60s).
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number = 60_000,
): RateLimitResult {
  cleanup(windowMs);

  const now = Date.now();
  const cutoff = now - windowMs;

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  // Remove timestamps outside the window
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

  if (entry.timestamps.length >= limit) {
    const oldestInWindow = entry.timestamps[0];
    const retryAfterMs = oldestInWindow + windowMs - now;
    return { allowed: false, remaining: 0, retryAfterMs };
  }

  entry.timestamps.push(now);
  return {
    allowed: true,
    remaining: limit - entry.timestamps.length,
    retryAfterMs: 0,
  };
}

/**
 * Pre-configured limiters for common scenarios.
 */
export const rateLimiters = {
  /** Login: 10 attempts per minute per IP */
  login: (ip: string) => rateLimit(`login:${ip}`, 10, 60_000),

  /** Mutations (create/update/delete): 30 per minute per user */
  mutation: (userId: string) => rateLimit(`mutation:${userId}`, 30, 60_000),

  /** Punch in/out: 6 per minute per user (generous for clock corrections) */
  attendance: (userId: string) => rateLimit(`attendance:${userId}`, 6, 60_000),

  /** Leave requests: 5 per minute per user */
  leave: (userId: string) => rateLimit(`leave:${userId}`, 5, 60_000),
};
