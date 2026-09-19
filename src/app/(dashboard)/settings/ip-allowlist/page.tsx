"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/lib/api-client";
import { useIpCheck, ipMatches } from "@/hooks/useIpCheck";
import { useToast } from "@/components/ui/toast";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
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
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import {
  Plus,
  Trash2,
  ArrowLeft,
  Shield,
  ShieldCheck,
  ShieldX,
  Globe,
  Clock,
  Check,
  X,
  ShieldAlert,
  Eye,
  EyeOff,
} from "lucide-react";
import Link from "next/link";

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

interface AllowedIP {
  id: string;
  ip: string;
  label: string;
  addedDate: string;
  addedBy: string;
}

interface BlockedIP {
  id: string;
  ip: string;
  reason: string;
  blockedDate: string;
}

interface PendingIPRequest {
  id: string;
  employeeName: string;
  employeeId: string;
  ip: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatTimestamp(ts: string) {
  const d = new Date(ts);
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const ADD_TYPE_OPTIONS = [
  { label: "Allow", value: "allow" },
  { label: "Block", value: "block" },
];

// ---------------------------------------------------------------------------
//  Component
// ---------------------------------------------------------------------------

export default function IPAllowlistPage() {
  const { isAdmin } = useAuth();
  const ipCheck = useIpCheck();
  const { toast } = useToast();

  // State
  const [allowed, setAllowed] = useState<AllowedIP[]>([]);
  const [blocked, setBlocked] = useState<BlockedIP[]>([]);
  const [pending, setPending] = useState<PendingIPRequest[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Fetch allowlist, blocklist, and pending IP requests via API
  const fetchLists = useCallback(async () => {
    setDataLoading(true);
    try {
      const [ipData, pendingData] = await Promise.all([
        api.ipAllowlist.list(),
        api.approvalRequests.list({ type: 'ip_violation', status: 'pending' }),
      ]);

      setAllowed(
        ipData.allowlist.map((row: any) => ({
          id: row.id,
          ip: row.ip,
          label: row.label ?? "",
          addedDate: row.created_at,
          addedBy: row.added_by_employee?.name ?? row.employees?.name ?? (row.added_by ? "Admin" : "System"),
        })),
      );
      setBlocked(
        ipData.blocklist.map((row: any) => ({
          id: row.id,
          ip: row.ip,
          reason: row.reason ?? "",
          blockedDate: row.created_at,
        })),
      );

      setPending(
        (pendingData.requests ?? []).map((r: any) => ({
          id: r.id,
          employeeName: r.employees?.name ?? 'Unknown',
          employeeId: r.employees?.employee_id ?? r.employee_id,
          ip: r.detected_ip ?? 'unknown',
          timestamp: r.created_at,
        })),
      );
      setBypassed(Boolean(ipData.bypassed));
    } catch (err) {
      toast({ variant: 'error', title: 'Failed to load IP data', description: String(err) });
    }
    setDataLoading(false);
  }, [toast]);

  useEffect(() => {
    fetchLists();
  }, [fetchLists]);

  // Add IP dialog
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [formIP, setFormIP] = useState("");
  const [formLabel, setFormLabel] = useState("");
  const [formType, setFormType] = useState("allow");

  // Remove confirmation dialog
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{
    id: string;
    ip: string;
    type: "allow" | "block";
  } | null>(null);

  // Pending IP visibility (admin can reveal/hide individual IPs)
  const [revealedIPs, setRevealedIPs] = useState<Set<string>>(new Set());

  // IP restriction bypass toggle. The bypass is a SERVER-SIDE, admin-only
  // setting (persisted in the DB and enforced by /api/attendance). It is read
  // in fetchLists() above and changed via the admin-only PATCH endpoint.
  const [bypassed, setBypassed] = useState(false);
  const toggleBypass = async () => {
    const next = !bypassed;
    setBypassed(next); // optimistic
    try {
      await api.ipAllowlist.setBypass(next);
      toast({
        variant: next ? 'warning' : 'success',
        title: next ? 'IP restriction bypass enabled' : 'IP restriction bypass disabled',
        description: next
          ? 'Punches from any IP will be allowed and not flagged.'
          : 'Punches from unrecognized IPs will be flagged for review.',
      });
    } catch (err) {
      setBypassed(!next); // revert on failure
      toast({ variant: 'error', title: 'Failed to update bypass', description: String(err) });
    }
  };

  // Admin guard
  if (!isAdmin) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <Shield className="mx-auto mb-4 h-12 w-12 text-gray-300" />
          <h2 className="text-lg font-semibold text-gray-900">
            Access Restricted
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Only administrators can manage the IP allowlist.
          </p>
        </div>
      </div>
    );
  }

  // Handlers -- Add IP
  const resetAddForm = () => {
    setFormIP("");
    setFormLabel("");
    setFormType("allow");
  };

  const handleAdd = async () => {
    if (!formIP.trim() || busy) return;
    setBusy(true);
    try {
      if (formType === "allow") {
        await api.ipAllowlist.add({ ip: formIP.trim(), label: formLabel.trim() || "Unlabeled" });
        toast({ variant: 'success', title: 'IP added to allowlist', description: formIP.trim() });
        await fetchLists();
        ipCheck.recheck();
      } else {
        await api.ipAllowlist.block({ id: '', ip: formIP.trim(), reason: formLabel.trim() || "Manually blocked", label: formLabel.trim() || "Manually blocked" });
        toast({ variant: 'success', title: 'IP added to blocklist', description: formIP.trim() });
        await fetchLists();
      }
    } catch (err) {
      toast({ variant: 'error', title: 'Failed to add IP', description: String(err) });
    }
    setBusy(false);
    resetAddForm();
    setAddDialogOpen(false);
  };

  // Handlers -- Remove
  const handleRemoveOpen = (
    id: string,
    ip: string,
    type: "allow" | "block",
  ) => {
    setRemoveTarget({ id, ip, type });
    setRemoveDialogOpen(true);
  };

  const handleRemoveConfirm = async () => {
    if (!removeTarget || busy) return;
    setBusy(true);
    try {
      if (removeTarget.type === "allow") {
        // Simply remove from allowlist (don't move to blocklist)
        await api.ipAllowlist.remove({ id: removeTarget.id });
        toast({ variant: 'success', title: 'IP removed from allowlist', description: removeTarget.ip });
        await fetchLists();
        ipCheck.recheck();
      } else {
        // Remove from blocklist
        await api.ipAllowlist.unblock({ id: removeTarget.id });
        toast({ variant: 'success', title: 'IP removed from blocklist', description: removeTarget.ip });
        await fetchLists();
      }
    } catch (err) {
      toast({ variant: 'error', title: 'Failed to remove IP', description: String(err) });
    }
    setBusy(false);
    setRemoveTarget(null);
    setRemoveDialogOpen(false);
  };

  // Handlers -- Block an allowed IP
  const handleBlockAllowed = async (entry: AllowedIP) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.ipAllowlist.block({
        id: entry.id,
        ip: entry.ip,
        reason: `Moved from allowlist (was: ${entry.label})`,
        label: entry.label,
      });
      toast({ variant: 'success', title: 'IP blocked', description: entry.ip });
      await fetchLists();
      ipCheck.recheck();
    } catch (err) {
      toast({ variant: 'error', title: 'Failed to block IP', description: String(err) });
    }
    setBusy(false);
  };

  // Handlers -- Unblock a blocked IP
  const handleUnblock = async (entry: BlockedIP) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.ipAllowlist.unblock({ id: entry.id });
      toast({ variant: 'success', title: 'IP unblocked', description: entry.ip });
      await fetchLists();
      ipCheck.recheck();
    } catch (err) {
      toast({ variant: 'error', title: 'Failed to unblock IP', description: String(err) });
    }
    setBusy(false);
  };

  // Handlers -- Pending requests
  const handleApproveToday = async (request: PendingIPRequest) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.approvalRequests.update({ id: request.id, status: "approved" });
      toast({ variant: 'success', title: 'Approved for today', description: `${request.employeeName} (${request.ip})` });
      setPending((prev) => prev.filter((p) => p.id !== request.id));
    } catch (err) {
      toast({ variant: 'error', title: 'Failed to approve', description: String(err) });
    }
    setBusy(false);
  };

  const handleApproveAndAdd = async (request: PendingIPRequest) => {
    if (busy) return;
    setBusy(true);
    try {
      // Approve the request first
      await api.approvalRequests.update({ id: request.id, status: "approved" });
      // Then add IP to allowlist; if this fails, revert the approval
      try {
        await api.ipAllowlist.add({
          ip: request.ip,
          label: `${request.employeeName}'s network`,
        });
      } catch (addErr) {
        // Revert: set approval back to pending since IP add failed
        await api.approvalRequests.update({ id: request.id, status: "pending" }).catch((revertErr) => {
          console.error('Failed to revert approval to pending after IP add failure:', revertErr);
          toast({ variant: 'error', title: 'Revert failed', description: 'Approval was marked approved but IP was not added. Please fix manually.' });
        });
        throw addErr;
      }
      toast({ variant: 'success', title: 'Approved & added to allowlist', description: `${request.employeeName} (${request.ip})` });
      setPending((prev) => prev.filter((p) => p.id !== request.id));
      await fetchLists();
      ipCheck.recheck();
    } catch (err) {
      toast({ variant: 'error', title: 'Failed to approve & add IP', description: String(err) });
    }
    setBusy(false);
  };

  const handleRejectRequest = async (request: PendingIPRequest) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.approvalRequests.update({ id: request.id, status: "rejected" });
      toast({ variant: 'success', title: 'Request rejected', description: request.employeeName });
      setPending((prev) => prev.filter((p) => p.id !== request.id));
    } catch (err) {
      toast({ variant: 'error', title: 'Failed to reject', description: String(err) });
    }
    setBusy(false);
  };

  // Handlers -- Quick-add current IP
  const handleQuickAddCurrentIp = async (ip: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.ipAllowlist.add({ ip, label: "My Network" });
      toast({ variant: 'success', title: 'Current IP added to allowlist', description: ip });
      await fetchLists();
      ipCheck.recheck();
    } catch (err) {
      toast({ variant: 'error', title: 'Failed to add IP', description: String(err) });
    }
    setBusy(false);
  };

  // Handlers -- Reveal / hide pending IPs
  const toggleRevealIP = (requestId: string) => {
    setRevealedIPs((prev) => {
      const next = new Set(prev);
      if (next.has(requestId)) {
        next.delete(requestId);
      } else {
        next.add(requestId);
      }
      return next;
    });
  };

  const maskIP = (ip: string) => {
    const parts = ip.split(".");
    if (parts.length === 4) {
      return `${parts[0]}.***.***.${parts[3]}`;
    }
    return "***.***.***";
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link href="/settings">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight m-0 mb-1">
              IP Allowlist Management
            </h1>
            <p className="text-xs text-gray-500">
              {allowed.length} allowed &middot; {blocked.length} blocked
              &middot; {pending.length} pending
            </p>
          </div>
        </div>

        <Button
          onClick={() => {
            resetAddForm();
            setAddDialogOpen(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add IP
        </Button>
      </div>

      {/* IP Restriction Bypass Toggle */}
      <Card className={bypassed ? "border-amber-300 bg-amber-50/50" : ""}>
        <CardContent className="flex items-center justify-between py-3 px-4">
          <div className="flex items-center gap-3">
            <ShieldAlert className={`h-5 w-5 ${bypassed ? "text-amber-600" : "text-gray-400"}`} />
            <div>
              <p className="text-[13px] font-semibold text-gray-900">
                IP Restriction Enforcement
              </p>
              <p className="text-[11px] text-gray-500">
                {bypassed
                  ? "Bypassed - all employees can punch in from any network"
                  : "Active - employees can only punch in from allowed IPs"}
              </p>
            </div>
          </div>
          <button
            onClick={toggleBypass}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              bypassed ? "bg-amber-500" : "bg-gray-900"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                bypassed ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </CardContent>
      </Card>

      {/* Your Current IP - quick add */}
      {ipCheck.detectedIp && ipCheck.detectedIp !== 'unknown' && (() => {
        // Check against page's own allowed list
        const ip = ipCheck.detectedIp!;
        let matchedLabel: string | null = null;
        const isInList = allowed.some((entry) => {
          if (ipMatches(ip, entry.ip)) {
            matchedLabel = entry.label;
            return true;
          }
          return false;
        });

        return (
          <Card className={isInList ? "border-green-200 bg-green-50/30" : "border-red-200 bg-red-50/30"}>
            <CardContent className="flex items-center justify-between py-3 px-4">
              <div className="flex items-center gap-3">
                <Globe className={`h-5 w-5 ${isInList ? "text-green-600" : "text-red-500"}`} />
                <div>
                  <p className="text-[13px] font-semibold text-gray-900">
                    Your current IP
                  </p>
                  <p className="text-[12px] font-mono text-gray-600">
                    {ip}
                    {isInList ? (
                      <span className="ml-2 text-[11px] font-sans text-green-600 font-medium">
                        &#10003; {matchedLabel}
                      </span>
                    ) : (
                      <span className="ml-2 text-[11px] font-sans text-red-500 font-medium">
                        Not in allowlist
                      </span>
                    )}
                  </p>
                </div>
              </div>
              {isInList ? (
                <Badge variant="green" dot>Allowed</Badge>
              ) : (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => handleQuickAddCurrentIp(ip)}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add to Allowlist
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {/* ---------------------------------------------------------------- */}
      {/*  Tabs: Allowed / Blocked                                        */}
      {/* ---------------------------------------------------------------- */}
      <Tabs defaultValue="allowed">
        <TabsList>
          <TabsTrigger value="allowed">
            <ShieldCheck className="mr-1.5 h-4 w-4" />
            Allowed IPs ({allowed.length})
          </TabsTrigger>
          <TabsTrigger value="blocked">
            <ShieldX className="mr-1.5 h-4 w-4" />
            Blocked IPs ({blocked.length})
          </TabsTrigger>
        </TabsList>

        {/* ---- Allowed IPs Tab ---- */}
        <TabsContent value="allowed">
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>IP Address</TableHead>
                      <TableHead>Label / Description</TableHead>
                      <TableHead>Added Date</TableHead>
                      <TableHead>Added By</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allowed.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="py-12 text-center">
                          <Globe className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                          <p className="text-sm text-gray-500">
                            {dataLoading ? "Loading..." : "No allowed IPs configured."}
                          </p>
                        </TableCell>
                      </TableRow>
                    ) : (
                      allowed.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-50">
                                <Globe className="h-4 w-4 text-green-600" />
                              </div>
                              <code className="rounded bg-gray-100 px-2 py-0.5 text-sm font-medium text-gray-800">
                                {entry.ip}
                              </code>
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-gray-600">
                            {entry.label}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-gray-500">
                            {formatDate(entry.addedDate)}
                          </TableCell>
                          <TableCell className="text-xs text-gray-500">
                            {entry.addedBy}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={busy}
                                className="text-red-600 hover:bg-red-50 hover:text-red-700"
                                onClick={() =>
                                  handleRemoveOpen(
                                    entry.id,
                                    entry.ip,
                                    "allow",
                                  )
                                }
                              >
                                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                                Remove
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={busy}
                                className="text-orange-600 hover:bg-orange-50 hover:text-orange-700"
                                onClick={() => handleBlockAllowed(entry)}
                              >
                                <ShieldX className="mr-1.5 h-3.5 w-3.5" />
                                Block
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
        </TabsContent>

        {/* ---- Blocked IPs Tab ---- */}
        <TabsContent value="blocked">
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>IP Address</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Blocked Date</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {blocked.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="py-12 text-center">
                          <ShieldCheck className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                          <p className="text-sm text-gray-500">
                            {dataLoading ? "Loading..." : "No blocked IPs. All clear!"}
                          </p>
                        </TableCell>
                      </TableRow>
                    ) : (
                      blocked.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-50">
                                <ShieldX className="h-4 w-4 text-red-600" />
                              </div>
                              <code className="rounded bg-gray-100 px-2 py-0.5 text-sm font-medium text-gray-800">
                                {entry.ip}
                              </code>
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-gray-600">
                            {entry.reason}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-gray-500">
                            {formatDate(entry.blockedDate)}
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end">
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={busy}
                                className="text-green-600 hover:bg-green-50 hover:text-green-700"
                                onClick={() => handleUnblock(entry)}
                              >
                                <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                                Unblock
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
        </TabsContent>
      </Tabs>

      {/* ---------------------------------------------------------------- */}
      {/*  Pending IP Requests                                            */}
      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-600" />
            Pending IP Requests
            {pending.length > 0 && (
              <Badge variant="destructive" className="ml-2">
                {pending.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <div className="py-8 text-center">
              <ShieldCheck className="mx-auto mb-3 h-10 w-10 text-gray-300" />
              <p className="text-sm text-gray-500">
                No pending IP requests at this time.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {pending.map((request) => {
                const isRevealed = revealedIPs.has(request.id);
                return (
                  <div
                    key={request.id}
                    className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50/50 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">
                          {request.employeeName}
                        </span>
                        <Badge variant="default">{request.employeeId}</Badge>
                      </div>
                      <div className="flex items-center gap-3 text-sm text-gray-600">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          {formatTimestamp(request.timestamp)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Globe className="h-3.5 w-3.5" />
                          <code className="rounded bg-white/80 px-1.5 py-0.5 text-xs">
                            {isRevealed ? request.ip : maskIP(request.ip)}
                          </code>
                          <button
                            type="button"
                            onClick={() => toggleRevealIP(request.id)}
                            className="rounded p-0.5 text-gray-400 hover:text-gray-700"
                            aria-label={
                              isRevealed ? "Hide IP" : "Reveal IP"
                            }
                          >
                            {isRevealed ? (
                              <EyeOff className="h-3.5 w-3.5" />
                            ) : (
                              <Eye className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => handleApproveToday(request)}
                      >
                        <Check className="mr-1.5 h-3.5 w-3.5" />
                        Approve for Today
                      </Button>
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => handleApproveAndAdd(request)}
                      >
                        <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                        Approve & Add to Allowlist
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        className="text-red-600 hover:bg-red-50 hover:text-red-700"
                        onClick={() => handleRejectRequest(request)}
                      >
                        <X className="mr-1.5 h-3.5 w-3.5" />
                        Reject
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/*  Add IP Dialog                                                   */}
      {/* ---------------------------------------------------------------- */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add IP Address</DialogTitle>
            <DialogDescription>
              Add an IP address to the allowlist or blocklist. CIDR notation
              is supported (e.g. 192.168.1.0/24).
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <Input
              label="IP Address"
              placeholder="e.g. 203.122.45.10 or 10.0.0.0/8"
              value={formIP}
              onChange={(e) => setFormIP(e.target.value)}
            />

            <Input
              label="Label / Description"
              placeholder="e.g. Office WiFi, VPN Gateway"
              value={formLabel}
              onChange={(e) => setFormLabel(e.target.value)}
            />

            <Select
              label="Type"
              options={ADD_TYPE_OPTIONS}
              value={formType}
              onChange={(e) => setFormType(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                resetAddForm();
                setAddDialogOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleAdd} disabled={!formIP.trim() || busy}>
              <Plus className="mr-2 h-4 w-4" />
              {formType === "allow" ? "Add to Allowlist" : "Add to Blocklist"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------------------------------------------------------- */}
      {/*  Remove Confirmation Dialog                                     */}
      {/* ---------------------------------------------------------------- */}
      <Dialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove IP</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove{" "}
              <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm font-semibold">
                {removeTarget?.ip}
              </code>{" "}
              from the{" "}
              {removeTarget?.type === "allow" ? "allowlist" : "blocklist"}?
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRemoveTarget(null);
                setRemoveDialogOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleRemoveConfirm} disabled={busy}>
              <Trash2 className="mr-2 h-4 w-4" />
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
