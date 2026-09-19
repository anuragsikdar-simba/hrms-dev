"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar, AvatarImage, AvatarFallback, getInitials } from "@/components/ui/avatar";
import { StatusBadge, type EmployeeStatus as BadgeStatus } from "@/components/ui/status-badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Eye, Pencil, UserX, LogOut, ShieldCheck, Shield } from "lucide-react";
import { EmployeeCard, type EmployeeCardData } from "./employee-card";
import { RoleBadge } from "./role-badge";
import type { EmployeeStatus } from "@/types";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface EmployeeTableProps {
  employees: EmployeeCardData[];
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
/*  Hook: responsive breakpoint                                        */
/* ------------------------------------------------------------------ */

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const handler = (e: MediaQueryListEvent | MediaQueryList) =>
      setIsMobile(e.matches);

    handler(mql);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [breakpoint]);

  return isMobile;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function EmployeeTable({ employees, onAction }: EmployeeTableProps) {
  const isMobile = useIsMobile();
  const router = useRouter();

  /* ---- Mobile: card grid ---- */
  if (isMobile) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {employees.map((emp) => (
          <EmployeeCard key={emp.id} employee={emp} onAction={onAction} />
        ))}
      </div>
    );
  }

  /* ---- Desktop: table ---- */
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Employee ID</TableHead>
          <TableHead>Department</TableHead>
          <TableHead>Designation</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Date of Joining</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>

      <TableBody>
        {employees.map((emp) => (
          <TableRow
            key={emp.id}
            className="cursor-pointer hover:bg-gray-50"
            onClick={() => router.push(`/employees/${emp.id}`)}
          >
            {/* Name + Avatar */}
            <TableCell>
              <Link
                href={`/employees/${emp.id}`}
                className="flex items-center gap-3"
                onClick={(e) => e.stopPropagation()}
              >
                <Avatar className="h-8 w-8">
                  {emp.profilePictureUrl && (
                    <AvatarImage src={emp.profilePictureUrl} alt={emp.name} />
                  )}
                  <AvatarFallback className="text-xs">
                    {getInitials(emp.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="text-xs font-medium text-gray-900 hover:text-blue-600 hover:underline">
                  {emp.name}
                </span>
              </Link>
            </TableCell>

            {/* Employee ID */}
            <TableCell className="font-mono text-xs">{emp.employeeId}</TableCell>

            {/* Department */}
            <TableCell className="text-xs">{emp.department}</TableCell>

            {/* Designation */}
            <TableCell className="text-xs">{emp.designation}</TableCell>

            {/* Role */}
            <TableCell>
              <RoleBadge role={emp.role} />
            </TableCell>

            {/* Status */}
            <TableCell>
              <StatusBadge status={statusToBadge[emp.status]} />
            </TableCell>

            {/* Date of Joining */}
            <TableCell className="font-mono text-xs">{emp.dateOfJoining}</TableCell>

            {/* Actions */}
            <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  aria-label="Employee actions"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => router.push(`/employees/${emp.id}`)}>
                    <Eye className="h-4 w-4" />
                    View Profile
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => router.push(`/employees/${emp.id}`)}>
                    <Pencil className="h-4 w-4" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      onAction(emp.role === "admin" ? "make_employee" : "make_admin", emp.id)
                    }
                  >
                    {emp.role === "admin" ? (
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
                    onClick={() => onAction("offboard", emp.id)}
                  >
                    <UserX className="h-4 w-4" />
                    Offboard
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    destructive
                    onClick={() => onAction("force_logout", emp.id)}
                  >
                    <LogOut className="h-4 w-4" />
                    Force Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
