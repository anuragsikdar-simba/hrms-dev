"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Skeleton, SkeletonTable } from "@/components/ui/skeleton";
import type { PayrollRunRow, PayslipRow, PayrollRunStatus } from "@/types";
import {
  ArrowLeft,
  Shield,
  Loader2,
  Lock,
  Send,
  Trash2,
  AlertCircle,
  Users,
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

type PendingAction = "lock" | "publish" | "delete";

const CONFIRM_COPY: Record<
  PendingAction,
  { title: string; body: string; cta: string }
> = {
  lock: {
    title: "Lock this payroll run?",
    body:
      "Locking freezes every figure in this run. Payslips can no longer be edited — a correction has to be issued as an arrear line in a later run. Employees still cannot see anything until you publish.",
    cta: "Lock run",
  },
  publish: {
    title: "Publish this payroll run?",
    body:
      "Publishing makes these payslips visible to employees, who can then download them. This cannot be undone.",
    cta: "Publish run",
  },
  delete: {
    title: "Delete this draft run?",
    body:
      "The draft and every payslip computed in it are permanently deleted. You can recompute the period afterwards.",
    cta: "Delete draft",
  },
};

// ---------------------------------------------------------------------------
//  Page
// ---------------------------------------------------------------------------

export default function PayrollRunPage() {
  const params = useParams<{ id: string }>();
  const runId = params.id;
  const router = useRouter();
  const { isAdmin, loading: authLoading } = useAuth();
  const { toast } = useToast();

  const [run, setRun] = useState<PayrollRunRow | null>(null);
  const [payslips, setPayslips] = useState<PayslipRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pending, setPending] = useState<PendingAction | null>(null);
  const [acting, setActing] = useState(false);
  const [savingTdsFor, setSavingTdsFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!runId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.payroll.run(runId);
      setRun(data.run);
      setPayslips(data.payslips ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the payroll run");
      setRun(null);
      setPayslips([]);
    }
    setLoading(false);
  }, [runId]);

  useEffect(() => {
    if (authLoading || !isAdmin) return;
    load();
  }, [authLoading, isAdmin, load]);

  /**
   * Commits a TDS override. The server owns the arithmetic, so the whole run is
   * re-read afterwards instead of patching numbers locally.
   */
  async function commitTds(payslip: PayslipRow, raw: string) {
    const trimmed = raw.trim();
    const next = trimmed === "" ? null : Number(trimmed);
    if (next !== null && (!Number.isFinite(next) || next < 0)) {
      toast({
        variant: "error",
        title: "Invalid TDS amount",
        description: "Enter a positive rupee amount, or clear the field to remove the override.",
      });
      await load();
      return;
    }
    if (next === payslip.tds_override) return;

    setSavingTdsFor(payslip.id);
    try {
      await api.payroll.setTds({ payslip_id: payslip.id, tds_override: next });
      toast({
        variant: "success",
        title: next === null ? "TDS override removed" : "TDS updated",
        description: payslip.employees?.name ?? undefined,
      });
      await load();
    } catch (err) {
      toast({
        variant: "error",
        title: "Failed to update TDS",
        description: err instanceof Error ? err.message : "Please try again.",
      });
      await load();
    }
    setSavingTdsFor(null);
  }

  async function runPendingAction() {
    if (!pending || !run) return;
    setActing(true);
    try {
      if (pending === "delete") {
        await api.payroll.deleteRun(run.id);
        toast({ variant: "success", title: "Draft run deleted" });
        setPending(null);
        setActing(false);
        router.push("/payroll");
        return;
      }
      const nextStatus = pending === "lock" ? "locked" : "published";
      await api.payroll.transitionRun(run.id, nextStatus);
      toast({
        variant: "success",
        title: nextStatus === "locked" ? "Payroll run locked" : "Payroll run published",
        description:
          nextStatus === "locked"
            ? "The figures are frozen. Publish when you are ready to share them."
            : "Employees can now see and download their payslips.",
      });
      setPending(null);
      await load();
    } catch (err) {
      toast({
        variant: "error",
        title: "Action failed",
        description: err instanceof Error ? err.message : "Please try again.",
      });
    }
    setActing(false);
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
            Only administrators can view payroll runs.
          </p>
        </div>
      </div>
    );
  }

  /* ---- Loading ---- */
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-4 w-28" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="rounded-lg border border-[var(--border)] bg-white p-4">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="mt-3 h-7 w-32" />
            </div>
          ))}
        </div>
        <SkeletonTable rows={6} columns={7} />
      </div>
    );
  }

  /* ---- Error ---- */
  if (error || !run) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <AlertCircle className="h-12 w-12 text-red-300" />
        <h2 className="text-lg font-semibold text-gray-900">
          Failed to load this payroll run
        </h2>
        <p className="max-w-md text-sm text-gray-500">
          {error ?? "The run could not be found."}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={load}>
            Try again
          </Button>
          <Link href="/payroll">
            <Button variant="ghost">Back to payroll</Button>
          </Link>
        </div>
      </div>
    );
  }

  const isDraft = run.status === "draft";
  const periodLabel = `${MONTH_NAMES[run.period_month - 1]} ${run.period_year}`;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <Link href="/payroll">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[22px] font-semibold tracking-tight text-gray-900">
                {periodLabel}
              </h1>
              <Badge variant={RUN_STATUS_BADGE[run.status]} dot>
                {RUN_STATUS_LABEL[run.status]}
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-gray-500">
              {run.employee_count} employee{run.employee_count === 1 ? "" : "s"} in this
              run
            </p>
          </div>
        </div>

        {/* Actions mirror the server state machine: draft -> locked -> published */}
        <div className="flex items-center gap-2">
          {run.status === "draft" && (
            <>
              <Button variant="destructive" onClick={() => setPending("delete")}>
                <Trash2 className="h-3.5 w-3.5" />
                Delete draft
              </Button>
              <Button onClick={() => setPending("lock")}>
                <Lock className="h-3.5 w-3.5" />
                Lock run
              </Button>
            </>
          )}
          {run.status === "locked" && (
            <Button onClick={() => setPending("publish")}>
              <Send className="h-3.5 w-3.5" />
              Publish
            </Button>
          )}
          {run.status === "published" && (
            <span className="text-xs text-gray-500">
              Published &mdash; payslips are visible to employees.
            </span>
          )}
        </div>
      </div>

      {/* Totals (server-computed) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <CardContent>
            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
              Total gross
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-gray-900">
              {inr.format(run.total_gross)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
              Total deductions
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-gray-900">
              {inr.format(run.total_deductions)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
              Total net pay
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-gray-900">
              {inr.format(run.total_net)}
            </p>
          </CardContent>
        </Card>
      </div>

      {isDraft && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs text-amber-700">
          This run is a draft. Employees cannot see any of these figures yet, and TDS
          is still editable.
        </div>
      )}

      {/* Payslips */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead className="text-right">Paid days</TableHead>
                  <TableHead className="text-right">LOP</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">TDS</TableHead>
                  <TableHead className="text-right">Deductions</TableHead>
                  <TableHead className="text-right">Net pay</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payslips.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-12 text-center">
                      <Users className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                      <p className="text-sm text-gray-500">
                        This run has no payslips. Every employee was skipped &mdash;
                        check that salary structures exist.
                      </p>
                    </TableCell>
                  </TableRow>
                ) : (
                  payslips.map((slip) => {
                    const tdsLine = slip.deductions.find((l) => l.key === "tds");
                    const tdsAmount = slip.tds_override ?? tdsLine?.amount ?? 0;
                    return (
                      <TableRow key={slip.id}>
                        <TableCell>
                          <span className="text-xs font-medium text-gray-900">
                            {slip.employees?.name ?? "Unknown employee"}
                          </span>
                          {slip.employees?.employee_id && (
                            <span className="ml-2 font-mono text-[11px] text-gray-400">
                              {slip.employees.employee_id}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-gray-700">
                          {slip.paid_days} / {slip.days_in_month}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {slip.lop_days > 0 ? (
                            <span className="font-semibold text-red-600">
                              {slip.lop_days}
                            </span>
                          ) : (
                            <span className="text-gray-400">0</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-gray-700">
                          {inr.format(slip.gross)}
                        </TableCell>
                        <TableCell className="text-right">
                          {isDraft ? (
                            <div className="flex items-center justify-end gap-1.5">
                              {savingTdsFor === slip.id && (
                                <Loader2 className="h-3 w-3 animate-spin text-gray-400" />
                              )}
                              <input
                                // Remounts whenever the server value changes so the
                                // field can never drift from the stored figure.
                                key={`${slip.id}:${slip.tds_override ?? "auto"}:${tdsLine?.amount ?? 0}`}
                                type="number"
                                min={0}
                                step={1}
                                defaultValue={tdsAmount === 0 ? "" : String(tdsAmount)}
                                placeholder="0"
                                aria-label={`TDS for ${slip.employees?.name ?? "employee"}`}
                                disabled={savingTdsFor === slip.id}
                                className="h-7 w-24 rounded-md border border-gray-300 bg-white px-2 text-right text-xs tabular-nums transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:opacity-50"
                                onBlur={(e) => commitTds(slip, e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") e.currentTarget.blur();
                                }}
                              />
                            </div>
                          ) : (
                            <span className="text-xs tabular-nums text-gray-700">
                              {inr.format(tdsAmount)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-gray-700">
                          {inr.format(slip.total_deductions)}
                        </TableCell>
                        <TableCell className="text-right text-xs font-semibold tabular-nums text-gray-900">
                          {inr.format(slip.net_pay)}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Confirm dialog for every state transition */}
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !acting) setPending(null);
        }}
      >
        <DialogContent>
          {pending && (
            <>
              <DialogHeader>
                <DialogTitle>{CONFIRM_COPY[pending].title}</DialogTitle>
                <DialogDescription>{CONFIRM_COPY[pending].body}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  disabled={acting}
                  onClick={() => setPending(null)}
                >
                  Cancel
                </Button>
                <Button
                  variant={pending === "delete" ? "destructive" : "default"}
                  disabled={acting}
                  onClick={runPendingAction}
                >
                  {acting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {CONFIRM_COPY[pending].cta}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
