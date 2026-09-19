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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Plus,
  Pencil,
  Trash2,
  Calendar,
  ArrowLeft,
  Shield,
  Loader2,
} from "lucide-react";
import Link from "next/link";

// ---------------------------------------------------------------------------
//  Types -- use lowercase to match DB values
// ---------------------------------------------------------------------------

type HolidayType = "mandatory" | "optional";

interface Holiday {
  id: string;
  name: string;
  date: string;
  type: HolidayType;
  financial_year: string;
}

// ---------------------------------------------------------------------------
//  Financial year helpers
// ---------------------------------------------------------------------------

function getCurrentFY(): string {
  const now = new Date();
  const startYear = now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
  return `${startYear}-${startYear + 1}`;
}

const FY_OPTIONS = [
  { label: "2024-2025", value: "2024-2025" },
  { label: "2025-2026", value: "2025-2026" },
  { label: "2026-2027", value: "2026-2027" },
  { label: "2027-2028", value: "2027-2028" },
];

const HOLIDAY_TYPE_OPTIONS = [
  { label: "Mandatory", value: "mandatory" },
  { label: "Optional", value: "optional" },
];

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function typeLabel(type: string): string {
  return type === "mandatory" ? "Mandatory" : "Optional";
}

// ---------------------------------------------------------------------------
//  Component
// ---------------------------------------------------------------------------

export default function HolidaysPage() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();

  // State
  const [selectedFY, setSelectedFY] = useState(getCurrentFY);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedHoliday, setSelectedHoliday] = useState<Holiday | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formName, setFormName] = useState("");
  const [formDate, setFormDate] = useState("");
  const [formType, setFormType] = useState<string>("mandatory");

  // Fetch holidays from API
  const fetchHolidays = useCallback(async () => {
    setLoading(true);
    try {
      const { holidays: data } = await api.holidays.list({ financial_year: selectedFY });
      setHolidays(
        (data ?? []).map((h: Record<string, unknown>) => ({
          id: h.id as string,
          name: h.name as string,
          date: h.date as string,
          type: (h.type as HolidayType) ?? "mandatory",
          financial_year: (h.financial_year as string) ?? selectedFY,
        })),
      );
    } catch (err) {
      toast({ variant: "error", title: "Failed to load holidays", description: String(err) });
      setHolidays([]);
    }
    setLoading(false);
  }, [selectedFY, toast]);

  useEffect(() => {
    fetchHolidays();
  }, [fetchHolidays]);

  const mandatoryCount = holidays.filter((h) => h.type === "mandatory").length;
  const optionalCount = holidays.filter((h) => h.type === "optional").length;

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
            Only administrators can manage the holiday calendar.
          </p>
        </div>
      </div>
    );
  }

  // Helpers
  const resetForm = () => {
    setFormName("");
    setFormDate("");
    setFormType("mandatory");
  };

  // Handlers
  const handleAddOpen = () => {
    resetForm();
    setAddDialogOpen(true);
  };

  const handleAdd = async () => {
    if (!formName.trim() || !formDate) return;
    setSaving(true);
    try {
      await api.holidays.create({
        name: formName.trim(),
        date: formDate,
        type: formType,
        financial_year: selectedFY,
      });
      toast({ variant: "success", title: "Holiday added", description: formName.trim() });
      resetForm();
      setAddDialogOpen(false);
      await fetchHolidays();
    } catch (err) {
      toast({ variant: "error", title: "Failed to add holiday", description: String(err) });
    }
    setSaving(false);
  };

  const handleEditOpen = (holiday: Holiday) => {
    setSelectedHoliday(holiday);
    setFormName(holiday.name);
    setFormDate(holiday.date);
    setFormType(holiday.type);
    setEditDialogOpen(true);
  };

  const handleEditSave = async () => {
    if (!formName.trim() || !formDate || !selectedHoliday) return;
    setSaving(true);
    try {
      await api.holidays.update({
        id: selectedHoliday.id,
        name: formName.trim(),
        date: formDate,
        type: formType,
      });
      toast({ variant: "success", title: "Holiday updated", description: formName.trim() });
      resetForm();
      setSelectedHoliday(null);
      setEditDialogOpen(false);
      await fetchHolidays();
    } catch (err) {
      toast({ variant: "error", title: "Failed to update holiday", description: String(err) });
    }
    setSaving(false);
  };

  const handleDeleteOpen = (holiday: Holiday) => {
    setSelectedHoliday(holiday);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!selectedHoliday) return;
    setSaving(true);
    try {
      await api.holidays.delete(selectedHoliday.id);
      toast({ variant: "success", title: "Holiday deleted", description: selectedHoliday.name });
      setSelectedHoliday(null);
      setDeleteDialogOpen(false);
      await fetchHolidays();
    } catch (err) {
      toast({ variant: "error", title: "Failed to delete holiday", description: String(err) });
    }
    setSaving(false);
  };

  // Sort holidays by date
  const sortedHolidays = [...holidays].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

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
              Holiday Calendar
            </h1>
            <p className="text-xs text-gray-500">
              {holidays.length} holidays &middot; {mandatoryCount}{" "}
              mandatory &middot; {optionalCount} optional
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="w-40">
            <Select
              options={FY_OPTIONS}
              value={selectedFY}
              onChange={(e) => setSelectedFY(e.target.value)}
            />
          </div>
          <Button onClick={handleAddOpen}>
            <Plus className="mr-2 h-4 w-4" />
            Add Holiday
          </Button>
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Holiday Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 6 }, (_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-44" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="ml-auto h-8 w-16 rounded" /></TableCell>
                    </TableRow>
                  ))
                ) : sortedHolidays.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-12 text-center">
                      <Calendar className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                      <p className="text-sm text-gray-500">
                        No holidays configured for {selectedFY}. Add your first
                        holiday.
                      </p>
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedHolidays.map((holiday) => (
                    <TableRow key={holiday.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50">
                            <Calendar className="h-4 w-4 text-emerald-600" />
                          </div>
                          <span className="font-mono text-xs text-gray-700">
                            {formatDate(holiday.date)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs font-medium text-gray-900">
                          {holiday.name}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            holiday.type === "mandatory"
                              ? "destructive"
                              : "default"
                          }
                        >
                          {typeLabel(holiday.type)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEditOpen(holiday)}
                          >
                            <Pencil className="mr-1.5 h-3.5 w-3.5" />
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 hover:bg-red-50 hover:text-red-700"
                            onClick={() => handleDeleteOpen(holiday)}
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

      {/* ---------------------------------------------------------------- */}
      {/*  Add Holiday Dialog                                              */}
      {/* ---------------------------------------------------------------- */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Holiday</DialogTitle>
            <DialogDescription>
              Add a new holiday to the {selectedFY} calendar.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <Input
              label="Holiday Name"
              placeholder="e.g. Republic Day"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
            />

            <Input
              label="Date"
              type="date"
              value={formDate}
              onChange={(e) => setFormDate(e.target.value)}
            />

            <Select
              label="Type"
              options={HOLIDAY_TYPE_OPTIONS}
              value={formType}
              onChange={(e) => setFormType(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                resetForm();
                setAddDialogOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAdd}
              disabled={!formName.trim() || !formDate || saving}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Plus className="mr-2 h-4 w-4" />
              Add Holiday
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------------------------------------------------------- */}
      {/*  Edit Holiday Dialog                                             */}
      {/* ---------------------------------------------------------------- */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Holiday</DialogTitle>
            <DialogDescription>
              Update the holiday details.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <Input
              label="Holiday Name"
              placeholder="Holiday name"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
            />

            <Input
              label="Date"
              type="date"
              value={formDate}
              onChange={(e) => setFormDate(e.target.value)}
            />

            <Select
              label="Type"
              options={HOLIDAY_TYPE_OPTIONS}
              value={formType}
              onChange={(e) => setFormType(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                resetForm();
                setSelectedHoliday(null);
                setEditDialogOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleEditSave}
              disabled={!formName.trim() || !formDate || saving}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------------------------------------------------------- */}
      {/*  Delete Confirmation Dialog                                      */}
      {/* ---------------------------------------------------------------- */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Holiday</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove{" "}
              <span className="font-semibold text-gray-900">
                {selectedHoliday?.name}
              </span>{" "}
              from the holiday calendar? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSelectedHoliday(null);
                setDeleteDialogOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteConfirm} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
