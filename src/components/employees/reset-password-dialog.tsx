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
import { Button } from "@/components/ui/button";
import { KeyRound, Copy, Check, ShieldAlert, RefreshCw } from "lucide-react";
import api from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";

export interface ResetPasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeName: string;
  employeeId: string;
}

/**
 * Admin-only "set a temporary password" dialog. Because this deployment has no
 * email service, admins set/generate a password here and share it with the user
 * directly. The user is forced to choose their own password on next login.
 */
export function ResetPasswordDialog({
  open,
  onOpenChange,
  employeeName,
  employeeId,
}: ResetPasswordDialogProps) {
  const { toast } = useToast();
  const [mode, setMode] = React.useState<"auto" | "custom">("auto");
  const [customPassword, setCustomPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<{ tempPassword: string; email: string } | null>(null);
  const [copied, setCopied] = React.useState(false);

  // Reset internal state whenever the dialog is opened/closed.
  React.useEffect(() => {
    if (!open) {
      setMode("auto");
      setCustomPassword("");
      setResult(null);
      setCopied(false);
      setLoading(false);
    }
  }, [open]);

  const handleGenerate = async () => {
    if (mode === "custom" && customPassword.trim().length < 8) {
      toast({
        variant: "error",
        title: "Password too short",
        description: "Password must be at least 8 characters.",
      });
      return;
    }
    setLoading(true);
    try {
      const data = await api.employees.resetPassword(
        employeeId,
        mode === "custom" ? customPassword.trim() : undefined,
      );
      setResult({ tempPassword: data.tempPassword, email: data.email });
      toast({
        variant: "success",
        title: "Password set",
        description: `A temporary password was set for ${employeeName}.`,
      });
    } catch (err) {
      toast({
        variant: "error",
        title: "Failed to set password",
        description: err instanceof Error ? err.message : "Please try again.",
      });
    }
    setLoading(false);
  };

  const handleCopy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.tempPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ variant: "error", title: "Copy failed", description: "Copy the password manually." });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            Reset Password
          </DialogTitle>
          <DialogDescription>
            Set a temporary password for <strong>{employeeName}</strong> and share it with them
            directly. They will be required to choose their own password on next login.
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button
                type="button"
                variant={mode === "auto" ? "default" : "outline"}
                size="sm"
                onClick={() => setMode("auto")}
              >
                Auto-generate
              </Button>
              <Button
                type="button"
                variant={mode === "custom" ? "default" : "outline"}
                size="sm"
                onClick={() => setMode("custom")}
              >
                Set my own
              </Button>
            </div>

            {mode === "custom" ? (
              <Input
                label="New temporary password"
                type="text"
                placeholder="At least 8 characters"
                value={customPassword}
                onChange={(e) => setCustomPassword(e.target.value)}
                autoComplete="off"
              />
            ) : (
              <p className="text-sm text-gray-500">
                A strong temporary password will be generated and shown to you once.
              </p>
            )}

            <div className="flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
              <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>
                This signs the employee out of all devices and forces them to set a new password
                when they next log in.
              </span>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Share this temporary password with <strong>{employeeName}</strong> ({result.email}).
              For security it is shown only once.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 select-all rounded-md border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-base tracking-wide">
                {result.tempPassword}
              </code>
              <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
                {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <div className="flex items-start gap-2 rounded-md bg-blue-50 p-3 text-sm text-blue-800">
              <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>
                The employee must use this password to log in, then they will be prompted to choose
                their own password.
              </span>
            </div>
          </div>
        )}

        <DialogFooter>
          {!result ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
                Cancel
              </Button>
              <Button onClick={handleGenerate} disabled={loading}>
                {loading ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <KeyRound className="h-4 w-4" />
                )}
                {loading ? "Setting..." : "Set Password"}
              </Button>
            </>
          ) : (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
