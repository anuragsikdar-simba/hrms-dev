"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/lib/api-client";
import { businessDate } from "@/lib/dates";
import { useToast } from "@/components/ui/toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import type { PayrollRunRow, PayrollRunStatus } from "@/types";
import {
  Shield,
  Loader2,
  Play,
  Wallet,
  AlertCircle,
  AlertTriangle,
  SlidersHorizontal,
  ChevronRight,
} from "lucide-react";

// ---------------------------------------------------------------------------
//  Constants & helpers
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const MONTH_OPTIONS = MONTH_NAMES.map((label, i) => ({
  label,
  value: String(i + 1),
}));

const RUN_STATUS_BADGE: Record<PayrollRunStatus, BadgeVariant> = {
  draft: "amber",
  locked: "blue",
  published: "green",
};

const RUN_STATUS_LABEL: Record<PayrollRunStatus, string> = {
  draft: "Draft",
  locked: "Locked",
  published: "Published",
};

/** Money is computed by the server (§8.5) — the UI only formats it. */
const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

function formatCreated(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
//  Page
// ---------------------------------------------------------------------------

export default function PayrollPage() {
  const { isAdmin, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const router = useRouter();

  // The IST business date decides which month the admin lands on (§1).
  const today = businessDate();

  const [runs, setRuns] = useState<PayrollRunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [periodYear, setPeriodYear] = useState(() => Number(today.slice(0, 4)));
  const [periodMonth, setPeriodMonth] = useState(() => Number(today.slice(5, 7)));
  const [creating, setCreating] = useState(false);

  /** Employees left out of the last draft — never hide this (§8.1). */
  const [skipped, setSkipped] = useState<{ name: string; reason: string }[]>([]);
  const [skippedPeriod, setSkippedPeriod] = useState<string | null>(null);

  const currentYear = Number(today.slice(0, 4));
  const yearOptions = [0, 1, 2, 3].map((back) => ({
    label: String(currentYear - back),
    value: String(currentYear - back),
  }));

  const loadRuns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { runs: data } = await api.payroll.runs();
      setRuns(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load payroll runs");
      setRuns([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (authLoading || !isAdmin) return;
    loadRuns();
  }, [authLoading, isAdmin, loadRuns]);

  async function handleCreateDraft() {
    setCreating(true);
    try {
      const result = await api.payroll.createRun({
        period_year: periodYear,
        period_month: periodMonth,
      });
      // Toast only after the awaited call resolved (§6.1 — no fake success).
      toast({
        variant: "success",
        title: "Draft payroll computed",
        description: `${result.payslips.length} payslip(s) for ${MONTH_NAMES[periodMonth - 1]} ${periodYear}.`,
      });
      setSkipped(result.skipped ?? []);
      setSkippedPeriod(`${MONTH_NAMES[periodMonth - 1]} ${periodYear}`);
      await loadRuns();
    } catch (err) {
      toast({
        variant: "error",
        title: "Failed to create the draft run",
        description: err instanceof Error ? err.message : "Please try again.",
      });
    }
    setCreating(false);
  }

  /* ---- Access guard ---- */
  if (authLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <Shield className="mx-auto mb-4 h-12 w-12 text-gray-300" />
          <h2 className="text-lg font-semibold text-gray-900">Access Restricted</h2>
          <p className="mt-1 text-sm text-gray-500">
            Only administrators can run payroll.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-gray-900">
            Payroll
          </h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Compute a monthly draft, review the figures, then lock and publish.
          </p>
        </div>
        <Link href="/payroll/structures">
          <Button variant="outline">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Salary structures
          </Button>
        </Link>
      </div>

      {/* Create a draft run */}
      <Card>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40">
              <Select
                label="Month"
                options={MONTH_OPTIONS}
                value={String(periodMonth)}
                onChange={(e) => setPeriodMonth(Number(e.target.value))}
              />
            </div>
            <div className="w-28">
              <Select
                label="Year"
                options={yearOptions}
                value={String(periodYear)}
                onChange={(e) => setPeriodYear(Number(e.target.value))}
              />
            </div>
            <Button onClick={handleCreateDraft} disabled={creating}>
              {creating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Create draft
            </Button>
          </div>
          <p className="max-w-sm text-xs text-gray-500">
            A draft recomputes from the salary structure in force on the last day
            of the period. Nothing is visible to employees until you publish.
          </p>
        </CardContent>
      </Card>

      {/* Skipped employees from the last computation */}
      {skippedPeriod && skipped.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-amber-800">
                {skipped.length} employee{skipped.length === 1 ? " was" : "s were"} NOT
                paid in {skippedPeriod}
              </p>
              <ul className="mt-1.5 space-y-1">
                {skipped.map((s) => (
                  <li key={`${s.name}-${s.reason}`} className="text-xs text-amber-700">
                    <span className="font-medium">{s.name}</span> &mdash; {s.reason}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-amber-700">
                Add a salary structure for them and create the draft again.
              </p>
            </div>
          </div>
        </div>
      )}

      {skippedPeriod && skipped.length === 0 && (
        <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-2.5 text-xs text-green-700">
          Every active employee had a salary structure for {skippedPeriod} &mdash;
          nobody was skipped.
        </div>
      )}

      {/* Runs */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Employees</TableHead>
                  <TableHead className="text-right">Total gross</TableHead>
                  <TableHead className="text-right">Total net</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 4 }, (_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="ml-auto h-4 w-8" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="ml-auto h-4 w-20" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="ml-auto h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="ml-auto h-4 w-4" /></TableCell>
                    </TableRow>
                  ))
                ) : error ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-12 text-center">
                      <AlertCircle className="mx-auto mb-3 h-10 w-10 text-red-300" />
                      <p className="text-sm text-gray-900">Failed to load payroll runs</p>
                      <p className="mt-1 text-xs text-gray-500">{error}</p>
                      <Button variant="outline" className="mt-3" onClick={loadRuns}>
                        Try again
                      </Button>
                    </TableCell>
                  </TableRow>
                ) : runs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-12 text-center">
                      <Wallet className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                      <p className="text-sm text-gray-500">
                        No payroll runs yet. Pick a month above and create the first
                        draft.
                      </p>
                    </TableCell>
                  </TableRow>
                ) : (
                  runs.map((run) => (
                    <TableRow
                      key={run.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/payroll/${run.id}`)}
                    >
                      <TableCell>
                        <span className="text-xs font-medium text-gray-900">
                          {MONTH_NAMES[run.period_month - 1]} {run.period_year}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={RUN_STATUS_BADGE[run.status]} dot>
                          {RUN_STATUS_LABEL[run.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs text-gray-700">
                        {run.employee_count}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-gray-700">
                        {inr.format(run.total_gross)}
                      </TableCell>
                      <TableCell className="text-right text-xs font-semibold tabular-nums text-gray-900">
                        {inr.format(run.total_net)}
                      </TableCell>
                      <TableCell className="text-xs text-gray-500">
                        {formatCreated(run.created_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <ChevronRight className="ml-auto h-4 w-4 text-gray-400" />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
