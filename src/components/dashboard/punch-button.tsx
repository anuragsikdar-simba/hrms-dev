'use client';

import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Play, Square, Pause, Loader2, Coffee } from 'lucide-react';
import { MAX_BREAK_HOURS } from '@/lib/attendance';

/** Max continuous break before it is capped / the session is auto-closed. */
export const MAX_BREAK_MS = MAX_BREAK_HOURS * 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type PunchState = 'idle' | 'active' | 'paused' | 'done';

export interface PunchSession {
  punchInTime: string;          // ISO string
  punchOutTime: string | null;  // ISO string
  segments: Segment[];          // active work segments
  totalPausedMs: number;        // total paused milliseconds
}

export interface Segment {
  start: string;   // ISO string
  end: string | null; // ISO string, null if still active
}

export interface PunchButtonProps {
  state: PunchState;
  session: PunchSession | null;
  loading?: boolean;
  onPunchIn: () => void;
  onPause: () => void;
  onResume: () => void;
  onPunchOut: () => void;
  className?: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

export function formatShortTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Calculate total break (paused) ms for a session.
 *
 * Break is derived as (elapsed span) − (work done), where span runs from
 * punch-in to punch-out (or "now" if still open). This is consistent with the
 * backend, which computes worked time as the sum of WORK segments and treats
 * everything else in the span as break. Deriving break this way (instead of
 * summing the gaps *between* segments) correctly captures:
 *   - a leading break before the first work segment,
 *   - a trailing break after the last segment (e.g. punch-out while paused),
 *   - the live, still-running break while the user is currently paused.
 */
export function calcBreakMs(session: PunchSession, asOf: number = Date.now()): number {
  const spanEnd = session.punchOutTime ? new Date(session.punchOutTime).getTime() : asOf;
  const spanMs = spanEnd - new Date(session.punchInTime).getTime();
  const workMs = calcActiveMs(session.segments, asOf);
  return Math.max(0, spanMs - workMs);
}

/** Calculate total active (working) ms from segments */
export function calcActiveMs(segments: Segment[], asOf: number = Date.now()): number {
  let total = 0;
  for (const seg of segments) {
    const end = seg.end ? new Date(seg.end).getTime() : asOf;
    total += end - new Date(seg.start).getTime();
  }
  return Math.max(0, total);
}

/**
 * Best-effort browser geolocation for geofenced punch-in.
 * Resolves to coordinates, or null when unsupported / denied / timed out -
 * a punch must NEVER be blocked client-side on location problems (the server
 * flags coordinate-less punches for review when geofencing is enabled).
 */
export function getPunchCoords(
  timeoutMs = 5_000,
): Promise<{ lat: number; lng: number; accuracy?: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null);
      return;
    }
    let settled = false;
    const finish = (v: { lat: number; lng: number; accuracy?: number } | null) => {
      if (!settled) { settled = true; resolve(v); }
    };
    // Belt-and-braces timeout: some browsers hang instead of erroring.
    const timer = setTimeout(() => finish(null), timeoutMs + 500);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        finish({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : undefined,
        });
      },
      () => { clearTimeout(timer); finish(null); },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1_000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function PunchButton({
  state,
  session,
  loading = false,
  onPunchIn,
  onPause,
  onResume,
  onPunchOut,
  className,
}: PunchButtonProps) {
  const [currentTime, setCurrentTime] = useState(formatTime(new Date()));
  const [activeDuration, setActiveDuration] = useState('00:00:00');
  const [pausedDuration, setPausedDuration] = useState('00:00:00');

  // Tick every second
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(formatTime(new Date()));
      if (session) {
        setActiveDuration(formatDuration(calcActiveMs(session.segments)));
        if (state === 'paused') {
          // Live break time = elapsed span − work done (consistent with the
          // backend), capped at MAX_BREAK_HOURS so an abandoned break does not
          // climb forever.
          const breakMs = Math.min(calcBreakMs(session), MAX_BREAK_MS);
          setPausedDuration(formatDuration(breakMs));
        } else {
          setPausedDuration(formatDuration(Math.min(calcBreakMs(session), MAX_BREAK_MS)));
        }
      }
    }, 1_000);
    return () => clearInterval(interval);
  }, [state, session]);

  const handleMainClick = useCallback(() => {
    if (loading) return;
    switch (state) {
      case 'idle':
        onPunchIn();
        break;
      case 'active':
        onPunchOut();
        break;
      case 'paused':
        onResume();
        break;
    }
  }, [loading, state, onPunchIn, onPunchOut, onResume]);

  // Colors and icons per state
  const config = {
    idle: {
      bg: 'bg-gradient-to-br from-green-500 to-green-600 hover:from-green-600 hover:to-green-700',
      ring: 'focus-visible:ring-green-300',
      shadow: 'shadow-green-200 hover:shadow-xl hover:shadow-green-200',
      icon: <Play className="h-12 w-12 text-white ml-1" fill="white" />,
      label: 'Punch In',
      labelColor: 'text-green-600',
      pulse: false,
    },
    active: {
      bg: 'bg-gradient-to-br from-red-500 to-red-600 hover:from-red-600 hover:to-red-700',
      ring: 'focus-visible:ring-red-300',
      shadow: 'shadow-red-200 hover:shadow-xl hover:shadow-red-200',
      icon: <Square className="h-12 w-12 text-white" fill="white" />,
      label: 'Punch Out',
      labelColor: 'text-red-600',
      pulse: true,
    },
    paused: {
      bg: 'bg-gradient-to-br from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700',
      ring: 'focus-visible:ring-amber-300',
      shadow: 'shadow-amber-200 hover:shadow-xl hover:shadow-amber-200',
      icon: <Play className="h-12 w-12 text-white ml-1" fill="white" />,
      label: 'Resume',
      labelColor: 'text-amber-600',
      pulse: false,
    },
    done: {
      bg: 'bg-gradient-to-br from-gray-400 to-gray-500',
      ring: 'focus-visible:ring-gray-300',
      shadow: 'shadow-gray-200',
      icon: <Square className="h-12 w-12 text-white" fill="white" />,
      label: 'Done for Today',
      labelColor: 'text-gray-500',
      pulse: false,
    },
  };

  const c = config[state];

  return (
    <div className={cn('flex flex-col items-center gap-4', className)}>
      {/* Current time */}
      <div className="text-center">
        <p className="text-sm font-medium text-gray-500">Current Time</p>
        <p className="text-2xl font-bold text-gray-900 tabular-nums tracking-tight">
          {currentTime}
        </p>
      </div>

      {/* Main button */}
      <button
        onClick={handleMainClick}
        disabled={loading || state === 'done'}
        aria-label={c.label}
        className={cn(
          'relative flex items-center justify-center',
          'h-32 w-32 rounded-full',
          'shadow-lg transition-all duration-300',
          'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-offset-2',
          'disabled:opacity-70 disabled:cursor-not-allowed',
          c.bg, c.ring, c.shadow,
        )}
      >
        {c.pulse && !loading && (
          <span className="absolute inset-0 rounded-full animate-ping bg-red-400 opacity-20" />
        )}
        {loading ? (
          <Loader2 className="h-12 w-12 text-white animate-spin" />
        ) : (
          c.icon
        )}
      </button>

      {/* Label */}
      <p className={cn('text-lg font-semibold', c.labelColor)}>
        {loading ? 'Processing...' : c.label}
      </p>

      {/* Pause button (only visible when active) */}
      {state === 'active' && !loading && (
        <button
          onClick={onPause}
          className={cn(
            'flex items-center gap-2 rounded-full px-5 py-2.5',
            'bg-amber-50 border border-amber-200 text-amber-700',
            'hover:bg-amber-100 transition-colors',
            'text-sm font-medium',
          )}
        >
          <Pause className="h-4 w-4" />
          Take a Break
        </button>
      )}

      {/* Status info */}
      <div className="text-center min-h-[4rem] space-y-1">
        {session && state !== 'idle' ? (
          <>
            <p className="text-sm text-gray-500">
              Punched in at{' '}
              <span className="font-semibold text-gray-700">
                {formatShortTime(session.punchInTime)}
              </span>
            </p>
            <p className="text-sm text-gray-500">
              Working:{' '}
              <span className="font-mono font-semibold text-green-600 tabular-nums">
                {activeDuration}
              </span>
            </p>
            {(session.totalPausedMs > 0 || state === 'paused') && (
              <p className="text-sm text-gray-500">
                <Coffee className="inline h-3.5 w-3.5 mr-1 text-amber-500" />
                Break:{' '}
                <span className="font-mono font-semibold text-amber-600 tabular-nums">
                  {pausedDuration}
                </span>
              </p>
            )}
            {state === 'paused' && (
              <p className="text-xs text-amber-600 font-medium mt-1 animate-pulse">
                On break...
              </p>
            )}
            {state === 'done' && session.punchOutTime && (
              <p className="text-sm text-gray-500">
                Punched out at{' '}
                <span className="font-semibold text-gray-700">
                  {formatShortTime(session.punchOutTime)}
                </span>
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-gray-500">Not punched in yet</p>
        )}
      </div>
    </div>
  );
}
