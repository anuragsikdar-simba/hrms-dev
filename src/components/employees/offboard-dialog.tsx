"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface OffboardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeName: string;
  employeeId: string;
  onConfirm: (data: {
    lastWorkingDay: string;
    reason: string;
    notes?: string;
  }) => Promise<void> | void;
}

/* ------------------------------------------------------------------ */
/*  Options                                                            */
/* ------------------------------------------------------------------ */

const REASON_OPTIONS = [
  { label: "Resignation", value: "resignation" },
  { label: "Termination", value: "termination" },
  { label: "Other", value: "other" },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function OffboardDialog({
  open,
  onOpenChange,
  employeeName,
  employeeId,
  onConfirm,
}: OffboardDialogProps) {
  const [lastWorkingDay, setLastWorkingDay] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [confirmName, setConfirmName] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const nameMatches = confirmName.trim() === employeeName.trim();
  const canSubmit =
    lastWorkingDay !== "" && reason !== "" && nameMatches && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onConfirm({ lastWorkingDay, reason, notes: notes || undefined });
      // Reset form state only on success
      setLastWorkingDay("");
      setReason("");
      setNotes("");
      setConfirmName("");
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenChange = (value: boolean) => {
    if (!value) {
      // Reset on close
      setLastWorkingDay("");
      setReason("");
      setNotes("");
      setConfirmName("");
      setSubmitting(false);
    }
    onOpenChange(value);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            Offboard Employee
          </DialogTitle>
          <DialogDescription>
            You are about to offboard{" "}
            <span className="font-semibold text-gray-900">{employeeName}</span>{" "}
            ({employeeId}). This action will:
          </DialogDescription>
        </DialogHeader>

        {/* Warning list */}
        <ul className="mt-2 space-y-1 text-sm text-gray-600">
          <li className="flex items-start gap-2">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
            Revoke all system access and active sessions
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
            Cancel pending leave requests
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
            Mark the employee status as terminated
          </li>
        </ul>

        {/* Form fields */}
        <div className="mt-4 space-y-4">
          <Input
            label="Last Working Day"
            type="date"
            value={lastWorkingDay}
            onChange={(e) => setLastWorkingDay(e.target.value)}
          />

          <Select
            label="Reason"
            placeholder="Select reason"
            options={REASON_OPTIONS}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />

          <Textarea
            label="Internal Notes (optional)"
            placeholder="Add any internal notes about this offboarding..."
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="mb-2 text-sm font-medium text-amber-800">
              Type{" "}
              <span className="font-bold">&quot;{employeeName}&quot;</span> to
              confirm
            </p>
            <Input
              placeholder={employeeName}
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              error={
                confirmName.length > 0 && !nameMatches
                  ? "Name does not match"
                  : undefined
              }
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!canSubmit}
            loading={submitting}
            onClick={handleSubmit}
          >
            {submitting ? "Offboarding..." : "Confirm Offboarding"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
