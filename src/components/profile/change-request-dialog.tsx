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
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface ChangeRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fieldName: string;
  currentValue: string;
  onSubmit: (newValue: string, reason: string) => Promise<void>;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ChangeRequestDialog({
  open,
  onOpenChange,
  fieldName,
  currentValue,
  onSubmit,
}: ChangeRequestDialogProps) {
  const [newValue, setNewValue] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  // Reset form state whenever the dialog opens
  React.useEffect(() => {
    if (open) {
      setNewValue("");
      setReason("");
      setLoading(false);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newValue.trim()) return;

    setLoading(true);
    try {
      await onSubmit(newValue.trim(), reason.trim());
      onOpenChange(false);
    } catch {
      // Error handling is done by the parent via toast
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Request Change - {fieldName}</DialogTitle>
          <DialogDescription>
            Submit a change request for review. Your request will be reviewed by
            HR before the update is applied.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* Current value (read-only) */}
          <Input
            label="Current Value"
            value={currentValue}
            readOnly
            disabled
            className="bg-gray-50"
          />

          {/* New value */}
          <Input
            label="New Value"
            placeholder="Enter new value"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            required
            autoFocus
          />

          {/* Reason (optional) */}
          <Textarea
            label="Reason (optional)"
            placeholder="Why is this change needed?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
          />

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" loading={loading} disabled={!newValue.trim()}>
              Submit Request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
