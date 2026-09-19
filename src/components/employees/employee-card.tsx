"use client";

import { Avatar, AvatarImage, AvatarFallback, getInitials } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge, type EmployeeStatus as BadgeStatus } from "@/components/ui/status-badge";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { MoreVertical, Eye, Pencil, UserX, LogOut, ShieldCheck, Shield } from "lucide-react";
import { RoleBadge } from "./role-badge";
import type { EmployeeStatus } from "@/types";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface EmployeeCardData {
  id: string;
  name: string;
  employeeId: string;
  department: string;
  designation: string;
  role: "admin" | "employee";
  status: EmployeeStatus;
  dateOfJoining: string;
  profilePictureUrl?: string;
}

export interface EmployeeCardProps {
  employee: EmployeeCardData;
  onAction: (action: string, employeeId: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const statusToBadge: Record<EmployeeStatus, BadgeStatus> = {
  active: "active",
  inactive: "inactive",
  offboarded: "terminated",
  pending_onboarding: "pending",
  onboarding_submitted: "pending",
  terminated: "terminated",
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function EmployeeCard({ employee, onAction }: EmployeeCardProps) {
  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="p-4">
        {/* Top row: avatar + info + actions */}
        <div className="flex items-start gap-3">
          <Avatar className="h-11 w-11">
            {employee.profilePictureUrl && (
              <AvatarImage src={employee.profilePictureUrl} alt={employee.name} />
            )}
            <AvatarFallback>{getInitials(employee.name)}</AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-gray-900">
              {employee.name}
            </p>
            <p className="truncate text-xs text-gray-500">
              {employee.designation}
            </p>
          </div>

          {/* Actions dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              aria-label="Employee actions"
            >
              <MoreVertical className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onAction("view", employee.id)}>
                <Eye className="h-4 w-4" />
                View Profile
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onAction("edit", employee.id)}>
                <Pencil className="h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  onAction(employee.role === "admin" ? "make_employee" : "make_admin", employee.id)
                }
              >
                {employee.role === "admin" ? (
                  <>
                    <Shield className="h-4 w-4" />
                    Revoke admin
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-4 w-4" />
                    Make admin
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                destructive
                onClick={() => onAction("offboard", employee.id)}
              >
                <UserX className="h-4 w-4" />
                Offboard
              </DropdownMenuItem>
              <DropdownMenuItem
                destructive
                onClick={() => onAction("force_logout", employee.id)}
              >
                <LogOut className="h-4 w-4" />
                Force Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Details row */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
          <span>
            <span className="font-medium text-gray-600">ID:</span>{" "}
            {employee.employeeId}
          </span>
          <span>
            <span className="font-medium text-gray-600">Dept:</span>{" "}
            {employee.department}
          </span>
          <span>
            <span className="font-medium text-gray-600">Joined:</span>{" "}
            {employee.dateOfJoining}
          </span>
        </div>

        {/* Status */}
        <div className="mt-3 flex items-center gap-2">
          <StatusBadge status={statusToBadge[employee.status]} />
          <RoleBadge role={employee.role} />
        </div>
      </CardContent>
    </Card>
  );
}
