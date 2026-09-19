"use client";

import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/lib/api-client";
import { businessDate } from "@/lib/dates";
import { resolveStructureFor } from "@/lib/payroll";
import { useToast } from "@/components/ui/toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { SearchInput } from "@/components/ui/search-input";
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
import { Skeleton } from "@/components/ui/skeleton";
import type {
  SalaryComponentCalc,
  SalaryComponentRow,
  SalaryStructureRow,
} from "@/types";
import {
  ArrowLeft,
  Shield,
  Loader2,
  Plus,
  Trash2,
  AlertCircle,
  Users,
  ChevronDown,
  ChevronRight,
  History,
} from "lucide-react";

// ---------------------------------------------------------------------------
//  Constants & helpers
// ---------------------------------------------------------------------------

const CALC_OPTIONS: { label: string; value: SalaryComponentCalc }[] = [
  { label: "Fixed amount", value: "fixed" },
  { label: "% of basic", value: "pct_of_basic" },
  { label: "% of gross", value: "pct_of_gross" },
  { label: "Balance (remainder)", value: "balance" },
];

/** Money is computed by the server (§8.5) — the UI only formats it. */
const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

function formatDate(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** First day of the month after the current IST business date (§1). */
function nextMonthStart(): string {
  const today = businessDate();
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
}

interface EmployeeOption {
  id: string;
  name: string;
  employeeId: string;
}

interface LineDraft {
  componentKey: string;
  calc: SalaryComponentCalc;
  amount: string;
  percent: string;
}

const EMPTY_LINE: LineDraft = {
  componentKey: "",
  calc: "fixed",
  amount: "",
  percent: "",
};

// ---------------------------------------------------------------------------
//  Page
// ---------------------------------------------------------------------------

export default function SalaryStructuresPage() {
  const { isAdmin, loading: authLoading } = useAuth();
  const { toast } = useToast();

  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [structures, setStructures] = useState<SalaryStructureRow[]>([]);
  const [components, setComponents] = useState<SalaryComponentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const [dialogFor, setDialogFor] = useState<EmployeeOption | null>(null);
  const [saving, setSaving] = useState(false);
  const [formEffectiveFrom, setFormEffectiveFrom] = useState("");
  const [formMonthlyGross, setFormMonthlyGross] = useState("");
  const [formCtc, setFormCtc] = useState("");
  const [formNote, setFormNote] = useState("");
  const [formLines, setFormLines] = useState<LineDraft[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [employeeRes, structureRes, settingsRes] = await Promise.all([
        api.employees.list(),
        api.payroll.structures(),
        api.payroll.settings(),
      ]);
      setEmployees(
        (employeeRes.employees ?? [])
          .map((row: Record<string, unknown>) => ({
            id: row.id as string,
            name: (row.name as string) ?? "",
            employeeId: (row.employee_id as string) ?? "",
          }))
          .sort((a: EmployeeOption, b: EmployeeOption) => a.name.localeCompare(b.name)),
      );
      setStructures(structureRes.structures ?? []);
      setComponents(settingsRes.components ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load salary structures");
      setEmployees([]);
      setStructures([]);
      setComponents([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (authLoading || !isAdmin) return;
    load();
  }, [authLoading, isAdmin, load]);

  /** Revisions per employee, newest effective date first. */
  const revisionsByEmployee = useMemo(() => {
    const grouped: Record<string, SalaryStructureRow[]> = {};
    for (const structure of structures) {
      const list = grouped[structure.employee_id];
      if (list) list.push(structure);
      else grouped[structure.employee_id] = [structure];
    }
    for (const list of Object.values(grouped)) {
      list.sort((a, b) => b.effective_from.localeCompare(a.effective_from));
    }
    return grouped;
  }, [structures]);

  const today = businessDate();
  const thisYear = Number(today.slice(0, 4));
  const thisMonth = Number(today.slice(5, 7));

  /** Earnings only — statutory deductions come from payroll settings (§8.3). */
  const earningComponents = components.filter(
    (c) => c.kind === "earning" && c.is_active,
  );
  const componentOptions = earningComponents.map((c) => ({
    label: c.name,
    value: c.key,
  }));
  const componentName: Record<string, string> = {};
  for (const c of components) componentName[c.key] = c.name;

  const filteredEmployees = employees.filter((emp) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      emp.name.toLowerCase().includes(q) ||
      emp.employeeId.toLowerCase().includes(q)
    );
  });

  function openRevisionDialog(emp: EmployeeOption) {
    const revisions = revisionsByEmployee[emp.id] ?? [];
    const current = resolveStructureFor(
      revisions.map((r) => ({ effectiveFrom: r.effective_from, row: r })),
      thisYear,
      thisMonth,
    );
    const base = current?.row ?? revisions[0] ?? null;

    setFormEffectiveFrom(nextMonthStart());
    setFormMonthlyGross(base ? String(base.monthly_gross) : "");
    setFormCtc(base?.ctc_annual != null ? String(base.ctc_annual) : "");
    setFormNote("");
    setFormLines(
      base?.items?.length
        ? base.items.map((item) => ({
            componentKey: item.component_key,
            calc: item.calc,
            amount: item.amount != null ? String(item.amount) : "",
            percent: item.percent != null ? String(item.percent) : "",
          }))
        : [{ ...EMPTY_LINE }],
    );
    setFormError(null);
    setDialogFor(emp);
  }

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setFormLines((prev) =>
      prev.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    );
  }

  async function handleSaveRevision() {
    if (!dialogFor) return;

    const gross = Number(formMonthlyGross);
    if (!formEffectiveFrom) {
      setFormError("Pick the date this revision takes effect from.");
      return;
    }
    if (!Number.isFinite(gross) || gross <= 0) {
      setFormError("Monthly gross must be a positive amount.");
      return;
    }
    if (formLines.length === 0) {
      setFormError("Add at least one salary component.");
      return;
    }
    const keys = new Set<string>();
    for (const line of formLines) {
      if (!line.componentKey) {
        setFormError("Every line needs a component.");
        return;
      }
      if (keys.has(line.componentKey)) {
        setFormError(
          `${componentName[line.componentKey] ?? line.componentKey} appears twice.`,
        );
        return;
      }
      keys.add(line.componentKey);
      if (line.calc === "fixed" && !(Number(line.amount) >= 0 && line.amount !== "")) {
        setFormError(
          `${componentName[line.componentKey] ?? line.componentKey} needs a fixed amount.`,
        );
        return;
      }
      if (
        (line.calc === "pct_of_basic" || line.calc === "pct_of_gross") &&
        !(Number(line.percent) > 0)
      ) {
        setFormError(
          `${componentName[line.componentKey] ?? line.componentKey} needs a percentage.`,
        );
        return;
      }
    }

    const ctc = formCtc.trim() === "" ? null : Number(formCtc);
    if (ctc !== null && (!Number.isFinite(ctc) || ctc < 0)) {
      setFormError("Annual CTC must be a positive amount.");
      return;
    }

    setFormError(null);
    setSaving(true);
    try {
      await api.payroll.createStructure({
        employee_id: dialogFor.id,
        effective_from: formEffectiveFrom,
        monthly_gross: gross,
        ctc_annual: ctc,
        note: formNote.trim() || undefined,
        items: formLines.map((line) => ({
          component_key: line.componentKey,
          calc: line.calc,
          amount: line.calc === "fixed" ? Number(line.amount) : null,
          percent:
            line.calc === "pct_of_basic" || line.calc === "pct_of_gross"
              ? Number(line.percent)
              : null,
        })),
      });
      // Toast only after the awaited call resolved (§6.1 — no fake success).
      toast({
        variant: "success",
        title: "Revision added",
        description: `${dialogFor.name} — effective ${formatDate(formEffectiveFrom)}. Earlier revisions are preserved.`,
      });
      setExpanded(dialogFor.id);
      setDialogFor(null);
      await load();
    } catch (err) {
      toast({
        variant: "error",
        title: "Failed to add the revision",
        description: err instanceof Error ? err.message : "Please try again.",
      });
    }
    setSaving(false);
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
            Only administrators can view salary structures.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link href="/payroll">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight text-gray-900">
              Salary structures
            </h1>
            <p className="mt-0.5 text-xs text-gray-500">
              Append-only. A revision adds a new effective-dated record; past
              payslips keep the structure they were computed from.
            </p>
          </div>
        </div>
        <SearchInput
          className="w-full sm:max-w-xs"
          placeholder="Search by name or employee ID..."
          value={search}
          onChange={setSearch}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Employee</TableHead>
                  <TableHead className="text-right">Monthly gross</TableHead>
                  <TableHead>Effective from</TableHead>
                  <TableHead className="text-right">Revisions</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 6 }, (_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="ml-auto h-4 w-20" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="ml-auto h-8 w-24 rounded-md" /></TableCell>
                    </TableRow>
                  ))
                ) : error ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-12 text-center">
                      <AlertCircle className="mx-auto mb-3 h-10 w-10 text-red-300" />
                      <p className="text-sm text-gray-900">
                        Failed to load salary structures
                      </p>
                      <p className="mt-1 text-xs text-gray-500">{error}</p>
                      <Button variant="outline" className="mt-3" onClick={load}>
                        Try again
                      </Button>
                    </TableCell>
                  </TableRow>
                ) : filteredEmployees.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-12 text-center">
                      <Users className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                      <p className="text-sm text-gray-500">
                        {search
                          ? "No employee matches that search."
                          : "No employees yet. Add employees before setting up payroll."}
                      </p>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredEmployees.map((emp) => {
                    const revisions = revisionsByEmployee[emp.id] ?? [];
                    const current = resolveStructureFor(
                      revisions.map((r) => ({
                        effectiveFrom: r.effective_from,
                        row: r,
                      })),
                      thisYear,
                      thisMonth,
                    )?.row;
                    const isOpen = expanded === emp.id;

                    return (
                      <Fragment key={emp.id}>
                        <TableRow key={emp.id}>
                          <TableCell>
                            <button
                              type="button"
                              aria-label={
                                isOpen ? "Hide revision history" : "Show revision history"
                              }
                              className="text-gray-400 transition-colors hover:text-gray-700 disabled:opacity-30"
                              disabled={revisions.length === 0}
                              onClick={() => setExpanded(isOpen ? null : emp.id)}
                            >
                              {isOpen ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </button>
                          </TableCell>
                          <TableCell>
                            <span className="text-xs font-medium text-gray-900">
                              {emp.name}
                            </span>
                            {emp.employeeId && (
                              <span className="ml-2 font-mono text-[11px] text-gray-400">
                                {emp.employeeId}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            {current ? (
                              <span className="font-semibold text-gray-900">
                                {inr.format(current.monthly_gross)}
                              </span>
                            ) : (
                              <Badge variant="amber">No structure</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-gray-500">
                            {current ? formatDate(current.effective_from) : "\u2014"}
                          </TableCell>
                          <TableCell className="text-right text-xs text-gray-500">
                            {revisions.length}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openRevisionDialog(emp)}
                            >
                              <Plus className="h-3 w-3" />
                              Add revision
                            </Button>
                          </TableCell>
                        </TableRow>

                        {isOpen && revisions.length > 0 && (
                          <TableRow key={`${emp.id}-history`}>
                            <TableCell colSpan={6} className="bg-gray-50/70">
                              <div className="flex items-center gap-1.5 pb-2">
                                <History className="h-3.5 w-3.5 text-gray-400" />
                                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                                  Revision history ({revisions.length})
                                </span>
                              </div>
                              <div className="space-y-2">
                                {revisions.map((rev, index) => (
                                  <div
                                    key={rev.id}
                                    className="rounded-lg border border-gray-200 bg-white px-3 py-2"
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <div className="flex items-center gap-2">
                                        <span className="text-xs font-medium text-gray-900">
                                          From {formatDate(rev.effective_from)}
                                        </span>
                                        {index === 0 && (
                                          <Badge variant="blue">Latest</Badge>
                                        )}
                                      </div>
                                      <span className="text-xs tabular-nums text-gray-700">
                                        {inr.format(rev.monthly_gross)} / month
                                        {rev.ctc_annual != null && (
                                          <span className="ml-2 text-gray-400">
                                            CTC {inr.format(rev.ctc_annual)}
                                          </span>
                                        )}
                                      </span>
                                    </div>
                                    {rev.items && rev.items.length > 0 && (
                                      <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                                        {rev.items.map((item) => (
                                          <li
                                            key={item.id}
                                            className="text-[11px] text-gray-500"
                                          >
                                            {componentName[item.component_key] ??
                                              item.component_key}
                                            :{" "}
                                            {item.calc === "fixed"
                                              ? inr.format(item.amount ?? 0)
                                              : item.calc === "balance"
                                                ? "balance"
                                                : `${item.percent ?? 0}% ${
                                                    item.calc === "pct_of_basic"
                                                      ? "of basic"
                                                      : "of gross"
                                                  }`}
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                    {rev.note && (
                                      <p className="mt-1 text-[11px] italic text-gray-400">
                                        {rev.note}
                                      </p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Add revision dialog */}
      <Dialog
        open={dialogFor !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setDialogFor(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          {dialogFor && (
            <>
              <DialogHeader>
                <DialogTitle>Add revision &mdash; {dialogFor.name}</DialogTitle>
                <DialogDescription>
                  This inserts a new effective-dated structure. The existing
                  revisions stay exactly as they are, so already-issued payslips
                  never change.
                </DialogDescription>
              </DialogHeader>

              <div className="mt-4 max-h-[60vh] space-y-4 overflow-y-auto pr-1">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Input
                    label="Effective from"
                    type="date"
                    value={formEffectiveFrom}
                    onChange={(e) => setFormEffectiveFrom(e.target.value)}
                  />
                  <Input
                    label="Monthly gross (₹)"
                    type="number"
                    min={0}
                    placeholder="e.g. 60000"
                    value={formMonthlyGross}
                    onChange={(e) => setFormMonthlyGross(e.target.value)}
                  />
                  <Input
                    label="Annual CTC (₹, optional)"
                    type="number"
                    min={0}
                    placeholder="e.g. 780000"
                    value={formCtc}
                    onChange={(e) => setFormCtc(e.target.value)}
                  />
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-700">
                        Earning components
                      </p>
                      <p className="text-[11px] text-gray-500">
                        Deductions (PF, ESI, PT, TDS) are statutory and come from
                        payroll settings.
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setFormLines((prev) => [...prev, { ...EMPTY_LINE }])}
                    >
                      <Plus className="h-3 w-3" />
                      Add line
                    </Button>
                  </div>

                  <div className="space-y-2">
                    {formLines.map((line, index) => (
                      <div
                        key={index}
                        className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2"
                      >
                        <Select
                          placeholder="Component"
                          options={componentOptions}
                          value={line.componentKey}
                          onChange={(e) =>
                            updateLine(index, { componentKey: e.target.value })
                          }
                        />
                        <Select
                          options={CALC_OPTIONS}
                          value={line.calc}
                          onChange={(e) =>
                            updateLine(index, {
                              calc: e.target.value as SalaryComponentCalc,
                            })
                          }
                        />
                        {line.calc === "fixed" ? (
                          <Input
                            type="number"
                            min={0}
                            placeholder="Amount ₹"
                            value={line.amount}
                            onChange={(e) => updateLine(index, { amount: e.target.value })}
                          />
                        ) : line.calc === "balance" ? (
                          <div className="flex h-10 items-center text-xs text-gray-500">
                            Takes whatever is left of the gross
                          </div>
                        ) : (
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            placeholder="Percent %"
                            value={line.percent}
                            onChange={(e) =>
                              updateLine(index, { percent: e.target.value })
                            }
                          />
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Remove line"
                          onClick={() =>
                            setFormLines((prev) => prev.filter((_, i) => i !== index))
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    {formLines.length === 0 && (
                      <p className="rounded-lg border border-dashed border-gray-300 px-3 py-4 text-center text-xs text-gray-500">
                        No components yet. Add at least one earning line.
                      </p>
                    )}
                  </div>
                </div>

                <Textarea
                  label="Note (optional)"
                  placeholder="e.g. Annual appraisal 2026"
                  value={formNote}
                  onChange={(e) => setFormNote(e.target.value)}
                />

                {formError && (
                  <p className="text-xs text-red-600" role="alert">
                    {formError}
                  </p>
                )}
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  disabled={saving}
                  onClick={() => setDialogFor(null)}
                >
                  Cancel
                </Button>
                <Button disabled={saving} onClick={handleSaveRevision}>
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Add revision
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
