"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
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
import { Select } from "@/components/ui/select";
import { SearchInput } from "@/components/ui/search-input";
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
  Plus,
  Trash2,
  Save,
  Pencil,
  ArrowLeft,
  Shield,
  CalendarDays,
  UserCog,
  Loader2,
} from "lucide-react";
import Link from "next/link";

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

interface LeaveType {
  id: string;
  name: string;
  key: string;
}

interface DefaultAllocation {
  leaveTypeId: string;
  annualDays: number;
}

interface EmployeeOverride {
  id: string;
  employeeId: string;
  employeeName: string;
  leaveTypeId: string;
  customDays: number;
}

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function getDefaultDays(
  defaults: DefaultAllocation[],
  leaveTypeId: string,
): number {
  return defaults.find((d) => d.leaveTypeId === leaveTypeId)?.annualDays ?? 0;
}

// ---------------------------------------------------------------------------
//  Component
// ---------------------------------------------------------------------------

export default function LeaveAllocationPage() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();

  // State
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [defaults, setDefaults] = useState<DefaultAllocation[]>([]);
  const [overrides, setOverrides] = useState<EmployeeOverride[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [employeeOptions, setEmployeeOptions] = useState<
    { label: string; value: string }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Track dirty allocations for save
  const [dirtyAllocations, setDirtyAllocations] = useState<Set<string>>(new Set());

  // Fetch from API
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [leavesResult, empResult] = await Promise.all([
        api.leaves.list(),
        api.employees.list(),
      ]);

      const ltData = leavesResult.leaveTypes ?? [];
      setLeaveTypes(ltData.map((lt: Record<string, unknown>) => ({
        id: lt.id as string,
        name: lt.name as string,
        key: lt.key as string,
      })));

      const allocData = leavesResult.leaveAllocations ?? [];
      setDefaults(allocData.map((a: Record<string, unknown>) => ({
        leaveTypeId: a.leave_type_id as string,
        annualDays: Number(a.annual_days ?? 0),
      })));

      const empLookup: Record<string, string> = {};
      (empResult.employees ?? []).forEach((e: any) => { empLookup[e.id] = e.name; });

      const ovrData = leavesResult.leaveOverrides ?? [];
      setOverrides(ovrData.map((o: Record<string, unknown>) => ({
        id: o.id as string,
        employeeId: o.employee_id as string,
        employeeName: empLookup[(o.employee_id as string)] ?? 'Unknown',
        leaveTypeId: o.leave_type_id as string,
        customDays: Number(o.custom_days ?? 0),
      })));

      const empData = (empResult.employees ?? []).filter((e: any) => e.status === 'active');
      setEmployeeOptions(empData.map((e: Record<string, unknown>) => ({
        label: e.name as string,
        value: e.id as string,
      })));

      setDirtyAllocations(new Set());
    } catch (err) {
      toast({ variant: "error", title: "Failed to load leave settings", description: String(err) });
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Dialog state
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [formEmployeeId, setFormEmployeeId] = useState("");
  const [formLeaveTypeId, setFormLeaveTypeId] = useState("");
  const [formCustomDays, setFormCustomDays] = useState("");

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedOverride, setSelectedOverride] = useState<EmployeeOverride | null>(null);

  const [leaveTypeDialogOpen, setLeaveTypeDialogOpen] = useState(false);
  const [leaveTypeDialogMode, setLeaveTypeDialogMode] = useState<"add" | "edit">("add");
  const [editingLeaveType, setEditingLeaveType] = useState<LeaveType | null>(null);
  const [ltFormName, setLtFormName] = useState("");
  const [ltFormKey, setLtFormKey] = useState("");
  const [ltFormDays, setLtFormDays] = useState("12");

  const [deleteLtDialogOpen, setDeleteLtDialogOpen] = useState(false);
  const [deletingLeaveType, setDeletingLeaveType] = useState<LeaveType | null>(null);

  // Derived
  const getLeaveTypeName = (id: string): string =>
    leaveTypes.find((lt) => lt.id === id)?.name ?? id;

  const leaveTypeOptions = useMemo(
    () => leaveTypes.map((lt) => ({ label: lt.name, value: lt.id })),
    [leaveTypes],
  );

  // Admin guard
  if (!isAdmin) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <Shield className="mx-auto mb-4 h-12 w-12 text-gray-300" />
          <h2 className="text-lg font-semibold text-gray-900">Access Restricted</h2>
          <p className="mt-1 text-sm text-gray-500">
            Only administrators can manage leave allocations.
          </p>
        </div>
      </div>
    );
  }

  // Handlers -- Default allocations
  const handleDefaultChange = (leaveTypeId: string, value: string) => {
    const days = Math.max(0, parseInt(value, 10) || 0);
    setDefaults((prev) =>
      prev.map((d) =>
        d.leaveTypeId === leaveTypeId ? { ...d, annualDays: days } : d,
      ),
    );
    setDirtyAllocations((prev) => new Set(prev).add(leaveTypeId));
  };

  const handleSaveAllocations = async () => {
    if (busy || dirtyAllocations.size === 0) return;
    setBusy(true);
    try {
      const allocations = defaults
        .filter((d) => dirtyAllocations.has(d.leaveTypeId))
        .map((d) => ({ leave_type_id: d.leaveTypeId, annual_days: d.annualDays }));
      await api.leaveSettings.bulkUpdateAllocations(allocations);
      toast({ variant: "success", title: "Saved", description: `Updated ${allocations.length} allocation(s).` });
      setDirtyAllocations(new Set());
    } catch (err) {
      toast({ variant: "error", title: "Failed to save allocations", description: String(err) });
    }
    setBusy(false);
  };

  // Handlers -- Overrides
  const resetOverrideForm = () => {
    setFormEmployeeId("");
    setFormLeaveTypeId("");
    setFormCustomDays("");
  };

  const handleAddOverride = async () => {
    if (!formEmployeeId || !formLeaveTypeId || !formCustomDays || busy) return;
    setBusy(true);
    try {
      await api.leaveSettings.createOverride({
        employee_id: formEmployeeId,
        leave_type_id: formLeaveTypeId,
        custom_days: Math.max(0, parseInt(formCustomDays, 10) || 0),
      });
      toast({ variant: "success", title: "Override added" });
      resetOverrideForm();
      setAddDialogOpen(false);
      await fetchData();
    } catch (err) {
      toast({ variant: "error", title: "Failed to add override", description: String(err) });
    }
    setBusy(false);
  };

  const handleDeleteOverrideOpen = (override: EmployeeOverride) => {
    setSelectedOverride(override);
    setDeleteDialogOpen(true);
  };

  const handleDeleteOverrideConfirm = async () => {
    if (!selectedOverride || busy) return;
    setBusy(true);
    try {
      await api.leaveSettings.deleteOverride(selectedOverride.id);
      toast({ variant: "success", title: "Override removed", description: selectedOverride.employeeName });
      setSelectedOverride(null);
      setDeleteDialogOpen(false);
      await fetchData();
    } catch (err) {
      toast({ variant: "error", title: "Failed to remove override", description: String(err) });
    }
    setBusy(false);
  };

  // Handlers -- Leave Type CRUD
  const openAddLeaveType = () => {
    setLeaveTypeDialogMode("add");
    setEditingLeaveType(null);
    setLtFormName("");
    setLtFormKey("");
    setLtFormDays("12");
    setLeaveTypeDialogOpen(true);
  };

  const openEditLeaveType = (lt: LeaveType) => {
    setLeaveTypeDialogMode("edit");
    setEditingLeaveType(lt);
    setLtFormName(lt.name);
    setLtFormKey(lt.key);
    const alloc = defaults.find((d) => d.leaveTypeId === lt.id);
    setLtFormDays(String(alloc?.annualDays ?? 0));
    setLeaveTypeDialogOpen(true);
  };

  const handleLeaveTypeSubmit = async () => {
    if (!ltFormName.trim() || !ltFormKey.trim() || busy) return;
    setBusy(true);
    const days = Math.max(0, parseInt(ltFormDays, 10) || 0);

    try {
      if (leaveTypeDialogMode === "add") {
        await api.leaveSettings.createLeaveType({
          name: ltFormName.trim(),
          key: ltFormKey.trim().toLowerCase().replace(/\s+/g, "_"),
          annual_days: days,
        });
        toast({ variant: "success", title: "Leave type added", description: `"${ltFormName.trim()}" with ${days} days/year.` });
      } else if (editingLeaveType) {
        await api.leaveSettings.updateLeaveType({
          id: editingLeaveType.id,
          name: ltFormName.trim(),
          key: ltFormKey.trim().toLowerCase().replace(/\s+/g, "_"),
        });
        // Also update allocation if days changed
        const currentAlloc = defaults.find((d) => d.leaveTypeId === editingLeaveType.id);
        if (!currentAlloc || currentAlloc.annualDays !== days) {
          await api.leaveSettings.updateAllocation({
            leave_type_id: editingLeaveType.id,
            annual_days: days,
          });
        }
        toast({ variant: "success", title: "Leave type updated", description: `"${ltFormName.trim()}" saved.` });
      }
      setLeaveTypeDialogOpen(false);
      await fetchData();
    } catch (err) {
      toast({ variant: "error", title: "Failed to save leave type", description: String(err) });
    }
    setBusy(false);
  };

  const openDeleteLeaveType = (lt: LeaveType) => {
    setDeletingLeaveType(lt);
    setDeleteLtDialogOpen(true);
  };

  const handleDeleteLeaveType = async () => {
    if (!deletingLeaveType || busy) return;
    setBusy(true);
    try {
      await api.leaveSettings.deleteLeaveType(deletingLeaveType.id);
      toast({ variant: "success", title: "Leave type deleted", description: `"${deletingLeaveType.name}" and all related overrides removed.` });
      setDeletingLeaveType(null);
      setDeleteLtDialogOpen(false);
      await fetchData();
    } catch (err) {
      toast({ variant: "error", title: "Failed to delete leave type", description: String(err) });
    }
    setBusy(false);
  };

  // Filtered overrides
  const filteredOverrides = overrides.filter((o) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      o.employeeName.toLowerCase().includes(q) ||
      getLeaveTypeName(o.leaveTypeId).toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/settings">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight m-0 mb-1">
            Leave Allocation Settings
          </h1>
          <p className="text-xs text-gray-500">
            Configure default annual leave quotas and per-employee overrides.
          </p>
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/*  Default Allocations                                             */}
      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHeader className="justify-between">
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-blue-600" />
              Leave Types &amp; Default Allocations
            </CardTitle>
            <Button size="sm" disabled={busy} onClick={openAddLeaveType}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add Leave Type
            </Button>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Leave Type</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead className="w-36">Annual Days</TableHead>
                  <TableHead className="w-28 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 4 }, (_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-8 w-20 rounded-md" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="ml-auto h-8 w-16 rounded" /></TableCell>
                    </TableRow>
                  ))
                ) : defaults.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-12 text-center">
                      <CalendarDays className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                      <p className="text-sm text-gray-500">No leave types configured yet.</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  defaults.map((alloc) => {
                    const lt = leaveTypes.find((t) => t.id === alloc.leaveTypeId);
                    if (!lt) return null;
                    return (
                      <TableRow key={alloc.leaveTypeId}>
                        <TableCell>
                          <span className="text-xs font-medium text-gray-900">
                            {lt.name}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="font-mono text-[11px] text-gray-500">
                            {lt.key}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={0}
                            value={String(alloc.annualDays)}
                            onChange={(e) =>
                              handleDefaultChange(alloc.leaveTypeId, e.target.value)
                            }
                            className="w-24"
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={busy}
                              onClick={() => openEditLeaveType(lt)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={busy}
                              className="text-red-600 hover:bg-red-50 hover:text-red-700"
                              onClick={() => openDeleteLeaveType(lt)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          <div className="mt-4 flex justify-end">
            <Button
              onClick={handleSaveAllocations}
              disabled={busy || dirtyAllocations.size === 0}
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Save className="mr-2 h-4 w-4" />
              Save Changes
              {dirtyAllocations.size > 0 && (
                <span className="ml-1.5 rounded-full bg-white/20 px-1.5 py-0.5 text-[10px]">
                  {dirtyAllocations.size}
                </span>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/*  Employee Overrides                                              */}
      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHeader className="flex-wrap justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <UserCog className="h-5 w-5 text-violet-600" />
              Employee Overrides
            </CardTitle>
            <div className="flex items-center gap-3">
              <SearchInput
                placeholder="Search overrides..."
                value={searchQuery}
                onChange={setSearchQuery}
                className="w-64"
              />
              <Button
                disabled={busy}
                onClick={() => {
                  resetOverrideForm();
                  setAddDialogOpen(true);
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Override
              </Button>
            </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee Name</TableHead>
                  <TableHead>Leave Type</TableHead>
                  <TableHead>Custom Days</TableHead>
                  <TableHead>Default Days</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOverrides.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-12 text-center">
                      <UserCog className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                      <p className="text-sm text-gray-500">
                        {searchQuery
                          ? "No overrides match your search."
                          : "No employee overrides configured yet."}
                      </p>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredOverrides.map((override) => {
                    const defaultDays = getDefaultDays(defaults, override.leaveTypeId);
                    const diff = override.customDays - defaultDays;
                    return (
                      <TableRow key={override.id}>
                        <TableCell>
                          <span className="text-xs font-medium text-gray-900">
                            {override.employeeName}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-gray-600">
                          {getLeaveTypeName(override.leaveTypeId)}
                        </TableCell>
                        <TableCell>
                          <span className="text-xs font-semibold text-gray-900">
                            {override.customDays}
                          </span>
                          {diff !== 0 && (
                            <span
                              className={`ml-2 text-xs font-medium ${
                                diff > 0 ? "text-green-600" : "text-red-600"
                              }`}
                            >
                              ({diff > 0 ? "+" : ""}
                              {diff})
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-gray-500">
                          {defaultDays}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              className="text-red-600 hover:bg-red-50 hover:text-red-700"
                              onClick={() => handleDeleteOverrideOpen(override)}
                            >
                              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                              Remove
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ---- Add Override Dialog ---- */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Employee Override</DialogTitle>
            <DialogDescription>
              Set a custom leave allocation for a specific employee.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <Select label="Employee" placeholder="Select employee" options={employeeOptions} value={formEmployeeId} onChange={(e) => setFormEmployeeId(e.target.value)} />
            <Select label="Leave Type" placeholder="Select leave type" options={leaveTypeOptions} value={formLeaveTypeId} onChange={(e) => setFormLeaveTypeId(e.target.value)} />
            <Input label="Custom Days" type="number" min={0} placeholder="e.g. 18" value={formCustomDays} onChange={(e) => setFormCustomDays(e.target.value)} />
            {formLeaveTypeId && (
              <p className="text-xs text-gray-500">
                Default: <span className="font-semibold">{getDefaultDays(defaults, formLeaveTypeId)} days</span>
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { resetOverrideForm(); setAddDialogOpen(false); }}>Cancel</Button>
            <Button onClick={handleAddOverride} disabled={!formEmployeeId || !formLeaveTypeId || !formCustomDays || busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Plus className="mr-2 h-4 w-4" />
              Add Override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Delete Override Dialog ---- */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Override</DialogTitle>
            <DialogDescription>
              Remove the custom allocation for{" "}
              <span className="font-semibold text-gray-900">{selectedOverride?.employeeName}</span>
              {" "}({getLeaveTypeName(selectedOverride?.leaveTypeId ?? "")})?
              They will revert to the default of{" "}
              <span className="font-semibold">{getDefaultDays(defaults, selectedOverride?.leaveTypeId ?? "")} days</span>.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setSelectedOverride(null); setDeleteDialogOpen(false); }}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteOverrideConfirm} disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Trash2 className="mr-2 h-4 w-4" />
              Remove Override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Add/Edit Leave Type Dialog ---- */}
      <Dialog open={leaveTypeDialogOpen} onOpenChange={setLeaveTypeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{leaveTypeDialogMode === "add" ? "Add Leave Type" : "Edit Leave Type"}</DialogTitle>
            <DialogDescription>
              {leaveTypeDialogMode === "add"
                ? "Create a new leave type with a default annual allocation."
                : "Update the leave type name, key, or default days."}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <Input label="Leave Type Name" placeholder="e.g. Compensatory Off" value={ltFormName} onChange={(e) => setLtFormName(e.target.value)} />
            <Input label="Key (identifier)" placeholder="e.g. comp_off" value={ltFormKey} onChange={(e) => setLtFormKey(e.target.value)} />
            <Input label="Default Annual Days" type="number" min={0} placeholder="e.g. 12" value={ltFormDays} onChange={(e) => setLtFormDays(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLeaveTypeDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleLeaveTypeSubmit} disabled={!ltFormName.trim() || !ltFormKey.trim() || busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {leaveTypeDialogMode === "add" ? (
                <><Plus className="mr-2 h-4 w-4" />Add Leave Type</>
              ) : (
                <><Save className="mr-2 h-4 w-4" />Save Changes</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Delete Leave Type Dialog ---- */}
      <Dialog open={deleteLtDialogOpen} onOpenChange={setDeleteLtDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Leave Type</DialogTitle>
            <DialogDescription>
              Delete <span className="font-semibold text-gray-900">{deletingLeaveType?.name}</span>?
              This removes all allocations and employee overrides for this type. Cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeletingLeaveType(null); setDeleteLtDialogOpen(false); }}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteLeaveType} disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Trash2 className="mr-2 h-4 w-4" />
              Delete Leave Type
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
