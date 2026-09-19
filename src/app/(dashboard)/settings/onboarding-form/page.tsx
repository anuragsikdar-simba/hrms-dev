"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/components/ui/toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  Pencil,
  Trash2,
  Plus,
  Save,
  GripVertical,
  ShieldAlert,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  Loader2,
} from "lucide-react";
import api from "@/lib/api-client";

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

type FieldType = "Text" | "Number" | "Date" | "Dropdown" | "File Upload";

interface FormField {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  editablePostOnboarding: boolean;
  dropdownOptions?: string[];
  deletable: boolean;
  /** For File Upload: accepted mime extensions */
  acceptedFormats?: string;
  /** For File Upload: max file size in bytes */
  maxFileSize?: number;
}

interface FormSection {
  id: string;
  title: string;
  description: string;
  collapsed: boolean;
  deletable: boolean;
  fields: FormField[];
}

// ---------------------------------------------------------------------------
//  Default sections (used when no config exists in DB)
// ---------------------------------------------------------------------------

const DEFAULT_SECTIONS: FormSection[] = [
  {
    id: "sec_personal",
    title: "Personal Information",
    description: "Basic personal details of the employee",
    collapsed: false,
    deletable: false,
    fields: [
      { id: "full_name", label: "Full Name", type: "Text", required: true, editablePostOnboarding: false, deletable: false },
      { id: "personal_email", label: "Personal Email", type: "Text", required: true, editablePostOnboarding: true, deletable: false },
      { id: "mobile_number", label: "Mobile Number", type: "Text", required: true, editablePostOnboarding: true, deletable: false },
      { id: "date_of_birth", label: "Date of Birth", type: "Date", required: true, editablePostOnboarding: false, deletable: false },
      { id: "gender", label: "Gender", type: "Dropdown", required: true, editablePostOnboarding: false, dropdownOptions: ["Male", "Female", "Other"], deletable: false },
      { id: "blood_group", label: "Blood Group", type: "Dropdown", required: true, editablePostOnboarding: false, dropdownOptions: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"], deletable: false },
    ],
  },
  {
    id: "sec_address",
    title: "Address",
    description: "Permanent and current address details",
    collapsed: false,
    deletable: false,
    fields: [
      { id: "permanent_address", label: "Permanent Address", type: "Text", required: true, editablePostOnboarding: false, deletable: false },
      { id: "current_address", label: "Current Address", type: "Text", required: true, editablePostOnboarding: true, deletable: false },
    ],
  },
  {
    id: "sec_emergency",
    title: "Emergency Contact",
    description: "Emergency contact person details",
    collapsed: false,
    deletable: false,
    fields: [
      { id: "emergency_contact_name", label: "Contact Name", type: "Text", required: true, editablePostOnboarding: true, deletable: false },
      { id: "emergency_contact_phone", label: "Contact Phone", type: "Text", required: true, editablePostOnboarding: true, deletable: false },
      { id: "emergency_contact_relationship", label: "Relationship", type: "Dropdown", required: true, editablePostOnboarding: true, dropdownOptions: ["Spouse", "Parent", "Sibling", "Friend", "Other"], deletable: false },
    ],
  },
  {
    id: "sec_identity",
    title: "Identity Documents",
    description: "Government identity proofs",
    collapsed: false,
    deletable: false,
    fields: [
      { id: "pan_number", label: "PAN Number", type: "Text", required: true, editablePostOnboarding: false, deletable: false },
      { id: "aadhaar_number", label: "Aadhaar Number", type: "Text", required: true, editablePostOnboarding: false, deletable: false },
    ],
  },
  {
    id: "sec_bank",
    title: "Bank Details",
    description: "Salary account information",
    collapsed: false,
    deletable: false,
    fields: [
      { id: "bank_name", label: "Bank Name", type: "Text", required: true, editablePostOnboarding: true, deletable: false },
      { id: "account_number", label: "Account Number", type: "Text", required: true, editablePostOnboarding: true, deletable: false },
      { id: "ifsc_code", label: "IFSC Code", type: "Text", required: true, editablePostOnboarding: true, deletable: false },
      { id: "account_type", label: "Account Type", type: "Dropdown", required: true, editablePostOnboarding: true, dropdownOptions: ["Savings", "Current"], deletable: false },
    ],
  },
  {
    id: "sec_documents",
    title: "Document Uploads",
    description: "Upload required identity and educational documents",
    collapsed: false,
    deletable: false,
    fields: [
      { id: "aadhaar_doc", label: "Aadhaar Card Copy", type: "File Upload", required: true, editablePostOnboarding: false, deletable: false, acceptedFormats: ".pdf,.jpg,.jpeg,.png", maxFileSize: 2097152 },
      { id: "pan_doc", label: "PAN Card Copy", type: "File Upload", required: true, editablePostOnboarding: false, deletable: false, acceptedFormats: ".pdf,.jpg,.jpeg,.png", maxFileSize: 2097152 },
      { id: "education_docs", label: "Education Certificates", type: "File Upload", required: false, editablePostOnboarding: false, deletable: false, acceptedFormats: ".pdf,.jpg,.jpeg,.png", maxFileSize: 2097152 },
    ],
  },
];

// ---------------------------------------------------------------------------
//  Constants
// ---------------------------------------------------------------------------

const FIELD_TYPE_OPTIONS = [
  { label: "Text", value: "Text" },
  { label: "Number", value: "Number" },
  { label: "Date", value: "Date" },
  { label: "Dropdown", value: "Dropdown" },
  { label: "File Upload", value: "File Upload" },
];

function typeBadgeVariant(type: FieldType) {
  const map: Record<FieldType, "default" | "secondary" | "warning" | "success" | "destructive"> = {
    Text: "default",
    Number: "secondary",
    Date: "warning",
    Dropdown: "success",
    "File Upload": "destructive",
  };
  return map[type];
}

interface FieldFormState {
  label: string;
  type: FieldType;
  required: boolean;
  editablePostOnboarding: boolean;
  dropdownOptions: string;
  acceptedFormats: string;
  maxFileSize: string;
}

const EMPTY_FIELD_FORM: FieldFormState = {
  label: "",
  type: "Text",
  required: true,
  editablePostOnboarding: true,
  dropdownOptions: "",
  acceptedFormats: ".pdf,.jpg,.jpeg,.png",
  maxFileSize: "2",
};

// ---------------------------------------------------------------------------
//  Helpers: strip UI-only props before saving to DB
// ---------------------------------------------------------------------------

function sectionsForDb(sections: FormSection[]) {
  return sections.map((s) => ({
    id: s.id,
    title: s.title,
    description: s.description,
    deletable: s.deletable,
    fields: s.fields.map((f) => ({
      id: f.id,
      label: f.label,
      type: f.type,
      required: f.required,
      editablePostOnboarding: f.editablePostOnboarding,
      deletable: f.deletable,
      ...(f.dropdownOptions ? { dropdownOptions: f.dropdownOptions } : {}),
      ...(f.type === "File Upload" ? { acceptedFormats: f.acceptedFormats, maxFileSize: f.maxFileSize } : {}),
    })),
  }));
}

function sectionsFromDb(dbSections: FormSection[]): FormSection[] {
  return dbSections.map((s) => ({
    ...s,
    collapsed: false,
    fields: s.fields.map((f) => ({ ...f })),
  }));
}

// ---------------------------------------------------------------------------
//  Page component
// ---------------------------------------------------------------------------

export default function OnboardingFormBuilderPage() {
  const { isAdmin, loading: authLoading } = useAuth();
  const { toast } = useToast();

  const [sections, setSections] = useState<FormSection[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [configId, setConfigId] = useState<string | null>(null);
  const [configVersion, setConfigVersion] = useState(1);
  // True when the builder has edits that are NOT yet persisted via Save
  // Configuration. Section/field add/edit/delete only mutate local state;
  // without this flag those changes could be silently lost on navigation.
  const [isDirty, setIsDirty] = useState(false);

  // Warn before the tab/window closes with unsaved changes.
  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  // Field dialog
  const [fieldDialogOpen, setFieldDialogOpen] = useState(false);
  const [fieldDialogMode, setFieldDialogMode] = useState<"add" | "edit">("add");
  const [fieldDialogSectionId, setFieldDialogSectionId] = useState<string | null>(null);
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [fieldForm, setFieldForm] = useState<FieldFormState>(EMPTY_FIELD_FORM);

  // Delete field dialog
  const [deleteFieldOpen, setDeleteFieldOpen] = useState(false);
  const [deletingFieldInfo, setDeletingFieldInfo] = useState<{ sectionId: string; fieldId: string; label: string } | null>(null);

  // Section dialog
  const [sectionDialogOpen, setSectionDialogOpen] = useState(false);
  const [sectionDialogMode, setSectionDialogMode] = useState<"add" | "edit">("add");
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [secFormTitle, setSecFormTitle] = useState("");
  const [secFormDesc, setSecFormDesc] = useState("");

  // Delete section dialog
  const [deleteSectionOpen, setDeleteSectionOpen] = useState(false);
  const [deletingSectionId, setDeletingSectionId] = useState<string | null>(null);

  // Drag state for fields
  const dragFieldRef = useRef<{ sectionId: string; fieldIndex: number } | null>(null);
  const [dragOverField, setDragOverField] = useState<{ sectionId: string; fieldIndex: number } | null>(null);

  // ---------------------------------------------------------------------------
  //  Load config from Supabase on mount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    (async () => {
      try {
        const { config } = await api.onboardingConfig.get();
        if (config) {
          setSections(sectionsFromDb(config.sections as FormSection[]));
          setConfigId(config.id);
          setConfigVersion(config.version);
        } else {
          // No config in DB yet, use defaults
          setSections(DEFAULT_SECTIONS);
        }
      } catch (err) {
        console.error('[onboarding-form] Failed to load config, using defaults:', err);
        setSections(DEFAULT_SECTIONS);
      }
      setLoadingConfig(false);
    })();
  }, []);

  // ---------------------------------------------------------------------------
  //  Section helpers
  // ---------------------------------------------------------------------------

  const toggleSection = useCallback((sectionId: string) => {
    setSections((prev) => prev.map((s) => s.id === sectionId ? { ...s, collapsed: !s.collapsed } : s));
  }, []);

  const moveSectionUp = useCallback((index: number) => {
    if (index === 0) return;
    setIsDirty(true);
    setSections((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }, []);

  const moveSectionDown = useCallback((index: number) => {
    setIsDirty(true);
    setSections((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }, []);

  const openAddSection = () => {
    setSectionDialogMode("add");
    setEditingSectionId(null);
    setSecFormTitle("");
    setSecFormDesc("");
    setSectionDialogOpen(true);
  };

  const openEditSection = (section: FormSection) => {
    setSectionDialogMode("edit");
    setEditingSectionId(section.id);
    setSecFormTitle(section.title);
    setSecFormDesc(section.description);
    setSectionDialogOpen(true);
  };

  const handleSectionSubmit = () => {
    if (!secFormTitle.trim()) return;
    if (sectionDialogMode === "add") {
      const newSection: FormSection = {
        id: `sec_${Date.now()}`,
        title: secFormTitle.trim(),
        description: secFormDesc.trim(),
        collapsed: false,
        deletable: true,
        fields: [],
      };
      setSections((prev) => [...prev, newSection]);
      setIsDirty(true);
      toast({ variant: "info", title: "Section added (unsaved)", description: `"${secFormTitle.trim()}" created. Click Save Configuration to apply.` });
    } else if (editingSectionId) {
      setSections((prev) => prev.map((s) => s.id === editingSectionId ? { ...s, title: secFormTitle.trim(), description: secFormDesc.trim() } : s));
      setIsDirty(true);
      toast({ variant: "info", title: "Section updated (unsaved)", description: "Click Save Configuration to apply." });
    }
    setSectionDialogOpen(false);
  };

  const openDeleteSection = (sectionId: string) => {
    setDeletingSectionId(sectionId);
    setDeleteSectionOpen(true);
  };

  const handleDeleteSection = () => {
    if (!deletingSectionId) return;
    setSections((prev) => prev.filter((s) => s.id !== deletingSectionId));
    setIsDirty(true);
    toast({ variant: "info", title: "Section deleted (unsaved)", description: "Click Save Configuration to apply." });
    setDeletingSectionId(null);
    setDeleteSectionOpen(false);
  };

  // ---------------------------------------------------------------------------
  //  Field helpers
  // ---------------------------------------------------------------------------

  const moveField = useCallback((sectionId: string, fieldIndex: number, direction: "up" | "down") => {
    setSections((prev) => prev.map((s) => {
      if (s.id !== sectionId) return s;
      const fields = [...s.fields];
      const target = direction === "up" ? fieldIndex - 1 : fieldIndex + 1;
      if (target < 0 || target >= fields.length) return s;
      [fields[fieldIndex], fields[target]] = [fields[target], fields[fieldIndex]];
      return { ...s, fields };
    }));
  }, []);

  const openAddField = (sectionId: string) => {
    setFieldDialogMode("add");
    setFieldDialogSectionId(sectionId);
    setEditingFieldId(null);
    setFieldForm(EMPTY_FIELD_FORM);
    setFieldDialogOpen(true);
  };

  const openEditField = (sectionId: string, field: FormField) => {
    setFieldDialogMode("edit");
    setFieldDialogSectionId(sectionId);
    setEditingFieldId(field.id);
    setFieldForm({
      label: field.label,
      type: field.type,
      required: field.required,
      editablePostOnboarding: field.editablePostOnboarding,
      dropdownOptions: field.dropdownOptions?.join("\n") ?? "",
      acceptedFormats: field.acceptedFormats ?? ".pdf,.jpg,.jpeg,.png",
      maxFileSize: field.maxFileSize ? String(field.maxFileSize / (1024 * 1024)) : "2",
    });
    setFieldDialogOpen(true);
  };

  const handleFieldSubmit = () => {
    if (!fieldForm.label.trim() || !fieldDialogSectionId) return;
    const dropdownOpts = fieldForm.type === "Dropdown"
      ? fieldForm.dropdownOptions.split("\n").map((o) => o.trim()).filter(Boolean)
      : undefined;

    const fileProps = fieldForm.type === "File Upload"
      ? {
          acceptedFormats: fieldForm.acceptedFormats || ".pdf,.jpg,.jpeg,.png",
          maxFileSize: (parseFloat(fieldForm.maxFileSize) || 2) * 1024 * 1024,
        }
      : {};

    if (fieldDialogMode === "add") {
      const newField: FormField = {
        id: `field_${Date.now()}`,
        label: fieldForm.label.trim(),
        type: fieldForm.type,
        required: fieldForm.required,
        editablePostOnboarding: fieldForm.editablePostOnboarding,
        deletable: true,
        dropdownOptions: dropdownOpts,
        ...fileProps,
      };
      setSections((prev) => prev.map((s) => s.id === fieldDialogSectionId ? { ...s, fields: [...s.fields, newField] } : s));
      setIsDirty(true);
      toast({ variant: "info", title: "Field added (unsaved)", description: `"${fieldForm.label.trim()}" added. Click Save Configuration to apply.` });
    } else if (editingFieldId) {
      setSections((prev) => prev.map((s) => {
        if (s.id !== fieldDialogSectionId) return s;
        return {
          ...s,
          fields: s.fields.map((f) => f.id === editingFieldId ? {
            ...f,
            label: fieldForm.label.trim(),
            type: fieldForm.type,
            required: fieldForm.required,
            editablePostOnboarding: fieldForm.editablePostOnboarding,
            dropdownOptions: dropdownOpts,
            ...fileProps,
          } : f),
        };
      }));
      setIsDirty(true);
      toast({ variant: "info", title: "Field updated (unsaved)", description: "Click Save Configuration to apply." });
    }
    setFieldDialogOpen(false);
  };

  const openDeleteField = (sectionId: string, field: FormField) => {
    setDeletingFieldInfo({ sectionId, fieldId: field.id, label: field.label });
    setDeleteFieldOpen(true);
  };

  const handleDeleteField = () => {
    if (!deletingFieldInfo) return;
    setSections((prev) => prev.map((s) => s.id === deletingFieldInfo.sectionId ? { ...s, fields: s.fields.filter((f) => f.id !== deletingFieldInfo.fieldId) } : s));
    setIsDirty(true);
    toast({ variant: "info", title: "Field deleted (unsaved)", description: "Click Save Configuration to apply." });
    setDeletingFieldInfo(null);
    setDeleteFieldOpen(false);
  };

  // ---------------------------------------------------------------------------
  //  Drag-and-drop for fields within same section
  // ---------------------------------------------------------------------------

  const handleDragStart = useCallback((sectionId: string, fieldIndex: number) => {
    dragFieldRef.current = { sectionId, fieldIndex };
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, sectionId: string, fieldIndex: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverField({ sectionId, fieldIndex });
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverField(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetSectionId: string, targetIndex: number) => {
    e.preventDefault();
    const from = dragFieldRef.current;
    if (!from || (from.sectionId === targetSectionId && from.fieldIndex === targetIndex)) {
      dragFieldRef.current = null;
      setDragOverField(null);
      return;
    }

    setIsDirty(true);
    setSections((prev) => {
      const next = prev.map((s) => ({ ...s, fields: [...s.fields] }));

      if (from.sectionId === targetSectionId) {
        const section = next.find((s) => s.id === from.sectionId);
        if (section) {
          const [moved] = section.fields.splice(from.fieldIndex, 1);
          section.fields.splice(targetIndex, 0, moved);
        }
      } else {
        const fromSection = next.find((s) => s.id === from.sectionId);
        const toSection = next.find((s) => s.id === targetSectionId);
        if (fromSection && toSection) {
          const [moved] = fromSection.fields.splice(from.fieldIndex, 1);
          toSection.fields.splice(targetIndex, 0, moved);
        }
      }
      return next;
    });
    dragFieldRef.current = null;
    setDragOverField(null);
  }, []);

  const handleDragEnd = useCallback(() => {
    dragFieldRef.current = null;
    setDragOverField(null);
  }, []);

  // ---------------------------------------------------------------------------
  //  Save to Supabase
  // ---------------------------------------------------------------------------

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = sectionsForDb(sections);
      const newVersion = configVersion + 1;

      // Save new config version via API. published:true makes it the active
      // config immediately (the API deactivates older versions), so the new
      // fields persist across refresh and apply to onboarding right away.
      const { config: savedConfig } = await api.onboardingConfig.save({
        version: newVersion,
        sections: payload,
        published: true,
      }) as { config: { id: string; version: number } };
      setConfigId(savedConfig.id);

      // Trust the server-assigned version (it derives the next version from the
      // DB max, which may differ from our optimistic guess).
      setConfigVersion(savedConfig.version ?? newVersion);
      setIsDirty(false);
      toast({ variant: "success", title: "Configuration saved", description: "Onboarding form updated successfully." });

      // Notify active employees about form updates
      // Skip inactive/terminated employees (people who left)
      try {
        const { employees: activeEmps } = await api.employees.list();

        const filteredEmps = (activeEmps || []).filter((emp: { status: string }) => emp.status === 'active');

        if (filteredEmps.length > 0) {
          // Notify all active employees
          const notifications = filteredEmps.map((emp: { id: string; onboarding_status: string }) => ({
            employee_id: emp.id,
            title: 'Onboarding Form Updated',
            message: emp.onboarding_status === 'completed'
              ? 'HR has added new fields to the onboarding form. Please visit the onboarding page to provide the additional information.'
              : 'HR has updated the onboarding form. Please review and complete any new fields.',
            type: 'onboarding',
          }));
          await api.notifications.create(notifications);

          // For completed employees: set status back to 'pending' so they can fill new fields
          const completedEmps = filteredEmps.filter(
            (e: { onboarding_status: string }) => e.onboarding_status === 'completed'
          );

          for (const emp of completedEmps) {
            try {
              await api.employees.update(emp.id, { onboarding_status: 'pending' });
            } catch (empErr) {
              console.error(`[onboarding-form] Failed to reset onboarding for ${emp.id}:`, empErr);
            }
          }
        }
      } catch (notifyErr) {
        console.error('[onboarding-form] Failed to send re-onboarding notifications:', notifyErr);
      }
    } catch (err) {
      toast({ variant: "error", title: "Save failed", description: String(err) });
    }
    setSaving(false);
  };

  // ---------------------------------------------------------------------------
  //  Guards
  // ---------------------------------------------------------------------------

  if (authLoading || loadingConfig) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        <p className="ml-2 text-sm text-gray-500">Loading configuration...</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24">
        <ShieldAlert className="h-10 w-10 text-red-400" />
        <p className="text-sm font-medium text-gray-700">
          You do not have permission to access this page.
        </p>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  //  Render
  // ---------------------------------------------------------------------------

  const totalFields = sections.reduce((sum, s) => sum + s.fields.length, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Link href="/settings">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight m-0 mb-1">
              Onboarding Form Builder
            </h1>
            <p className="text-xs text-gray-500">
              {sections.length} sections, {totalFields} fields (v{configVersion}). Drag fields to reorder, even across sections.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isDirty && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
              Unsaved changes
            </span>
          )}
          <Button variant="outline" onClick={openAddSection}>
            <FolderPlus className="h-4 w-4" />
            Add Section
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? "Saving..." : "Save Configuration"}
          </Button>
        </div>
      </div>

      {/* Sections */}
      {sections.map((section, sectionIndex) => (
        <Card key={section.id}>
          {/* Section header */}
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-gray-200">
            <button
              type="button"
              onClick={() => toggleSection(section.id)}
              className="shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
            >
              {section.collapsed ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>

            <div className="flex flex-col gap-0.5 shrink-0">
              <button
                type="button"
                aria-label="Move section up"
                disabled={sectionIndex === 0}
                onClick={() => moveSectionUp(sectionIndex)}
                className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-30"
              >
                <ArrowUp className="h-3 w-3" />
              </button>
              <button
                type="button"
                aria-label="Move section down"
                disabled={sectionIndex === sections.length - 1}
                onClick={() => moveSectionDown(sectionIndex)}
                className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-30"
              >
                <ArrowDown className="h-3 w-3" />
              </button>
            </div>

            <div className="flex-1 min-w-0">
              <h3 className="text-[13px] font-semibold text-gray-900 leading-tight">
                {section.title}
              </h3>
              {section.description && (
                <p className="text-[11px] text-gray-500 mt-0.5 leading-tight">
                  {section.description}
                </p>
              )}
            </div>

            <Badge variant="secondary" className="shrink-0">
              {section.fields.length} field{section.fields.length !== 1 ? "s" : ""}
            </Badge>

            <div className="flex items-center gap-0.5 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => openAddField(section.id)}
                title="Add field to this section"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => openEditSection(section)}
                title="Edit section"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              {section.deletable && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50"
                  onClick={() => openDeleteSection(section.id)}
                  title="Delete section"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>

          {/* Section fields */}
          {!section.collapsed && (
            <div className="px-5 py-3">
              {section.fields.length === 0 ? (
                <div className="rounded-lg border-2 border-dashed border-gray-200 py-8 text-center">
                  <p className="text-xs text-gray-400 mb-2">No fields in this section</p>
                  <Button variant="outline" size="sm" onClick={() => openAddField(section.id)}>
                    <Plus className="h-3.5 w-3.5" />
                    Add Field
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {section.fields.map((field, fieldIndex) => (
                    <div
                      key={field.id}
                      draggable
                      onDragStart={() => handleDragStart(section.id, fieldIndex)}
                      onDragOver={(e) => handleDragOver(e, section.id, fieldIndex)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, section.id, fieldIndex)}
                      onDragEnd={handleDragEnd}
                      className={`flex items-center gap-3 rounded-lg border bg-gray-50/50 px-3 py-2.5 transition-all ${
                        dragOverField?.sectionId === section.id && dragOverField?.fieldIndex === fieldIndex
                          ? "ring-2 ring-blue-400 ring-offset-1 bg-blue-50/30"
                          : "border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-gray-300 active:cursor-grabbing" />

                      <div className="flex flex-col gap-0.5 shrink-0">
                        <button
                          type="button"
                          disabled={fieldIndex === 0}
                          onClick={() => moveField(section.id, fieldIndex, "up")}
                          className="rounded p-0.5 text-gray-400 hover:bg-gray-200 disabled:opacity-30"
                        >
                          <ArrowUp className="h-2.5 w-2.5" />
                        </button>
                        <button
                          type="button"
                          disabled={fieldIndex === section.fields.length - 1}
                          onClick={() => moveField(section.id, fieldIndex, "down")}
                          className="rounded p-0.5 text-gray-400 hover:bg-gray-200 disabled:opacity-30"
                        >
                          <ArrowDown className="h-2.5 w-2.5" />
                        </button>
                      </div>

                      <div className="flex flex-1 flex-wrap items-center gap-1.5 min-w-0">
                        <span className="text-xs font-medium text-gray-900">{field.label}</span>
                        <Badge variant={typeBadgeVariant(field.type)}>{field.type}</Badge>
                        <Badge variant={field.required ? "destructive" : "outline"}>
                          {field.required ? "Required" : "Optional"}
                        </Badge>
                        <Badge variant={field.editablePostOnboarding ? "success" : "secondary"}>
                          {field.editablePostOnboarding ? "Editable" : "Locked"}
                        </Badge>
                        {field.type === "File Upload" && field.acceptedFormats && (
                          <Badge variant="outline" className="text-[10px]">
                            {field.acceptedFormats}
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center gap-0.5 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => openEditField(section.id, field)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50"
                          disabled={!field.deletable}
                          onClick={() => openDeleteField(section.id, field)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>
      ))}

      {/* Footnote */}
      <p className="text-xs text-gray-400">
        Default system fields (PAN, Aadhaar, Name, etc.) and default sections cannot be deleted.
        Changes apply to future onboardings only.
      </p>

      {/* ---------------------------------------------------------------- */}
      {/*  Add/Edit Field Dialog                                           */}
      {/* ---------------------------------------------------------------- */}
      <Dialog open={fieldDialogOpen} onOpenChange={setFieldDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{fieldDialogMode === "add" ? "Add Field" : "Edit Field"}</DialogTitle>
            <DialogDescription>
              {fieldDialogMode === "add"
                ? "Define a new field for this section."
                : "Update field configuration."}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <Input
              label="Field Label"
              placeholder="e.g. LinkedIn Profile URL"
              value={fieldForm.label}
              onChange={(e) => setFieldForm((p) => ({ ...p, label: e.target.value }))}
            />
            <Select
              label="Field Type"
              options={FIELD_TYPE_OPTIONS}
              value={fieldForm.type}
              onChange={(e) => setFieldForm((p) => ({ ...p, type: e.target.value as FieldType }))}
            />
            {fieldForm.type === "Dropdown" && (
              <Textarea
                label="Dropdown Options"
                helperText="Enter one option per line"
                placeholder={"Option 1\nOption 2\nOption 3"}
                value={fieldForm.dropdownOptions}
                onChange={(e) => setFieldForm((p) => ({ ...p, dropdownOptions: e.target.value }))}
                rows={4}
              />
            )}
            {fieldForm.type === "File Upload" && (
              <>
                <Input
                  label="Accepted Formats"
                  placeholder=".pdf,.jpg,.jpeg,.png"
                  helperText="Comma-separated file extensions"
                  value={fieldForm.acceptedFormats}
                  onChange={(e) => setFieldForm((p) => ({ ...p, acceptedFormats: e.target.value }))}
                />
                <Input
                  label="Max File Size (MB)"
                  type="number"
                  placeholder="2"
                  value={fieldForm.maxFileSize}
                  onChange={(e) => setFieldForm((p) => ({ ...p, maxFileSize: e.target.value }))}
                />
              </>
            )}
            <div className="flex flex-col gap-3 sm:flex-row sm:gap-6">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={fieldForm.required}
                  onChange={(e) => setFieldForm((p) => ({ ...p, required: e.target.checked }))}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                Required
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={fieldForm.editablePostOnboarding}
                  onChange={(e) => setFieldForm((p) => ({ ...p, editablePostOnboarding: e.target.checked }))}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                Editable post-onboarding
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFieldDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleFieldSubmit} disabled={!fieldForm.label.trim()}>
              {fieldDialogMode === "add" ? "Add Field" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------------------------------------------------------- */}
      {/*  Delete Field Dialog                                             */}
      {/* ---------------------------------------------------------------- */}
      <Dialog open={deleteFieldOpen} onOpenChange={setDeleteFieldOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Field</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove <strong>{deletingFieldInfo?.label}</strong> from the onboarding form? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteFieldOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteField}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------------------------------------------------------- */}
      {/*  Add/Edit Section Dialog                                         */}
      {/* ---------------------------------------------------------------- */}
      <Dialog open={sectionDialogOpen} onOpenChange={setSectionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{sectionDialogMode === "add" ? "Add Section" : "Edit Section"}</DialogTitle>
            <DialogDescription>
              {sectionDialogMode === "add"
                ? "Create a new category section for the onboarding form."
                : "Update section details."}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <Input
              label="Section Title"
              placeholder="e.g. Education Details"
              value={secFormTitle}
              onChange={(e) => setSecFormTitle(e.target.value)}
            />
            <Input
              label="Description (optional)"
              placeholder="e.g. Academic qualifications and certifications"
              value={secFormDesc}
              onChange={(e) => setSecFormDesc(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSectionDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSectionSubmit} disabled={!secFormTitle.trim()}>
              {sectionDialogMode === "add" ? (
                <>
                  <FolderPlus className="mr-2 h-4 w-4" />
                  Add Section
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------------------------------------------------------- */}
      {/*  Delete Section Dialog                                           */}
      {/* ---------------------------------------------------------------- */}
      <Dialog open={deleteSectionOpen} onOpenChange={setDeleteSectionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Section</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this section and all its fields? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteSectionOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteSection}>
              <Trash2 className="mr-2 h-4 w-4" />
              Delete Section
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
