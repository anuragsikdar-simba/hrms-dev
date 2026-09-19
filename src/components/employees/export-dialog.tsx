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
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
import api from "@/lib/api-client";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/* ------------------------------------------------------------------ */
/*  Column definitions                                                 */
/* ------------------------------------------------------------------ */

interface ColumnDef {
  key: string;
  label: string;
}

const EXPORT_COLUMNS: ColumnDef[] = [
  { key: "name", label: "Name" },
  { key: "employee_id", label: "Employee ID" },
  { key: "email", label: "Email" },
  { key: "department", label: "Department" },
  { key: "designation", label: "Designation" },
  { key: "status", label: "Status" },
  { key: "date_of_joining", label: "Date of Joining" },
  { key: "phone", label: "Phone" },
  { key: "role", label: "Role" },
  { key: "shift_start", label: "Shift Start" },
  { key: "shift_end", label: "Shift End" },
];

/* ------------------------------------------------------------------ */
/*  CSV helper                                                         */
/* ------------------------------------------------------------------ */

function escapeCSVField(field: string): string {
  if (field.includes(",") || field.includes('"') || field.includes("\n")) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

function generateCSV(columns: ColumnDef[], data: Record<string, string>[]): string {
  const header = columns.map((c) => escapeCSVField(c.label)).join(",");
  const rows = data.map((row) =>
    columns.map((c) => escapeCSVField(row[c.key] ?? "")).join(","),
  );
  return [header, ...rows].join("\n");
}

function downloadCSV(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ExportDialog({ open, onOpenChange }: ExportDialogProps) {
  const [selectedKeys, setSelectedKeys] = React.useState<Set<string>>(
    () => new Set(EXPORT_COLUMNS.map((c) => c.key)),
  );
  const [exporting, setExporting] = React.useState(false);

  const allSelected = selectedKeys.size === EXPORT_COLUMNS.length;
  const noneSelected = selectedKeys.size === 0;

  const toggleColumn = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedKeys(new Set(EXPORT_COLUMNS.map((c) => c.key)));
  };

  const deselectAll = () => {
    setSelectedKeys(new Set());
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const selectedColumns = EXPORT_COLUMNS.filter((c) =>
        selectedKeys.has(c.key),
      );

      const { employees: data } = await api.employees.list();

      if (!data) {
        console.error("Failed to fetch employees for export");
        return;
      }

      const rows: Record<string, string>[] = (data ?? []).map((row) => {
        const record = row as unknown as Record<string, unknown>;
        const mapped: Record<string, string> = {};
        for (const col of selectedColumns) {
          if (col.key === "department") {
            // Department is a joined relation: { id, name }.
            const dept = record.department as { name?: string } | null;
            mapped[col.key] = dept?.name ?? "";
          } else {
            mapped[col.key] = record[col.key] != null ? String(record[col.key]) : "";
          }
        }
        return mapped;
      });

      const csv = generateCSV(selectedColumns, rows);
      const timestamp = businessDate();
      downloadCSV(csv, `employees-export-${timestamp}.csv`);
      onOpenChange(false);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-green-600" />
            Export Employees
          </DialogTitle>
          <DialogDescription>
            Select the columns to include in your CSV export.
          </DialogDescription>
        </DialogHeader>

        {/* Select All / Deselect All */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={selectAll}
            disabled={allSelected}
          >
            Select All
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={deselectAll}
            disabled={noneSelected}
          >
            Deselect All
          </Button>
          <span className="ml-auto text-xs text-gray-500">
            {selectedKeys.size} of {EXPORT_COLUMNS.length} selected
          </span>
        </div>

        {/* Column checkboxes */}
        <div className="mt-2 grid grid-cols-2 gap-2">
          {EXPORT_COLUMNS.map((col) => (
            <label
              key={col.key}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm transition-colors hover:bg-gray-50 has-[:checked]:border-blue-300 has-[:checked]:bg-blue-50"
            >
              <input
                type="checkbox"
                checked={selectedKeys.has(col.key)}
                onChange={() => toggleColumn(col.key)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              {col.label}
            </label>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={noneSelected || exporting}>
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {exporting ? "Exporting..." : "Export CSV"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
