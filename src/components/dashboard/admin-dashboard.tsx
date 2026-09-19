'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  Inbox,
  ShieldAlert,
  Clock,
  UserPen,
  AlertTriangle,
  ChevronRight,
  Ban,
  MinusCircle,
  Check,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { useIpCheck } from '@/hooks/useIpCheck';
import { useAuth } from '@/contexts/AuthContext';
import api from '@/lib/api-client';
import { businessDate } from '@/lib/dates';
import {
  PunchCard,
  LeaveBalanceCard,
  UpcomingCard,
  ActivityCard,
} from './employee-dashboard';
import { HRAnalytics } from './hr-analytics';
import { calcBreakMs, MAX_BREAK_MS, getPunchCoords } from './punch-button';
import type { PunchState, PunchSession } from './punch-button';

const MAX_SESSION_MS = 12 * 60 * 60 * 1000;

/* ================================================================== */
/*  Types                                                              */
/* ================================================================== */

type PendingItem = { label: string; count: number; Icon: React.ComponentType<{ className?: string }>; iconBg: string; iconColor: string; href: string };

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */

function formatAdminDate(): string {
  const now = new Date();
  return now.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }) + ' - ' + now.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }) + ' IST';
}

/* ================================================================== */
/*  Admin-specific components                                          */
/* ================================================================== */

/* ---------- Presence list ---------- */

function PresenceList({
  title,
  dotColor,
  children,
}: {
  title: string;
  dotColor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2.5">
        <span className={`h-[6px] w-[6px] rounded-full ${dotColor}`} />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{title}</span>
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

/* ---------- Admin Today Card ---------- */

type Absentee = { id: string; employeeId: string; name: string; department: string };
type LeaveTypeOption = { id: string; name: string; key: string };

function MarkAbsentDropdown({
  employee,
  date,
  leaveTypes,
  onMarked,
}: {
  employee: Absentee;
  date: string;
  leaveTypes: LeaveTypeOption[];
  onMarked: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  async function handleAction(action: 'lop' | 'deduct_leave', leaveTypeId?: string) {
    setLoading(true);
    try {
      const result = await api.attendance.markAbsent({
        employee_id: employee.id,
        date,
        action,
        leave_type_id: leaveTypeId,
      });
      const label = action === 'lop'
        ? 'Marked as Loss of Pay'
        : `Deducted from ${result.leaveType ?? 'leave'}`;
      toast({ variant: 'success', title: label, description: `${employee.name} on ${date}` });
      onMarked(employee.id);
      setOpen(false);
    } catch (err) {
      toast({ variant: 'error', title: 'Failed', description: String(err) });
    }
    setLoading(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        disabled={loading}
        className="text-[10px] font-medium text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 px-2 py-0.5 rounded transition-colors disabled:opacity-50 whitespace-nowrap"
      >
        {loading ? 'Marking...' : 'Mark absent'}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-white rounded-lg shadow-lg border border-gray-200 w-56 py-1">
          <button
            onClick={() => handleAction('lop')}
            className="flex items-center gap-2 w-full px-3 py-2 text-left text-[12px] text-gray-700 hover:bg-gray-50"
          >
            <Ban className="h-3.5 w-3.5 text-red-500" />
            Loss of Pay (LOP)
          </button>
          <div className="border-t border-gray-100 my-1" />
          <div className="px-3 py-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Deduct from leave</span>
          </div>
          {leaveTypes
            .filter((lt) => ['casual', 'sick', 'earned'].includes(lt.key))
            .map((lt) => (
              <button
                key={lt.id}
                onClick={() => handleAction('deduct_leave', lt.id)}
                className="flex items-center gap-2 w-full px-3 py-2 text-left text-[12px] text-gray-700 hover:bg-gray-50"
              >
                <MinusCircle className="h-3.5 w-3.5 text-amber-500" />
                {lt.name}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

function AdminTodayCard() {
  const [present, setPresent] = useState<{ name: string; avatar: string; punchIn: string }[]>([]);
  const [onLeave, setOnLeave] = useState<{ name: string; avatar: string; leaveType: string }[]>([]);
  const [notPunched, setNotPunched] = useState<Absentee[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeOption[]>([]);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const refreshAbsentees = useCallback(async () => {
    try {
      const today = businessDate();
      const result = await api.attendance.absentees({ date: today });
      if (result.isHoliday) {
        setStatusNote('Today is a holiday');
        setNotPunched([]);
      } else if (result.isWeekend) {
        setStatusNote('Today is a weekend');
        setNotPunched([]);
      } else {
        setStatusNote(null);
        setNotPunched(result.absentees ?? []);
      }
    } catch (err) {
      console.error('[AdminTodayCard] absentees refresh error:', err);
    }
  }, []);

  useEffect(() => {
    async function fetchTodayStats() {
      try {
        const today = businessDate();

        // Fetch today's attendance, open overnight sessions, leaves, and
        // absentees in parallel. Open sessions catch night-shift workers whose
        // punch-in row is dated an earlier business day but who are still in.
        const [attResult, openResult, leavesResult, absenteesResult] = await Promise.all([
          api.attendance.list({ date: today }),
          api.attendance.openSessions().catch(() => ({ records: [] })),
          api.leaves.list(),
          api.attendance.absentees({ date: today }),
        ]);

        const att = attResult.records ?? [];
        const leaves = leavesResult.requests ?? [];

        // "Present" = actually punched in today. Records can exist with a null
        // punch_in (e.g. observers/segments), so filter on punch_in.
        const presentList = att
          .filter((a: Record<string, unknown>) => !!a.punch_in)
          .map((a: Record<string, unknown>) => {
            const emp = a.employees as { name?: string } | null;
            const name = emp?.name ?? 'Unknown';
            const initials = name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
            const punchIn = a.punch_in
              ? new Date(a.punch_in as string).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
              : '';
            return { name, avatar: initials, punchIn };
          });

        // Merge open overnight sessions (dated an earlier day) into Present so
        // night-shift workers don't vanish from the dashboard at midnight.
        const seenToday = new Set(
          att.filter((a: Record<string, unknown>) => !!a.punch_in)
            .map((a: Record<string, unknown>) => (a.employees as { id?: string } | null)?.id ?? a.employee_id),
        );
        for (const o of (openResult.records ?? []) as Record<string, unknown>[]) {
          const empId = (o.employees as { id?: string } | null)?.id ?? o.employee_id;
          if (seenToday.has(empId)) continue;
          const emp = o.employees as { name?: string } | null;
          const name = emp?.name ?? 'Unknown';
          const initials = name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
          const punchIn = o.punch_in
            ? new Date(o.punch_in as string).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
            : '';
          // Mark overnight sessions so the admin sees the punch-in was yesterday.
          presentList.push({ name, avatar: initials, punchIn: `${punchIn} (prev. day)` });
          seenToday.add(empId);
        }
        setPresent(presentList);

        if (leaves.length > 0) {
          const todayLeaves = leaves.filter((l: Record<string, unknown>) =>
            l.status === 'approved' && l.from_date && l.to_date &&
            (l.from_date as string) <= today && (l.to_date as string) >= today,
          );
          const leaveList = todayLeaves.map((l: Record<string, unknown>) => {
            const emp = l.employees as { name: string } | null;
            const lt = l.leave_types as { name: string } | null;
            const initials = (emp?.name ?? '').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
            return { name: emp?.name ?? 'Unknown', avatar: initials, leaveType: lt?.name ?? 'Leave' };
          });
          setOnLeave(leaveList);
        }

        // Use absentees API (holiday/weekend aware)
        if (absenteesResult.isHoliday) {
          setStatusNote('Today is a holiday');
          setNotPunched([]);
        } else if (absenteesResult.isWeekend) {
          setStatusNote('Today is a weekend');
          setNotPunched([]);
        } else {
          setStatusNote(null);
          setNotPunched(absenteesResult.absentees ?? []);
        }

        // Fetch leave types for the mark-absent dropdown
        const ltResult = await api.leaves.list();
        setLeaveTypes((ltResult.leaveTypes ?? []) as LeaveTypeOption[]);
      } catch (err) {
        console.error('[AdminTodayCard] fetch error:', err);
        setFetchError('Unable to load today\'s attendance data');
      }
    }
    fetchTodayStats();
  }, []);

  function handleMarked(employeeId: string) {
    setNotPunched((prev) => prev.filter((e) => e.id !== employeeId));
  }

  const today = businessDate();
  const presentCount = present.length;
  const absentCount = notPunched.length;
  const leaveCount = onLeave.length;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <CardTitle>Today across August</CardTitle>
            <CardDescription className="mt-0.5">{formatAdminDate()}</CardDescription>
          </div>
          {!fetchError && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge variant="green">{presentCount} present</Badge>
              <Badge variant="red">{absentCount} absent</Badge>
              <Badge variant="purple">{leaveCount} on leave</Badge>
            </div>
          )}
        </div>
      </CardHeader>
      {fetchError ? (
        <CardContent>
          <p className="text-[12px] text-red-500 text-center py-4">{fetchError}</p>
        </CardContent>
      ) : (
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {/* Present */}
          <PresenceList title="Present" dotColor="bg-green-500">
            {present.map((p, i) => (
              <div key={`${p.name}-${i}`} className="flex items-center gap-2.5">
                <div className="h-7 w-7 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                  <span className="text-[9px] font-semibold text-gray-500">{p.avatar}</span>
                </div>
                <span className="flex-1 text-[12px] text-gray-700 truncate">{p.name}</span>
                <span className="font-mono text-[11px] tabular-nums text-gray-400 shrink-0">{p.punchIn}</span>
              </div>
            ))}
          </PresenceList>

          {/* On leave */}
          <PresenceList title="On leave" dotColor="bg-purple-500">
            {onLeave.map((p, i) => (
              <div key={`${p.name}-${i}`} className="flex items-center gap-2.5">
                <div className="h-7 w-7 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                  <span className="text-[9px] font-semibold text-gray-500">{p.avatar}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-[12px] text-gray-700 truncate block">{p.name}</span>
                  <span className="text-[10px] text-gray-400">{p.leaveType}</span>
                </div>
              </div>
            ))}
          </PresenceList>

          {/* Not yet punched in */}
          <PresenceList title={statusNote ? statusNote : 'Not yet punched in'} dotColor="bg-red-500">
            {statusNote ? (
              <p className="text-[11px] text-gray-400 italic">No absences to track</p>
            ) : notPunched.length === 0 ? (
              <div className="flex items-center gap-2 py-1">
                <Check className="h-3.5 w-3.5 text-green-500" />
                <span className="text-[12px] text-gray-500">Everyone has punched in or is on leave</span>
              </div>
            ) : (
              notPunched.map((p) => {
                const initials = p.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
                return (
                  <div key={p.id} className="flex items-center gap-2.5">
                    <div className="h-7 w-7 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                      <span className="text-[9px] font-semibold text-gray-500">{initials}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-[12px] text-gray-700 truncate block">{p.name}</span>
                      <span className="text-[10px] text-gray-400">{p.department}</span>
                    </div>
                    <MarkAbsentDropdown
                      employee={p}
                      date={today}
                      leaveTypes={leaveTypes}
                      onMarked={handleMarked}
                    />
                  </div>
                );
              })
            )}
          </PresenceList>
        </div>
      </CardContent>
      )}
    </Card>
  );
}

/* ---------- Admin Pending Actions Card ---------- */

function AdminPendingActionsCard() {
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchPendingCounts() {
      try {
        const [stats, absenteesResult] = await Promise.all([
          api.dashboardStats.get(),
          api.attendance.absentees(),
        ]);
        const leaveCount = stats.pendingLeaves ?? 0;
        const regCount = stats.pendingRegularisations ?? 0;
        const ipCount = stats.pendingIpViolations ?? 0;
        const onboardingCount = stats.pendingOnboarding ?? 0;
        const absentCount = absenteesResult.absentees?.length ?? 0;

        const items: PendingItem[] = [];
        if (absentCount > 0) items.push({ label: 'Employees absent without leave', count: absentCount, Icon: AlertTriangle, iconBg: 'bg-red-50', iconColor: 'text-red-600', href: '/dashboard' });
        if ((leaveCount ?? 0) > 0) items.push({ label: 'Leave requests awaiting review', count: leaveCount ?? 0, Icon: Inbox, iconBg: 'bg-blue-50', iconColor: 'text-blue-600', href: '/approvals' });
        if ((onboardingCount ?? 0) > 0) items.push({ label: 'Onboarding submissions to review', count: onboardingCount ?? 0, Icon: UserPen, iconBg: 'bg-purple-50', iconColor: 'text-purple-600', href: '/onboarding/submissions' });
        if ((ipCount ?? 0) > 0) items.push({ label: 'Unknown IP punch-in requests', count: ipCount ?? 0, Icon: ShieldAlert, iconBg: 'bg-red-50', iconColor: 'text-red-600', href: '/settings/ip-allowlist' });
        if ((regCount ?? 0) > 0) items.push({ label: 'Regularisation requests', count: regCount ?? 0, Icon: Clock, iconBg: 'bg-amber-50', iconColor: 'text-amber-600', href: '/approvals' });
        setPendingItems(items);
      } catch (err) {
        console.error('[AdminPendingActionsCard] fetch error:', err);
        setFetchError('Unable to load pending actions');
      }
    }
    fetchPendingCounts();
  }, []);

  const totalPending = pendingItems.reduce((sum, item) => sum + item.count, 0);

  if (pendingItems.length === 0 && !fetchError) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Pending actions
          {totalPending > 0 && <Badge variant="amber" className="ml-1">{totalPending}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {fetchError ? (
          <p className="text-[12px] text-red-500 text-center py-4 px-4">{fetchError}</p>
        ) : pendingItems.map((item, i) => {
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
              <span className="font-mono text-[11px] tabular-nums text-gray-400 mr-1">{item.count}</span>
              <ChevronRight className="h-3.5 w-3.5 text-gray-300 shrink-0" />
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}

/* ================================================================== */
/*  Main Component                                                     */
/* ================================================================== */

export function AdminDashboard() {
  const { userProfile } = useAuth();
  const employeeId = userProfile?.id;

  /* Punch state (same pattern as employee dashboard) */
  const [punchState, setPunchState] = useState<PunchState>('idle');
  const [session, setSession] = useState<PunchSession | null>(null);
  const [punchLoading, setPunchLoading] = useState(false);
  const [attendanceId, setAttendanceId] = useState<string | null>(null);
  const [monthlySummary] = useState({ present: 0, workingDays: 0, onLeave: 0, absent: 0, avgPunchIn: '--:--' });
  const { toast } = useToast();
  const autoPunchOutFired = useRef(false);
  const ipCheck = useIpCheck();
  const initDone = useRef(false);

  /** Today's date as YYYY-MM-DD in local timezone */
  function todayDateStr(): string {
    return businessDate();
  }

  /* ---- Restore session from Supabase on mount ---- */
  useEffect(() => {
    if (!employeeId || initDone.current) return;
    initDone.current = true;

    (async () => {
      try {
        // Restore an in-progress punch first: an open session (no punch_out)
        // is matched regardless of which calendar day it started on, so a
        // late-night / overnight shift that began "yesterday" in IST still
        // shows Punch Out after the business date rolls over. Fall back to
        // today's completed record only for the "done" state.
        const { records: openRecords } = await api.attendance.openSession();
        let data = openRecords?.[0] ?? null;

        if (!data) {
          const today = todayDateStr();
          const { records } = await api.attendance.list({ date: today });
          data = records?.[0] ?? null;
        }

        if (!data) return;

        if (data.punch_out) {
          const segs = data.attendance_segments ?? [];

          const segments = segs.map((s: { segment_start: string; segment_end: string | null }) => ({
            start: s.segment_start, end: s.segment_end,
          }));
          let totalPausedMs = 0;
          for (let i = 0; i < segments.length - 1; i++) {
            if (segments[i].end && segments[i + 1]?.start) {
              totalPausedMs += new Date(segments[i + 1].start).getTime() - new Date(segments[i].end!).getTime();
            }
          }
          setSession({ punchInTime: data.punch_in, punchOutTime: data.punch_out, segments, totalPausedMs });
          setAttendanceId(data.id);
          setPunchState('done');
        } else if (data.punch_in) {
          const segs = data.attendance_segments ?? [];

          const segments = segs.map((s: { segment_start: string; segment_end: string | null }) => ({
            start: s.segment_start, end: s.segment_end,
          }));
          let totalPausedMs = 0;
          for (let i = 0; i < segments.length - 1; i++) {
            if (segments[i].end && segments[i + 1]?.start) {
              totalPausedMs += new Date(segments[i + 1].start).getTime() - new Date(segments[i].end!).getTime();
            }
          }
          const lastSeg = segments[segments.length - 1];
          const isPaused = lastSeg && lastSeg.end !== null;
          setSession({ punchInTime: data.punch_in, punchOutTime: null, segments, totalPausedMs });
          setAttendanceId(data.id);
          setPunchState(isPaused ? 'paused' : 'active');
        }
      } catch (err) {
        console.error('[AdminDashboard] session restore error:', err);
        toast({ variant: 'error', title: 'Failed to restore session', description: 'Could not load today\'s punch data.' });
      }
    })();
  }, [employeeId]);

  const handlePunchIn = useCallback(async () => {
    if (!employeeId) return;
    setPunchLoading(true);
    try {
      const now = new Date().toISOString();

      // Punch in. The server detects the real IP, decides the flag, and
      // (when flagged) creates the IP-violation approval request itself.
      // Best-effort location for geofencing; null (denied/unavailable) never blocks.
      const coords = await getPunchCoords();
      const { record: att } = await api.attendance.punchIn(coords ?? undefined);

      await api.segments.startBreak(att.id);

      setAttendanceId(att.id);
      setSession({ punchInTime: now, punchOutTime: null, segments: [{ start: now, end: null }], totalPausedMs: 0 });
      setPunchState('active');

      // If the server flagged this punch (unrecognized IP), inform the user.
      if (att.ip_flagged) {
        toast({
          variant: 'warning',
          title: 'Unknown IP detected',
          description: 'Punched in from an unrecognised network. A regularisation request has been created.',
        });
      }
    } catch (err) {
      toast({ variant: 'error', title: 'Punch-in failed', description: String(err) });
    }
    setPunchLoading(false);
  }, [employeeId, toast]);

  const handlePause = useCallback(async () => {
    if (!attendanceId) return;
    setPunchLoading(true);
    try {
      const now = new Date();
      // Find open segment from attendance record
      const { records } = await api.attendance.list({ date: todayDateStr() });
      const todayRec = records?.[0];
      const dbSegs = todayRec?.attendance_segments ?? [];
      const openSeg = dbSegs.find((s: any) => !s.segment_end);
      if (openSeg) {
        await api.segments.endBreak(openSeg.id);
      }

      setSession((prev) => {
        if (!prev) return prev;
        const s = [...prev.segments];
        const last = s[s.length - 1];
        if (last && !last.end) s[s.length - 1] = { ...last, end: now.toISOString() };
        return { ...prev, segments: s };
      });
      setPunchState('paused');
    } catch (err) {
      toast({ variant: 'error', title: 'Pause failed', description: String(err) });
    }
    setPunchLoading(false);
  }, [attendanceId, toast]);

  const handleResume = useCallback(async () => {
    if (!attendanceId) return;
    setPunchLoading(true);
    try {
      const now = new Date();
      await api.segments.startBreak(attendanceId);

      setSession((prev) => {
        if (!prev) return prev;
        const lastSeg = prev.segments[prev.segments.length - 1];
        const pauseMs = lastSeg?.end ? now.getTime() - new Date(lastSeg.end).getTime() : 0;
        return { ...prev, totalPausedMs: prev.totalPausedMs + pauseMs, segments: [...prev.segments, { start: now.toISOString(), end: null }] };
      });
      setPunchState('active');
    } catch (err) {
      toast({ variant: 'error', title: 'Resume failed', description: String(err) });
    }
    setPunchLoading(false);
  }, [attendanceId, toast]);

  const handlePunchOut = useCallback(async () => {
    if (!attendanceId) return;
    setPunchLoading(true);
    try {
      const now = new Date();

      // Close last open segment and punch out via API
      const { records } = await api.attendance.list({ date: todayDateStr() });
      const todayRec = records?.[0];
      const dbSegs = todayRec?.attendance_segments ?? [];
      const openSeg = dbSegs.find((s: any) => !s.segment_end);
      if (openSeg) {
        await api.segments.endBreak(openSeg.id);
      }

      // Punch out via API (server calculates worked hours)
      await api.attendance.punchOut();

      setSession((prev) => {
        if (!prev) return prev;
        const segs = [...prev.segments];
        const last = segs[segs.length - 1];
        if (last && !last.end) segs[segs.length - 1] = { ...last, end: now.toISOString() };
        let extraPause = 0;
        if (punchState === 'paused' && last?.end) {
          extraPause = now.getTime() - new Date(last.end).getTime();
        }
        return { ...prev, punchOutTime: now.toISOString(), segments: segs, totalPausedMs: prev.totalPausedMs + extraPause };
      });
      setPunchState('done');
    } catch (err) {
      toast({ variant: 'error', title: 'Punch-out failed', description: String(err) });
    }
    setPunchLoading(false);
  }, [attendanceId, punchState, toast]);

  /* ---- Auto punch-out after MAX_SESSION_MS ---- */
  useEffect(() => {
    if (punchState !== 'active' && punchState !== 'paused') return;
    if (!session) return;

    const id = setInterval(() => {
      const elapsed = Date.now() - new Date(session.punchInTime).getTime();
      if (elapsed >= MAX_SESSION_MS && !autoPunchOutFired.current) {
        autoPunchOutFired.current = true;
        // Persist via the real punch-out API so the open record is closed in
        // the DB (worked_hours computed + capped server-side).
        void handlePunchOut();
        toast({
          variant: 'error',
          title: 'Auto punched out',
          description: `Your session exceeded ${MAX_SESSION_MS / 3_600_000}h. You have been automatically punched out.`,
        });
        return;
      }

      // A break is not meant to run forever: auto punch-out once a continuous
      // break exceeds the cap (real worked segments are still credited).
      if (punchState === 'paused' && !autoPunchOutFired.current) {
        if (calcBreakMs(session) >= MAX_BREAK_MS) {
          autoPunchOutFired.current = true;
          void handlePunchOut();
          toast({
            variant: 'error',
            title: 'Auto punched out (break too long)',
            description: `Your break exceeded ${MAX_BREAK_MS / 3_600_000}h, so you have been automatically punched out.`,
          });
        }
      }
    }, 30_000);

    return () => clearInterval(id);
  }, [punchState, session, toast, handlePunchOut]);

  useEffect(() => {
    if (punchState === 'idle' || punchState === 'active') {
      autoPunchOutFired.current = false;
    }
  }, [punchState]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
        {/* ---- Left Column ---- */}
        <div className="space-y-4 min-w-0">
          {userProfile?.tracksAttendance !== false && (
            <PunchCard
              punchState={punchState}
              session={session}
              punchLoading={punchLoading}
              onPunchIn={handlePunchIn}
              onPause={handlePause}
              onResume={handleResume}
              onPunchOut={handlePunchOut}
              ipCheck={ipCheck}
              monthlySummary={monthlySummary}
            />
          )}
          <AdminTodayCard />
          <LeaveBalanceCard employeeId={employeeId} />
        </div>

        {/* ---- Right Column ---- */}
        <div className="space-y-4 min-w-0">
          <AdminPendingActionsCard />
          <UpcomingCard showTeamLeaves />
          <ActivityCard employeeId={employeeId} />
        </div>
      </div>

      {/* ---- HR Analytics Section ---- */}
      <HRAnalytics />
    </div>
  );
}
