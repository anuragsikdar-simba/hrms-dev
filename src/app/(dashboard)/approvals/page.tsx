"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { BadgeVariant } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, getInitials } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  CheckCheck,
  Inbox,
  Clock,
  AlertTriangle,
  Users,
  Search,
} from "lucide-react";
import api from "@/lib/api-client";
import { businessDate } from "@/lib/dates";
import { useAuth } from "@/contexts/AuthContext";

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

type RequestType = "Leave" | "Regularisation" | "WFH" | "Shift Change" | "Profile Change" | "IP Violation" | "Location";
type RequestStatus = "pending" | "approved" | "rejected";
type LeaveSubType = "Earned" | "Sick" | "Casual";

interface ApprovalRequest {
  id: string;
  employeeName: string;
  department: string;
  type: RequestType;
  status: RequestStatus;
  timeAgo: string;
  // Leave-specific
  leaveType?: LeaveSubType;
  from?: string;
  to?: string;
  days?: number;
  appliedOn?: string;
  reportingTo?: string;
  reason: string;
  leaveBalance?: { type: string; total: number; used: number };
  teamOverlap?: string[];
  // Regularisation-specific
  regDate?: string;
  originalPunch?: string;
  requestedChange?: string;
  // WFH-specific
  wfhFrom?: string;
  wfhTo?: string;
  // Shift-change-specific (parsed from requested_change JSON)
  currentShift?: string;
  requestedShift?: string;
  // Profile-change-specific (parsed from requested_change JSON)
  fieldName?: string;
  newValue?: string;
  // IP-violation-specific
  detectedIp?: string;
  // Resolution metadata
  resolvedAt?: string;
  resolvedBy?: string;
  rejectionReason?: string;
  note?: string;
  // Raw creation timestamp (ISO) for sorting
  createdAt: string;
}

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

const TYPE_BADGE_VARIANT: Record<RequestType, BadgeVariant> = {
  Leave: "blue",
  Regularisation: "purple",
  WFH: "amber",
  "Shift Change": "green",
  "Profile Change": "default",
  "IP Violation": "red",
  Location: "red",
};

/** Human-readable title for the detail panel so the admin instantly knows
 *  what KIND of request they are looking at before reading any fields. */
const TYPE_TITLE: Record<RequestType, string> = {
  Leave: "Leave Request",
  Regularisation: "Attendance Regularisation",
  WFH: "Work From Home Request",
  "Shift Change": "Shift Change Request",
  "Profile Change": "Profile Change Request",
  "IP Violation": "Unrecognised Network (IP) Approval",
  Location: "Outside Approved Location",
};

const LEAVE_TYPE_BADGE_VARIANT: Record<LeaveSubType, BadgeVariant> = {
  Earned: "blue",
  Sick: "red",
  Casual: "purple",
};

type TabFilter = "all" | RequestType;
type ViewMode = "pending" | "history";

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
  });
}

function formatDateFull(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getDescription(req: ApprovalRequest): string {
  if (req.type === "Leave") {
    return `${req.leaveType} leave, ${formatDate(req.from ?? "")}${req.from !== req.to ? ` - ${formatDate(req.to ?? "")}` : ""} (${req.days}d)`;
  }
  if (req.type === "Regularisation") {
    return `${formatDate(req.regDate ?? "")} - ${req.requestedChange}`;
  }
  if (req.type === "WFH") {
    return `WFH ${formatDate(req.wfhFrom ?? "")}${req.wfhFrom !== req.wfhTo ? ` - ${formatDate(req.wfhTo ?? "")}` : ""}`;
  }
  if (req.type === "Shift Change") {
    return `Shift ${req.currentShift ?? "?"} \u2192 ${req.requestedShift ?? "?"}`;
  }
  if (req.type === "Profile Change") {
    return `${req.fieldName ?? "Field"} \u2192 ${req.newValue ?? "?"}`;
  }
  if (req.type === "IP Violation") {
    return `Unrecognised IP ${req.detectedIp ?? ""}`;
  }
  if (req.type === "Location") {
    return req.reason || "Punched outside approved locations";
  }
  return req.reason;
}

// ---------------------------------------------------------------------------
//  Stats Row
// ---------------------------------------------------------------------------

function StatsRow({
  pending,
  approvedToday,
  rejected,
  avgResponse,
}: {
  pending: number;
  approvedToday: number;
  rejected: number;
  avgResponse: string;
}) {
  const stats = [
    { label: "Pending", value: String(pending), dotColor: "bg-amber-500" },
    {
      label: "Approved",
      value: String(approvedToday),
      dotColor: "bg-green-500",
    },
    { label: "Rejected", value: String(rejected), dotColor: "bg-red-500" },
    { label: "Avg. response", value: avgResponse, dotColor: "bg-blue-500" },
  ];

  return (
    <div className="grid grid-cols-4 gap-3">
      {stats.map((s) => (
        <Card key={s.label}>
          <CardContent className="py-3 px-4">
            <div className="flex items-center gap-1.5 mb-1">
              <span
                className={`h-[6px] w-[6px] rounded-full shrink-0 ${s.dotColor}`}
              />
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                {s.label}
              </span>
            </div>
            <p className="font-mono text-2xl font-medium tabular-nums text-gray-900">
              {s.value}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Request List Item
// ---------------------------------------------------------------------------

function RequestListItem({
  request,
  isSelected,
  onClick,
}: {
  request: ApprovalRequest;
  isSelected: boolean;
  onClick: () => void;
}) {
  const statusBadge =
    request.status === "approved" ? (
      <Badge variant="green" className="ml-auto shrink-0">Approved</Badge>
    ) : request.status === "rejected" ? (
      <Badge variant="red" className="ml-auto shrink-0">Rejected</Badge>
    ) : null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left p-3 border-b border-gray-100 cursor-pointer transition-colors ${
        isSelected
          ? "bg-blue-50/40 border-l-[3px] border-l-blue-500"
          : "hover:bg-gray-50 border-l-[3px] border-l-transparent"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <Avatar className="h-7 w-7 shrink-0 mt-0.5">
          <AvatarFallback className="text-[10px]">
            {getInitials(request.employeeName)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-gray-900 truncate">
              {request.employeeName}
            </span>
            {statusBadge || (
              <span className="font-mono text-[10px] text-gray-400 shrink-0">
                {request.timeAgo}
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <Badge variant={TYPE_BADGE_VARIANT[request.type]}>
              {request.type}
            </Badge>
            {!statusBadge && request.timeAgo && (
              <span className="sr-only">{request.timeAgo}</span>
            )}
          </div>
          <p className="mt-1 text-xs text-gray-500 line-clamp-2">
            {getDescription(request)}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <span className="font-mono text-[10px] text-gray-400">
              {request.id}
            </span>
            {request.resolvedAt && (
              <span className="font-mono text-[10px] text-gray-400">
                &middot; {request.resolvedAt}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
//  Leave Balance Impact
// ---------------------------------------------------------------------------

function LeaveBalanceImpact({
  balance,
  days,
}: {
  balance: { type: string; total: number; used: number };
  days: number;
}) {
  const before = balance.total - balance.used;
  const after = Math.max(before - days, 0);
  const beforePct = (balance.used / balance.total) * 100;
  const afterPct = ((balance.used + days) / balance.total) * 100;

  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-2">
        {balance.type} leave balance impact
      </p>
      <div className="flex items-center justify-between text-xs mb-1.5">
        <span className="text-gray-600">
          Before: <span className="font-mono font-medium text-gray-900">{before}</span> days
        </span>
        <span className="text-gray-600">
          After: <span className="font-mono font-medium text-amber-600">{after}</span> days
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-gray-200 overflow-hidden">
        <div className="h-full flex">
          <div
            className="h-full bg-gray-400 transition-all"
            style={{ width: `${Math.min(beforePct, 100)}%` }}
          />
          <div
            className="h-full bg-amber-400 transition-all"
            style={{ width: `${Math.min(afterPct - beforePct, 100 - beforePct)}%` }}
          />
        </div>
      </div>
      <div className="flex items-center gap-3 mt-1.5 text-[10px] text-gray-500">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-gray-400" /> Used
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-amber-400" /> This request
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-gray-200" /> Remaining
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Detail Panel
// ---------------------------------------------------------------------------

function DetailPanel({
  request,
  onApprove,
  onReject,
  isBusy,
}: {
  request: ApprovalRequest;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  isBusy: boolean;
}) {
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState("");

  const isPending = request.status === "pending";

  const statusBadge =
    request.status === "approved" ? (
      <Badge variant="green" dot>Approved</Badge>
    ) : request.status === "rejected" ? (
      <Badge variant="red" dot>Rejected</Badge>
    ) : (
      <Badge variant="amber" dot>Pending</Badge>
    );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-200">
        {/* What kind of request this is - the first thing the admin reads */}
        <div className="mb-3 flex items-center gap-2">
          <Badge variant={TYPE_BADGE_VARIANT[request.type]} dot>
            {request.type}
          </Badge>
          <h2 className="text-[13px] font-semibold text-gray-900">
            {TYPE_TITLE[request.type]}
          </h2>
        </div>
        <div className="flex items-center gap-3">
          <Avatar className="h-9 w-9">
            <AvatarFallback className="text-xs">
              {getInitials(request.employeeName)}
            </AvatarFallback>
          </Avatar>
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              {request.employeeName}
            </h3>
            <p className="text-[11px] text-gray-500">
              {request.department} &middot;{" "}
              <span className="font-mono">{request.id}</span>
            </p>
          </div>
          <div className="ml-auto">
            {statusBadge}
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {/* Leave request detail */}
        {request.type === "Leave" && (
          <>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <DetailField label="Type">
                <Badge variant={LEAVE_TYPE_BADGE_VARIANT[request.leaveType ?? "Casual"]} dot>
                  {request.leaveType}
                </Badge>
              </DetailField>
              <DetailField label="Days">
                <span className="font-mono text-sm font-medium text-gray-900">
                  {request.days}
                </span>
              </DetailField>
              <DetailField label="From">
                <span className="font-mono text-xs text-gray-900">
                  {formatDateFull(request.from ?? "")}
                </span>
              </DetailField>
              <DetailField label="To">
                <span className="font-mono text-xs text-gray-900">
                  {formatDateFull(request.to ?? "")}
                </span>
              </DetailField>
              <DetailField label="Applied on">
                <span className="font-mono text-xs text-gray-700">
                  {formatDateFull(request.appliedOn ?? "")}
                </span>
              </DetailField>
              <DetailField label="Reporting to">
                <span className="text-xs text-gray-700">
                  {request.reportingTo}
                </span>
              </DetailField>
            </div>

            {/* Reason */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                Reason
              </p>
              <p className="text-xs text-gray-700 leading-relaxed">
                {request.reason}
              </p>
            </div>

            {/* Leave balance impact */}
            {request.leaveBalance && (
              <LeaveBalanceImpact
                balance={request.leaveBalance}
                days={request.days!}
              />
            )}

            {/* Team overlap */}
            {request.teamOverlap && request.teamOverlap.length > 0 && (
              <div className="rounded-md bg-amber-50 border border-amber-200 p-2.5 flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-[11px] font-semibold text-amber-800">
                    Team overlap
                  </p>
                  <p className="text-[11px] text-amber-700">
                    {request.teamOverlap.join(", ")}{" "}
                    {request.teamOverlap.length === 1 ? "is" : "are"} also on
                    leave during this period.
                  </p>
                </div>
              </div>
            )}
          </>
        )}

        {/* Regularisation detail */}
        {request.type === "Regularisation" && (
          <>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <DetailField label="Date">
                <span className="font-mono text-xs text-gray-900">
                  {formatDateFull(request.regDate ?? "")}
                </span>
              </DetailField>
              <DetailField label="Original punch">
                <span className="font-mono text-xs text-gray-900">
                  {request.originalPunch}
                </span>
              </DetailField>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                Requested change
              </p>
              <p className="text-xs text-gray-700 leading-relaxed">
                {request.requestedChange}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                Reason
              </p>
              <p className="text-xs text-gray-700 leading-relaxed">
                {request.reason}
              </p>
            </div>
          </>
        )}

        {/* WFH detail */}
        {request.type === "WFH" && (
          <>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <DetailField label="From">
                <span className="font-mono text-xs text-gray-900">
                  {formatDateFull(request.wfhFrom ?? "")}
                </span>
              </DetailField>
              <DetailField label="To">
                <span className="font-mono text-xs text-gray-900">
                  {formatDateFull(request.wfhTo ?? "")}
                </span>
              </DetailField>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                Reason
              </p>
              <p className="text-xs text-gray-700 leading-relaxed">
                {request.reason}
              </p>
            </div>
          </>
        )}

        {/* Shift change detail */}
        {request.type === "Shift Change" && (
          <>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <DetailField label="Current shift">
                <span className="font-mono text-xs text-gray-900">
                  {request.currentShift ?? "Unknown"}
                </span>
              </DetailField>
              <DetailField label="Requested shift">
                <span className="font-mono text-xs font-semibold text-green-700">
                  {request.requestedShift ?? "Unknown"}
                </span>
              </DetailField>
            </div>
            <div className="rounded-md bg-blue-50 border border-blue-200 p-2.5">
              <p className="text-[11px] text-blue-800">
                Approving immediately updates this employee&apos;s shift. Attendance grace and
                auto punch-out will follow the new timings from the next punch-in.
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                Reason
              </p>
              <p className="text-xs text-gray-700 leading-relaxed">
                {request.reason}
              </p>
            </div>
          </>
        )}

        {/* Profile change detail */}
        {request.type === "Profile Change" && (
          <>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <DetailField label="Field">
                <span className="text-xs text-gray-900">{request.fieldName ?? "Unknown"}</span>
              </DetailField>
              <DetailField label="New value">
                <span className="font-mono text-xs font-semibold text-green-700 break-all">
                  {request.newValue ?? "Unknown"}
                </span>
              </DetailField>
            </div>
            {request.reason && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                  Reason
                </p>
                <p className="text-xs text-gray-700 leading-relaxed">{request.reason}</p>
              </div>
            )}
          </>
        )}

        {/* IP violation detail */}
        {request.type === "IP Violation" && (
          <>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <DetailField label="Detected IP">
                <span className="font-mono text-xs text-gray-900">{request.detectedIp ?? "Unknown"}</span>
              </DetailField>
            </div>
            <div className="rounded-md bg-amber-50 border border-amber-200 p-2.5">
              <p className="text-[11px] text-amber-800">
                Approving here only clears this request - it does <strong>not</strong> add the IP
                to the allowlist. To approve <em>and</em> allowlist the network in one step, use{" "}
                <a href="/settings/ip-allowlist" className="font-semibold underline hover:text-amber-900">
                  Settings &rarr; IP Allowlist
                </a>.
              </p>
            </div>
            {request.reason && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                  Details
                </p>
                <p className="text-xs text-gray-700 leading-relaxed">{request.reason}</p>
              </div>
            )}
          </>
        )}

        {/* Location violation detail */}
        {request.type === "Location" && (
          <>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                Details
              </p>
              <p className="text-xs text-gray-700 leading-relaxed">{request.reason}</p>
            </div>
            <div className="rounded-md bg-amber-50 border border-amber-200 p-2.5">
              <p className="text-[11px] text-amber-800">
                The punch itself was recorded - this request is only the review. Manage approved
                locations in{" "}
                <a href="/settings/punch-locations" className="font-semibold underline hover:text-amber-900">
                  Settings &rarr; Punch Locations
                </a>. Note that browser GPS can be inaccurate indoors.
              </p>
            </div>
          </>
        )}

        {/* Add note */}
        {isPending && showNote && (
          <div>
            <Textarea
              label="Note"
              placeholder="Add a note for this decision..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
            />
          </div>
        )}

        {/* Resolution info for history items */}
        {!isPending && (
          <div className={`rounded-lg border p-3 ${
            request.status === "approved"
              ? "border-green-200 bg-green-50/50"
              : "border-red-200 bg-red-50/50"
          }`}>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-2">
              Resolution
            </p>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-500">Status:</span>
                <span className={`font-medium ${
                  request.status === "approved" ? "text-green-700" : "text-red-700"
                }`}>
                  {request.status === "approved" ? "Approved" : "Rejected"}
                </span>
              </div>
              {request.resolvedBy && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-gray-500">By:</span>
                  <span className="font-medium text-gray-900">{request.resolvedBy}</span>
                </div>
              )}
              {request.resolvedAt && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-gray-500">On:</span>
                  <span className="font-mono text-gray-700">{request.resolvedAt}</span>
                </div>
              )}
              {request.rejectionReason && (
                <div className="mt-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                    Rejection reason
                  </span>
                  <p className="mt-0.5 text-xs text-red-700 leading-relaxed">
                    {request.rejectionReason}
                  </p>
                </div>
              )}
              {request.note && (
                <div className="mt-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                    Note
                  </span>
                  <p className="mt-0.5 text-xs text-gray-700 leading-relaxed">
                    {request.note}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer actions */}
      {isPending ? (
        <div className="px-5 py-3 border-t border-gray-200 bg-gray-50/50 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowNote(!showNote)}
            className="text-[11px] text-gray-500 hover:text-gray-700 font-medium transition-colors"
          >
            {showNote ? "Hide note" : "Add note"}
          </button>
          <div className="flex-1" />
          <Button
            variant="destructive"
            size="default"
            onClick={() => onReject(request.id)}
            disabled={isBusy}
          >
            Reject
          </Button>
          <Button
            size="default"
            className="bg-green-600 border-green-600 hover:bg-green-700 text-white focus-visible:ring-green-600"
            onClick={() => onApprove(request.id)}
            disabled={isBusy}
          >
            {isBusy ? "Processing..." : "Approve"}
          </Button>
        </div>
      ) : (
        <div className="px-5 py-3 border-t border-gray-200 bg-gray-50/50 flex items-center justify-center">
          <p className="text-xs text-gray-400">
            This request has been {request.status}.
          </p>
        </div>
      )}
    </div>
  );
}

function DetailField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-0.5">
        {label}
      </p>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Empty Selection State
// ---------------------------------------------------------------------------

function EmptySelection() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 mb-4">
        <Inbox className="h-7 w-7 text-gray-400" />
      </div>
      <h3 className="text-sm font-semibold text-gray-900 mb-1">
        Select a request
      </h3>
      <p className="text-xs text-gray-500 max-w-[220px]">
        Choose a request from the list to view details and take action.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Reject Dialog
// ---------------------------------------------------------------------------

function RejectDialog({
  open,
  onOpenChange,
  onConfirm,
  requestId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (id: string, reason: string) => void;
  requestId: string | null;
}) {
  const [rejectionReason, setRejectionReason] = useState("");
  const [error, setError] = useState("");

  function handleConfirm() {
    if (!rejectionReason.trim()) {
      setError("Rejection reason is required.");
      return;
    }
    if (requestId) {
      onConfirm(requestId, rejectionReason.trim());
    }
    setRejectionReason("");
    setError("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject Request</DialogTitle>
          <DialogDescription>
            Please provide a reason for rejecting this request. This will be
            shared with the employee.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4">
          <Textarea
            label="Rejection Reason"
            placeholder="Enter rejection reason..."
            value={rejectionReason}
            onChange={(e) => {
              setRejectionReason(e.target.value);
              if (e.target.value.trim()) setError("");
            }}
            error={error || undefined}
            rows={3}
            required
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm}>
            Confirm Rejection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
//  Page
// ---------------------------------------------------------------------------

export default function ApprovalsPage() {
  const { userProfile } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("pending");
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  // Triage controls for large queues
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("");
  const [sortBy, setSortBy] = useState<"priority" | "oldest" | "newest">("priority");

  // Admin-only guard
  useEffect(() => {
    if (userProfile && userProfile.role !== 'admin') {
      router.replace('/dashboard');
    }
  }, [userProfile, router]);

  // Fetch all approval requests from Supabase
  const fetchRequests = useCallback(async () => {
    try {
      // Fetch leave requests (pending ones for approval)
      const { requests: leaveData } = await api.leaves.list();

      const leaveRequests: ApprovalRequest[] = (leaveData ?? []).map((r: Record<string, unknown>) => {
        const emp = r.employees as { name: string; department: { id: string; name: string } | null } | null;
        const lt = r.leave_types as { name: string } | null;
        const created = new Date(r.created_at as string);
        const elapsed = Math.round((Date.now() - created.getTime()) / 60_000);
        const timeAgo = elapsed < 60 ? `${elapsed}m ago` : elapsed < 1440 ? `${Math.round(elapsed / 60)}h ago` : `${Math.round(elapsed / 1440)}d ago`;

        return {
          id: r.id as string,
          employeeName: emp?.name ?? 'Unknown',
          department: emp?.department?.name ?? '',
          type: 'Leave' as const,
          status: (r.status as string) === 'cancelled' ? 'rejected' as const : r.status as 'pending' | 'approved' | 'rejected',
          timeAgo,
          leaveType: (lt?.name?.replace(' Leave', '') ?? 'Casual') as 'Earned' | 'Sick' | 'Casual',
          from: r.from_date as string ?? '',
          to: r.to_date as string ?? '',
          days: Number(r.days),
          appliedOn: businessDate(new Date(r.created_at as string)),
          reason: (r.reason as string) ?? '',
          rejectionReason: r.rejection_reason as string | undefined,
          resolvedAt: r.approved_at as string | undefined,
          createdAt: (r.created_at as string) ?? '',
        };
      });

      // Fetch regularisation / WFH / IP violation requests
      const { requests: approvalData } = await api.approvalRequests.list();

      const otherRequests: ApprovalRequest[] = (approvalData ?? []).map((r: Record<string, unknown>) => {
        const emp = r.employees as { name: string; department: { id: string; name: string } | null } | null;
        const created = new Date(r.created_at as string);
        const elapsed = Math.round((Date.now() - created.getTime()) / 60_000);
        const timeAgo = elapsed < 60 ? `${elapsed}m ago` : elapsed < 1440 ? `${Math.round(elapsed / 60)}h ago` : `${Math.round(elapsed / 1440)}d ago`;

        const dbType = r.type as string;
        const type: RequestType =
          dbType === 'wfh' ? 'WFH' :
          dbType === 'shift_change' ? 'Shift Change' :
          dbType === 'profile_change' ? 'Profile Change' :
          dbType === 'ip_violation' ? 'IP Violation' :
          dbType === 'location_violation' ? 'Location' :
          'Regularisation';

        // Type-specific payloads live in requested_change as JSON.
        let currentShift: string | undefined;
        let requestedShift: string | undefined;
        let fieldName: string | undefined;
        let newValue: string | undefined;
        if (typeof r.requested_change === 'string' && r.requested_change.startsWith('{')) {
          try {
            const parsed = JSON.parse(r.requested_change) as Record<string, string | null>;
            if (type === 'Shift Change') {
              currentShift = parsed.current_shift_start && parsed.current_shift_end
                ? `${parsed.current_shift_start} - ${parsed.current_shift_end}`
                : 'No fixed shift';
              requestedShift = parsed.new_shift_start && parsed.new_shift_end
                ? `${parsed.new_shift_start} - ${parsed.new_shift_end}`
                : undefined;
            }
            if (type === 'Profile Change') {
              fieldName = parsed.field_name ?? undefined;
              newValue = parsed.new_value ?? undefined;
            }
          } catch { /* fall back to raw requestedChange text */ }
        }

        return {
          id: r.id as string,
          employeeName: emp?.name ?? 'Unknown',
          department: emp?.department?.name ?? '',
          type,
          status: r.status as 'pending' | 'approved' | 'rejected',
          timeAgo,
          regDate: r.reg_date as string | undefined,
          originalPunch: r.original_punch as string | undefined,
          requestedChange: r.requested_change as string | undefined,
          wfhFrom: r.wfh_from as string | undefined,
          wfhTo: r.wfh_to as string | undefined,
          currentShift,
          requestedShift,
          fieldName,
          newValue,
          detectedIp: r.detected_ip as string | undefined,
          reason: (r.reason as string) ?? '',
          rejectionReason: r.rejection_reason as string | undefined,
          resolvedAt: r.resolved_at as string | undefined,
          createdAt: (r.created_at as string) ?? '',
        };
      });

      setRequests([...leaveRequests, ...otherRequests]);
    } catch (err) {
      toast({ variant: "error", title: "Failed to load requests", description: String(err) });
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const now = () =>
    new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) +
    ", " +
    new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

  // --- derived ---
  // Priority triage order: IP violations are security-relevant, leaves block
  // people's plans, shift/profile changes affect payroll-relevant config,
  // regularisations are retrospective corrections and can wait the longest.
  const TYPE_PRIORITY: Record<RequestType, number> = useMemo(() => ({
    "IP Violation": 0,
    Location: 0,
    Leave: 1,
    "Shift Change": 2,
    "Profile Change": 3,
    WFH: 4,
    Regularisation: 5,
  }), []);

  const pendingRequests = useMemo(() => {
    const list = requests.filter((r) => r.status === "pending");
    if (sortBy === "priority") {
      return list.sort(
        (a, b) =>
          TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type] ||
          a.createdAt.localeCompare(b.createdAt), // oldest first within a type
      );
    }
    if (sortBy === "oldest") {
      return list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // newest
  }, [requests, sortBy, TYPE_PRIORITY]);

  const resolvedRequests = useMemo(
    () => requests.filter((r) => r.status !== "pending").sort((a, b) => {
      // Most recently resolved first
      if (a.resolvedAt && b.resolvedAt) return b.resolvedAt.localeCompare(a.resolvedAt);
      return 0;
    }),
    [requests],
  );

  // Department options come from the loaded requests themselves.
  const departmentOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of requests) if (r.department) set.add(r.department);
    return Array.from(set).sort();
  }, [requests]);

  // Text search + department narrow the visible pool BEFORE tab counts, so
  // the tab badges always reflect what the admin is actually looking at.
  const searchedRequests = useMemo(() => {
    const source = viewMode === "pending" ? pendingRequests : resolvedRequests;
    const q = search.trim().toLowerCase();
    return source.filter((r) => {
      if (deptFilter && r.department !== deptFilter) return false;
      if (!q) return true;
      return (
        r.employeeName.toLowerCase().includes(q) ||
        r.type.toLowerCase().includes(q) ||
        getDescription(r).toLowerCase().includes(q)
      );
    });
  }, [pendingRequests, resolvedRequests, viewMode, search, deptFilter]);

  const counts = useMemo(() => {
    const source = searchedRequests;
    const byType = (t: RequestType) => source.filter((r) => r.type === t).length;
    return {
      all: source.length,
      Leave: byType("Leave"),
      Regularisation: byType("Regularisation"),
      "Shift Change": byType("Shift Change"),
      WFH: byType("WFH"),
      "Profile Change": byType("Profile Change"),
      "IP Violation": byType("IP Violation"),
      Location: byType("Location"),
    };
  }, [searchedRequests]);

  const filteredRequests = useMemo(() => {
    const source = searchedRequests;
    if (tab === "all") return source;
    return source.filter((r) => r.type === tab);
  }, [searchedRequests, tab]);

  const selectedRequest = useMemo(
    () => requests.find((r) => r.id === selectedId) ?? null,
    [requests, selectedId],
  );

  const approvedTodayCount = useMemo(
    () => requests.filter((r) => r.status === "approved").length,
    [requests],
  );

  const rejectedCount = useMemo(
    () => requests.filter((r) => r.status === "rejected").length,
    [requests],
  );

  // --- handlers ---
  async function handleApprove(id: string) {
    if (busyIds.has(id)) return;
    setBusyIds((prev) => new Set(prev).add(id));
    const req = requests.find((r) => r.id === id);
    const isLeave = req?.type === 'Leave';

    try {
      if (isLeave) {
        await api.leaves.update(id, { status: 'approved' });
      } else {
        await api.approvalRequests.update({ id, status: 'approved' });
      }
    } catch (err) {
      toast({ variant: "error", title: "Failed to approve", description: String(err) });
      setBusyIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
      return;
    }

    setBusyIds((prev) => { const next = new Set(prev); next.delete(id); return next; });

    setRequests((prev) =>
      prev.map((r) =>
        r.id === id
          ? { ...r, status: "approved" as const, resolvedAt: now(), resolvedBy: userProfile?.name ?? "Admin" }
          : r,
      ),
    );
    if (selectedId === id) {
      const remaining = pendingRequests.filter((r) => r.id !== id);
      setSelectedId(remaining.length > 0 ? remaining[0].id : null);
    }
  }

  function handleRejectClick(id: string) {
    setRejectTargetId(id);
    setRejectDialogOpen(true);
  }

  async function handleRejectConfirm(id: string, reason: string) {
    if (busyIds.has(id)) return;
    setBusyIds((prev) => new Set(prev).add(id));
    const req = requests.find((r) => r.id === id);
    const isLeave = req?.type === 'Leave';

    try {
      if (isLeave) {
        await api.leaves.update(id, { status: 'rejected', rejection_reason: reason });
      } else {
        await api.approvalRequests.update({ id, status: 'rejected', rejection_reason: reason });
      }
    } catch (err) {
      toast({ variant: "error", title: "Failed to reject", description: String(err) });
      setBusyIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
      return;
    }

    setBusyIds((prev) => { const next = new Set(prev); next.delete(id); return next; });

    setRequests((prev) =>
      prev.map((r) =>
        r.id === id
          ? { ...r, status: "rejected" as const, resolvedAt: now(), resolvedBy: userProfile?.name ?? "Admin", rejectionReason: reason }
          : r,
      ),
    );
    if (selectedId === id) {
      const remaining = pendingRequests.filter((r) => r.id !== id);
      setSelectedId(remaining.length > 0 ? remaining[0].id : null);
    }
  }

  async function handleBulkApprove() {
    if (bulkLoading) return;
    // Scope bulk approval to what the admin is LOOKING AT (current tab +
    // search + department filter), never the whole queue blindly.
    const targets = filteredRequests.filter((r) => r.status === "pending");
    if (targets.length === 0) return;
    setBulkLoading(true);
    const ts = now();

    const items = targets.map((r) => ({
      id: r.id,
      type: r.type === 'Leave' ? 'leave' as const : 'approval_request' as const,
    }));

    try {
      await api.approvals.bulkUpdate({ items, status: 'approved' });
    } catch (err) {
      toast({ variant: "error", title: "Bulk approve failed", description: String(err) });
      setBulkLoading(false);
      return;
    }

    const targetIds = new Set(targets.map((r) => r.id));
    setRequests((prev) =>
      prev.map((r) =>
        targetIds.has(r.id)
          ? { ...r, status: "approved" as const, resolvedAt: ts, resolvedBy: userProfile?.name ?? "Admin" }
          : r,
      ),
    );
    toast({
      variant: "success",
      title: "Bulk approved",
      description: `${targets.length} request${targets.length > 1 ? 's' : ''} approved${tab !== 'all' ? ` (${tab})` : ''}.`,
    });
    setSelectedId(null);
    setBulkLoading(false);
  }

  // --- request-type filter options (always lists every kind, with counts) ---
  const typeOptions: { key: TabFilter; label: string; count: number }[] = [
    { key: "all", label: "All types", count: counts.all },
    { key: "Leave", label: "Leave", count: counts.Leave },
    { key: "Regularisation", label: "Regularisation", count: counts.Regularisation },
    { key: "Shift Change", label: "Shift Change", count: counts["Shift Change"] },
    { key: "WFH", label: "Work From Home", count: counts.WFH },
    { key: "Profile Change", label: "Profile Change", count: counts["Profile Change"] },
    { key: "IP Violation", label: "IP / Network", count: counts["IP Violation"] },
    { key: "Location", label: "Location", count: counts.Location },
  ];

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-gray-900">
            Approvals
          </h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Pending requests requiring your action
          </p>
        </div>
        <div className="flex items-center gap-2">
          {viewMode === "pending" && (
            <Button
              variant="outline"
              size="default"
              onClick={handleBulkApprove}
              disabled={filteredRequests.filter((r) => r.status === "pending").length === 0 || bulkLoading}
              title="Approves only the requests currently visible (respects tab, search and department filters)"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              {bulkLoading
                ? "Approving..."
                : tab === "all" && !search && !deptFilter
                  ? "Bulk approve"
                  : `Approve visible (${filteredRequests.filter((r) => r.status === "pending").length})`}
            </Button>
          )}
        </div>
      </div>

      {/* Stats Row */}
      <StatsRow
        pending={pendingRequests.length}
        approvedToday={approvedTodayCount}
        rejected={rejectedCount}
        avgResponse="4.2 h"
      />

      {/* Main area: list-detail split. Height is viewport-bound so long queues
          scroll INSIDE the list instead of stretching the whole page (which
          left a giant blank area under the detail panel). */}
      <Card className="overflow-hidden">
        <div className="grid grid-cols-[340px_1fr] gap-0 h-[calc(100vh-240px)] min-h-[480px]">
          {/* Left: Request List */}
          <div className="border-r border-gray-200 flex flex-col h-full min-h-0">
            {/* View mode toggle: Pending / History */}
            <div className="flex border-b border-gray-200">
              <button
                type="button"
                onClick={() => { setViewMode("pending"); setTab("all"); setSelectedId(null); }}
                className={`flex-1 py-2.5 text-xs font-semibold text-center transition-colors ${
                  viewMode === "pending"
                    ? "bg-gray-900 text-white"
                    : "bg-gray-50 text-gray-500 hover:text-gray-700"
                }`}
              >
                <Inbox className="inline-block h-3.5 w-3.5 mr-1.5 -mt-px" />
                Pending
                {pendingRequests.length > 0 && (
                  <span className={`ml-1.5 font-mono text-[10px] px-1.5 rounded-full ${
                    viewMode === "pending" ? "bg-white/20 text-white" : "bg-amber-100 text-amber-700"
                  }`}>
                    {pendingRequests.length}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => { setViewMode("history"); setTab("all"); setSelectedId(null); }}
                className={`flex-1 py-2.5 text-xs font-semibold text-center transition-colors ${
                  viewMode === "history"
                    ? "bg-gray-900 text-white"
                    : "bg-gray-50 text-gray-500 hover:text-gray-700"
                }`}
              >
                <CheckCheck className="inline-block h-3.5 w-3.5 mr-1.5 -mt-px" />
                History
                {resolvedRequests.length > 0 && (
                  <span className={`ml-1.5 font-mono text-[10px] px-1.5 rounded-full ${
                    viewMode === "history" ? "bg-white/20 text-white" : "bg-gray-200 text-gray-600"
                  }`}>
                    {resolvedRequests.length}
                  </span>
                )}
              </button>
            </div>

            {/* Triage controls: type, search, department, sort */}
            <div className="space-y-1.5 border-b border-gray-200 bg-gray-50/60 px-2 py-1.5">
              {/* Request type - always lists every kind with its count */}
              <select
                value={tab}
                onChange={(e) => setTab(e.target.value as TabFilter)}
                className="w-full rounded-md border border-gray-200 bg-white py-1 pl-1.5 pr-5 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-400"
                title="Filter by request type"
              >
                {typeOptions.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label} ({t.count})
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1 min-w-0">
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search name or request..."
                    className="w-full rounded-md border border-gray-200 bg-white py-1 pr-2 text-[11px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
                    style={{ paddingLeft: "1.625rem" }}
                  />
                </div>
                {departmentOptions.length > 1 && (
                  <select
                    value={deptFilter}
                    onChange={(e) => setDeptFilter(e.target.value)}
                    className="shrink-0 rounded-md border border-gray-200 bg-white py-1 pl-1.5 pr-5 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-400"
                    title="Filter by department"
                  >
                    <option value="">All depts</option>
                    {departmentOptions.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                )}
                {viewMode === "pending" && (
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as "priority" | "oldest" | "newest")}
                    className="shrink-0 rounded-md border border-gray-200 bg-white py-1 pl-1.5 pr-5 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-400"
                    title="Sort order: Priority puts security/leave requests first, oldest first within each type"
                  >
                    <option value="priority">Priority</option>
                    <option value="oldest">Oldest first</option>
                    <option value="newest">Newest first</option>
                  </select>
                )}
              </div>
            </div>

            {/* Scrollable list */}
            <div className="flex-1 overflow-y-auto min-h-0">
              {filteredRequests.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                  <Clock className="h-8 w-8 text-gray-300 mb-2" />
                  <p className="text-xs text-gray-400">
                    {search || deptFilter
                      ? "No requests match your filters"
                      : viewMode === "pending"
                        ? "No pending requests"
                        : "No resolved requests yet"}
                  </p>
                  {(search || deptFilter) && (
                    <button
                      type="button"
                      className="mt-2 text-[11px] font-medium text-blue-600 hover:underline"
                      onClick={() => { setSearch(""); setDeptFilter(""); }}
                    >
                      Clear filters
                    </button>
                  )}
                </div>
              ) : (
                filteredRequests.map((req) => (
                  <RequestListItem
                    key={req.id}
                    request={req}
                    isSelected={selectedId === req.id}
                    onClick={() => setSelectedId(req.id)}
                  />
                ))
              )}
            </div>
          </div>

          {/* Right: Detail Panel */}
          <div className="h-full min-h-0 overflow-y-auto">
            {selectedRequest ? (
              <DetailPanel
                request={selectedRequest}
                onApprove={handleApprove}
                onReject={handleRejectClick}
                isBusy={busyIds.has(selectedRequest.id)}
              />
            ) : (
              <EmptySelection />
            )}
          </div>
        </div>
      </Card>

      {/* Reject Dialog */}
      <RejectDialog
        open={rejectDialogOpen}
        onOpenChange={setRejectDialogOpen}
        onConfirm={handleRejectConfirm}
        requestId={rejectTargetId}
      />
    </div>
  );
}
