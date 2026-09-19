"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  ArrowLeft,
  Mail,
  Bell,
  Save,
  Plus,
  Pencil,
  Trash2,
  Shield,
  ToggleLeft,
  ToggleRight,
  Loader2,
  Send,
} from "lucide-react";

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

interface NotificationRule {
  id: string;
  event: string;
  description: string;
  email_enabled: boolean;
  recipients: string;
}

// ---------------------------------------------------------------------------
//  Component
// ---------------------------------------------------------------------------

export default function EmailNotificationsPage() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();

  // State
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [smtp, setSmtp] = useState<Record<string, string>>({
    smtp_host: "", smtp_port: "587", smtp_username: "", smtp_password: "",
    from_name: "", from_email: "", encryption: "TLS",
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"add" | "edit">("add");
  const [editingRule, setEditingRule] = useState<NotificationRule | null>(null);
  const [formEvent, setFormEvent] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formRecipients, setFormRecipients] = useState("");
  const [formEnabled, setFormEnabled] = useState(true);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingRule, setDeletingRule] = useState<NotificationRule | null>(null);

  // Track dirty SMTP fields
  const [smtpDirty, setSmtpDirty] = useState(false);

  // Fetch
  const fetchData = useCallback(async () => {
    try {
      const { rules: rulesData, smtp: smtpData } = await api.emailSettings.get();
      setRules(rulesData ?? []);
      if (smtpData) {
        setSmtp((prev) => ({ ...prev, ...smtpData }));
      }
    } catch (err) {
      toast({ variant: "error", title: "Failed to load email settings", description: String(err) });
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Admin guard
  if (!isAdmin) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <Shield className="mx-auto mb-4 h-12 w-12 text-gray-300" />
          <h2 className="text-lg font-semibold text-gray-900">Access Restricted</h2>
          <p className="mt-1 text-sm text-gray-500">Only administrators can manage email settings.</p>
        </div>
      </div>
    );
  }

  // Handlers -- Rules
  const openAdd = () => {
    setDialogMode("add");
    setEditingRule(null);
    setFormEvent("");
    setFormDesc("");
    setFormRecipients("");
    setFormEnabled(true);
    setDialogOpen(true);
  };

  const openEdit = (rule: NotificationRule) => {
    setDialogMode("edit");
    setEditingRule(rule);
    setFormEvent(rule.event);
    setFormDesc(rule.description);
    setFormRecipients(rule.recipients);
    setFormEnabled(rule.email_enabled);
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!formEvent.trim() || busy) return;
    setBusy(true);
    try {
      if (dialogMode === "add") {
        await api.emailSettings.createRule({
          event: formEvent.trim(),
          description: formDesc.trim(),
          email_enabled: formEnabled,
          recipients: formRecipients.trim(),
        });
        toast({ variant: "success", title: "Rule added", description: `"${formEvent.trim()}" notification created.` });
      } else if (editingRule) {
        await api.emailSettings.updateRule({
          id: editingRule.id,
          event: formEvent.trim(),
          description: formDesc.trim(),
          email_enabled: formEnabled,
          recipients: formRecipients.trim(),
        });
        toast({ variant: "success", title: "Rule updated", description: `"${formEvent.trim()}" saved.` });
      }
      setDialogOpen(false);
      await fetchData();
    } catch (err) {
      toast({ variant: "error", title: "Failed to save rule", description: String(err) });
    }
    setBusy(false);
  };

  const openDelete = (rule: NotificationRule) => {
    setDeletingRule(rule);
    setDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingRule || busy) return;
    setBusy(true);
    try {
      await api.emailSettings.deleteRule(deletingRule.id);
      toast({ variant: "success", title: "Rule deleted", description: `"${deletingRule.event}" removed.` });
      setDeletingRule(null);
      setDeleteDialogOpen(false);
      await fetchData();
    } catch (err) {
      toast({ variant: "error", title: "Failed to delete rule", description: String(err) });
    }
    setBusy(false);
  };

  const handleToggle = async (rule: NotificationRule) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.emailSettings.toggleRule(rule.id, !rule.email_enabled);
      await fetchData();
    } catch (err) {
      toast({ variant: "error", title: "Failed to toggle rule", description: String(err) });
    }
    setBusy(false);
  };

  // Handlers -- SMTP
  const handleSmtpChange = (key: string, value: string) => {
    setSmtp((prev) => ({ ...prev, [key]: value }));
    setSmtpDirty(true);
  };

  const handleSaveSmtp = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.emailSettings.saveSmtp(smtp);
      toast({ variant: "success", title: "SMTP settings saved", description: "Email configuration updated." });
      setSmtpDirty(false);
    } catch (err) {
      toast({ variant: "error", title: "Failed to save SMTP settings", description: String(err) });
    }
    setBusy(false);
  };

  const handleTestEmail = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { message } = await api.emailSettings.testEmail(smtp.from_email);
      toast({ variant: "success", title: "Test email", description: message });
    } catch (err) {
      toast({ variant: "error", title: "Test email failed", description: String(err) });
    }
    setBusy(false);
  };

  // ---------------------------------------------------------------------------
  //  Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between mb-[18px] gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Link href="/settings">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight m-0 mb-1">
              Email Notifications
            </h1>
            <p className="text-xs text-gray-500">
              Configure which events trigger email notifications and manage SMTP settings.
            </p>
          </div>
        </div>
      </div>

      {/* ---- SMTP Configuration ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-blue-600" />
            SMTP Configuration
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="SMTP Host" placeholder="smtp.example.com" value={smtp.smtp_host} onChange={(e) => handleSmtpChange("smtp_host", e.target.value)} />
              <Input label="SMTP Port" placeholder="587" value={smtp.smtp_port} onChange={(e) => handleSmtpChange("smtp_port", e.target.value)} />
              <Input label="Username" placeholder="noreply@example.com" value={smtp.smtp_username} onChange={(e) => handleSmtpChange("smtp_username", e.target.value)} />
              <Input label="Password" type="password" placeholder="********" value={smtp.smtp_password} onChange={(e) => handleSmtpChange("smtp_password", e.target.value)} />
              <Input label="From Name" placeholder="August HRMS" value={smtp.from_name} onChange={(e) => handleSmtpChange("from_name", e.target.value)} />
              <Input label="From Email" placeholder="noreply@example.com" value={smtp.from_email} onChange={(e) => handleSmtpChange("from_email", e.target.value)} />
            </div>
          )}
          <div className="mt-4 flex items-center gap-3">
            <Button onClick={handleSaveSmtp} disabled={busy || !smtpDirty}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Save className="mr-2 h-4 w-4" />
              Save SMTP Settings
            </Button>
            <Button variant="outline" onClick={handleTestEmail} disabled={busy || !smtp.smtp_host || !smtp.from_email}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Send className="mr-2 h-4 w-4" />
              Send Test Email
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ---- Notification Rules ---- */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-indigo-600" />
              Notification Rules
            </CardTitle>
            <Button size="sm" disabled={busy} onClick={openAdd}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add Rule
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead className="hidden sm:table-cell">Description</TableHead>
                  <TableHead>Recipients</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }, (_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-44" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="ml-auto h-8 w-16 rounded" /></TableCell>
                    </TableRow>
                  ))
                ) : rules.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-12 text-center">
                      <Bell className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                      <p className="text-sm text-gray-500">No notification rules configured.</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  rules.map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell>
                        <span className="text-xs font-medium text-gray-900">{rule.event}</span>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-xs text-gray-500 max-w-[200px] truncate">
                        {rule.description}
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-gray-600">{rule.recipients}</span>
                      </TableCell>
                      <TableCell>
                        <button
                          onClick={() => handleToggle(rule)}
                          disabled={busy}
                          className="flex items-center gap-1.5 text-xs"
                        >
                          {rule.email_enabled ? (
                            <ToggleRight className="h-5 w-5 text-green-600" />
                          ) : (
                            <ToggleLeft className="h-5 w-5 text-gray-400" />
                          )}
                          <span className={rule.email_enabled ? "text-green-700" : "text-gray-500"}>
                            {rule.email_enabled ? "On" : "Off"}
                          </span>
                        </button>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" disabled={busy} onClick={() => openEdit(rule)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={busy}
                            className="text-red-600 hover:bg-red-50 hover:text-red-700"
                            onClick={() => openDelete(rule)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ---- Add/Edit Rule Dialog ---- */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogMode === "add" ? "Add Notification Rule" : "Edit Notification Rule"}</DialogTitle>
            <DialogDescription>
              {dialogMode === "add"
                ? "Create a new email notification trigger."
                : "Update the notification rule settings."}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <Input label="Event Name" placeholder="e.g. Leave Applied" value={formEvent} onChange={(e) => setFormEvent(e.target.value)} />
            <Input label="Description" placeholder="When an employee submits a leave request" value={formDesc} onChange={(e) => setFormDesc(e.target.value)} />
            <Input label="Recipients" placeholder="e.g. employee, manager, hr" value={formRecipients} onChange={(e) => setFormRecipients(e.target.value)} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={formEnabled} onChange={(e) => setFormEnabled(e.target.checked)} className="rounded" />
              Email enabled
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={!formEvent.trim() || busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {dialogMode === "add" ? "Add Rule" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Delete Rule Dialog ---- */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Notification Rule</DialogTitle>
            <DialogDescription>
              Delete <span className="font-semibold text-gray-900">{deletingRule?.event}</span>? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeletingRule(null); setDeleteDialogOpen(false); }}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
