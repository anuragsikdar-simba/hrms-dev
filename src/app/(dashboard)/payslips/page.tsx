"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import api from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
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
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import type { PayslipRow } from "@/types";
import {
  Loader2,
  AlertCircle,
  Download,
  Wallet,
  FileText,
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

/** Money is computed by the server (§8.5) — the UI only formats it. */
const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

// ---------------------------------------------------------------------------
//  Page
// ---------------------------------------------------------------------------

export default function MyPayslipsPage() {
  const { toast } = useToast();

  const [payslips, setPayslips] = useState<PayslipRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PayslipRow | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { payslips: data } = await api.payroll.payslips();
      setPayslips(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load your payslips");
      setPayslips([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** Newest first, grouped by calendar year. */
  const groups = useMemo(() => {
    const byYear: Record<string, PayslipRow[]> = {};
    for (const slip of payslips) {
      const key = String(slip.period_year);
      const list = byYear[key];
      if (list) list.push(slip);
      else byYear[key] = [slip];
    }
    return Object.keys(byYear)
      .sort((a, b) => Number(b) - Number(a))
      .map((year) => ({
        year,
        slips: byYear[year].sort((a, b) => b.period_month - a.period_month),
      }));
  }, [payslips]);

  async function openPayslip(id: string) {
    setOpenId(id);
    setDetail(null);
    setDownloadUrl(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const data = await api.payroll.payslip(id);
      setDetail(data.payslip);
      setDownloadUrl(data.downloadUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Please try again.";
      setDetailError(message);
      toast({ variant: "error", title: "Failed to open payslip", description: message });
    }
    setDetailLoading(false);
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight text-gray-900">
          My payslips
        </h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Published payslips only. A month appears here once payroll has been
          published by HR.
        </p>
      </div>

      {/* Loading */}
      {loading && (
        <div className="rounded-xl border border-[var(--border)] bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-4 w-16" />
          </div>
          <div className="space-y-3">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex items-center justify-between border-b border-gray-100 py-3 last:border-b-0">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 text-center">
          <AlertCircle className="h-12 w-12 text-red-300" />
          <h2 className="text-lg font-semibold text-gray-900">
            Failed to load your payslips
          </h2>
          <p className="max-w-md text-sm text-gray-500">{error}</p>
          <Button variant="outline" onClick={load}>
            Try again
          </Button>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && groups.length === 0 && (
        <EmptyState
          icon={Wallet}
          title="No payslips yet"
          description="Once HR publishes a payroll run, your payslip for that month shows up here."
        />
      )}

      {/* Grouped list */}
      {!loading &&
        !error &&
        groups.map((group) => (
          <Card key={group.year}>
            <CardContent className="p-0">
              <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2.5">
                <span className="text-xs font-semibold text-gray-900">
                  {group.year}
                </span>
                <span className="text-[11px] text-gray-500">
                  {group.slips.length} payslip{group.slips.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Month</TableHead>
                      <TableHead className="text-right">Paid days</TableHead>
                      <TableHead className="text-right">Gross</TableHead>
                      <TableHead className="text-right">Deductions</TableHead>
                      <TableHead className="text-right">Net pay</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.slips.map((slip) => (
                      <TableRow
                        key={slip.id}
                        className="cursor-pointer"
                        onClick={() => openPayslip(slip.id)}
                      >
                        <TableCell>
                          <span className="text-xs font-medium text-gray-900">
                            {MONTH_NAMES[slip.period_month - 1]}
                          </span>
                          {slip.lop_days > 0 && (
                            <Badge variant="amber" className="ml-2">
                              {slip.lop_days} LOP
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-gray-700">
                          {slip.paid_days} / {slip.days_in_month}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-gray-700">
                          {inr.format(slip.gross)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-gray-700">
                          {inr.format(slip.total_deductions)}
                        </TableCell>
                        <TableCell className="text-right text-xs font-semibold tabular-nums text-gray-900">
                          {inr.format(slip.net_pay)}
                        </TableCell>
                        <TableCell className="text-right">
                          <ChevronRight className="ml-auto h-4 w-4 text-gray-400" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ))}

      {/* Detail */}
      <Dialog
        open={openId !== null}
        onOpenChange={(open) => {
          if (!open) setOpenId(null);
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {detail
                ? `Payslip \u2014 ${MONTH_NAMES[detail.period_month - 1]} ${detail.period_year}`
                : "Payslip"}
            </DialogTitle>
            <DialogDescription>
              {detail
                ? `${detail.paid_days} paid day(s) of ${detail.days_in_month}${
                    detail.lop_days > 0 ? ` \u00b7 ${detail.lop_days} day(s) loss of pay` : ""
                  }`
                : "Fetching the stored payslip..."}
            </DialogDescription>
          </DialogHeader>

          {detailLoading && (
            <div className="flex items-center justify-center gap-2 py-10">
              <Loader2 className="h-6 w-6 animate-spin text-gray-300" />
              <span className="text-sm text-gray-500">Loading payslip...</span>
            </div>
          )}

          {!detailLoading && detailError && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <AlertCircle className="h-10 w-10 text-red-300" />
              <p className="text-sm text-gray-500">{detailError}</p>
              {openId && (
                <Button variant="outline" onClick={() => openPayslip(openId)}>
                  Try again
                </Button>
              )}
            </div>
          )}

          {!detailLoading && !detailError && detail && (
            <div className="mt-2 max-h-[60vh] space-y-4 overflow-y-auto pr-1">
              {/* Earnings */}
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  Earnings
                </p>
                <div className="rounded-lg border border-gray-200">
                  {detail.earnings.map((line) => (
                    <div
                      key={line.key}
                      className="flex items-center justify-between border-b border-gray-100 px-3 py-2 last:border-b-0"
                    >
                      <span className="text-xs text-gray-700">{line.label}</span>
                      <span className="text-xs tabular-nums text-gray-900">
                        {inr.format(line.amount)}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between bg-gray-50 px-3 py-2">
                    <span className="text-xs font-semibold text-gray-900">
                      Gross earnings
                    </span>
                    <span className="text-xs font-semibold tabular-nums text-gray-900">
                      {inr.format(detail.gross)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Deductions */}
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  Deductions
                </p>
                <div className="rounded-lg border border-gray-200">
                  {detail.deductions.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-gray-500">
                      No deductions this month.
                    </div>
                  ) : (
                    detail.deductions.map((line) => (
                      <div
                        key={line.key}
                        className="flex items-center justify-between border-b border-gray-100 px-3 py-2 last:border-b-0"
                      >
                        <span className="text-xs text-gray-700">{line.label}</span>
                        <span className="text-xs tabular-nums text-gray-900">
                          {inr.format(line.amount)}
                        </span>
                      </div>
                    ))
                  )}
                  <div className="flex items-center justify-between bg-gray-50 px-3 py-2">
                    <span className="text-xs font-semibold text-gray-900">
                      Total deductions
                    </span>
                    <span className="text-xs font-semibold tabular-nums text-gray-900">
                      {inr.format(detail.total_deductions)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Net */}
              <div className="flex items-center justify-between rounded-lg border border-gray-900 bg-gray-900 px-3 py-2.5">
                <span className="text-xs font-semibold text-white">Net pay</span>
                <span className="text-sm font-semibold tabular-nums text-white">
                  {inr.format(detail.net_pay)}
                </span>
              </div>

              {/* Download */}
              {downloadUrl ? (
                <a href={downloadUrl} target="_blank" rel="noreferrer">
                  <Button className="w-full">
                    <Download className="h-3.5 w-3.5" />
                    Download PDF
                  </Button>
                </a>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-dashed border-gray-300 bg-gray-50/50 px-3 py-2.5">
                  <FileText className="h-4 w-4 shrink-0 text-gray-400" />
                  <p className="text-xs text-gray-500">
                    The PDF is not available yet. The figures above are your final
                    published payslip.
                  </p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
