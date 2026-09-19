"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/lib/api-client";
import { businessDate } from "@/lib/dates";
import { useToast } from "@/components/ui/toast";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { BadgeVariant } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Skeleton, SkeletonPageHeader, SkeletonTable, SkeletonCard } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Plus,
  Info,
  Calendar,
  Sun,
  AlertTriangle,
} from "lucide-react";

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

type LeaveStatus = "approved" | "pending" | "rejected" | "cancelled";
type LeaveType = "Earned" | "Casual" | "Sick" | "Optional";

/** A leave type as stored in the DB (the single source of truth). */
interface DbLeaveType {
  id: string;
  name: string;
  key: string;
}

interface LeaveRecord {
  id: string;
  employeeName: string;
  type: LeaveType;
  from: string;
  to: string;
  days: number;
  status: LeaveStatus;
  reason: string;
  appliedDate: string;
  rejectionReason?: string;
}

// ---------------------------------------------------------------------------
//  Leave balance config (fallback/mock data)
// ---------------------------------------------------------------------------

const LEAVE_BALANCES: {
  label: LeaveType;
  total: number;
  used: number;
  barColor: string;
  dotColor: string;
}[] = [
  {
    label: "Casual",
    total: 12,
    used: 4,
    barColor: "bg-purple-500",
    dotColor: "bg-purple-500",
  },
  {
    label: "Sick",
    total: 10,
    used: 3,
    barColor: "bg-red-500",
    dotColor: "bg-red-500",
  },
  {
    label: "Earned",
    total: 18,
    used: 6,
    barColor: "bg-gray-900",
    dotColor: "bg-gray-900",
  },
  {
    label: "Optional",
    total: 4,
    used: 1,
    barColor: "bg-amber-500",
    dotColor: "bg-amber-500",
  },
];

// Computed totals
const TOTAL_BALANCE =
  LEAVE_BALANCES.reduce((s, b) => s + (b.total - b.used), 0); // 31
const TOTAL_USED = LEAVE_BALANCES.reduce((s, b) => s + b.used, 0); // 14
const TOTAL_CAPACITY = LEAVE_BALANCES.reduce((s, b) => s + b.total, 0); // 44

// ---------------------------------------------------------------------------
//  Leave type options
// ---------------------------------------------------------------------------

const LEAVE_TYPES: LeaveType[] = ["Earned", "Casual", "Sick", "Optional"];

// ---------------------------------------------------------------------------

// Employees on leave for specific dates (for overlap view)
const OVERLAP_MAP: Record<string, string[]> = {
  "2026-05-22": ["Deepak M.", "Sneha K."],
  "2026-05-23": ["Deepak M."],
  "2026-05-25": [],
};

// Holidays
const HOLIDAYS = [
  { date: "2026-05-01", name: "Labour Day", type: "mandatory" as const },
  { date: "2026-05-25", name: "Buddha Purnima", type: "optional" as const },
];

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

const STATUS_BADGE_VARIANT: Record<LeaveStatus, BadgeVariant> = {
  approved: "green",
  pending: "amber",
  rejected: "red",
  cancelled: "slate",
};

const TYPE_BADGE_VARIANT: Record<LeaveType, BadgeVariant> = {
  Sick: "red",
  Earned: "blue",
  Casual: "purple",
  Optional: "amber",
};

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
  });
}

function formatDateFull(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getOverlappingEmployees(from: string, to: string): string[] {
  const names = new Set<string>();
  const start = new Date(from);
  const end = new Date(to);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().split("T")[0];
    (OVERLAP_MAP[key] ?? []).forEach((n) => names.add(n));
  }
  return Array.from(names);
}

function getDayName(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-IN", { weekday: "short" });
}

function getDatesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  const start = new Date(from);
  const end = new Date(to);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}

function countWeekdays(from: string, to: string): number {
  let count = 0;
  const start = new Date(from);
  const end = new Date(to);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
//  Stats Row
// ---------------------------------------------------------------------------

function StatsRow({ pendingCount, upcomingCount }: { pendingCount: number; upcomingCount: number }) {
  const stats = [
    {
      label: "Total balance",
      value: `${TOTAL_BALANCE} days`,
      dotColor: "bg-blue-500",
    },
    {
      label: "Used this FY",
      value: `${TOTAL_USED} days`,
      dotColor: "bg-purple-500",
    },
    {
      label: "Pending approval",
      value: String(pendingCount),
      dotColor: "bg-amber-500",
    },
    {
      label: "Upcoming approved",
      value: String(upcomingCount),
      dotColor: "bg-green-500",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {stats.map((s) => (
        <Card key={s.label}>
          <CardContent className="py-3 px-4">
            <div className="flex items-center gap-1.5 mb-1">
              <span
                className={`h-[6px] w-[6px] rounded-full shrink-0 ${s.dotColor}`}
              />
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                {s.label}
              </span>
            </div>
            <p className="font-mono text-2xl font-medium tabular-nums text-gray-900">
              {s.value}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Balance Card (right sidebar)
// ---------------------------------------------------------------------------

function getFYLabel() {
  const now = new Date();
  const startYear = now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
  return `FY ${startYear}-${String(startYear + 1).slice(2)}`;
}

function BalanceCard() {
  const { userProfile } = useAuth();
  const [balances, setBalances] = useState(LEAVE_BALANCES);
  const [totalBalance, setTotalBalance] = useState(TOTAL_BALANCE);
  const [totalCapacity, setTotalCapacity] = useState(TOTAL_CAPACITY);

  useEffect(() => {
    if (!userProfile?.id) return;

    async function fetchBalances() {
      try {
        // Fetch leave types + allocations via API
        const leavesData = await api.leaves.list();
        const types = leavesData.leaveTypes ?? [];
        const allocs = leavesData.leaveAllocations ?? [];
        const overrides = leavesData.leaveOverrides ?? [];
        const requests = (leavesData.requests ?? []).filter((r: any) => {
          if (r.status !== 'approved') return false;
          // Only count leaves within current FY (April 1 - March 31)
          const now = new Date();
          const fyStartYear = now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
          const fyStart = `${fyStartYear}-04-01`;
          const fyEnd = `${fyStartYear + 1}-03-31`;
          return r.from_date <= fyEnd && r.to_date >= fyStart;
        });

        if (!types.length) return;

        const barColors: Record<string, string> = {
          casual: 'bg-purple-500',
          sick: 'bg-red-500',
          earned: 'bg-gray-900',
          optional_holiday: 'bg-amber-500',
          maternity: 'bg-pink-500',
          paternity: 'bg-blue-500',
        };

        const labelMap: Record<string, string> = {
          casual: 'Casual',
          sick: 'Sick',
          earned: 'Earned',
          optional_holiday: 'Optional',
          maternity: 'Maternity',
          paternity: 'Paternity',
        };

        const usedMap = new Map<string, number>();
        (requests ?? []).forEach((r: { leave_type_id: string; days: number }) => {
          usedMap.set(r.leave_type_id, (usedMap.get(r.leave_type_id) ?? 0) + Number(r.days));
        });

        const overrideMap = new Map<string, number>();
        (overrides ?? []).forEach((o: { leave_type_id: string; custom_days: number }) => {
          overrideMap.set(o.leave_type_id, o.custom_days);
        });

        const allocMap = new Map<string, number>();
        (allocs ?? []).forEach((a: { leave_type_id: string; annual_days: number }) => {
          allocMap.set(a.leave_type_id, a.annual_days);
        });

        const newBalances = types
          .filter((t: { key: string }) => ['casual', 'sick', 'earned', 'optional_holiday'].includes(t.key))
          .map((t: { id: string; name: string; key: string }) => {
            const total = overrideMap.get(t.id) ?? allocMap.get(t.id) ?? 0;
            const used = usedMap.get(t.id) ?? 0;
            return {
              label: (labelMap[t.key] ?? t.name.replace(' Leave', '')) as LeaveType,
              total,
              used,
              barColor: barColors[t.key] ?? 'bg-gray-400',
              dotColor: barColors[t.key] ?? 'bg-gray-400',
            };
          });

        if (newBalances.length > 0) {
          setBalances(newBalances);
          setTotalBalance(newBalances.reduce((s: number, b: { total: number; used: number }) => s + (b.total - b.used), 0));
          setTotalCapacity(newBalances.reduce((s: number, b: { total: number }) => s + b.total, 0));
        }
      } catch (err) {
        console.error('[leaves] balance fetch error:', err);
      }
    }
    fetchBalances();
  }, [userProfile]);

  return (
    <Card className="sticky top-0">
      <CardHeader className="flex-col items-start gap-0.5">
        <CardTitle>Balance - {getFYLabel()}</CardTitle>
        <CardDescription>
          {totalBalance} of {totalCapacity} days remaining
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {balances.map((lb) => {
          const remaining = lb.total - lb.used;
          const pct = lb.total > 0 ? (lb.used / lb.total) * 100 : 0;
          return (
            <div key={lb.label}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-gray-900">
                  {lb.label}
                </span>
                <span className="font-mono text-xs tabular-nums text-gray-500">
                  {lb.used} used &middot; {remaining} left
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-gray-100">
                <div
                  className={`h-full rounded-full transition-all ${lb.barColor}`}
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>
            </div>
          );
        })}
      </CardContent>
      <CardFooter>
        <Info className="h-3.5 w-3.5 shrink-0 text-gray-400" />
        <span>Unused earned leave carries forward to the next FY (max 30 days).</span>
      </CardFooter>
    </Card>
  );
}

// ---------------------------------------------------------------------------
//  Apply Leave Modal
// ---------------------------------------------------------------------------

function ApplyLeaveDialog({
  open,
  onOpenChange,
  leaveTypes,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leaveTypes: DbLeaveType[];
  onSubmit: (payload: {
    leaveTypeId: string;
    leaveTypeName: string;
    from: string;
    to: string;
    days: number;
    halfDay: boolean;
    reason: string;
  }) => void | Promise<void>;
}) {
  // The selected leave type is the real DB id (empty until picked).
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [halfDay, setHalfDay] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Preview calculations
  const previewDays = useMemo(() => {
    if (!startDate || !endDate) return 0;
    if (halfDay) return 0.5;
    return countWeekdays(startDate, endDate);
  }, [startDate, endDate, halfDay]);

  const previewDates = useMemo(() => {
    if (!startDate || !endDate) return [];
    return getDatesBetween(startDate, endDate);
  }, [startDate, endDate]);

  const overlappingTeam = useMemo(() => {
    if (!startDate || !endDate) return [];
    return getOverlappingEmployees(startDate, endDate);
  }, [startDate, endDate]);

  async function handleSubmit() {
    if (!leaveTypeId || !startDate || !endDate || !reason.trim()) return;
    const lt = leaveTypes.find((t) => t.id === leaveTypeId);
    if (!lt) return;

    setSubmitting(true);
    try {
      await onSubmit({
        leaveTypeId,
        leaveTypeName: lt.name,
        from: startDate,
        to: endDate,
        days: previewDays,
        halfDay,
        reason: reason.trim(),
      });
      setLeaveTypeId("");
      setStartDate("");
      setEndDate("");
      setHalfDay(false);
      setReason("");
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = leaveTypeId && startDate && endDate && reason.trim() && previewDays > 0 && !submitting;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[720px]">
        <DialogHeader>
          <DialogTitle>Apply for leave</DialogTitle>
          <DialogDescription>
            Select leave type, dates, and provide a reason.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-[1fr_240px]">
          {/* Left: form */}
          <div className="space-y-4">
            {/* Leave type 2x2 grid */}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                Leave type
              </label>
              {leaveTypes.length === 0 ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  No leave types have been configured yet. Ask an admin to add
                  them under Settings &rarr; Leave Allocation.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {leaveTypes.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setLeaveTypeId(t.id)}
                      className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                        leaveTypeId === t.id
                          ? "border-gray-900 bg-gray-900 text-white"
                          : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="From"
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  if (!endDate || e.target.value > endDate) {
                    setEndDate(e.target.value);
                  }
                }}
              />
              <Input
                label="To"
                type="date"
                value={endDate}
                min={startDate || undefined}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>

            {/* Half day */}
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={halfDay}
                onChange={(e) => setHalfDay(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
              />
              <span className="text-xs font-medium">Half day</span>
            </label>

            {/* Reason */}
            <Textarea
              label="Reason"
              placeholder="Briefly describe the reason..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
          </div>

          {/* Right: preview */}
          <div className="rounded-lg bg-gray-50 border border-gray-100 p-4 space-y-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                Duration
              </p>
              <p className="font-mono text-2xl font-medium tabular-nums text-gray-900">
                {previewDays}{" "}
                <span className="text-sm font-normal text-gray-500">
                  {previewDays === 1 ? "day" : "days"}
                </span>
              </p>
            </div>

            {previewDates.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-2">
                  Day breakdown
                </p>
                <div className="space-y-1.5 max-h-[140px] overflow-y-auto">
                  {previewDates.map((d) => {
                    const dayNum = new Date(d).getDay();
                    const isWeekend = dayNum === 0 || dayNum === 6;
                    const holiday = HOLIDAYS.find((h) => h.date === d);
                    return (
                      <div
                        key={d}
                        className="flex items-center gap-2 text-xs"
                      >
                        {isWeekend ? (
                          <Sun className="h-3 w-3 text-amber-500 shrink-0" />
                        ) : holiday ? (
                          <Calendar className="h-3 w-3 text-green-500 shrink-0" />
                        ) : (
                          <Calendar className="h-3 w-3 text-gray-400 shrink-0" />
                        )}
                        <span
                          className={`font-mono tabular-nums ${
                            isWeekend
                              ? "text-gray-400 line-through"
                              : "text-gray-700"
                          }`}
                        >
                          {formatDate(d)}
                        </span>
                        <span className="text-gray-400">
                          {getDayName(d)}
                        </span>
                        {holiday && (
                          <Badge variant={holiday.type === "mandatory" ? "blue" : "amber"} className="ml-auto">
                            {holiday.name}
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {overlappingTeam.length > 0 && (
              <div className="rounded-md bg-amber-50 border border-amber-200 p-2.5 flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-[11px] font-semibold text-amber-800">
                    Team overlap
                  </p>
                  <p className="text-[11px] text-amber-700">
                    {overlappingTeam.join(", ")}{" "}
                    {overlappingTeam.length === 1 ? "is" : "are"} also on
                    leave during this period.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="mt-5">
          <div className="flex items-center gap-2 mr-auto text-[11px] text-gray-500">
            <Info className="h-3.5 w-3.5 shrink-0" />
            Your manager will be notified for approval.
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            loading={submitting}
          >
            Submit request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
//  Leave History Table
// ---------------------------------------------------------------------------

type TabFilter = "all" | "pending" | "approved" | "rejected";

function LeaveHistoryCard({
  leaves,
  onCancel,
}: {
  leaves: LeaveRecord[];
  onCancel: (id: string) => void;
}) {
  const [tab, setTab] = useState<TabFilter>("all");

  const counts = useMemo(() => {
    return {
      all: leaves.length,
      pending: leaves.filter((l) => l.status === "pending").length,
      approved: leaves.filter((l) => l.status === "approved").length,
      rejected: leaves.filter((l) => l.status === "rejected").length,
    };
  }, [leaves]);

  const filtered = useMemo(() => {
    if (tab === "all") return leaves;
    return leaves.filter((l) => l.status === tab);
  }, [leaves, tab]);

  const tabs: { key: TabFilter; label: string; count: number }[] = [
    { key: "all", label: "All", count: counts.all },
    { key: "pending", label: "Pending", count: counts.pending },
    { key: "approved", label: "Approved", count: counts.approved },
    { key: "rejected", label: "Rejected", count: counts.rejected },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>My leave history</CardTitle>
        <div className="ml-auto flex items-center gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                tab === t.key
                  ? "bg-gray-900 text-white"
                  : "text-gray-500 hover:bg-gray-100 hover:text-gray-700"
              }`}
            >
              {t.label}
              <span
                className={`font-mono text-[10px] tabular-nums ${
                  tab === t.key ? "text-gray-300" : "text-gray-400"
                }`}
              >
                {t.count}
              </span>
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="h-8 px-4 text-[10px]">Request</TableHead>
              <TableHead className="h-8 px-4 text-[10px]">Type</TableHead>
              <TableHead className="h-8 px-4 text-[10px]">Dates</TableHead>
              <TableHead className="h-8 px-4 text-[10px]">Days</TableHead>
              <TableHead className="h-8 px-4 text-[10px]">Status</TableHead>
              <TableHead className="h-8 px-4 text-[10px]">Applied</TableHead>
              <TableHead className="h-8 px-4 text-[10px] w-[60px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center text-xs text-gray-400 py-8"
                >
                  No leave records found.
                </TableCell>
              </TableRow>
            )}
            {filtered.map((l) => (
              <TableRow key={l.id}>
                {/* Request: mono ID + reason */}
                <TableCell className="px-4 py-2">
                  <div>
                    <span className="font-mono text-[11px] tabular-nums text-gray-900 font-medium">
                      {l.id}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-500 truncate max-w-[200px]">
                    {l.reason}
                  </p>
                </TableCell>

                {/* Type pill */}
                <TableCell className="px-4 py-2">
                  <Badge variant={TYPE_BADGE_VARIANT[l.type]} dot>
                    {l.type}
                  </Badge>
                </TableCell>

                {/* Dates */}
                <TableCell className="px-4 py-2 font-mono text-xs tabular-nums text-gray-700">
                  {formatDate(l.from)}
                  {l.from !== l.to && (
                    <>
                      {" "}
                      <span className="text-gray-400">&rarr;</span>{" "}
                      {formatDate(l.to)}
                    </>
                  )}
                </TableCell>

                {/* Days */}
                <TableCell className="px-4 py-2 font-mono text-xs tabular-nums text-gray-900">
                  {l.days}
                </TableCell>

                {/* Status pill */}
                <TableCell className="px-4 py-2">
                  <Badge variant={STATUS_BADGE_VARIANT[l.status]} dot>
                    {l.status.charAt(0).toUpperCase() + l.status.slice(1)}
                  </Badge>
                </TableCell>

                {/* Applied */}
                <TableCell className="px-4 py-2 font-mono text-xs tabular-nums text-gray-500">
                  {formatDateFull(l.appliedDate)}
                </TableCell>

                {/* Actions */}
                <TableCell className="px-4 py-2">
                  {(l.status === "pending" || l.status === "approved") && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:text-red-700 hover:bg-red-50 text-[11px]"
                      onClick={() => {
                        if (window.confirm(`Cancel leave request ${l.id}?`)) {
                          onCancel(l.id);
                        }
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
//  Page
// ---------------------------------------------------------------------------

export default function LeavesPage() {
  const { isAdmin, userProfile } = useAuth();
  const { toast } = useToast();
  const [leaves, setLeaves] = useState<LeaveRecord[]>([]);
  // Leave types come from the DB (single source of truth) so the apply form
  // submits a real leave_type_id instead of reverse-matching a hardcoded name.
  const [leaveTypeOptions, setLeaveTypeOptions] = useState<DbLeaveType[]>([]);
  const [applyDialogOpen, setApplyDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  // Fetch leave requests via API
  const fetchLeaves = useCallback(async () => {
    if (!userProfile?.id) return;
    try {
      const { requests: data, leaveTypes } = await api.leaves.list();
      setLeaveTypeOptions(
        (leaveTypes ?? []).map((t: any) => ({ id: t.id, name: t.name, key: t.key })),
      );

      const mapped: LeaveRecord[] = (data ?? []).map((r: Record<string, unknown>) => {
        const lt = r.leave_types as { name: string } | null;
        return {
          id: r.id as string,
          employeeName: userProfile.name,
          type: (lt?.name?.replace(' Leave', '') ?? 'Casual') as LeaveType,
          from: r.from_date as string,
          to: r.to_date as string,
          days: Number(r.days),
          status: r.status as LeaveStatus,
          reason: (r.reason as string) ?? '',
          appliedDate: businessDate(new Date(r.created_at as string)),
          rejectionReason: r.rejection_reason as string | undefined,
        };
      });
      setLeaves(mapped);
    } catch (err) {
      toast({ variant: "error", title: "Failed to load leave history", description: String(err) });
    }
    setLoading(false);
  }, [userProfile]);

  useEffect(() => { fetchLeaves(); }, [fetchLeaves]);

  // Computed stats
  const pendingCount = leaves.filter((l) => l.status === "pending").length;
  const upcomingApproved = leaves.filter(
    (l) => l.status === "approved" && new Date(l.from) > new Date(),
  ).length;

  // ---- handlers ----

  async function handleApplyLeave(payload: {
    leaveTypeId: string;
    leaveTypeName: string;
    from: string;
    to: string;
    days: number;
    halfDay: boolean;
    reason: string;
  }) {
    if (!userProfile?.id) return;
    try {
      const { request } = await api.leaves.create({
        leave_type_id: payload.leaveTypeId,
        from_date: payload.from,
        to_date: payload.to,
        days: payload.days,
        half_day: payload.halfDay,
        reason: payload.reason,
      });

      toast({
        variant: "success",
        title: "Leave request submitted",
        description: "Your request is now pending approval.",
      });

      // Optimistic insert (id from the server), then refetch for the source of truth.
      setLeaves((prev) => [
        {
          id: (request?.id as string) ?? `tmp-${Date.now()}`,
          employeeName: userProfile.name,
          type: (payload.leaveTypeName.replace(" Leave", "") || "Casual") as LeaveType,
          from: payload.from,
          to: payload.to,
          days: payload.days,
          status: "pending",
          reason: payload.reason,
          appliedDate: businessDate(),
        },
        ...prev,
      ]);
      fetchLeaves();
    } catch (err) {
      toast({ variant: "error", title: "Failed to submit leave request", description: String(err) });
    }
  }

  async function handleCancelLeave(id: string) {
    try {
      await api.leaves.update(id, { status: 'cancelled' });
      setLeaves((prev) =>
        prev.map((l) =>
          l.id === id ? { ...l, status: "cancelled" as const } : l,
        ),
      );
      toast({ variant: "success", title: "Leave cancelled" });
    } catch (err) {
      // Without this, a failed cancel (network error, already-approved leave)
      // was silently swallowed and the button just looked dead.
      toast({
        variant: "error",
        title: "Failed to cancel leave",
        description: err instanceof Error ? err.message : "Please try again.",
      });
    }
  }

  // ---- render ----
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <SkeletonPageHeader />
          <Skeleton className="h-9 w-32 rounded-md" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
        </div>
        <div className="grid grid-cols-1 gap-4 items-start lg:grid-cols-[1fr_320px]">
          <SkeletonTable rows={6} columns={5} />
          <SkeletonCard lines={6} />
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-gray-900">
            Leave
          </h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {isAdmin
              ? "Manage your leaves \u2014 apply, view balance, track status"
              : "Your leaves \u2014 apply, view balance, cancel pending"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setApplyDialogOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Apply for leave
          </Button>
        </div>
      </div>

      {/* Stats Row */}
      <StatsRow pendingCount={pendingCount} upcomingCount={upcomingApproved} />

      {/* Admin info banner */}
      {isAdmin && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5">
          <Info className="h-4 w-4 text-blue-600 shrink-0" />
          <p className="text-xs text-blue-700">
            Team leave requests need approval? Head to the{" "}
            <Link href="/approvals" className="font-semibold underline">
              Approvals page
            </Link>
            .
          </p>
        </div>
      )}

      {/* Main area: grid */}
      <div className="grid grid-cols-1 gap-4 items-start lg:grid-cols-[1fr_320px]">
        {/* Left: Leave History */}
        <LeaveHistoryCard
          leaves={leaves}
          onCancel={handleCancelLeave}
        />

        {/* Right: Balance Card */}
        <BalanceCard />
      </div>

      {/* Apply Leave Modal */}
      <ApplyLeaveDialog
        open={applyDialogOpen}
        onOpenChange={setApplyDialogOpen}
        leaveTypes={leaveTypeOptions}
        onSubmit={handleApplyLeave}
      />
    </div>
  );
}
