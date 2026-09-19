'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  ChevronRight,
  FileUp,
  UserPen,
  Square,
  Play,
  Coffee,
  CheckCircle2,
  ShieldAlert,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useIpCheck } from '@/hooks/useIpCheck';
import { useAuth } from '@/contexts/AuthContext';
import api from '@/lib/api-client';
import { businessDate } from '@/lib/dates';
import { calcActiveMs, calcBreakMs, formatShortTime, MAX_BREAK_MS, getPunchCoords } from './punch-button';
import type { PunchState, PunchSession } from './punch-button';
import { SelfieModal, type WorkMode } from './selfie-modal';

/* Max session before auto punch-out (12 hours in ms) */
const MAX_SESSION_MS = 12 * 60 * 60 * 1000;

/** Today's date as YYYY-MM-DD in local timezone */
function todayDateStr(): string {
  // Use the shared IST business date so client and server agree on "today".
  return businessDate();
}

/* ================================================================== */
/*  Types                                                              */
/* ================================================================== */

type LeaveBalance = { type: string; remaining: number; total: number; color: string; track: string };
type MonthlySummary = { present: number; workingDays: number; onLeave: number; absent: number; avgPunchIn: string };
type HeatmapStatus = 'present' | 'leave' | 'half' | 'absent' | 'holiday' | 'weekend' | 'future' | 'empty';
type HeatmapCell = { day: number; status: HeatmapStatus; isToday: boolean };
type UpcomingHoliday = { name: string; date: string; subtitle: string; type: 'mandatory' | 'optional' };
type TeamLeave = { name: string; avatar: string; dateRange: string; leaveType: string };
type ActivityItem = { who: string; action: string; time: string; color: string };

const LEAVE_COLORS: Record<number, { color: string; track: string }> = {
  0: { color: 'bg-purple-500', track: 'bg-purple-100' },
  1: { color: 'bg-red-500', track: 'bg-red-100' },
  2: { color: 'bg-blue-500', track: 'bg-blue-100' },
  3: { color: 'bg-amber-500', track: 'bg-amber-100' },
  4: { color: 'bg-green-500', track: 'bg-green-100' },
  5: { color: 'bg-teal-500', track: 'bg-teal-100' },
};

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */

function padTwo(n: number): string {
  return String(n).padStart(2, '0');
}

/* ================================================================== */
/*  Sub-components                                                     */
/* ================================================================== */

/* ---------- Punch Card ---------- */

export function PunchCard({
  punchState,
  session,
  punchLoading,
  onPunchIn,
  onPause,
  onResume,
  onPunchOut,
  ipCheck,
  monthlySummary,
  workMode,
}: {
  workMode?: WorkMode;
  punchState: PunchState;
  session: PunchSession | null;
  punchLoading: boolean;
  onPunchIn: () => void;
  onPause: () => void;
  onResume: () => void;
  onPunchOut: () => void;
  ipCheck: {
    detectedIp: string | null;
    isAllowed: boolean;
    matchedNetwork: string | null;
    loading: boolean;
    bypassed: boolean;
  };
  monthlySummary: MonthlySummary;
}) {
  const [now, setNow] = useState(new Date());
  const [showConfirm, setShowConfirm] = useState(false);

  // Tick wall clock every second
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(id);
  }, []);

  const isPunchedIn = punchState === 'active' || punchState === 'paused';
  const accentBorder =
    punchState === 'active' ? 'border-l-green-500' :
    punchState === 'paused' ? 'border-l-amber-500' :
    'border-l-gray-900';

  // Format clock
  const hours = padTwo(now.getHours());
  const minutes = padTwo(now.getMinutes());
  const seconds = padTwo(now.getSeconds());

  // Date string
  const dateStr = now.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  // Session timer - only compute live when punched in; freeze when done
  const activeMs = session ? calcActiveMs(session.segments) : 0;
  const sessionHrs = Math.floor(activeMs / 3_600_000);
  const sessionMins = Math.floor((activeMs % 3_600_000) / 60_000);
  const sessionSecs = Math.floor((activeMs % 60_000) / 1_000);

  // Break (paused) time, derived as span − work and capped at the break limit
  // so an abandoned break never displays an ever-growing value.
  const breakMs = session ? Math.min(calcBreakMs(session), MAX_BREAK_MS) : 0;

  // Punch out with confirmation
  const handlePunchOutClick = () => setShowConfirm(true);
  const confirmPunchOut = () => { setShowConfirm(false); onPunchOut(); };
  const cancelPunchOut = () => setShowConfirm(false);

  return (
    <Card className={`border-l-[3px] ${accentBorder}`}>
      <CardContent className="p-0">
        {/* Main content area */}
        <div className="grid grid-cols-[1fr_auto] gap-4 p-4 pb-3">
          {/* Left side */}
          <div className="min-w-0">
            {/* Status pill & Work Mode badge */}
            <div className="flex flex-wrap items-center gap-2 mb-2">
              {punchState === 'active' ? (
                <Badge variant="green" dot>Currently punched in</Badge>
              ) : punchState === 'paused' ? (
                <Badge variant="amber" dot>On break</Badge>
              ) : punchState === 'done' ? (
                <Badge variant="slate" dot>Punched out for today</Badge>
              ) : (
                <Badge variant="slate" dot>Not punched in</Badge>
              )}

              {isPunchedIn && (
                <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                  {workMode === 'home' ? '🏠 Work From Home' : workMode === 'client' ? '💼 Client Site' : workMode === 'onsite' ? '📍 On-site' : '🏢 Office'}
                </span>
              )}
            </div>

            {/* Network status */}
            {ipCheck.loading ? (
              <p className="text-[11px] text-gray-400 mb-1.5">Detecting network...</p>
            ) : ipCheck.isAllowed ? (
              <p className="text-[11px] text-green-600 mb-1.5">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500 mr-1 align-middle" />
                {ipCheck.matchedNetwork || 'Allowed network'}
              </p>
            ) : (
              <p className="text-[11px] text-red-500 mb-1.5">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500 mr-1 align-middle" />
                Unrecognised network
              </p>
            )}

            {/* Large clock */}
            <div className="font-mono font-light text-[36px] leading-none tabular-nums text-gray-900 tracking-tight">
              {hours}:{minutes}
              <span className="text-[18px] text-gray-400 ml-0.5">{seconds}</span>
            </div>

            {/* Date meta */}
            <p className="text-[11px] text-gray-400 mt-1.5">
              {dateStr} &mdash; IST
            </p>
          </div>

          {/* Right side - action buttons */}
          <div className="flex flex-col items-end justify-between">
            {/* Primary action */}
            {punchState === 'idle' ? (
              <div className="flex flex-col items-end gap-2">
                <button
                  onClick={onPunchIn}
                  disabled={punchLoading || ipCheck.loading}
                  className="bg-gray-900 hover:bg-black text-white py-3.5 px-5 rounded-md font-semibold text-[13px] uppercase tracking-widest transition-colors flex items-center gap-2.5 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {ipCheck.loading ? (
                    <>
                      <span className="h-2.5 w-2.5 rounded-full bg-gray-400 animate-pulse" />
                      Checking...
                    </>
                  ) : ipCheck.isAllowed ? (
                    <>
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
                      </span>
                      Punch In
                    </>
                  ) : (
                    <>
                      <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
                      Punch In
                    </>
                  )}
                </button>
                {!ipCheck.loading && !ipCheck.isAllowed && (
                  <p className="text-[11px] text-amber-600 text-right max-w-[200px]">
                    Unknown IP detected. You can still punch in but it will be sent for admin approval.
                  </p>
                )}
              </div>
            ) : punchState === 'active' ? (
              <div className="flex flex-col items-end gap-2">
                <button
                  onClick={onPause}
                  disabled={punchLoading}
                  className="bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-700 py-2 px-4 rounded-md font-semibold text-[12px] uppercase tracking-widest transition-colors flex items-center gap-2 disabled:opacity-60"
                >
                  <Coffee className="h-3.5 w-3.5" />
                  Break
                </button>
                {showConfirm ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-gray-500 mr-1">End day?</span>
                    <button
                      onClick={confirmPunchOut}
                      className="bg-red-700 hover:bg-red-800 text-white py-1.5 px-3 rounded text-[11px] font-semibold uppercase tracking-wider transition-colors"
                    >
                      Yes
                    </button>
                    <button
                      onClick={cancelPunchOut}
                      className="bg-gray-100 hover:bg-gray-200 text-gray-600 py-1.5 px-3 rounded text-[11px] font-semibold uppercase tracking-wider transition-colors"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handlePunchOutClick}
                    disabled={punchLoading}
                    className="bg-red-700 hover:bg-red-800 text-white py-3.5 px-5 rounded-md font-semibold text-[13px] uppercase tracking-widest transition-colors flex items-center gap-2.5 disabled:opacity-60"
                  >
                    <Square className="h-3.5 w-3.5 fill-white" />
                    Punch Out
                  </button>
                )}
              </div>
            ) : punchState === 'paused' ? (
              <div className="flex flex-col items-end gap-2">
                <button
                  onClick={onResume}
                  disabled={punchLoading}
                  className="bg-green-600 hover:bg-green-700 text-white py-3.5 px-5 rounded-md font-semibold text-[13px] uppercase tracking-widest transition-colors flex items-center gap-2.5 disabled:opacity-60"
                >
                  <Play className="h-3.5 w-3.5 fill-white" />
                  Resume
                </button>
                {showConfirm ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-gray-500 mr-1">End day?</span>
                    <button
                      onClick={confirmPunchOut}
                      className="bg-red-700 hover:bg-red-800 text-white py-1.5 px-3 rounded text-[11px] font-semibold uppercase tracking-wider transition-colors"
                    >
                      Yes
                    </button>
                    <button
                      onClick={cancelPunchOut}
                      className="bg-gray-100 hover:bg-gray-200 text-gray-600 py-1.5 px-3 rounded text-[11px] font-semibold uppercase tracking-wider transition-colors"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handlePunchOutClick}
                    disabled={punchLoading}
                    className="bg-red-700 hover:bg-red-800 text-white py-2 px-4 rounded-md font-semibold text-[12px] uppercase tracking-widest transition-colors flex items-center gap-2 disabled:opacity-60"
                  >
                    <Square className="h-3 w-3 fill-white" />
                    Punch Out
                  </button>
                )}
              </div>
            ) : (
              /* done state - final, no re-punch */
              <div className="flex flex-col items-end gap-2">
                <button
                  disabled
                  className="bg-gray-200 text-gray-400 py-3.5 px-5 rounded-md font-semibold text-[13px] uppercase tracking-widest cursor-not-allowed flex items-center gap-2.5"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Done for Today
                </button>
                <Link
                  href="/attendance"
                  className="text-[11px] text-blue-600 hover:text-blue-800 hover:underline"
                >
                  Punched out by mistake? Request regularisation &rarr;
                </Link>
              </div>
            )}

            {/* Session timer or last punch-out */}
            <div className="text-right mt-2">
              {isPunchedIn ? (
                <div>
                  <p className="font-mono text-[13px] tabular-nums text-green-600">
                    {padTwo(sessionHrs)}:{padTwo(sessionMins)}:{padTwo(sessionSecs)} session
                  </p>
                  {punchState === 'paused' && (
                    <p className="text-[11px] text-amber-600 font-medium mt-0.5 animate-pulse flex items-center justify-end gap-1">
                      <Coffee className="h-3 w-3" />
                      On break {padTwo(Math.floor(breakMs / 3_600_000))}:{padTwo(Math.floor((breakMs % 3_600_000) / 60_000))}:{padTwo(Math.floor((breakMs % 60_000) / 1_000))}
                    </p>
                  )}
                  {breakMs > 0 && punchState !== 'paused' && (
                    <p className="font-mono text-[10px] tabular-nums text-amber-500 mt-0.5">
                      Break: {padTwo(Math.floor(breakMs / 3_600_000))}:{padTwo(Math.floor((breakMs % 3_600_000) / 60_000))}:{padTwo(Math.floor((breakMs % 60_000) / 1_000))}
                    </p>
                  )}
                </div>
              ) : punchState === 'done' && session ? (
                <div>
                  <p className="font-mono text-[13px] tabular-nums text-gray-500">
                    {padTwo(sessionHrs)}:{padTwo(sessionMins)}:{padTwo(sessionSecs)} worked
                  </p>
                  {session.punchInTime && (
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      In: <span className="font-mono tabular-nums">{formatShortTime(session.punchInTime)}</span>
                      {session.punchOutTime && (
                        <> &mdash; Out: <span className="font-mono tabular-nums">{formatShortTime(session.punchOutTime)}</span></>
                      )}
                    </p>
                  )}
                  {session.totalPausedMs > 0 && (
                    <p className="font-mono text-[10px] tabular-nums text-amber-500 mt-0.5">
                      Break: {padTwo(Math.floor(session.totalPausedMs / 3_600_000))}:{padTwo(Math.floor((session.totalPausedMs % 3_600_000) / 60_000))}:{padTwo(Math.floor((session.totalPausedMs % 60_000) / 1_000))}
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* Bottom stats row */}
        <div className="grid grid-cols-4 border-t border-gray-200">
          <StatCell label="Days present" value={`${monthlySummary.present}/${monthlySummary.workingDays}`} />
          <StatCell label="On leave" value={String(monthlySummary.onLeave)} border />
          <StatCell label="Absent" value={String(monthlySummary.absent)} border />
          <StatCell label="Avg. punch-in" value={monthlySummary.avgPunchIn} border />
        </div>
      </CardContent>
    </Card>
  );
}

export function StatCell({ label, value, border }: { label: string; value: string; border?: boolean }) {
  return (
    <div className={`px-4 py-3 ${border ? 'border-l border-gray-200' : ''}`}>
      <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium mb-0.5">{label}</p>
      <p className="font-mono text-[16px] font-medium tabular-nums text-gray-900">{value}</p>
    </div>
  );
}

/* ---------- Leave Balance Card ---------- */

/**
 * Returns the Indian Financial Year boundaries for a given date.
 * FY runs April 1 to March 31.
 */
function getCurrentFY(now = new Date()) {
  const month = now.getMonth(); // 0-indexed
  const year = now.getFullYear();
  // If Jan-Mar, FY started last April
  const startYear = month < 3 ? year - 1 : year;
  return {
    label: `FY ${startYear}-${String(startYear + 1).slice(2)}`,
    start: `${startYear}-04-01`,
    end: `${startYear + 1}-03-31`,
  };
}

export function LeaveBalanceCard({ employeeId }: { employeeId?: string }) {
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const fy = getCurrentFY();

  useEffect(() => {
    if (!employeeId) return;
    (async () => {
      try {
        const { leaveTypes, leaveAllocations, leaveOverrides, requests } = await api.leaves.list();
        // Build a map of leave type id -> name
        const typeMap = new Map<string, string>();
        for (const lt of leaveTypes ?? []) typeMap.set(lt.id, lt.name);

        // Build override map (custom_days per employee per leave type)
        const overrideMap = new Map<string, number>();
        for (const o of leaveOverrides ?? []) overrideMap.set(o.leave_type_id, o.custom_days);

        // Count used days from approved leave requests within current FY
        const usedMap = new Map<string, number>();
        for (const r of requests ?? []) {
          if (r.status !== 'approved') continue;
          // Filter by FY date range
          if (r.from_date > fy.end || r.to_date < fy.start) continue;
          usedMap.set(r.leave_type_id, (usedMap.get(r.leave_type_id) ?? 0) + Number(r.days));
        }

        if (leaveAllocations && leaveAllocations.length > 0) {
          const list = leaveAllocations.map((a: Record<string, unknown>, idx: number) => {
            const total = overrideMap.get(a.leave_type_id as string) ?? (a.annual_days as number) ?? 0;
            const used = usedMap.get(a.leave_type_id as string) ?? 0;
            const remaining = Math.max(total - used, 0);
            const colors = LEAVE_COLORS[idx % Object.keys(LEAVE_COLORS).length];
            return { type: typeMap.get(a.leave_type_id as string) ?? 'Leave', remaining, total, ...colors };
          });
          setBalances(list);
        }
      } catch (err) {
        console.error('[LeaveBalanceCard] fetch error:', err);
        setFetchError('Unable to load leave balances');
      }
    })();
  }, [employeeId, fy.start, fy.end]);

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <CardTitle>Leave balance</CardTitle>
          <CardDescription>{fy.label} &middot; Apr 01 - Mar 31</CardDescription>
        </div>
        <Link href="/leaves"><Button variant="outline" size="sm">Apply</Button></Link>
      </CardHeader>
      <CardContent className="space-y-3.5">
        {fetchError ? (
          <p className="text-[12px] text-red-500 text-center py-4">{fetchError}</p>
        ) : balances.length === 0 ? (
          <p className="text-[12px] text-gray-400 text-center py-4">No leave allocations found</p>
        ) : balances.map((leave) => (
          <div key={leave.type}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[12px] font-semibold text-gray-700">{leave.type}</span>
              <span className="font-mono text-[12px] tabular-nums text-gray-600">
                <span className="font-semibold text-gray-900">{leave.remaining}</span>
                <span className="text-gray-400"> / {leave.total}</span>
              </span>
            </div>
            <div className={`h-1.5 w-full rounded-full bg-gray-100`}>
              <div
                className={`h-1.5 rounded-full transition-all duration-500 ${leave.color}`}
                style={{ width: `${leave.total > 0 ? Math.min((leave.remaining / leave.total) * 100, 100) : 0}%` }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/* ---------- Pending Actions Card ---------- */

type PendingAction = { label: string; count: number | null; iconBg: string; iconColor: string; Icon: React.ComponentType<{ className?: string }>; href: string };

function PendingActionsCard({ employeeId }: { employeeId?: string }) {
  const [items, setItems] = useState<PendingAction[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (!employeeId) return;
    (async () => {
      try {
        const stats = await api.dashboardStats.get() as { pendingLeaves?: number; onboardingStatus?: string };

        const pending: PendingAction[] = [];
        if ((stats.pendingLeaves ?? 0) > 0) {
          pending.push({ label: 'Pending leave requests', count: stats.pendingLeaves ?? 0, iconBg: 'bg-amber-50', iconColor: 'text-amber-600', Icon: FileUp, href: '/leaves' });
        }
        if (stats.onboardingStatus === 'pending') {
          pending.push({ label: 'Complete onboarding', count: null, iconBg: 'bg-blue-50', iconColor: 'text-blue-600', Icon: UserPen, href: '/onboarding' });
        } else if (stats.onboardingStatus === 'in_progress') {
          pending.push({ label: 'Onboarding submitted — awaiting review', count: null, iconBg: 'bg-green-50', iconColor: 'text-green-600', Icon: UserPen, href: '/onboarding' });
        }
        setItems(pending);
      } catch (err) {
        console.error('[PendingActionsCard] fetch error:', err);
        setFetchError('Unable to load pending actions');
      }
    })();
  }, [employeeId]);

  if (items.length === 0 && !fetchError) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Pending actions
          {items.length > 0 && <Badge variant="amber" className="ml-1">{items.length}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {fetchError ? (
          <p className="text-[12px] text-red-500 text-center py-4 px-4">{fetchError}</p>
        ) : items.map((item, i) => {
          const Icon = item.Icon;
          return (
            <Link
              key={i}
              href={item.href}
              className="flex items-center gap-3 w-full px-4 py-2.5 hover:bg-gray-50 transition-colors text-left border-b border-gray-100 last:border-b-0"
            >
              <div className={`h-[26px] w-[26px] rounded-md ${item.iconBg} flex items-center justify-center shrink-0`}>
                <Icon className={`h-3.5 w-3.5 ${item.iconColor}`} />
              </div>
              <span className="flex-1 text-[12px] text-gray-700">{item.label}</span>
              {item.count != null && (
                <span className="font-mono text-[11px] tabular-nums text-gray-400 mr-1">{item.count}</span>
              )}
              <ChevronRight className="h-3.5 w-3.5 text-gray-300 shrink-0" />
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}

/* ---------- Upcoming Card ---------- */

export function UpcomingCard({ showTeamLeaves = false }: { showTeamLeaves?: boolean }) {
  const [holidays, setHolidays] = useState<UpcomingHoliday[]>([]);
  const [teamLeaves, setTeamLeaves] = useState<TeamLeave[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const today = todayDateStr();
        const thirtyDaysLater = businessDate(new Date(Date.now() + 30 * 86400000));

        const { holidays: allHols } = await api.holidays.list();

        if (allHols) {
          const upcoming = allHols.filter((h: { date: string }) => h.date >= today && h.date <= thirtyDaysLater).slice(0, 5);
          setHolidays(upcoming.map((h: { name: string; date: string; type: string }) => ({
            name: h.name,
            date: h.date,
            subtitle: h.type === 'optional' ? 'Optional holiday' : 'Public holiday',
            type: h.type as 'mandatory' | 'optional',
          })));
        }

        if (showTeamLeaves) {
          const { requests: allLeaves } = await api.leaves.list({ status: 'approved' });

          if (allLeaves) {
            const filtered = allLeaves
              .filter((l: Record<string, unknown>) => (l.to_date as string) >= today && (l.from_date as string) <= thirtyDaysLater)
              .slice(0, 5);
            setTeamLeaves(filtered.map((l: Record<string, unknown>) => {
              const emp = l.employees as { name: string } | null;
              const lt = l.leave_types as { name: string } | null;
              const initials = (emp?.name ?? '').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
              const from = new Date(l.from_date as string);
              const to = new Date(l.to_date as string);
              const fromStr = from.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
              const toStr = to.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
              const dateRange = from.getTime() === to.getTime() ? fromStr : `${fromStr} - ${toStr}`;
              return { name: emp?.name ?? 'Unknown', avatar: initials, dateRange, leaveType: lt?.name ?? 'Leave' };
            }));
          }
        }
      } catch (err) {
        console.error('[UpcomingCard] fetch error:', err);
        setFetchError('Unable to load upcoming events');
      }
    })();
  }, [showTeamLeaves]);

  if (fetchError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Upcoming - next 30 days</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-[12px] text-red-500 text-center py-4">{fetchError}</p>
        </CardContent>
      </Card>
    );
  }

  if (holidays.length === 0 && teamLeaves.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Upcoming - next 30 days</CardTitle>
          <CardDescription>No upcoming holidays or team leaves</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Upcoming - next 30 days</CardTitle>
          <CardDescription>{showTeamLeaves ? 'Holidays & approved team leaves' : 'Upcoming company holidays'}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Holidays */}
        {holidays.map((h, i) => {
          const d = new Date(h.date);
          const monthStr = d.toLocaleDateString('en-IN', { month: 'short' }).toUpperCase();
          const dayStr = d.getDate();
          return (
            <div key={i} className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-md bg-amber-50 border border-amber-200 flex flex-col items-center justify-center shrink-0">
                <span className="text-[8px] font-bold uppercase text-amber-600 leading-none">{monthStr}</span>
                <span className="text-[14px] font-bold text-amber-700 leading-tight">{dayStr}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-semibold text-gray-900 truncate">{h.name}</p>
                <p className="text-[11px] text-gray-400">{h.subtitle}</p>
              </div>
              <Badge variant="amber">Holiday</Badge>
            </div>
          );
        })}

        {/* Team leaves - admin only */}
        {showTeamLeaves && teamLeaves.length > 0 && holidays.length > 0 && (
          <div className="border-t border-gray-100" />
        )}

        {showTeamLeaves && teamLeaves.map((tl, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
              <span className="text-[10px] font-semibold text-gray-500">{tl.avatar}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-semibold text-gray-900 truncate">{tl.name}</p>
              <p className="font-mono text-[11px] tabular-nums text-gray-400">{tl.dateRange}</p>
            </div>
            <Badge variant="purple">{tl.leaveType}</Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/* ---------- Mini Month Heatmap ---------- */

const HEATMAP_COLORS: Record<HeatmapStatus, string> = {
  present: 'bg-green-400',
  leave: 'bg-purple-400',
  half: 'bg-amber-400',
  absent: 'bg-red-400',
  holiday: 'bg-gray-300',
  weekend: 'bg-gray-200',
  future: 'bg-gray-100',
  empty: 'bg-transparent',
};

function MiniMonthHeatmap({ employeeId, joiningDate }: { employeeId?: string; joiningDate?: string }) {
  const weekDays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const [heatmap, setHeatmap] = useState<HeatmapCell[]>([]);

  useEffect(() => {
    (async () => {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth();
      const today = now.getDate();
      const firstDay = new Date(year, month, 1).getDay();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

      // Parse joining date to know which days are before the employee joined
      const joinDate = joiningDate ? new Date(joiningDate) : null;

      // Fetch attendance for this month
      let attendanceDates: Set<string> = new Set();
      let leaveDates: Set<string> = new Set();
      let holidayDates: Set<string> = new Set();

      if (employeeId) {
        const { records: attRecords } = await api.attendance.list({ month: month + 1, year });

        if (attRecords) {
          attRecords.forEach((a: { date: string; status: string }) => {
            attendanceDates.add(a.date);
          });
        }

        const { requests: leaveRecords } = await api.leaves.list({ status: 'approved' });

        if (leaveRecords) {
          leaveRecords
            .filter((l: Record<string, unknown>) => (l.from_date as string) <= `${monthStr}-${daysInMonth}` && (l.to_date as string) >= `${monthStr}-01`)
            .forEach((l: { from_date: string; to_date: string }) => {
              const start = new Date(l.from_date);
              const end = new Date(l.to_date);
              for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                leaveDates.add(d.toISOString().slice(0, 10));
              }
            });
        }
      }

      const { holidays: allHols } = await api.holidays.list();

      if (allHols) {
        allHols
          .filter((h: { date: string }) => h.date >= `${monthStr}-01` && h.date <= `${monthStr}-${daysInMonth}`)
          .forEach((h: { date: string }) => holidayDates.add(h.date));
      }

      const cells: HeatmapCell[] = [];
      for (let i = 0; i < firstDay; i++) {
        cells.push({ day: 0, status: 'empty', isToday: false });
      }

      for (let d = 1; d <= daysInMonth; d++) {
        const dow = new Date(year, month, d).getDay();
        const isToday = d === today;
        const dateKey = `${monthStr}-${String(d).padStart(2, '0')}`;
        const cellDate = new Date(year, month, d);
        let status: HeatmapStatus;

        // Days before joining date are not applicable
        if (joinDate && cellDate < new Date(joinDate.getFullYear(), joinDate.getMonth(), joinDate.getDate())) {
          status = 'empty';
        } else if (d > today) {
          status = 'future';
        } else if (dow === 0 || dow === 6) {
          status = 'weekend';
        } else if (holidayDates.has(dateKey)) {
          status = 'holiday';
        } else if (leaveDates.has(dateKey)) {
          status = 'leave';
        } else if (attendanceDates.has(dateKey)) {
          status = 'present';
        } else {
          status = d < today ? 'absent' : 'future';
        }

        cells.push({ day: d, status, isToday });
      }

      setHeatmap(cells);
    })();
  }, [employeeId, joiningDate]);

  const heatmapCounts = {
    present: heatmap.filter((c) => c.status === 'present').length,
    leave: heatmap.filter((c) => c.status === 'leave').length,
    half: heatmap.filter((c) => c.status === 'half').length,
    absent: heatmap.filter((c) => c.status === 'absent').length,
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>This month at a glance</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Day headers */}
        <div className="grid grid-cols-7 gap-1 mb-1">
          {weekDays.map((d, i) => (
            <div key={i} className="text-center text-[9px] font-medium text-gray-400 uppercase">
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7 gap-1">
          {heatmap.map((cell, i) => {
            if (cell.status === 'empty') {
              return <div key={i} className="aspect-square" />;
            }
            const isFuture = cell.status === 'future';
            return (
              <div
                key={i}
                className={`aspect-square rounded-[3px] flex items-center justify-center text-[9px] font-medium
                  ${HEATMAP_COLORS[cell.status]}
                  ${isFuture ? 'opacity-40' : ''}
                  ${cell.isToday ? 'ring-[1.5px] ring-blue-500 ring-offset-1' : ''}
                  ${cell.status === 'present' || cell.status === 'leave' || cell.status === 'half' || cell.status === 'absent' ? 'text-white' : 'text-gray-500'}
                `}
                title={cell.day > 0 ? `${cell.day} - ${cell.status}` : undefined}
              >
                {cell.day > 0 ? cell.day : ''}
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 pt-3 border-t border-gray-100">
          <LegendDot color="bg-green-400" label="Present" count={heatmapCounts.present} />
          <LegendDot color="bg-purple-400" label="Leave" count={heatmapCounts.leave} />
          <LegendDot color="bg-amber-400" label="Half" count={heatmapCounts.half} />
          <LegendDot color="bg-red-400" label="Absent" count={heatmapCounts.absent} />
        </div>
      </CardContent>
    </Card>
  );
}

function LegendDot({ color, label, count }: { color: string; label: string; count: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`h-[6px] w-[6px] rounded-full ${color}`} />
      <span className="text-[10px] text-gray-500">{label}</span>
      <span className="font-mono text-[10px] tabular-nums text-gray-400">{count}</span>
    </div>
  );
}

/* ---------- Activity Feed Card ---------- */

export function ActivityCard({ employeeId }: { employeeId?: string }) {
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (!employeeId) return;
    (async () => {
      try {
        const { auditLog } = await api.employees.get(employeeId) as { auditLog: { action: string; details: string | null; created_at: string }[] };
        const data = (auditLog ?? []).slice(0, 5);

        if (data.length > 0) {
          setActivity(data.map((row: { action: string; details: string | null; created_at: string }) => {
            const d = new Date(row.created_at);
            const isToday = d.toDateString() === new Date().toDateString();
            const time = isToday
              ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
              : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
            return {
              who: 'You',
              action: row.details || row.action,
              time,
              color: row.action.includes('punch') ? 'bg-green-500' : row.action.includes('leave') ? 'bg-purple-500' : 'bg-gray-400',
            };
          }));
        }
      } catch (err) {
        console.error('[ActivityCard] fetch error:', err);
        setFetchError('Unable to load recent activity');
      }
    })();
  }, [employeeId]);

  if (fetchError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-[12px] text-red-500 text-center py-4">{fetchError}</p>
        </CardContent>
      </Card>
    );
  }

  if (activity.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-[12px] text-gray-400 text-center py-4">No recent activity</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {activity.map((item, i) => (
          <div
            key={i}
            className="flex items-start gap-2.5 px-4 py-2.5 border-b border-gray-50 last:border-b-0"
          >
            <span className={`h-[6px] w-[6px] rounded-full mt-1.5 shrink-0 ${item.color}`} />
            <p className="flex-1 text-[12px] text-gray-600 leading-relaxed">
              <span className="font-semibold text-gray-900">{item.who}</span>{' '}
              {item.action}
            </p>
            <span className="font-mono text-[10px] tabular-nums text-gray-400 shrink-0 mt-0.5">
              {item.time}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/* ================================================================== */
/*  Main Component                                                     */
/* ================================================================== */

export function EmployeeDashboard() {
  const { userProfile } = useAuth();
  const employeeId = userProfile?.id; // UUID from Supabase

  // Punch state
  const [punchState, setPunchState] = useState<PunchState>('idle');
  const [session, setSession] = useState<PunchSession | null>(null);
  const [punchLoading, setPunchLoading] = useState(false);
  const [attendanceId, setAttendanceId] = useState<string | null>(null); // Attendance row ID
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null); // Current open segment ID
  const [monthlySummary, setMonthlySummary] = useState<MonthlySummary>({ present: 0, workingDays: 0, onLeave: 0, absent: 0, avgPunchIn: '--:--' });
  // Selfie modal & work mode state
  const [selfieModalOpen, setSelfieModalOpen] = useState(false);
  const [selfieAction, setSelfieAction] = useState<'punch_in' | 'punch_out'>('punch_in');
  const [workMode, setWorkMode] = useState<WorkMode>('office');
  const { toast } = useToast();
  const autoPunchOutFired = useRef(false);
  const ipCheck = useIpCheck();
  const initDone = useRef<string | null>(null);

  /* ---- Monthly summary via API ---- */
  useEffect(() => {
    if (!employeeId) return;
    (async () => {
      try {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();
        const today = now.getDate();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

        // Parse joining date to only count days from when employee started
        const joinDate = userProfile?.dateOfJoining ? new Date(userProfile.dateOfJoining as unknown as string) : null;
        const joinDay = (joinDate && joinDate.getFullYear() === year && joinDate.getMonth() === month)
          ? joinDate.getDate()
          : 1; // If joined in a previous month (or no date), count from 1st

        // Fetch holidays, attendance, and leaves via API in parallel
        const [holsResult, attResult, leavesResult] = await Promise.all([
          api.holidays.list(),
          api.attendance.list({ month: month + 1, year }),
          api.leaves.list({ status: 'approved' }),
        ]);

        // Count working days up to today (exclude weekends + holidays + pre-joining)
        const holidaySet = new Set(
          (holsResult.holidays ?? [])
            .filter((h: { date: string }) => h.date >= `${monthStr}-01` && h.date <= `${monthStr}-${String(today).padStart(2, '0')}`)
            .map((h: { date: string }) => h.date)
        );
        let workingDays = 0;
        for (let d = joinDay; d <= today; d++) {
          const dow = new Date(year, month, d).getDay();
          const dateKey = `${monthStr}-${String(d).padStart(2, '0')}`;
          if (dow !== 0 && dow !== 6 && !holidaySet.has(dateKey)) workingDays++;
        }

        const att = attResult.records ?? [];
        const presentDays = att.length;

        // Get leave days this month
        const leaves = (leavesResult.requests ?? [])
          .filter((l: Record<string, unknown>) => (l.from_date as string) <= `${monthStr}-${daysInMonth}` && (l.to_date as string) >= `${monthStr}-01`);

        let leaveDays = 0;
        for (const l of leaves) {
          const start = new Date(Math.max(new Date(l.from_date).getTime(), new Date(`${monthStr}-01`).getTime()));
          const end = new Date(Math.min(new Date(l.to_date).getTime(), new Date(`${monthStr}-${daysInMonth}`).getTime()));
          for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dow = d.getDay();
            if (dow !== 0 && dow !== 6) leaveDays++;
          }
        }

        const absentDays = Math.max(0, workingDays - presentDays - leaveDays);

        // Avg punch-in
        let avgPunchIn = '--:--';
        if (att.length > 0) {
          const totalMinutes = att.reduce((sum: number, a: { punch_in: string }) => {
            const d = new Date(a.punch_in);
            return sum + d.getHours() * 60 + d.getMinutes();
          }, 0);
          const avgMin = Math.round(totalMinutes / att.length);
          avgPunchIn = `${padTwo(Math.floor(avgMin / 60))}:${padTwo(avgMin % 60)}`;
        }

        setMonthlySummary({ present: presentDays, workingDays, onLeave: leaveDays, absent: absentDays, avgPunchIn });
      } catch (err) {
        console.error('[EmployeeDashboard] monthly summary fetch error:', err);
        toast({ variant: 'error', title: 'Failed to load monthly summary', description: 'Attendance stats may be inaccurate.' });
      }
    })();
  }, [employeeId, userProfile?.dateOfJoining]);

  /* ---- Restore session via API on mount ---- */
  useEffect(() => {
    // Restore today's punch state once per employee. Guarding by employeeId
    // (rather than a boolean) means a re-login / account switch reliably
    // re-runs the restore, while same-id re-renders are skipped.
    if (!employeeId || initDone.current === employeeId) return;
    initDone.current = employeeId;

    (async () => {
      try {
        // Restore an in-progress punch first. An open session (no punch_out)
        // is matched regardless of which calendar day it started on, so a
        // late-night / overnight shift that began "yesterday" in IST still
        // surfaces after the business date rolls over -- the user sees Punch
        // Out instead of being wrongly shown Punch In again. If there's no
        // open session, fall back to today's (completed) record for the
        // "done" state.
        const { records: openRecords } = await api.attendance.openSession();
        let data = openRecords?.[0];

        if (!data) {
          const today = todayDateStr();
          const { records } = await api.attendance.list({ date: today });
          data = records?.[0];
        }
        if (!data) return; // no open session and no record today, stay idle
        if ((data as Record<string, unknown>).work_mode) {
          setWorkMode((data as Record<string, unknown>).work_mode as WorkMode);
        }

        // Segments come joined from the API as attendance_segments
        const rawSegs = (data.attendance_segments ?? []) as { id: string; segment_start: string; segment_end: string | null }[];
        rawSegs.sort((a: { segment_start: string }, b: { segment_start: string }) => a.segment_start.localeCompare(b.segment_start));

        const segments = rawSegs.map((s) => ({
          start: s.segment_start,
          end: s.segment_end,
        }));

        // Calculate total paused time
        let totalPausedMs = 0;
        for (let i = 0; i < segments.length - 1; i++) {
          if (segments[i].end && segments[i + 1]?.start) {
            totalPausedMs += new Date(segments[i + 1].start).getTime() - new Date(segments[i].end!).getTime();
          }
        }

        if (data.punch_out) {
          // Already punched out today
          setSession({
            punchInTime: data.punch_in,
            punchOutTime: data.punch_out,
            segments,
            totalPausedMs,
          });
          setAttendanceId(data.id);
          setPunchState('done');
        } else if (data.punch_in) {
          // Punched in, not out yet - restore active/paused
          const lastSeg = segments[segments.length - 1];
          const isPaused = lastSeg && lastSeg.end !== null;

          setSession({
            punchInTime: data.punch_in,
            punchOutTime: null,
            segments,
            totalPausedMs,
          });
          setAttendanceId(data.id);
          // Store last segment ID for pause/resume operations
          if (rawSegs.length > 0) {
            const lastRawSeg = rawSegs[rawSegs.length - 1];
            setActiveSegmentId(lastRawSeg.segment_end === null ? lastRawSeg.id : null);
          }
          setPunchState(isPaused ? 'paused' : 'active');
        }
      } catch (err) {
        console.error('[EmployeeDashboard] session restore error:', err);
        toast({ variant: 'error', title: 'Failed to restore session', description: 'Could not load today\'s punch data.' });
      }
    })();
  }, [employeeId]);

  const executePunchIn = useCallback(async (selfieDataUrl: string | null, mode?: WorkMode) => {
    if (!employeeId) return;
    setPunchLoading(true);
    const chosenMode = mode ?? workMode;
    try {
      const now = new Date().toISOString();
      const coords = await getPunchCoords();
      const { record: att } = await api.attendance.punchIn({
        ...(coords ?? {}),
        selfie: selfieDataUrl ?? undefined,
        work_mode: chosenMode,
      });

      const { segment } = await api.segments.startBreak(att.id);

      setAttendanceId(att.id);
      setActiveSegmentId(segment.id);
      setSession({
        punchInTime: att.punch_in ?? now,
        punchOutTime: null,
        segments: [{ start: segment.segment_start ?? now, end: null }],
        totalPausedMs: 0,
      });
      setPunchState('active');

      if (att.ip_flagged) {
        toast({
          variant: 'warning',
          title: 'Unknown IP detected',
          description: 'You punched in from an unrecognised network. A regularisation request has been sent to admin for approval.',
        });
      }
    } catch (err) {
      toast({ variant: 'error', title: 'Punch-in failed', description: String(err) });
    }
    setPunchLoading(false);
  }, [employeeId, workMode, toast]);

  const requestPunchIn = useCallback(() => {
    setSelfieAction('punch_in');
    setSelfieModalOpen(true);
  }, []);

  const handlePause = useCallback(async () => {
    if (!attendanceId || !activeSegmentId) return;
    setPunchLoading(true);
    try {
      const now = new Date();

      // Close the active segment via API
      await api.segments.endBreak(activeSegmentId);
      setActiveSegmentId(null);

      setSession((prev) => {
        if (!prev) return prev;
        const s = [...prev.segments];
        const last = s[s.length - 1];
        if (last && !last.end) {
          s[s.length - 1] = { ...last, end: now.toISOString() };
        }
        return { ...prev, segments: s };
      });
      setPunchState('paused');
    } catch (err) {
      toast({ variant: 'error', title: 'Pause failed', description: String(err) });
    }
    setPunchLoading(false);
  }, [attendanceId, activeSegmentId, toast]);

  const handleResume = useCallback(async () => {
    if (!attendanceId) return;
    setPunchLoading(true);
    try {
      const now = new Date();

      // Create new segment via API
      const { segment } = await api.segments.startBreak(attendanceId);
      setActiveSegmentId(segment.id);

      setSession((prev) => {
        if (!prev) return prev;
        const lastSeg = prev.segments[prev.segments.length - 1];
        const pauseMs = lastSeg?.end
          ? now.getTime() - new Date(lastSeg.end).getTime()
          : 0;
        return {
          ...prev,
          totalPausedMs: prev.totalPausedMs + pauseMs,
          segments: [...prev.segments, { start: segment.segment_start ?? now.toISOString(), end: null }],
        };
      });
      setPunchState('active');
    } catch (err) {
      toast({ variant: 'error', title: 'Resume failed', description: String(err) });
    }
    setPunchLoading(false);
  }, [attendanceId, toast]);

  const executePunchOut = useCallback(async (selfieDataUrl: string | null, mode?: WorkMode) => {
    if (!attendanceId) return;
    setPunchLoading(true);
    const chosenMode = mode ?? workMode;
    try {
      const now = new Date();
      if (activeSegmentId) {
        await api.segments.endBreak(activeSegmentId);
        setActiveSegmentId(null);
      }

      const coords = await getPunchCoords();
      const { record: att } = await api.attendance.punchOut({
        ...(coords ?? {}),
        selfie: selfieDataUrl ?? undefined,
        work_mode: chosenMode,
      });

      setSession((prev) => {
        if (!prev) return prev;
        const segs = [...prev.segments];
        const last = segs[segs.length - 1];
        if (last && !last.end) {
          segs[segs.length - 1] = { ...last, end: now.toISOString() };
        }
        let extraPause = 0;
        if (punchState === 'paused' && last?.end) {
          extraPause = now.getTime() - new Date(last.end).getTime();
        }
        return { ...prev, punchOutTime: now.toISOString(), segments: segs, totalPausedMs: prev.totalPausedMs + extraPause };
      });
      setPunchState('done');

      if (att?.ip_flagged) {
        toast({
          variant: 'error',
          title: 'Unauthorized IP detected',
          description: 'You punched out from an unrecognised network. A regularisation request has been sent to your admin for approval.',
        });
      }
    } catch (err) {
      toast({ variant: 'error', title: 'Punch-out failed', description: String(err) });
    }
    setPunchLoading(false);
  }, [attendanceId, activeSegmentId, punchState, workMode, toast]);

  const requestPunchOut = useCallback(() => {
    setSelfieAction('punch_out');
    setSelfieModalOpen(true);
  }, []);

  const handleSelfieCaptured = useCallback(async (selfieDataUrl: string | null, selectedMode: WorkMode) => {
    setWorkMode(selectedMode);
    setSelfieModalOpen(false);
    if (selfieAction === 'punch_in') {
      await executePunchIn(selfieDataUrl, selectedMode);
    } else {
      await executePunchOut(selfieDataUrl, selectedMode);
    }
  }, [selfieAction, executePunchIn, executePunchOut]);

  /* ---- Auto punch-out after MAX_SESSION_MS ---- */
  useEffect(() => {
    if (punchState !== 'active' && punchState !== 'paused') return;
    if (!session) return;

    const id = setInterval(() => {
      const elapsed = Date.now() - new Date(session.punchInTime).getTime();
      if (elapsed >= MAX_SESSION_MS && !autoPunchOutFired.current) {
        autoPunchOutFired.current = true;
        // Persist via the real punch-out API (handles segments + worked_hours
        // server-side, capped at the session limit). Do NOT only mutate state,
        // otherwise the open record would remain in the DB.
        void executePunchOut(null);
        toast({
          variant: 'error',
          title: 'Auto punched out',
          description: `Your session exceeded ${MAX_SESSION_MS / 3_600_000}h. You have been automatically punched out. Submit a regularisation request if needed.`,
        });
        return;
      }

      // A break is not meant to run forever. If the user paused and never
      // resumed, auto punch them out once the continuous break exceeds the cap
      // (real worked segments are still credited; the abandoned break is not).
      if (punchState === 'paused' && !autoPunchOutFired.current) {
        const breakMs = calcBreakMs(session);
        if (breakMs >= MAX_BREAK_MS) {
          autoPunchOutFired.current = true;
          void executePunchOut(null);
          toast({
            variant: 'error',
            title: 'Auto punched out (break too long)',
            description: `Your break exceeded ${MAX_BREAK_MS / 3_600_000}h, so you have been automatically punched out. Submit a regularisation request if needed.`,
          });
        }
      }
    }, 30_000); // check every 30s

    return () => clearInterval(id);
  }, [punchState, session, toast, executePunchOut]);

  /* ---- Reset auto-fire flag on new punch-in ---- */
  useEffect(() => {
    if (punchState === 'idle' || punchState === 'active') {
      autoPunchOutFired.current = false;
    }
  }, [punchState]);

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
        {/* ---- Left Column ---- */}
        <div className="space-y-4 min-w-0">
          {userProfile?.tracksAttendance !== false && (
            <PunchCard
              punchState={punchState}
              session={session}
              punchLoading={punchLoading}
              onPunchIn={requestPunchIn}
              onPause={handlePause}
              onResume={handleResume}
              onPunchOut={requestPunchOut}
              ipCheck={ipCheck}
              monthlySummary={monthlySummary}
              workMode={workMode}
            />
          )}
          <UpcomingCard />
          <LeaveBalanceCard employeeId={employeeId} />
        </div>

        {/* ---- Right Column ---- */}
        <div className="space-y-4 min-w-0">
          <PendingActionsCard employeeId={employeeId} />
          <MiniMonthHeatmap employeeId={employeeId} joiningDate={userProfile?.dateOfJoining as unknown as string} />
          <ActivityCard employeeId={employeeId} />
        </div>
      </div>
      <SelfieModal
        open={selfieModalOpen}
        onClose={() => setSelfieModalOpen(false)}
        actionType={selfieAction}
        initialWorkMode={workMode}
        onCapture={handleSelfieCaptured}
        loading={punchLoading}
      />
    </>
  );
}
