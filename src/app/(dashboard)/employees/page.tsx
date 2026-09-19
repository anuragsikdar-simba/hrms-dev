"use client";

import * as React from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/lib/api-client";
import { SearchInput } from "@/components/ui/search-input";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { EmployeeTable } from "@/components/employees/employee-table";
import { OffboardDialog } from "@/components/employees/offboard-dialog";
import { ExportDialog } from "@/components/employees/export-dialog";
import { ImportDialog } from "@/components/employees/import-dialog";
import { useToast } from "@/components/ui/toast";
import type { EmployeeCardData } from "@/components/employees/employee-card";
import type { EmployeeStatus } from "@/types";
import {
  UserPlus,
  Download,
  Upload,
  Users,
  ShieldAlert,
  AlertCircle,
} from "lucide-react";
import { Skeleton, SkeletonPageHeader, SkeletonTable } from "@/components/ui/skeleton";

/* ------------------------------------------------------------------ */
/*  Filter types                                                       */
/* ------------------------------------------------------------------ */

type FilterKey = "all" | "active" | "pending_onboarding" | "terminated";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "pending_onboarding", label: "Pending Onboarding" },
  { key: "terminated", label: "Terminated" },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Map the Supabase row fields to the front-end EmployeeStatus.
 *
 * Supabase schema:
 *   status: 'active' | 'inactive' | 'offboarded'
 *   onboarding_status: e.g. 'pending', 'submitted', 'completed', etc.
 *
 * Front-end EmployeeStatus:
 *   'pending_onboarding' | 'onboarding_submitted' | 'active' | 'terminated'
 */
function deriveStatus(
  dbStatus: string | null,
  onboardingStatus: string | null,
): EmployeeStatus {
  if (dbStatus === "inactive" || dbStatus === "offboarded") return "terminated";
  // If still onboarding
  if (onboardingStatus === "submitted") return "onboarding_submitted";
  if (
    onboardingStatus &&
    onboardingStatus !== "completed" &&
    onboardingStatus !== "done"
  ) {
    return "pending_onboarding";
  }
  return "active";
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const PAGE_SIZE = 20;

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */

export default function EmployeesPage() {
  const { isAdmin, loading } = useAuth();
  const { toast } = useToast();

  const [employees, setEmployees] = React.useState<EmployeeCardData[]>([]);
  const [fetchLoading, setFetchLoading] = React.useState(true);
  const [fetchError, setFetchError] = React.useState<string | null>(null);
  // The full-screen loading spinner should only appear on the very first load.
  // Background refreshes (e.g. after a CSV import) must keep the directory
  // mounted so dialogs and their state (like the one-time credentials shown
  // after an import) are not destroyed by a re-render.
  const hasLoadedOnce = React.useRef(false);

  const [search, setSearch] = React.useState("");
  const [filter, setFilter] = React.useState<FilterKey>("all");
  const [currentPage, setCurrentPage] = React.useState(1);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [offboardTarget, setOffboardTarget] = React.useState<EmployeeCardData | null>(null);

  /* ---- Fetch employees from Supabase ---- */
  const loadEmployees = React.useCallback(async () => {
    // Only show the full-screen spinner on the first load. Subsequent refreshes
    // (e.g. triggered by a CSV import's onImported) run silently so the page —
    // and any open dialog showing one-time credentials — stays mounted.
    if (!hasLoadedOnce.current) setFetchLoading(true);
    setFetchError(null);
    try {
      const { employees: data } = await api.employees.list();
      const mapped: EmployeeCardData[] = (data ?? []).map((row) => ({
        id: row.id,
        name: row.name ?? "",
        employeeId: row.employee_id ?? "",
        department: row.department?.name ?? "",
        designation: row.designation ?? "",
        role: row.role === "admin" ? "admin" : "employee",
        status: deriveStatus(row.status, row.onboarding_status),
        dateOfJoining: row.date_of_joining ?? "",
        profilePictureUrl: row.avatar_url ?? undefined,
      }));
      setEmployees(mapped);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed to fetch employees");
    } finally {
      hasLoadedOnce.current = true;
      setFetchLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (loading || !isAdmin) return;
    loadEmployees();
  }, [loading, isAdmin, loadEmployees]);

  /* ---- Access guard ---- */
  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
          <ShieldAlert className="h-8 w-8 text-red-600" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900">Access Denied</h2>
        <p className="max-w-md text-sm text-gray-500">
          You do not have permission to view this page. Only administrators can
          access the Employee Directory.
        </p>
        <Link href="/dashboard">
          <Button variant="outline">Back to Dashboard</Button>
        </Link>
      </div>
    );
  }

  /* ---- Data loading state ---- */
  if (fetchLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <SkeletonPageHeader />
          <Skeleton className="h-9 w-32 rounded-md" />
        </div>
        <div className="flex gap-3">
          <Skeleton className="h-9 w-full max-w-sm rounded-md" />
          <Skeleton className="h-9 w-36 rounded-md" />
        </div>
        <SkeletonTable rows={8} columns={6} />
      </div>
    );
  }

  /* ---- Error state ---- */
  if (fetchError) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
          <AlertCircle className="h-8 w-8 text-red-600" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900">
          Failed to load employees
        </h2>
        <p className="max-w-md text-sm text-gray-500">{fetchError}</p>
        <Button
          variant="outline"
          onClick={() => {
            setFetchError(null);
            setFetchLoading(true);
            // Re-trigger the effect by toggling error state
            window.location.reload();
          }}
        >
          Try Again
        </Button>
      </div>
    );
  }

  /* ---- Filtering & searching ---- */
  const filtered = employees.filter((emp) => {
    // Status filter
    if (filter !== "all" && emp.status !== filter) return false;

    // Search filter (name or department, case-insensitive)
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        emp.name.toLowerCase().includes(q) ||
        emp.department.toLowerCase().includes(q)
      );
    }

    return true;
  });

  /* ---- Pagination ---- */
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paginated = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

  /* ---- Action handler (dropdown menu) ---- */
  const handleAction = async (action: string, employeeId: string) => {
    const emp = employees.find((e) => e.id === employeeId);
    if (!emp) return;

    if (action === "offboard") {
      setOffboardTarget(emp);
      return;
    }

    if (action === "make_admin" || action === "make_employee") {
      const nextRole = action === "make_admin" ? "admin" : "employee";
      try {
        await api.employees.update(employeeId, { role: nextRole });
        toast({
          variant: "success",
          title: nextRole === "admin" ? "Admin access granted" : "Admin access revoked",
          description:
            nextRole === "admin"
              ? `${emp.name} is now an admin.`
              : `${emp.name} is now a regular employee.`,
        });
        await loadEmployees();
      } catch (err) {
        toast({
          variant: "error",
          title: "Failed to change role",
          description: err instanceof Error ? err.message : "Please try again.",
        });
      }
      return;
    }

    if (action === "force_logout") {
      try {
        await api.employees.forceLogout(employeeId);
        toast({
          variant: "warning",
          title: "Session Revoked",
          description: `All active sessions for ${emp.name} have been terminated.`,
        });
      } catch (err) {
        toast({
          variant: "error",
          title: "Failed to revoke sessions",
          description: err instanceof Error ? err.message : "Please try again.",
        });
      }
    }
  };

  /* ---- Offboard confirm ---- */
  const handleOffboardConfirm = async (data: {
    lastWorkingDay: string;
    reason: string;
    notes?: string;
  }) => {
    if (!offboardTarget) return;
    try {
      await api.employees.offboard(offboardTarget.id, data);
      toast({
        variant: "success",
        title: "Employee Offboarded",
        description: `${offboardTarget.name} has been offboarded successfully.`,
      });
      setOffboardTarget(null);
      await loadEmployees();
    } catch (err) {
      toast({
        variant: "error",
        title: "Failed to offboard employee",
        description: err instanceof Error ? err.message : "Please try again.",
      });
      throw err; // keep dialog open + form values
    }
  };

  /* ---- Filter change resets page ---- */
  const handleFilterChange = (key: FilterKey) => {
    setFilter(key);
    setCurrentPage(1);
  };

  const handleSearch = (value: string) => {
    setSearch(value);
    setCurrentPage(1);
  };

  return (
    <div className="space-y-6">
      {/* ---- Header ---- */}
      <div className="flex items-end justify-between mb-[18px] gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight m-0 mb-1">
            Employee Directory
          </h1>
          <p className="text-xs text-gray-500">
            Manage and view all employees across the organization.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Import CSV */}
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" />
            Import CSV
          </Button>

          {/* Export CSV */}
          <Button variant="outline" onClick={() => setExportOpen(true)}>
            <Download className="h-4 w-4" />
            Export CSV
          </Button>

          {/* Add Employee */}
          <Link href="/employees/new">
            <Button>
              <UserPlus className="h-4 w-4" />
              Add Employee
            </Button>
          </Link>
        </div>
      </div>

      {/* ---- Search + Filters ---- */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput
          className="w-full sm:max-w-xs"
          placeholder="Search by name or department..."
          value={search}
          onChange={handleSearch}
        />

        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map(({ key, label }) => (
            <Button
              key={key}
              size="sm"
              variant={filter === key ? "default" : "outline"}
              onClick={() => handleFilterChange(key)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {/* ---- Table / Cards ---- */}
      {paginated.length > 0 ? (
        <EmployeeTable employees={paginated} onAction={handleAction} />
      ) : (
        <EmptyState
          icon={Users}
          title="No employees found"
          description={
            search || filter !== "all"
              ? "Try adjusting your search or filter criteria."
              : "Get started by adding your first employee."
          }
          action={
            !search && filter === "all" ? (
              <Link href="/employees/new">
                <Button>
                  <UserPlus className="h-4 w-4" />
                  Add Employee
                </Button>
              </Link>
            ) : undefined
          }
        />
      )}

      {/* ---- Pagination ---- */}
      {filtered.length > PAGE_SIZE && (
        <Pagination
          currentPage={safePage}
          totalPages={totalPages}
          totalItems={filtered.length}
          pageSize={PAGE_SIZE}
          onPageChange={setCurrentPage}
        />
      )}

      {/* ---- Offboard Dialog ---- */}
      {offboardTarget && (
        <OffboardDialog
          open={!!offboardTarget}
          onOpenChange={(open) => {
            if (!open) setOffboardTarget(null);
          }}
          employeeName={offboardTarget.name}
          employeeId={offboardTarget.employeeId}
          onConfirm={handleOffboardConfirm}
        />
      )}

      {/* Import / Export dialogs */}
      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={loadEmployees}
      />
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
    </div>
  );
}
