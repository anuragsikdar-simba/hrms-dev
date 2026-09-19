"use client";

import * as React from "react";
import { businessDate } from "@/lib/dates";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Upload,
  Download,
  FileSpreadsheet,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Trash2,
  ArrowLeft,
  Copy,
  Check,
  KeyRound,
} from "lucide-react";
import api from "@/lib/api-client";
import { parseCSV, toCSV, downloadFile } from "@/lib/csv";
import { isValidEmployeeId } from "@/lib/employee-id";

/* ------------------------------------------------------------------ */
/*  Column spec — the canonical import/template format                 */
/* ------------------------------------------------------------------ */

interface ImportColumn {
  key: string;
  label: string;
  /** The column header must be present in the uploaded CSV. */
  required: boolean;
  /**
   * The cell value must be non-empty for the row to be valid (mirrors the
   * single "Add Employee" form so bulk import can't create incomplete
   * records). May be true even when `required` is false — i.e. the header is
   * optional but, if the admin leaves the value blank, they must fill it in
   * the review grid before importing.
   */
  valueRequired?: boolean;
  example: string;
  note: string;
}

/**
 * The import columns. `name`, `email`, `employee_id` are required by the API;
 * everything else is optional. `department` is matched (or created) by name.
 */
export const IMPORT_COLUMNS: ImportColumn[] = [
  { key: "name", label: "name", required: true, valueRequired: true, example: "Asha Verma", note: "Full name" },
  { key: "email", label: "email", required: true, valueRequired: true, example: "asha@august.io", note: "Work email (login)" },
  { key: "employee_id", label: "employee_id", required: false, example: "", note: "Blank = auto (AU-YYYY-NNNN)" },
  { key: "department", label: "department", required: false, valueRequired: true, example: "Engineering", note: "Required. Pick from existing in the review step (typos auto-matched)" },
  { key: "designation", label: "designation", required: false, valueRequired: true, example: "Software Engineer", note: "Required. Job title" },
  { key: "role", label: "role", required: false, example: "employee", note: "employee or admin (default employee)" },
  { key: "phone", label: "phone", required: false, example: "+91 98765 43210", note: "Optional" },
  { key: "date_of_joining", label: "date_of_joining", required: false, valueRequired: true, example: "2025-04-01", note: "Required. YYYY-MM-DD" },
  { key: "shift_start", label: "shift_start", required: false, example: "09:00", note: "HH:MM (IST)" },
  { key: "shift_end", label: "shift_end", required: false, example: "18:00", note: "HH:MM. If <= start, overnight" },
  { key: "tracks_attendance", label: "tracks_attendance", required: false, example: "true", note: "false = observer (no punch)" },
];

const REQUIRED_KEYS = IMPORT_COLUMNS.filter((c) => c.required).map((c) => c.key);
const ALL_KEYS = IMPORT_COLUMNS.map((c) => c.key);

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a run that created at least one employee, to refresh the list. */
  onImported: () => void;
}

interface RowResult {
  line: number;
  name: string;
  email: string;
  status: "created" | "skipped" | "error";
  message?: string;
  /** Present only for newly created rows — the one-time login credentials. */
  tempPassword?: string;
  employeeId?: string;
}

/** Server-side validation report for one row (from /api/employees/bulk). */
interface ServerRowReport {
  line: number;
  name: string;
  email: string;
  status: "ok" | "created" | "skipped" | "error";
  errors: string[];
  warnings: string[];
  department?: { name: string; action: "matched" | "create" | "none" };
  message?: string;
  /** Returned by the commit path for created rows. */
  tempPassword?: string;
  employeeId?: string;
}

/** A single editable review row (string-valued for the grid). */
type ReviewRow = Record<string, string>;

type Phase = "idle" | "review" | "results";

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseBool(v: string): boolean {
  return !["false", "no", "0", "observer"].includes(v.trim().toLowerCase());
}

/** Per-cell validation. Returns an error string or null. */
function cellError(key: string, value: string): string | null {
  const v = (value ?? "").trim();
  if (key === "name" && !v) return "Required";
  if (key === "email") {
    if (!v) return "Required";
    if (!EMAIL_RE.test(v)) return "Invalid email";
  }
  // Required fields that keep the directory clean (mirrors the single
  // "Add Employee" form): department, designation, date of joining.
  if (key === "department" && !v) return "Required";
  if (key === "designation" && !v) return "Required";
  if (key === "date_of_joining") {
    if (!v) return "Required";
    if (!DATE_RE.test(v)) return "Use YYYY-MM-DD";
  }
  // Employee ID is optional (blank = auto-generate), but if supplied it must
  // match the accepted format. Mirrors the single "Add Employee" form.
  if (key === "employee_id" && v && !isValidEmployeeId(v))
    return "Invalid ID (blank = auto)";
  if ((key === "shift_start" || key === "shift_end") && v && !TIME_RE.test(v))
    return "Use HH:MM";
  if (key === "role" && v && !["admin", "employee"].includes(v.trim().toLowerCase()))
    return "admin/employee";
  return null;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ImportDialog({ open, onOpenChange, onImported }: ImportDialogProps) {
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<ReviewRow[]>([]);
  const [parseError, setParseError] = React.useState<string | null>(null);
  const [importing, setImporting] = React.useState(false);
  const [results, setResults] = React.useState<RowResult[] | null>(null);
  // Whether the "copy all credentials" button has just been clicked.
  const [copiedCreds, setCopiedCreds] = React.useState(false);
  // Server-side validation (DB-aware): per-line report + overall summary.
  const [serverReports, setServerReports] = React.useState<Map<number, ServerRowReport>>(new Map());
  const [validating, setValidating] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  // Existing departments (for the picker) — predefined values so the admin
  // selects rather than free-types, avoiding typos/mismatches.
  const [departments, setDepartments] = React.useState<{ id: string; name: string }[]>([]);
  // Per-row flag: admin explicitly chose to add a NEW department (free-type).
  const [newDeptRows, setNewDeptRows] = React.useState<Set<number>>(new Set());
  // Preview of the next auto-generated employee_id (shown as placeholder so the
  // admin sees what a blank ID will become). Same as the single-add form.
  const [nextIdPreview, setNextIdPreview] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const revalidateTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load existing departments whenever the dialog opens.
  React.useEffect(() => {
    if (!open) return;
    let active = true;
    api.departments
      .list()
      .then((res) => {
        if (active) setDepartments((res.departments ?? []).map((d: any) => ({ id: d.id, name: d.name })));
      })
      .catch(() => {
        /* non-fatal: picker falls back to free-type */
      });
    // Preview the next auto-generated employee_id (placeholder hint only).
    api.employees
      .previewNextId()
      .then((res) => {
        if (active) setNextIdPreview(res.nextId);
      })
      .catch(() => {
        /* non-fatal: server still auto-generates on commit */
      });
    return () => {
      active = false;
    };
  }, [open]);

  const reset = React.useCallback(() => {
    setPhase("idle");
    setFileName(null);
    setRows([]);
    setParseError(null);
    setImporting(false);
    setResults(null);
    setServerReports(new Map());
    setValidating(false);
    setServerError(null);
    setNewDeptRows(new Set());
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const downloadTemplate = () => {
    const headers = ALL_KEYS;
    const sample = Object.fromEntries(IMPORT_COLUMNS.map((c) => [c.key, c.example]));
    const csv = toCSV(headers, [sample]);
    downloadFile("employee-import-template.csv", csv);
  };

  const handleFile = async (file: File) => {
    setParseError(null);
    setResults(null);
    setFileName(file.name);
    try {
      const text = await file.text();
      const raw = parseCSV(text);
      if (raw.length === 0) {
        setParseError("The file has no data rows.");
        return;
      }
      // Validate required headers are present.
      const headers = Object.keys(raw[0]);
      const missing = REQUIRED_KEYS.filter((k) => !headers.includes(k));
      if (missing.length > 0) {
        setParseError(
          `Missing required column(s): ${missing.join(", ")}. Download the template for the exact format.`,
        );
        return;
      }
      // Normalise into the canonical column set so the grid is uniform.
      // Snap department to the canonical existing name when it matches
      // case/space-insensitively (so "engineering" -> "Engineering"). Unknown
      // departments are left as-is; the picker defaults to a dropdown and the
      // server flags them "new" — the admin can then pick an existing one or
      // explicitly choose "Add new department".
      const deptByLower = new Map(departments.map((d) => [d.name.trim().toLowerCase(), d.name]));
      const normalised: ReviewRow[] = raw.map((r) => {
        const out: ReviewRow = {};
        for (const k of ALL_KEYS) out[k] = (r[k] ?? "").trim();
        if (out.department) {
          const canon = deptByLower.get(out.department.toLowerCase());
          if (canon) out.department = canon;
        }
        return out;
      });
      setRows(normalised);
      setNewDeptRows(new Set());
      setPhase("review");
      void validateOnServer(normalised);
    } catch {
      setParseError("Could not read the file. Make sure it is a valid .csv file.");
    }
  };

  /**
   * Ask the server to validate the current rows against the live DB
   * (existing departments, duplicate emails/IDs, in-file duplicates).
   * This is the source of truth for the review report.
   */
  const validateOnServer = React.useCallback(async (current: ReviewRow[]) => {
    if (current.length === 0) {
      setServerReports(new Map());
      return;
    }
    setValidating(true);
    setServerError(null);
    try {
      const res = await api.employees.bulkValidate(current);
      const map = new Map<number, ServerRowReport>();
      for (const r of (res.rows ?? []) as ServerRowReport[]) map.set(r.line, r);
      setServerReports(map);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Could not validate against the server.");
    } finally {
      setValidating(false);
    }
  }, []);

  const updateCell = (rowIdx: number, key: string, value: string) => {
    setRows((prev) => {
      const next = [...prev];
      next[rowIdx] = { ...next[rowIdx], [key]: value };
      return next;
    });
  };

  const removeRow = (rowIdx: number) => {
    setRows((prev) => prev.filter((_, i) => i !== rowIdx));
    setNewDeptRows((prev) => {
      // Re-index the "new dept" flags after a row is removed.
      const next = new Set<number>();
      for (const i of prev) {
        if (i < rowIdx) next.add(i);
        else if (i > rowIdx) next.add(i - 1);
      }
      return next;
    });
  };

  // Department picker handling: the select uses sentinel values.
  const ADD_NEW = "__add_new__";
  const setNewDept = (rowIdx: number, on: boolean) => {
    setNewDeptRows((prev) => {
      const next = new Set(prev);
      if (on) next.add(rowIdx);
      else next.delete(rowIdx);
      return next;
    });
  };

  // Debounced re-validation against the server whenever rows change in review.
  React.useEffect(() => {
    if (phase !== "review") return;
    if (revalidateTimer.current) clearTimeout(revalidateTimer.current);
    revalidateTimer.current = setTimeout(() => void validateOnServer(rows), 500);
    return () => {
      if (revalidateTimer.current) clearTimeout(revalidateTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, phase]);

  // Once departments are loaded, any row whose CSV department is non-blank but
  // doesn't match an existing one is switched to "Add new" mode so the typed
  // value stays visible/editable (instead of silently falling to "— none —").
  // Runs once per file (keyed on entering review + the loaded dept list).
  const snappedRef = React.useRef(false);
  React.useEffect(() => {
    if (phase !== "review") {
      snappedRef.current = false;
      return;
    }
    if (snappedRef.current || departments.length === 0) return;
    const known = new Map(departments.map((d) => [d.name.trim().toLowerCase(), d.name]));
    // Compute matches/flags from the current rows up front (don't rely on the
    // setRows updater running synchronously).
    const toFlag = new Set<number>();
    const snapped = rows.map((r, i) => {
      const d = (r.department ?? "").trim();
      if (!d) return r;
      const canon = known.get(d.toLowerCase());
      if (canon) return canon === r.department ? r : { ...r, department: canon };
      toFlag.add(i);
      return r;
    });
    setRows(snapped);
    if (toFlag.size > 0) setNewDeptRows((prev) => new Set([...prev, ...toFlag]));
    snappedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, departments]);

  // Client-side cell error (instant feedback) OR a server error for this line.
  const rowHasError = React.useCallback(
    (rowIdx: number): boolean => {
      const row = rows[rowIdx];
      if (IMPORT_COLUMNS.some((c) => cellError(c.key, row[c.key]))) return true;
      const rep = serverReports.get(rowIdx + 1);
      return !!rep && rep.errors.length > 0;
    },
    [rows, serverReports],
  );

  // Total error count = client cell errors + server-only row errors.
  const errorCount = React.useMemo(() => {
    let n = 0;
    rows.forEach((row, i) => {
      const cellErrs = IMPORT_COLUMNS.filter((c) => cellError(c.key, row[c.key])).length;
      const rep = serverReports.get(i + 1);
      const serverErrs = rep ? rep.errors.length : 0;
      n += cellErrs + serverErrs;
    });
    return n;
  }, [rows, serverReports]);

  // New departments that will be created (from the server report).
  const newDepartments = React.useMemo(() => {
    const set = new Set<string>();
    for (const rep of serverReports.values()) {
      if (rep.department?.action === "create" && rep.department.name) {
        set.add(rep.department.name.toLowerCase());
      }
    }
    return set.size;
  }, [serverReports]);

  const handleImport = async () => {
    if (rows.length === 0) return;
    setImporting(true);
    setResults(null);
    try {
      // One server call does everything: dept creation (deduped) + provisioning.
      const res = await api.employees.bulkCreate(rows);
      const out: RowResult[] = ((res.rows ?? []) as ServerRowReport[]).map((r) => ({
        line: r.line,
        name: r.name,
        email: r.email,
        status: (r.status === "ok" ? "created" : r.status) as RowResult["status"],
        message: r.message,
        tempPassword: r.tempPassword,
        employeeId: r.employeeId,
      }));
      setResults(out);
      setPhase("results");
      if (out.some((r) => r.status === "created")) onImported();
    } catch (err) {
      // The server refused (e.g. validation errors slipped through). Surface it.
      setServerError(err instanceof Error ? err.message : "Import failed. Please try again.");
    } finally {
      setImporting(false);
    }
  };

  const summary = results
    ? {
        created: results.filter((r) => r.status === "created").length,
        skipped: results.filter((r) => r.status === "skipped").length,
        errors: results.filter((r) => r.status === "error").length,
      }
    : null;

  // Newly created rows that carry one-time login credentials to hand out.
  const createdCreds = React.useMemo(
    () => (results ?? []).filter((r) => r.status === "created" && r.tempPassword),
    [results],
  );

  // Plain-text block (for the clipboard) of every new hire's credentials.
  const credsText = React.useMemo(
    () =>
      createdCreds
        .map(
          (r) =>
            `${r.name}\n  Employee ID: ${r.employeeId ?? "-"}\n  Login: ${r.email}\n  Temporary password: ${r.tempPassword}`,
        )
        .join("\n\n"),
    [createdCreds],
  );

  const copyAllCreds = async () => {
    if (!credsText) return;
    try {
      await navigator.clipboard.writeText(credsText);
      setCopiedCreds(true);
      setTimeout(() => setCopiedCreds(false), 2000);
    } catch {
      /* clipboard blocked — the admin can still use Download CSV */
    }
  };

  const downloadCreds = () => {
    const csv = toCSV(
      ["name", "employee_id", "login_email", "temporary_password"],
      createdCreds.map((r) => ({
        name: r.name,
        employee_id: r.employeeId ?? "",
        login_email: r.email,
        temporary_password: r.tempPassword ?? "",
      })),
    );
    const stamp = businessDate();
    downloadFile(`august-credentials-${stamp}.csv`, csv);
  };

  const wide = phase === "review";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={wide ? "max-w-5xl" : "max-w-2xl"}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-blue-600" />
            Import Employees from CSV
          </DialogTitle>
          <DialogDescription>
            {phase === "review"
              ? "Review and edit the data below. Fix anything flagged, fill in missing details, then import."
              : "Upload a .csv file to bulk-add employees. Each new hire gets a login account with a temporary password."}
          </DialogDescription>
        </DialogHeader>

        {/* ---------------------------------------------------------- */}
        {/*  PHASE: idle — format reference + file picker               */}
        {/* ---------------------------------------------------------- */}
        {phase === "idle" && (
          <>
            <div className="rounded-lg border border-gray-200">
              <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2">
                <p className="text-sm font-medium text-gray-900">Required format</p>
                <Button variant="outline" size="sm" onClick={downloadTemplate}>
                  <Download className="h-3.5 w-3.5" />
                  Download template
                </Button>
              </div>
              <div className="max-h-48 overflow-auto p-1">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-white">
                    <tr className="text-gray-500">
                      <th className="px-2 py-1 font-medium">Column</th>
                      <th className="px-2 py-1 font-medium">Required</th>
                      <th className="px-2 py-1 font-medium">Example</th>
                      <th className="px-2 py-1 font-medium">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {IMPORT_COLUMNS.map((c) => (
                      <tr key={c.key} className="border-t border-gray-100">
                        <td className="px-2 py-1 font-mono text-gray-800">{c.label}</td>
                        <td className="px-2 py-1">
                          {c.required || c.valueRequired ? (
                            <span className="font-medium text-red-600">Yes</span>
                          ) : (
                            <span className="text-gray-400">No</span>
                          )}
                        </td>
                        <td className="px-2 py-1 text-gray-600">{c.example}</td>
                        <td className="px-2 py-1 text-gray-500">{c.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 px-4 py-6 text-sm text-gray-600 transition-colors hover:border-blue-400 hover:bg-blue-50/40"
              >
                <FileSpreadsheet className="h-5 w-5 text-gray-400" />
                {fileName ? (
                  <span className="font-medium text-gray-800">{fileName}</span>
                ) : (
                  <span>Click to choose a .csv file</span>
                )}
              </button>

              {parseError && (
                <p className="mt-2 flex items-start gap-1.5 text-sm text-red-600">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {parseError}
                </p>
              )}
            </div>
          </>
        )}

        {/* ---------------------------------------------------------- */}
        {/*  PHASE: review — editable grid                              */}
        {/* ---------------------------------------------------------- */}
        {phase === "review" && (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="text-gray-700">
                <span className="font-medium">{rows.length}</span> row{rows.length === 1 ? "" : "s"}
              </span>
              {validating ? (
                <span className="inline-flex items-center gap-1 text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Checking against database...
                </span>
              ) : errorCount > 0 ? (
                <span className="inline-flex items-center gap-1 text-red-600">
                  <AlertTriangle className="h-4 w-4" />
                  {errorCount} issue{errorCount === 1 ? "" : "s"} to fix
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-green-700">
                  <CheckCircle2 className="h-4 w-4" /> All rows valid
                </span>
              )}
              {newDepartments > 0 && (
                <span className="inline-flex items-center gap-1 text-blue-600">
                  <CheckCircle2 className="h-4 w-4" />
                  {newDepartments} new department{newDepartments === 1 ? "" : "s"} will be created
                </span>
              )}
            </div>
            {serverError && (
              <p className="flex items-start gap-1.5 text-sm text-red-600">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {serverError}
              </p>
            )}

            <div className="max-h-[55vh] overflow-auto rounded-lg border border-gray-200">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 z-10 bg-gray-50">
                  <tr className="text-gray-600">
                    <th className="px-1 py-1.5 font-medium">#</th>
                    {IMPORT_COLUMNS.map((c) => (
                      <th key={c.key} className="whitespace-nowrap px-1.5 py-1.5 font-medium">
                        {c.label}
                        {(c.required || c.valueRequired) && <span className="text-red-500"> *</span>}
                      </th>
                    ))}
                    <th className="px-1 py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, ri) => {
                    const rep = serverReports.get(ri + 1);
                    const rowErr = rowHasError(ri);
                    return (
                    <tr
                      key={ri}
                      className={
                        "border-t border-gray-100 align-top " +
                        (rowErr ? "bg-red-50/40" : "")
                      }
                    >
                      <td className="px-1 py-1 text-gray-400">{ri + 1}</td>
                      {IMPORT_COLUMNS.map((c) => {
                        const err = cellError(c.key, row[c.key]);
                        const common =
                          "w-full rounded border bg-white px-1.5 py-1 text-xs focus:outline-none focus:ring-1 " +
                          (err
                            ? "border-red-400 focus:ring-red-400"
                            : "border-gray-200 focus:ring-blue-400");
                        // Department disposition badge from the server report.
                        const deptBadge =
                          c.key === "department" && rep?.department && (row[c.key] ?? "").trim()
                            ? rep.department.action === "matched"
                              ? <span className="mt-0.5 inline-block text-[10px] text-green-600">existing</span>
                              : rep.department.action === "create"
                                ? <span className="mt-0.5 inline-block text-[10px] text-blue-600">new</span>
                                : null
                            : null;
                        return (
                          <td key={c.key} className="px-1 py-1">
                            {c.key === "role" ? (
                              <select
                                value={(row[c.key] || "employee").toLowerCase() === "admin" ? "admin" : "employee"}
                                onChange={(e) => updateCell(ri, c.key, e.target.value)}
                                className={common}
                              >
                                <option value="employee">employee</option>
                                <option value="admin">admin</option>
                              </select>
                            ) : c.key === "tracks_attendance" ? (
                              <select
                                value={parseBool(row[c.key] || "true") ? "true" : "false"}
                                onChange={(e) => updateCell(ri, c.key, e.target.value)}
                                className={common}
                              >
                                <option value="true">tracks</option>
                                <option value="false">observer</option>
                              </select>
                            ) : c.key === "department" ? (
                              // Predefined picker: choose an existing department
                              // (no typos) or explicitly add a new one.
                              newDeptRows.has(ri) || departments.length === 0 ? (
                                <div className="min-w-[8rem] space-y-0.5">
                                  <input
                                    type="text"
                                    value={row[c.key] ?? ""}
                                    placeholder="New department name"
                                    onChange={(e) => updateCell(ri, c.key, e.target.value)}
                                    className={common}
                                  />
                                  {departments.length > 0 && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setNewDept(ri, false);
                                        updateCell(ri, c.key, "");
                                      }}
                                      className="text-[10px] text-blue-600 hover:underline"
                                    >
                                      pick existing
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <select
                                  value={
                                    departments.some(
                                      (d) => d.name.toLowerCase() === (row[c.key] ?? "").toLowerCase(),
                                    )
                                      ? departments.find(
                                          (d) => d.name.toLowerCase() === (row[c.key] ?? "").toLowerCase(),
                                        )!.name
                                      : ""
                                  }
                                  onChange={(e) => {
                                    if (e.target.value === ADD_NEW) {
                                      setNewDept(ri, true);
                                      updateCell(ri, c.key, "");
                                    } else {
                                      updateCell(ri, c.key, e.target.value);
                                    }
                                  }}
                                  className={common + " min-w-[8rem]"}
                                >
                                  <option value="">— none —</option>
                                  {departments.map((d) => (
                                    <option key={d.id} value={d.name}>
                                      {d.name}
                                    </option>
                                  ))}
                                  <option value={ADD_NEW}>+ Add new department…</option>
                                </select>
                              )
                            ) : c.key === "shift_start" || c.key === "shift_end" ? (
                              // Native time picker so the value is always a
                              // well-formed HH:MM (24h) and never dumped in a
                              // free-text format. Matches the single-add form.
                              <input
                                type="time"
                                value={row[c.key] ?? ""}
                                onChange={(e) => updateCell(ri, c.key, e.target.value)}
                                className={common + " min-w-[6rem]"}
                              />
                            ) : c.key === "date_of_joining" ? (
                              // Native date picker -> always YYYY-MM-DD.
                              <input
                                type="date"
                                value={row[c.key] ?? ""}
                                onChange={(e) => updateCell(ri, c.key, e.target.value)}
                                className={common + " min-w-[8rem]"}
                              />
                            ) : c.key === "employee_id" ? (
                              <input
                                type="text"
                                value={row[c.key] ?? ""}
                                placeholder={nextIdPreview ? `Auto: ${nextIdPreview}` : "Auto-generated"}
                                onChange={(e) => updateCell(ri, c.key, e.target.value)}
                                className={common + " min-w-[8rem] font-mono"}
                              />
                            ) : (
                              <input
                                type="text"
                                value={row[c.key] ?? ""}
                                placeholder={c.required || c.valueRequired ? "required" : ""}
                                onChange={(e) => updateCell(ri, c.key, e.target.value)}
                                className={common + " min-w-[7rem]"}
                              />
                            )}
                            {err && <p className="mt-0.5 text-[10px] text-red-500">{err}</p>}
                            {deptBadge}
                          </td>
                        );
                      })}
                      <td className="px-1 py-1">
                        <button
                          type="button"
                          onClick={() => removeRow(ri)}
                          title="Remove this row"
                          className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                        {/* Server-side row errors not tied to a single cell. */}
                        {rep && rep.errors.length > 0 && (
                          <ul className="mt-1 list-none space-y-0.5">
                            {rep.errors.map((e, k) => (
                              <li key={k} className="whitespace-nowrap text-[10px] text-red-500">
                                {e}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={IMPORT_COLUMNS.length + 2} className="px-2 py-6 text-center text-gray-500">
                        No rows left. Go back to choose another file.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {importing && (
              <p className="flex items-center gap-2 text-sm text-gray-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating {rows.length} employee{rows.length === 1 ? "" : "s"}...
              </p>
            )}
          </>
        )}

        {/* ---------------------------------------------------------- */}
        {/*  PHASE: results                                             */}
        {/* ---------------------------------------------------------- */}
        {phase === "results" && summary && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-3 text-sm">
              <span className="inline-flex items-center gap-1 text-green-700">
                <CheckCircle2 className="h-4 w-4" /> {summary.created} created
              </span>
              {summary.skipped > 0 && (
                <span className="inline-flex items-center gap-1 text-amber-700">
                  <AlertTriangle className="h-4 w-4" /> {summary.skipped} skipped (duplicate)
                </span>
              )}
              {summary.errors > 0 && (
                <span className="inline-flex items-center gap-1 text-red-700">
                  <XCircle className="h-4 w-4" /> {summary.errors} failed
                </span>
              )}
            </div>

            {/* One-time login credentials for the newly created employees.
                Shown ONCE here (the password is never retrievable later), so
                the admin must copy or download them before closing. */}
            {createdCreds.length > 0 && (
              <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-1.5">
                    <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <p className="text-[12px] text-amber-800">
                      Save these now — temporary passwords are shown only once.
                      Each employee must change theirs on first login.
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={copyAllCreds}>
                      {copiedCreds ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-green-600" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" /> Copy all
                        </>
                      )}
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={downloadCreds}>
                      <Download className="h-3.5 w-3.5" /> Download CSV
                    </Button>
                  </div>
                </div>
                <div className="max-h-52 overflow-auto rounded-md border border-amber-200 bg-white">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-gray-50 text-gray-500">
                      <tr>
                        <th className="px-2 py-1 font-medium">Name</th>
                        <th className="px-2 py-1 font-medium">Employee ID</th>
                        <th className="px-2 py-1 font-medium">Login email</th>
                        <th className="px-2 py-1 font-medium">Temp password</th>
                      </tr>
                    </thead>
                    <tbody>
                      {createdCreds.map((r) => (
                        <tr key={r.line} className="border-t border-gray-100">
                          <td className="px-2 py-1 text-gray-700">{r.name}</td>
                          <td className="px-2 py-1 font-mono text-gray-600">{r.employeeId ?? "-"}</td>
                          <td className="px-2 py-1 text-gray-700">{r.email}</td>
                          <td className="px-2 py-1 font-mono font-medium text-gray-900">{r.tempPassword}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {(summary.errors > 0 || summary.skipped > 0) && (
              <div className="max-h-40 overflow-auto rounded-lg border border-gray-200">
                <table className="w-full text-left text-xs">
                  <tbody>
                    {results!
                      .filter((r) => r.status !== "created")
                      .map((r) => (
                        <tr key={r.line} className="border-t border-gray-100">
                          <td className="px-2 py-1 text-gray-500">Row {r.line}</td>
                          <td className="px-2 py-1 text-gray-700">{r.email || r.name}</td>
                          <td className="px-2 py-1 text-gray-600">{r.message}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {phase === "review" && (
            <Button
              variant="outline"
              onClick={() => {
                setPhase("idle");
                setRows([]);
                setFileName(null);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
              disabled={importing}
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          )}
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={importing}>
            {phase === "results" ? "Close" : "Cancel"}
          </Button>
          {phase === "review" && (
            <Button
              onClick={handleImport}
              disabled={rows.length === 0 || errorCount > 0 || importing || validating}
            >
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {importing ? "Importing..." : validating ? "Checking..." : `Import ${rows.length}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
