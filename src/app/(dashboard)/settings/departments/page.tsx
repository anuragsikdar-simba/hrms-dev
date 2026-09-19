"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import {
  Card,
  CardContent,
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
  Plus,
  Pencil,
  Trash2,
  Building2,
  ArrowLeft,
  Shield,
  Loader2,
} from "lucide-react";
import Link from "next/link";

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

interface Department {
  id: string;
  name: string;
  employeeCount: number;
}

// ---------------------------------------------------------------------------
//  Component
// ---------------------------------------------------------------------------

export default function DepartmentsPage() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();

  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedDept, setSelectedDept] = useState<Department | null>(null);
  const [deptName, setDeptName] = useState("");

  const fetchDepartments = useCallback(async () => {
    try {
      const { departments: data } = await api.departments.list();
      setDepartments(data ?? []);
    } catch (err) {
      toast({ variant: "error", title: "Failed to load departments", description: String(err) });
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => { fetchDepartments(); }, [fetchDepartments]);

  // Admin guard
  if (!isAdmin) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <Shield className="mx-auto mb-4 h-12 w-12 text-gray-300" />
          <h2 className="text-lg font-semibold text-gray-900">Access Restricted</h2>
          <p className="mt-1 text-sm text-gray-500">Only administrators can manage departments.</p>
        </div>
      </div>
    );
  }

  // Handlers
  const handleAdd = async () => {
    if (!deptName.trim() || busy) return;
    setBusy(true);
    try {
      await api.departments.create(deptName.trim());
      toast({ variant: "success", title: "Department created", description: deptName.trim() });
      setDeptName("");
      setAddDialogOpen(false);
      await fetchDepartments();
    } catch (err) {
      toast({ variant: "error", title: "Failed to create department", description: String(err) });
    }
    setBusy(false);
  };

  const handleEditOpen = (dept: Department) => {
    setSelectedDept(dept);
    setDeptName(dept.name);
    setEditDialogOpen(true);
  };

  const handleEditSave = async () => {
    if (!deptName.trim() || !selectedDept || busy) return;
    setBusy(true);
    try {
      await api.departments.update(selectedDept.id, deptName.trim());
      toast({ variant: "success", title: "Department updated", description: deptName.trim() });
      setDeptName("");
      setSelectedDept(null);
      setEditDialogOpen(false);
      await fetchDepartments();
    } catch (err) {
      toast({ variant: "error", title: "Failed to update department", description: String(err) });
    }
    setBusy(false);
  };

  const handleDeleteOpen = (dept: Department) => {
    setSelectedDept(dept);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!selectedDept || busy) return;
    setBusy(true);
    try {
      await api.departments.remove(selectedDept.id);
      toast({ variant: "success", title: "Department deleted", description: selectedDept.name });
      setSelectedDept(null);
      setDeleteDialogOpen(false);
      await fetchDepartments();
    } catch (err) {
      toast({ variant: "error", title: "Failed to delete department", description: String(err) });
    }
    setBusy(false);
  };

  const totalEmployees = departments.reduce((sum, d) => sum + d.employeeCount, 0);

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
            <h1 className="text-[22px] font-semibold tracking-tight m-0 mb-1">Departments</h1>
            <p className="text-xs text-gray-500">
              {departments.length} departments &middot; {totalEmployees} employees
            </p>
          </div>
        </div>

        <Button disabled={busy} onClick={() => setAddDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Department
        </Button>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Department Name</TableHead>
                  <TableHead>Employee Count</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }, (_, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Skeleton className="h-9 w-9 rounded-lg" />
                          <Skeleton className="h-4 w-32" />
                        </div>
                      </TableCell>
                      <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="ml-auto h-8 w-16 rounded" /></TableCell>
                    </TableRow>
                  ))
                ) : departments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="py-12 text-center">
                      <Building2 className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                      <p className="text-sm text-gray-500">No departments found. Add your first department.</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  departments.map((dept) => (
                    <TableRow key={dept.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50">
                            <Building2 className="h-4 w-4 text-blue-600" />
                          </div>
                          <span className="text-xs font-medium text-gray-900">{dept.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-gray-600">
                        {dept.employeeCount} employees
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">
                          <Button variant="ghost" size="sm" disabled={busy} onClick={() => handleEditOpen(dept)}>
                            <Pencil className="mr-1.5 h-3.5 w-3.5" />
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            className="text-red-600 hover:bg-red-50 hover:text-red-700"
                            onClick={() => handleDeleteOpen(dept)}
                          >
                            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                            Delete
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

      {/* Add Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Department</DialogTitle>
            <DialogDescription>Create a new department in your organization.</DialogDescription>
          </DialogHeader>
          <div className="mt-4">
            <Input
              label="Department Name"
              placeholder="e.g. Product Management"
              value={deptName}
              onChange={(e) => setDeptName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeptName(""); setAddDialogOpen(false); }}>Cancel</Button>
            <Button onClick={handleAdd} disabled={!deptName.trim() || busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Plus className="mr-2 h-4 w-4" />
              Add Department
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Department</DialogTitle>
            <DialogDescription>Update the department name.</DialogDescription>
          </DialogHeader>
          <div className="mt-4">
            <Input
              label="Department Name"
              placeholder="Department name"
              value={deptName}
              onChange={(e) => setDeptName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleEditSave()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeptName(""); setSelectedDept(null); setEditDialogOpen(false); }}>Cancel</Button>
            <Button onClick={handleEditSave} disabled={!deptName.trim() || busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Department</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{" "}
              <span className="font-semibold text-gray-900">{selectedDept?.name}</span>?
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {selectedDept && selectedDept.employeeCount > 0 && (
            <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              <strong>Warning:</strong> This department has {selectedDept.employeeCount} employees. They will need to be reassigned.
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setSelectedDept(null); setDeleteDialogOpen(false); }}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteConfirm} disabled={busy}>
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
