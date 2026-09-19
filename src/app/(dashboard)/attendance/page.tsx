"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Skeleton, SkeletonPageHeader, SkeletonTable } from "@/components/ui/skeleton";
import {
  ChevronLeft,
  ChevronRight,
  Play,
  Square,
  Globe,
  AlertTriangle,
  MoreHorizontal,
  Calendar as CalendarIcon,
  List,
  Clock,
  Info,
} from "lucide-react";

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

type AttendanceStatus =
  | "present"
  | "half"
  | "absent"
  | "leave"
  | "holiday"
  | "weekend"
  | "future";

interface DayRecord {
  date: Date;
  status: AttendanceStatus;
  punchIn?: string;
  punchOut?: string;
  totalHours?: number;
  holidayName?: string;
  leaveType?: string;
  isLate?: boolean;
  isOvertime?: boolean;
  isFlagged?: boolean;
  isActiveSession?: boolean;
  ip?: string;
  breakTime?: string;
  note?: string;
  leaveApprovedBy?: string;
  leaveDaysUsed?: number;
  leaveReason?: string;
}

interface RegularisationForm {
  punchIn: string;
  punchOut: string;
  caseType: string;
  reason: string;
}

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const MONTH_NAMES_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const DAY_NAMES_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_NAMES_FULL = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Local-timezone date key (YYYY-MM-DD). Must NOT use toISOString(), which
 * converts to UTC: for users ahead of UTC (e.g. IST, +5:30) a local midnight
 * Date shifts back to the previous calendar day, so DB records would overlay on
 * the wrong (or no) cell and never appear. Building the key from local Y/M/D
 * keeps it consistent with the locally-constructed calendar grid.
 */
function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateLong(d: Date) {
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function getDayLabel(d: Date, today: Date) {
  const dayName = DAY_NAMES_FULL[d.getDay()];
  if (isSameDay(d, today)) return `${dayName} \u2014 today`;
  return dayName;
}

// ---------------------------------------------------------------------------
//  Calendar day generator (populated with real DB data)
// ---------------------------------------------------------------------------

function padTime(h: number, m: number) {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function generateCalendarDays(year: number, month: number, joiningDate?: string): DayRecord[] {
  const today = new Date();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const records: DayRecord[] = [];

  // Parse joining date - days before joining are "not applicable". Guard
  // against an invalid / unparseable value so we never produce an Invalid Date
  // (which makes every comparison false and wrongly marks pre-join days absent).
  const parsedJoin = joiningDate ? new Date(joiningDate) : null;
  const joinDate = parsedJoin && !Number.isNaN(parsedJoin.getTime()) ? parsedJoin : null;

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    const dow = date.getDay(); // 0=Sun, 6=Sat
    const isFuture = date > today && !isSameDay(date, today);

    // Before joining date - empty/not applicable
    if (joinDate && date < new Date(joinDate.getFullYear(), joinDate.getMonth(), joinDate.getDate())) {
      records.push({ date, status: "future" });
      continue;
    }

    // Future
    if (isFuture) {
      records.push({ date, status: "future" });
      continue;
    }

    // Weekends
    if (dow === 0 || dow === 6) {
      records.push({ date, status: "weekend" });
      continue;
    }

    // Past/today weekdays with no attendance data yet - show as "no record"
    records.push({ date, status: "absent" });
  }

  return records;
}

// Map a raw DB attendance status to a UI status the calendar understands.
// The DB stores operational statuses ('present', 'active', 'auto_punched_out',
// ...) which are a different vocabulary from the calendar's display statuses.
// Anything that represents a worked day (has punches) renders as "present";
// only explicit leave/holiday map across. Unknown values must NOT fall through
// to `undefined`, otherwise STATUS_PILL[status] is undefined and the whole page
// crashes while rendering ("cannot read properties of undefined").
function mapDbStatus(raw: unknown, hasPunchIn: boolean): AttendanceStatus {
  const s = String(raw ?? '').toLowerCase();
  switch (s) {
    case 'leave':
    case 'on_leave':
      return 'leave';
    case 'holiday':
      return 'holiday';
    case 'weekend':
      return 'weekend';
    case 'half':
    case 'half_day':
      return 'half';
    case 'absent':
      return 'absent';
    // present / active / auto_punched_out / anything else with a punch = present.
    default:
      return hasPunchIn ? 'present' : 'absent';
  }
}

// ---------------------------------------------------------------------------
//  Status pill config
// ---------------------------------------------------------------------------

const STATUS_PILL: Record<
  AttendanceStatus,
  { label: string; variant: "green" | "amber" | "red" | "purple" | "blue" | "slate"; }
> = {
  present: { label: "Present", variant: "green" },
  half: { label: "Half day", variant: "amber" },
  absent: { label: "Absent", variant: "red" },
  leave: { label: "On leave", variant: "purple" },
  holiday: { label: "Holiday", variant: "amber" },
  weekend: { label: "Weekend", variant: "slate" },
  future: { label: "Upcoming", variant: "slate" },
};

const CASE_OPTIONS = [
  { label: "Auto punched out", value: "auto_punched_out" },
  { label: "Missed punch-in or punch-out", value: "missed_punch" },
  { label: "Wrong times", value: "wrong_times" },
];

// ---------------------------------------------------------------------------
//  Sub-components
// ---------------------------------------------------------------------------

/** Stat card in the stats row */
function StatCard({
  label,
  value,
  delta,
  dotColor,
}: {
  label: string;
  value: string;
  delta: string;
  dotColor: string;
}) {
  return (
    <Card>
      <CardContent className="px-4 py-3">
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className={cn("h-[6px] w-[6px] rounded-full shrink-0", dotColor)} />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            {label}
          </span>
        </div>
        <div className="font-mono text-[20px] font-semibold text-gray-900 tabular-nums leading-tight">
          {value}
        </div>
        <div className="text-[11px] text-gray-500 mt-0.5">{delta}</div>
      </CardContent>
    </Card>
  );
}

/** Status pill in calendar cell */
function CellPill({ status, isActive }: { status: AttendanceStatus; isActive?: boolean }) {
  const cfg = STATUS_PILL[status] ?? STATUS_PILL.absent;
  if (status === "present" && isActive) {
    return (
      <Badge variant="green" className="text-[8px] px-1 py-0 leading-tight">
        Active session
      </Badge>
    );
  }
  if (status === "future") return <span className="text-gray-300 text-[10px]">&mdash;</span>;
  return (
    <Badge variant={cfg.variant} className="text-[8px] px-1 py-0 leading-tight">
      {cfg.label}
    </Badge>
  );
}

/** Time row inside a calendar cell */
function CellTime({
  label,
  time,
  isLate,
  isOt,
}: {
  label: string;
  time: string;
  isLate?: boolean;
  isOt?: boolean;
}) {
  return (
    <span className="flex items-baseline gap-1 text-[9px] leading-none">
      <span className="text-gray-400 w-[16px]">{label}</span>
      <span
        className={cn(
          "font-mono tabular-nums",
          isLate ? "text-amber-600" : isOt ? "text-blue-600" : "text-gray-600",
        )}
      >
        {time}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
//  Day Detail Panel Sub-components
// ---------------------------------------------------------------------------

function TimelineRow({
  icon: Icon,
  iconBg,
  label,
  value,
  note,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconBg: string;
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <div
        className={cn(
          "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded",
          iconBg,
        )}
      >
        <Icon className="h-3 w-3" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] uppercase tracking-wide text-gray-500 font-medium">
          {label}
        </div>
        <div className="font-mono text-[13px] text-gray-900 tabular-nums">{value}</div>
        {note && <div className="text-[11px] text-gray-400 mt-0.5">{note}</div>}
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[11px] text-gray-500">{label}</span>
      <span className="text-[12px] font-medium text-gray-900">{value}</span>
    </div>
  );
}

function WarningBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-2.5 mt-3">
      <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
      <span className="text-[11px] text-amber-800">{message}</span>
    </div>
  );
}

function DangerBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-2.5 mt-3">
      <AlertTriangle className="h-3.5 w-3.5 text-red-600 shrink-0 mt-0.5" />
      <span className="text-[11px] text-red-800">{message}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Day Detail Panel
// ---------------------------------------------------------------------------

function DayDetailPanel({
  record,
  today,
  onRegularise,
  isAdmin,
}: {
  record: DayRecord;
  today: Date;
  onRegularise: () => void;
  isAdmin?: boolean;
}) {
  const isToday = isSameDay(record.date, today);
  const statusCfg = STATUS_PILL[record.status] ?? STATUS_PILL.absent;

  return (
    <Card className="sticky top-4 w-full">
      <CardHeader className="flex-col items-start gap-0.5">
        <CardTitle className="text-[14px]">{formatDateLong(record.date)}</CardTitle>
        <span className="text-[11px] text-gray-500">
          {getDayLabel(record.date, today)}
        </span>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Status pills row */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={statusCfg.variant} dot>
            {record.isActiveSession ? "Active session" : statusCfg.label}
          </Badge>
          {record.isLate && (
            <Badge variant="amber" dot>Late</Badge>
          )}
          {record.isOvertime && (
            <Badge variant="blue" dot>Overtime</Badge>
          )}
          {record.isFlagged && (
            <Badge variant="amber" dot>Flagged</Badge>
          )}
        </div>

        {/* Present / Half detail */}
        {(record.status === "present" || record.status === "half") && (
          <>
            <div className="space-y-2.5 pt-1">
              {record.punchIn && (
                <TimelineRow
                  icon={Play}
                  iconBg="bg-green-100 text-green-700"
                  label="Punch in"
                  value={record.punchIn}
                  note={record.isLate ? "Late arrival" : undefined}
                />
              )}
              {record.punchOut && (
                <TimelineRow
                  icon={Square}
                  iconBg="bg-red-100 text-red-700"
                  label="Punch out"
                  value={record.punchOut}
                />
              )}
              {record.isActiveSession && !record.punchOut && (
                <TimelineRow
                  icon={Clock}
                  iconBg="bg-blue-100 text-blue-700"
                  label="Status"
                  value="Session active"
                  note="Punch out pending"
                />
              )}
              {isAdmin && record.ip && (
                <TimelineRow
                  icon={Globe}
                  iconBg="bg-gray-100 text-gray-600"
                  label="IP address"
                  value={record.ip}
                />
              )}
            </div>

            <div className="border-t border-gray-100 pt-2.5 space-y-0.5">
              {record.totalHours != null && (
                <DetailRow label="Hours logged" value={`${record.totalHours}h`} />
              )}
              {record.isActiveSession && !record.totalHours && (
                <DetailRow label="Hours logged" value="In progress" />
              )}
              {record.breakTime && (
                <DetailRow label="Break time" value={record.breakTime} />
              )}
              <DetailRow
                label="Status"
                value={
                  record.isActiveSession
                    ? "Active"
                    : record.status === "half"
                      ? "Half day"
                      : "Completed"
                }
              />
            </div>

            {record.isFlagged && record.note && (
              <WarningBanner message={record.note} />
            )}
          </>
        )}

        {/* Leave detail */}
        {record.status === "leave" && (
          <>
            <div className="space-y-0.5 pt-1">
              <DetailRow label="Type" value={record.leaveType || "Leave"} />
              <DetailRow label="Span" value={`${record.leaveDaysUsed || 1} day${(record.leaveDaysUsed || 1) > 1 ? "s" : ""}`} />
              {record.leaveApprovedBy && (
                <DetailRow label="Approved by" value={record.leaveApprovedBy} />
              )}
              {/* NOTE: deliberately no "X of 12" quota row here. Leave allocations
                  are configurable per leave type; hardcoding a denominator was
                  fake data. The real balance lives on the Leaves page. */}
            </div>
            {record.leaveReason && (
              <>
                <div className="border-t border-gray-100 pt-2.5">
                  <div className="text-[11px] text-gray-500 mb-1">Reason</div>
                  <div className="text-[12px] text-gray-700">{record.leaveReason}</div>
                </div>
              </>
            )}
          </>
        )}

        {/* Absent detail */}
        {record.status === "absent" && (
          <>
            <div className="space-y-0.5 pt-1">
              <DetailRow label="Expected" value="09:00 - 18:00" />
              <DetailRow label="Recorded" value="No data" />
            </div>
            <DangerBanner message="No attendance recorded for this day. Please regularise if this was an error." />
            <Button className="w-full mt-2" onClick={onRegularise}>
              Regularise this day
            </Button>
          </>
        )}

        {/* Holiday detail */}
        {record.status === "holiday" && (
          <div className="space-y-0.5 pt-1">
            <DetailRow label="Holiday" value={record.holidayName || "Public holiday"} />
            <DetailRow label="Type" value="Gazetted holiday" />
            <div className="text-[11px] text-gray-400 mt-2 flex items-center gap-1.5">
              <Info className="h-3 w-3" />
              No attendance required
            </div>
          </div>
        )}

        {/* Weekend detail */}
        {record.status === "weekend" && (
          <div className="pt-1">
            <div className="text-[11px] text-gray-400 flex items-center gap-1.5">
              <Info className="h-3 w-3" />
              Weekend. No attendance required.
            </div>
          </div>
        )}

        {/* Future detail */}
        {record.status === "future" && (
          <div className="pt-1">
            <div className="text-[11px] text-gray-400 flex items-center gap-1.5">
              <Info className="h-3 w-3" />
              Upcoming working day. No data yet.
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
//  List View
// ---------------------------------------------------------------------------

function ListView({ records, today }: { records: DayRecord[]; today: Date }) {
  // Reverse chronological, skip weekends
  const rows = useMemo(() => {
    return [...records]
      .filter((r) => r.status !== "weekend" && r.status !== "future")
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [records]);

  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-gray-200 text-[10px] uppercase tracking-wider text-gray-500">
              <th className="px-4 py-2.5 font-semibold">Date</th>
              <th className="px-4 py-2.5 font-semibold">Day</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5 font-semibold">Punch in</th>
              <th className="px-4 py-2.5 font-semibold">Punch out</th>
              <th className="px-4 py-2.5 font-semibold">Hours</th>
              <th className="px-4 py-2.5 font-semibold">Notes</th>
              <th className="px-4 py-2.5 font-semibold w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const cfg = STATUS_PILL[r.status] ?? STATUS_PILL.absent;
              const isToday = isSameDay(r.date, today);
              return (
                <tr
                  key={r.date.getTime()}
                  className={cn(
                    "border-b border-gray-100 text-[12px] hover:bg-gray-50 transition-colors",
                    isToday && "bg-blue-50/40",
                  )}
                >
                  <td className="px-4 py-2 font-mono tabular-nums text-gray-900">
                    {MONTH_NAMES_SHORT[r.date.getMonth()]} {r.date.getDate()}
                    {isToday && (
                      <span className="ml-1.5 text-[9px] font-bold text-blue-600 uppercase">
                        Today
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-gray-600">
                    {DAY_NAMES_FULL[r.date.getDay()]}
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant={cfg.variant} dot>{cfg.label}</Badge>
                  </td>
                  <td className="px-4 py-2 font-mono tabular-nums text-gray-700">
                    {r.punchIn || "\u2014"}
                  </td>
                  <td className="px-4 py-2 font-mono tabular-nums text-gray-700">
                    {r.isActiveSession ? "Active" : r.punchOut || "\u2014"}
                  </td>
                  <td className="px-4 py-2 font-mono tabular-nums text-gray-700">
                    {r.totalHours != null ? `${r.totalHours}h` : "\u2014"}
                  </td>
                  <td className="px-4 py-2 text-gray-500 text-[11px] max-w-[160px] truncate">
                    {r.note || r.leaveType || r.holidayName || ""}
                  </td>
                  <td className="px-4 py-2">
                    <button className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
//  Main Component
// ---------------------------------------------------------------------------

export default function AttendancePage() {
  const today = useMemo(() => new Date(), []);
  const { toast } = useToast();
  const { userProfile, isAdmin } = useAuth();

  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [selectedDay, setSelectedDay] = useState<DayRecord | null>(null);
  const [view, setView] = useState<"month" | "list">("month");
  const [regDialogOpen, setRegDialogOpen] = useState(false);
  const [regForm, setRegForm] = useState<RegularisationForm>({
    punchIn: "",
    punchOut: "",
    caseType: "",
    reason: "",
  });
  const [regError, setRegError] = useState("");
  const [dbRecords, setDbRecords] = useState<DayRecord[]>([]);
  const [loading, setLoading] = useState(true);
  // Real regularisation requests for this employee (RLS returns only their own).
  const [regStats, setRegStats] = useState<{ total: number; pending: number } | null>(null);

  const fetchRegStats = useCallback(async () => {
    if (!userProfile?.id) return;
    try {
      const { requests } = await api.approvalRequests.list({ type: "regularisation" });
      // Admins get every employee's requests back, so filter to the viewer's own.
      const mine = (requests ?? []).filter(
        (r: Record<string, unknown>) => r.employee_id === userProfile.id,
      );
      setRegStats({
        total: mine.length,
        pending: mine.filter((r: Record<string, unknown>) => r.status === "pending").length,
      });
    } catch {
      // Non-fatal: the stat card just shows a dash.
      setRegStats(null);
    }
  }, [userProfile?.id]);

  useEffect(() => {
    fetchRegStats();
  }, [fetchRegStats]);

  // Fetch attendance from Supabase
  useEffect(() => {
    if (!userProfile?.id) return;

    async function fetchAttendance() {
      try {
        const { records: data } = await api.attendance.list({
          employeeId: userProfile!.id,
          month: currentMonth + 1,
          year: currentYear,
        });

        if (data && data.length > 0) {
          const mapped: DayRecord[] = data.map((r: Record<string, unknown>) => {
            const hasPunchIn = !!r.punch_in;
            const isActive = r.status === 'active' || (hasPunchIn && !r.punch_out);
            return {
              date: new Date((r.date as string) + 'T00:00:00'),
              status: mapDbStatus(r.status, hasPunchIn),
              punchIn: r.punch_in ? new Date(r.punch_in as string).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) : undefined,
              punchOut: r.punch_out ? new Date(r.punch_out as string).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) : undefined,
              totalHours: r.worked_hours != null ? Number(r.worked_hours) : undefined,
              ip: r.ip_address as string | undefined,
              isActiveSession: isActive,
            };
          });
          setDbRecords(mapped);
        } else {
          setDbRecords([]);
        }
      } catch (err) {
        console.error('[attendance] fetch error:', err);
        setDbRecords([]);
      } finally {
        setLoading(false);
      }
    }
    fetchAttendance();
  }, [userProfile, currentYear, currentMonth]);

  // ---- Data ---- (merge DB records with calendar grid)
  const records = useMemo(() => {
    const joiningDate = userProfile?.dateOfJoining as unknown as string | undefined;
    const calendarDays = generateCalendarDays(currentYear, currentMonth, joiningDate);
    if (dbRecords.length === 0) return calendarDays;

    // Create a map of DB records by date string
    const dbMap = new Map<string, DayRecord>();
    dbRecords.forEach((r) => {
      dbMap.set(localDateKey(r.date), r);
    });

    // Overlay DB records onto calendar days
    return calendarDays.map((day) => {
      const dbEntry = dbMap.get(localDateKey(day.date));
      if (dbEntry) return { ...day, ...dbEntry, date: day.date };
      return day;
    });
  }, [currentYear, currentMonth, dbRecords, userProfile?.dateOfJoining]);

  // Auto-select today on load
  const todayRecord = useMemo(
    () => records.find((r) => isSameDay(r.date, today)),
    [records, today],
  );

  // Use selected day or default to today
  const activeRecord = selectedDay || todayRecord || null;

  // ---- Summary ----
  const summary = useMemo(() => {
    let present = 0;
    let workDaysPast = 0;
    let totalPunchInMinutes = 0;
    let punchInCount = 0;
    let totalHours = 0;

    for (const r of records) {
      if (r.status === "present" || r.status === "half") {
        present++;
        if (r.totalHours != null && Number.isFinite(r.totalHours)) totalHours += r.totalHours;
        if (r.punchIn) {
          const [h, m] = r.punchIn.split(":").map(Number);
          if (Number.isFinite(h) && Number.isFinite(m)) {
            totalPunchInMinutes += h * 60 + m;
            punchInCount++;
          }
        }
      }
      if (
        r.status !== "weekend" &&
        r.status !== "holiday" &&
        r.status !== "future"
      ) {
        workDaysPast++;
      }
    }

    const avgPunchInMin = punchInCount > 0 ? Math.round(totalPunchInMinutes / punchInCount) : 0;
    const avgH = Math.floor(avgPunchInMin / 60);
    const avgM = avgPunchInMin % 60;

    return {
      present,
      workDaysPast,
      avgPunchIn: padTime(avgH, avgM),
      totalHours: totalHours.toFixed(1),
      avgHoursPerDay: punchInCount > 0 ? (totalHours / punchInCount).toFixed(1) : "0",
    };
  }, [records]);

  // ---- Calendar grid (Sun-Sat) ----
  const calendarCells = useMemo(() => {
    const firstDay = new Date(currentYear, currentMonth, 1);
    const startOffset = firstDay.getDay(); // 0=Sun
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

    const cells: (DayRecord | null)[] = [];

    // Leading nulls for days before the 1st
    for (let i = 0; i < startOffset; i++) {
      cells.push(null);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const record = records.find((r) => r.date.getDate() === d);
      cells.push(record ?? null);
    }

    // Trailing nulls to fill out the last week
    while (cells.length % 7 !== 0) {
      cells.push(null);
    }

    return cells;
  }, [records, currentMonth, currentYear]);

  // ---- Navigation ----
  const goToPrevMonth = useCallback(() => {
    setSelectedDay(null);
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  }, [currentMonth]);

  const goToNextMonth = useCallback(() => {
    setSelectedDay(null);
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  }, [currentMonth]);

  const goToToday = useCallback(() => {
    setCurrentMonth(today.getMonth());
    setCurrentYear(today.getFullYear());
    setSelectedDay(null);
  }, [today]);

  // ---- Regularisation ----
  function openRegDialog() {
    setRegForm({
      punchIn: activeRecord?.punchIn ?? "",
      punchOut: activeRecord?.punchOut ?? "",
      caseType: "",
      reason: "",
    });
    setRegError("");
    setRegDialogOpen(true);
  }

  const [regSubmitting, setRegSubmitting] = useState(false);

  async function handleRegSubmit() {
    if (!regForm.reason.trim()) {
      setRegError("Reason is required");
      return;
    }
    if (!regForm.punchIn && !regForm.punchOut) {
      setRegError("Please provide at least a corrected punch-in or punch-out time");
      return;
    }
    setRegError("");
    setRegSubmitting(true);

    // The day this request is for. Key by LOCAL date so IST users get the day
    // they actually selected (punch timestamps are stored in UTC).
    const day = activeRecord?.date ?? today;
    const regDate = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;

    // Human-readable summaries the approvals screen renders as-is.
    const originalPunch = `In: ${activeRecord?.punchIn || "—"}, Out: ${activeRecord?.punchOut || "—"}`;
    const requestedChange = `In: ${regForm.punchIn || "—"}, Out: ${regForm.punchOut || "—"}${regForm.caseType ? ` (${regForm.caseType})` : ""}`;

    try {
      await api.approvalRequests.create({
        type: "regularisation",
        reg_date: regDate,
        original_punch: originalPunch,
        requested_change: requestedChange,
        action_type: regForm.caseType || undefined,
        reason: regForm.reason.trim(),
      });
      toast({
        variant: "success",
        title: "Request submitted",
        description: "Your regularisation request has been sent for approval.",
      });
      setRegDialogOpen(false);
      fetchRegStats();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Please try again.";
      setRegError(msg);
      toast({ variant: "error", title: "Failed to submit request", description: msg });
    } finally {
      setRegSubmitting(false);
    }
  }

  // ---- Legend items ----
  const legendItems: { label: string; color: string; striped?: boolean }[] = [
    { label: "Present", color: "bg-green-500" },
    { label: "Leave", color: "bg-purple-500" },
    { label: "Half", color: "bg-amber-500" },
    { label: "Absent", color: "bg-red-500" },
    { label: "Holiday", color: "bg-amber-400", striped: true },
  ];

  if (loading) {
    return (
      <div className="space-y-5">
        <SkeletonPageHeader />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            <Skeleton className="h-9 w-32 rounded-md" />
            <Skeleton className="h-9 w-32 rounded-md" />
          </div>
          <Skeleton className="h-9 w-28 rounded-md" />
        </div>
        <SkeletonTable rows={8} columns={6} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ================================================================= */}
      {/*  Page Header                                                      */}
      {/* ================================================================= */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold text-gray-900">Attendance</h1>
          <p className="text-[12px] text-gray-500 mt-0.5">
            Your attendance &mdash; {MONTH_NAMES[currentMonth]} {currentYear}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Month / List toggle */}
          <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
            <button
              onClick={() => setView("month")}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors",
                view === "month"
                  ? "bg-white text-gray-900 shadow-sm border border-gray-200"
                  : "text-gray-500 hover:text-gray-700 border border-transparent",
              )}
            >
              <CalendarIcon className="h-3 w-3" />
              Month
            </button>
            <button
              onClick={() => setView("list")}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors",
                view === "list"
                  ? "bg-white text-gray-900 shadow-sm border border-gray-200"
                  : "text-gray-500 hover:text-gray-700 border border-transparent",
              )}
            >
              <List className="h-3 w-3" />
              List
            </button>
          </div>

          <Button size="default" onClick={openRegDialog}>
            Regularise
          </Button>
        </div>
      </div>

      {/* ================================================================= */}
      {/*  Stats Row                                                        */}
      {/* ================================================================= */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Days present"
          value={`${summary.present} / ${summary.workDaysPast}`}
          delta="This month"
          dotColor="bg-green-500"
        />
        <StatCard
          label="Avg. punch-in"
          value={summary.avgPunchIn}
          delta="This month"
          dotColor="bg-blue-500"
        />
        <StatCard
          label="Hours logged"
          value={`${summary.totalHours} h`}
          delta={`${summary.avgHoursPerDay}h average / day`}
          dotColor="bg-slate-500"
        />
        <StatCard
          label="Regularisations"
          value={regStats ? String(regStats.total) : "—"}
          delta={
            regStats
              ? regStats.pending > 0
                ? `${regStats.pending} pending approval`
                : "None pending"
              : "Unavailable"
          }
          dotColor="bg-amber-500"
        />
      </div>

      {/* ================================================================= */}
      {/*  Month View / List View                                           */}
      {/* ================================================================= */}
      {view === "list" ? (
        <ListView records={records} today={today} />
      ) : (
        <div className="grid gap-4 grid-cols-1 lg:grid-cols-[1fr_320px]">
          {/* Calendar */}
          <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-3">
                <CardTitle className="text-[14px]">
                  {MONTH_NAMES[currentMonth]} {currentYear}
                </CardTitle>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" onClick={goToPrevMonth}>
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={goToToday}>
                    Today
                  </Button>
                  <Button variant="ghost" size="icon" onClick={goToNextMonth}>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* Legend */}
              <div className="flex items-center gap-3 flex-wrap">
                {legendItems.map((item) => (
                  <div key={item.label} className="flex items-center gap-1">
                    <span
                      className={cn(
                        "inline-block h-2.5 w-2.5 rounded-sm shrink-0",
                        item.color,
                        item.striped &&
                          "bg-[repeating-linear-gradient(45deg,transparent,transparent_2px,rgba(255,255,255,0.4)_2px,rgba(255,255,255,0.4)_4px)]",
                      )}
                    />
                    <span className="text-[10px] text-gray-500">{item.label}</span>
                  </div>
                ))}
              </div>
            </CardHeader>

            <CardContent className="p-0">
              {/* Day-of-week header */}
              <div className="grid grid-cols-7 border-b border-gray-200">
                {DAY_NAMES_SHORT.map((day, i) => (
                  <div
                    key={day}
                    className={cn(
                      "px-2 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wider",
                      i === 0 || i === 6 ? "text-gray-400" : "text-gray-500",
                    )}
                  >
                    {day}
                  </div>
                ))}
              </div>

              {/* Calendar grid */}
              <div className="grid grid-cols-7 min-h-[360px] lg:min-h-[540px]">
                {calendarCells.map((record, idx) => {
                  const col = idx % 7;
                  const isWeekendCol = col === 0 || col === 6;
                  const isLastCol = col === 6;
                  // Bottom border for all but last row
                  const totalRows = Math.ceil(calendarCells.length / 7);
                  const row = Math.floor(idx / 7);
                  const isLastRow = row === totalRows - 1;

                  if (!record) {
                    return (
                      <div
                        key={idx}
                        className={cn(
                          "bg-gray-50/60",
                          !isLastCol && "border-r border-gray-100",
                          !isLastRow && "border-b border-gray-100",
                        )}
                      />
                    );
                  }

                  const isToday = isSameDay(record.date, today);
                  const isSelected = activeRecord && isSameDay(activeRecord.date, record.date);

                  return (
                    <button
                      key={idx}
                      onClick={() => setSelectedDay(record)}
                      className={cn(
                        "relative flex flex-col p-1.5 sm:p-2 text-left transition-colors min-h-[60px] sm:min-h-[90px] group",
                        !isLastCol && "border-r border-gray-100",
                        !isLastRow && "border-b border-gray-100",
                        // Background
                        record.status === "weekend" && "bg-gray-50/60",
                        record.status === "future" && "bg-white",
                        record.status === "present" && "bg-white hover:bg-green-50/30",
                        record.status === "half" && "bg-white hover:bg-amber-50/30",
                        record.status === "absent" && "bg-white hover:bg-red-50/30",
                        record.status === "leave" && "bg-white hover:bg-purple-50/30",
                        record.status === "holiday" && "bg-amber-50/30 hover:bg-amber-50/50",
                        // Selected / Today ring
                        isSelected && "shadow-[inset_0_0_0_2px_var(--accent)]",
                        isToday && !isSelected && "shadow-[inset_0_0_0_2px_#3b82f6]",
                        "focus:outline-none",
                      )}
                    >
                      {/* Date number + TODAY tag */}
                      <div className="flex items-center gap-1">
                        <span
                          className={cn(
                            "font-mono text-[12px] font-medium tabular-nums",
                            isToday ? "text-blue-600" : "text-gray-900",
                            record.status === "weekend" && "text-gray-400",
                            record.status === "future" && "text-gray-300",
                          )}
                        >
                          {record.date.getDate()}
                        </span>
                        {isToday && (
                          <span className="text-[9px] font-bold text-blue-600 uppercase">
                            Today
                          </span>
                        )}
                      </div>

                      {/* Flagged dot */}
                      {record.isFlagged && (
                        <span className="absolute top-2 right-2 h-[6px] w-[6px] rounded-full bg-amber-500" />
                      )}

                      {/* Status content */}
                      <div className="flex flex-col gap-[3px] mt-1">
                        <CellPill status={record.status} isActive={record.isActiveSession} />

                        {/* Times for present/half - hidden on mobile */}
                        {(record.status === "present" || record.status === "half") && record.punchIn && (
                          <div className="hidden sm:flex flex-col gap-[1px] mt-0.5">
                            <CellTime
                              label="in"
                              time={record.punchIn}
                              isLate={record.isLate}
                            />
                            {record.punchOut && (
                              <CellTime
                                label="out"
                                time={record.punchOut}
                                isOt={record.isOvertime}
                              />
                            )}
                          </div>
                        )}

                        {/* Leave label */}
                        {record.status === "leave" && record.leaveType && (
                          <span className="text-[9px] text-purple-600 truncate">
                            {record.leaveType}
                          </span>
                        )}

                        {/* Holiday label */}
                        {record.status === "holiday" && record.holidayName && (
                          <span className="text-[9px] text-amber-700 truncate">
                            {record.holidayName}
                          </span>
                        )}

                        {/* Absent label */}
                        {record.status === "absent" && (
                          <span className="text-[9px] text-red-500">No record</span>
                        )}

                        {/* Weekend text */}
                        {record.status === "weekend" && (
                          <span className="text-[9px] text-gray-400">Weekend</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Day Detail Sidebar */}
          {activeRecord && (
            <DayDetailPanel
              record={activeRecord}
              today={today}
              onRegularise={openRegDialog}
              isAdmin={isAdmin}
            />
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/*  Regularisation Dialog                                            */}
      {/* ================================================================= */}
      <Dialog open={regDialogOpen} onOpenChange={setRegDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Regularisation</DialogTitle>
            <DialogDescription>
              Submit a regularisation request for{" "}
              {activeRecord ? formatDateLong(activeRecord.date) : ""}.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <Input
              label="Date"
              value={activeRecord ? formatDateLong(activeRecord.date) : ""}
              readOnly
              className="bg-gray-50"
            />
            <Input
              label="Correct Punch-in Time"
              type="time"
              value={regForm.punchIn}
              onChange={(e) =>
                setRegForm((f) => ({ ...f, punchIn: e.target.value }))
              }
            />
            <Input
              label="Correct Punch-out Time"
              type="time"
              value={regForm.punchOut}
              onChange={(e) =>
                setRegForm((f) => ({ ...f, punchOut: e.target.value }))
              }
            />
            <Select
              label="Case"
              placeholder="Select a case"
              options={CASE_OPTIONS}
              value={regForm.caseType}
              onChange={(e) =>
                setRegForm((f) => ({ ...f, caseType: e.target.value }))
              }
            />
            <Textarea
              label="Reason"
              placeholder="Please describe the reason for regularisation..."
              value={regForm.reason}
              onChange={(e) =>
                setRegForm((f) => ({ ...f, reason: e.target.value }))
              }
              error={regError || undefined}
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRegDialogOpen(false)} disabled={regSubmitting}>
              Cancel
            </Button>
            <Button onClick={handleRegSubmit} disabled={regSubmitting}>
              {regSubmitting ? "Submitting..." : "Submit Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
