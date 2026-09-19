"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { Avatar, AvatarFallback, getInitials } from "@/components/ui/avatar";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { OffboardDialog } from "@/components/employees/offboard-dialog";
import { ResetPasswordDialog } from "@/components/employees/reset-password-dialog";
import {
  ArrowLeft,
  LogOut,
  KeyRound,
  UserX,
  Phone,
  Mail,
  Building2,
  Briefcase,
  CalendarDays,
  Clock,
  Download,
  Save,
  X,
  Plus,
  Pencil,
  Trash2,
  Eye,
  ExternalLink,
  ShieldCheck,
  ShieldX,
  RotateCcw,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";

/* ------------------------------------------------------------------ */
/*  Mock data factory                                                  */
/* ------------------------------------------------------------------ */

interface MockEmployee {
  id: string;
  name: string;
  email: string;
  employeeId: string;
  department: string;
  departmentId: string;
  reportingManagerId: string;
  reportingManagerName: string;
  designation: string;
  status: "active" | "pending" | "terminated" | "offboarded" | "inactive";
  dateOfJoining: string;
  tracksAttendance: boolean;
  shiftStart: string;
  shiftEnd: string;
  employmentType: string;
  phone: string;
  personalEmail: string;
  dob: string;
  gender: string;
  bloodGroup: string;
  permanentAddress: string;
  currentAddress: string;
  emergencyContact: { name: string; relationship: string; phone: string };
  pan: string;
  aadhaar: string;
  bankDetails: {
    bankName: string;
    accountNumber: string;
    ifsc: string;
    accountType: string;
  };
  documents: { id: string; name: string; category: string; uploadedAt: string; fileUrl: string; verified: boolean; verifiedAt: string | null }[];
  leaveBalances: {
    leaveTypeId: string;
    type: string;
    total: number;
    used: number;
    remaining: number;
    defaultDays: number;
    isOverride: boolean;
  }[];
  leaveHistory: {
    type: string;
    from: string;
    to: string;
    days: number;
    status: string;
  }[];
  auditTrail: {
    action: string;
    performedBy: string;
    timestamp: string;
    details: string;
  }[];
  attendanceHistory: {
    dbId: string;
    rawDate: string;
    rawPunchIn: string | null;
    rawPunchOut: string | null;
    date: string;
    punchIn: string;
    punchOut: string;
    hours: string;
    status: string;
  }[];
  customFields: Record<string, string>;
}

function getEmptyEmployee(id: string): MockEmployee {
  return {
    id,
    name: "",
    email: "",
    employeeId: "",
    department: "",
    departmentId: "",
    reportingManagerId: "",
    reportingManagerName: "",
    designation: "",
    status: "active",
    dateOfJoining: "",
    tracksAttendance: true,
    shiftStart: "",
    shiftEnd: "",
    employmentType: "",
    phone: "",
    personalEmail: "",
    dob: "",
    gender: "",
    bloodGroup: "",
    permanentAddress: "",
    currentAddress: "",
    emergencyContact: { name: "", relationship: "", phone: "" },
    pan: "",
    aadhaar: "",
    bankDetails: { bankName: "", accountNumber: "", ifsc: "", accountType: "" },
    documents: [],
    leaveBalances: [],
    leaveHistory: [],
    attendanceHistory: [],
    auditTrail: [],
    customFields: {},
  };
}

/* ------------------------------------------------------------------ */
/*  Helper: info row                                                   */
/* ------------------------------------------------------------------ */

function formatShift(start: string, end: string): string {
  if (!start || !end) return 'Not set';
  const fmt = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const hr = h % 12 === 0 ? 12 : h % 12;
    return `${hr}:${String(m).padStart(2, '0')} ${period}`;
  };
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const overnight = eh * 60 + em <= sh * 60 + sm;
  return `${fmt(start)} - ${fmt(end)}${overnight ? ' (next day)' : ''}`;
}

function InfoRow({
  label,
  value,
  editing,
  editValue,
  onEditChange,
}: {
  label: string;
  value: string;
  editing?: boolean;
  editValue?: string;
  onEditChange?: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
      <span className="w-40 shrink-0 text-sm font-medium text-gray-500">
        {label}
      </span>
      {editing && onEditChange ? (
        <Input
          className="max-w-sm"
          value={editValue ?? value}
          onChange={(e) => onEditChange(e.target.value)}
        />
      ) : (
        <span className="text-sm text-gray-900">{value}</span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helper: section header with edit/save/cancel                       */
/* ------------------------------------------------------------------ */

function SectionHeader({
  title,
  section,
  editSection,
  isAdmin,
  sectionSaving,
  onStartEdit,
  onSave,
  onCancel,
}: {
  title: string;
  section: string;
  editSection: string | null;
  isAdmin: boolean;
  sectionSaving: boolean;
  onStartEdit: (section: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const isEditing = editSection === section;
  const anotherSectionEditing = editSection !== null && editSection !== section;

  return (
    <div className="flex items-center justify-between">
      <h4 className="text-sm font-semibold text-gray-700">{title}</h4>
      {isAdmin && (
        <div className="flex items-center gap-2">
          {isEditing ? (
            <>
              <Button variant="outline" size="sm" onClick={onCancel} disabled={sectionSaving}>
                <X className="h-3.5 w-3.5" />
                Cancel
              </Button>
              <Button size="sm" onClick={onSave} disabled={sectionSaving}>
                <Save className="h-3.5 w-3.5" />
                {sectionSaving ? "Saving..." : "Save"}
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onStartEdit(section)}
              disabled={anotherSectionEditing}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Select option constants                                            */
/* ------------------------------------------------------------------ */

const GENDER_OPTIONS = [
  { label: "Male", value: "Male" },
  { label: "Female", value: "Female" },
  { label: "Other", value: "Other" },
];

const BLOOD_GROUP_OPTIONS = [
  { label: "A+", value: "A+" },
  { label: "A-", value: "A-" },
  { label: "B+", value: "B+" },
  { label: "B-", value: "B-" },
  { label: "AB+", value: "AB+" },
  { label: "AB-", value: "AB-" },
  { label: "O+", value: "O+" },
  { label: "O-", value: "O-" },
];

const ACCOUNT_TYPE_OPTIONS = [
  { label: "Savings", value: "Savings" },
  { label: "Current", value: "Current" },
];

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function EmployeeProfilePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { isAdmin } = useAuth();
  const { toast } = useToast();

  const _mockEmployee = getEmptyEmployee(params.id);
  const [dbEmployee, setDbEmployee] = React.useState<Partial<MockEmployee> | null>(null);
  // Expected onboarding documents (File Upload fields from the active config),
  // used to render a clear "uploaded vs missing" checklist.
  const [expectedDocs, setExpectedDocs] = React.useState<{ fieldId: string; label: string }[]>([]);

  // Loads leave types/allocations/overrides/requests and rebuilds the
  // balances + history tables. Reusable so we can refresh after edits.
  const loadLeaves = React.useCallback(async () => {
    const {
      leaveTypes: types = [],
      leaveAllocations: allocs = [],
      leaveOverrides: overrides = [],
      leaveRequests: requests = [],
    } = await api.employees.get(params.id);

    if (types.length === 0) {
      setDbEmployee((prev) => ({ ...prev, leaveBalances: [], leaveHistory: [] }));
      return;
    }

    // Build allocation maps: default (global) vs override (per-employee)
    const defaultMap = new Map<string, number>();
    for (const a of allocs) defaultMap.set(a.leave_type_id, a.annual_days);
    const overrideMap = new Map<string, number>();
    for (const o of overrides) overrideMap.set(o.leave_type_id, o.custom_days);

    // Build used map: leave_type_id -> used days (approved only)
    const usedMap = new Map<string, number>();
    for (const r of requests) {
      if (r.status === 'approved') {
        usedMap.set(r.leave_type_id, (usedMap.get(r.leave_type_id) ?? 0) + Number(r.days));
      }
    }

    const balances = types.map((t) => {
      const defaultDays = defaultMap.get(t.id) ?? 0;
      const isOverride = overrideMap.has(t.id);
      const total = isOverride ? (overrideMap.get(t.id) as number) : defaultDays;
      const used = usedMap.get(t.id) ?? 0;
      return {
        leaveTypeId: t.id,
        type: t.name,
        total,
        used,
        remaining: total - used,
        defaultDays,
        isOverride,
      };
    });

    const typeNameMap = new Map(types.map((t) => [t.id, t.name]));
    const history = requests.map((r) => ({
      type: typeNameMap.get(r.leave_type_id) ?? 'Unknown',
      from: new Date(r.from_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
      to: new Date(r.to_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
      days: Number(r.days),
      status: r.status.charAt(0).toUpperCase() + r.status.slice(1),
    }));

    setDbEmployee((prev) => ({ ...prev, leaveBalances: balances, leaveHistory: history }));
  }, [params.id]);

  React.useEffect(() => {
    async function fetchEmployee() {
      try {
        const empData = await api.employees.get(params.id);
        const data = empData.employee;

        if (data) {
          setDbEmployee({
            id: data.id,
            name: data.name,
            email: data.email,
            employeeId: data.employee_id,
            department: data.department?.name ?? '',
            departmentId: data.department?.id ?? data.department_id ?? '',
            reportingManagerId: data.reporting_to ?? '',
            reportingManagerName: (Array.isArray(data.reporting_manager) ? data.reporting_manager[0]?.name : data.reporting_manager?.name) ?? '',
            designation: data.designation,
            status: (data.status ?? 'active') as 'active' | 'pending' | 'terminated' | 'offboarded' | 'inactive',
            dateOfJoining: data.date_of_joining,
            tracksAttendance: (data.tracks_attendance as boolean) ?? true,
            shiftStart: data.shift_start ? String(data.shift_start).slice(0, 5) : '',
            shiftEnd: data.shift_end ? String(data.shift_end).slice(0, 5) : '',
            employmentType: data.employment_type ?? '',
            phone: data.phone,
            personalEmail: data.personal_email ?? '',
            dob: data.date_of_birth ?? '',
            gender: data.gender,
            bloodGroup: data.blood_group,
            permanentAddress: data.address ?? '',
            currentAddress: data.current_address ?? data.address ?? '',
            emergencyContact: {
              name: data.emergency_contact_name ?? '',
              relationship: data.emergency_contact_relation ?? '',
              phone: data.emergency_contact_phone ?? '',
            },
            pan: data.pan ?? '',
            aadhaar: data.aadhaar ?? '',
            bankDetails: data.bank_details ?? { bankName: '', accountNumber: '', ifsc: '', accountType: '' },
            customFields: (data.custom_fields as Record<string, string>) ?? {},
          });
        }

        // Fetch attendance history (last 30 records)
        const { records: attData } = await api.attendance.list({ employeeId: params.id });

        if (attData && attData.length > 0) {
          const LATE_THRESHOLD = '04:30'; // 10:00 IST = 04:30 UTC
          const history = attData.map((row) => {
            const punchInTime = row.punch_in ? new Date(row.punch_in).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '-';
            const punchOutTime = row.punch_out ? new Date(row.punch_out).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '-';
            const hours = row.worked_hours != null ? `${Number(row.worked_hours).toFixed(1)}h` : '-';
            let status = 'Present';
            if (row.status === 'absent') status = 'Absent';
            else if (row.status === 'leave') status = 'Leave';
            else if (row.status === 'holiday') status = 'Holiday';
            else if (row.status === 'weekend') status = 'Weekend';
            else if (row.status === 'half') status = 'Half Day';
            else if (row.punch_in) {
              const utcTime = row.punch_in.substring(11, 16);
              if (utcTime > LATE_THRESHOLD) status = 'Late';
            }
            return {
              dbId: row.id,
              rawDate: row.date,
              rawPunchIn: row.punch_in,
              rawPunchOut: row.punch_out,
              date: new Date(row.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
              punchIn: punchInTime,
              punchOut: punchOutTime,
              hours,
              status,
            };
          });
          setDbEmployee((prev) => ({ ...prev, attendanceHistory: history }));
        }

        // Fetch documents
        const { documents: docData } = await api.documents.list({ employee_id: params.id });

        if (docData && docData.length > 0) {
          const docs = docData.map((row: any) => ({
            id: row.id,
            name: row.name,
            category: row.category,
            uploadedAt: new Date(row.uploaded_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
            fileUrl: row.file_url ?? '',
            verified: row.verified ?? false,
            verifiedAt: row.verified_at ?? null,
          }));
          setDbEmployee((prev) => ({ ...prev, documents: docs }));
        }

        // Fetch leave balances & history via API
        await loadLeaves();

        // Fetch audit trail from the already-fetched employee data
        const auditData = empData.auditLog ?? [];

        if (auditData && auditData.length > 0) {
          const trail = auditData.map((row) => {
            const performer = row.employees as { name?: string } | null;
            return {
              action: row.action,
              performedBy: performer?.name ?? 'System',
              timestamp: new Date(row.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
              details: row.details ?? '',
            };
          });
          setDbEmployee((prev) => ({ ...prev, auditTrail: trail }));
        }
      } catch (err) {
        toast({ variant: "error", title: "Failed to load employee", description: String(err) });
      }
    }
    fetchEmployee();
  }, [params.id]);

  // Merge DB data over mock fallback - used as `employee` throughout
  const employee = React.useMemo(() => {
    if (!dbEmployee) return _mockEmployee;
    return { ..._mockEmployee, ...Object.fromEntries(Object.entries(dbEmployee).filter(([, v]) => v != null)) } as MockEmployee;
  }, [_mockEmployee, dbEmployee]);

  // Build a document checklist: each expected onboarding document with its
  // uploaded file(s) (matched by the "<label> - <filename>" naming the
  // onboarding upload uses), or marked Missing. Any uploaded documents that
  // don't match an expected field are surfaced as "Other documents".
  type DocItem = MockEmployee['documents'][number];
  const documentChecklist = React.useMemo(() => {
    const docs = employee.documents ?? [];
    const matchedIds = new Set<string>();
    const expected = expectedDocs.map((exp) => {
      const files = docs.filter((d) => {
        const n = (d.name ?? '').trim();
        return n === exp.label || n.startsWith(`${exp.label} -`) || n.startsWith(`${exp.label} —`);
      });
      files.forEach((f) => matchedIds.add(f.id));
      return { label: exp.label, files };
    });
    const others = docs.filter((d) => !matchedIds.has(d.id));
    return { expected, others };
  }, [employee.documents, expectedDocs]);

  const [activeTab, setActiveTab] = React.useState("overview");
  const [offboardOpen, setOffboardOpen] = React.useState(false);
  const [resetPasswordOpen, setResetPasswordOpen] = React.useState(false);
  const [departmentOptions, setDepartmentOptions] = React.useState<{label:string;value:string}[]>([]);
  const [employeeOptions, setEmployeeOptions] = React.useState<{label:string;value:string}[]>([]);

  React.useEffect(() => {
    api.departments.list().then(({ departments }) => {
      if (departments) setDepartmentOptions(departments.map(d => ({ label: d.name, value: d.id })));
    }).catch((err) => {
      // Surface the failure: an empty dropdown otherwise looks like "no departments"
      // and lets an admin save employment details with a blank department.
      toast({ variant: 'error', title: 'Failed to load departments', description: String(err) });
    });
    // Load expected onboarding documents from the active config so the
    // Documents tab can show a clear uploaded-vs-missing checklist.
    api.onboardingConfig.get().then(({ config }) => {
      const sections = (config?.sections ?? []) as { fields?: { id: string; label: string; type: string }[] }[];
      const fileFields = sections
        .flatMap((s) => s.fields ?? [])
        .filter((f) => f.type === 'File Upload')
        .map((f) => ({ fieldId: f.id, label: f.label }));
      setExpectedDocs(fileFields);
    }).catch(() => { /* config is optional; fall back to listing only uploaded docs */ });
    // Fetch employee list for Reporting Manager dropdown
    if (isAdmin) {
      api.employees.list().then(({ employees }: { employees: any[] }) => {
        if (employees) {
          setEmployeeOptions(
            employees
              .filter((e: any) => e.id !== params.id) // exclude self
              .map((e: any) => ({ label: `${e.name} (${e.employee_id})`, value: e.id }))
          );
        }
      }).catch((err) => {
        toast({ variant: 'error', title: 'Failed to load employee list', description: String(err) });
      });
    }
  }, [isAdmin, params.id]);

  /* ---- Per-section inline edit state ---- */
  const [editSection, setEditSection] = React.useState<string | null>(null);
  const [editForm, setEditForm] = React.useState<Record<string, string>>({});
  const [sectionSaving, setSectionSaving] = React.useState(false);

  const startEdit = (section: string) => {
    const prefill: Record<string, string> = {};
    if (section === "personal") {
      prefill.phone = employee.phone;
      prefill.personalEmail = employee.personalEmail;
      prefill.dob = employee.dob;
      prefill.gender = employee.gender;
      prefill.bloodGroup = employee.bloodGroup;
      prefill.permanentAddress = employee.permanentAddress;
      prefill.currentAddress = employee.currentAddress;
    } else if (section === "emergency") {
      prefill.emergencyName = employee.emergencyContact.name;
      prefill.emergencyRelationship = employee.emergencyContact.relationship;
      prefill.emergencyPhone = employee.emergencyContact.phone;
    } else if (section === "identity") {
      prefill.pan = employee.pan;
      prefill.aadhaar = employee.aadhaar;
    } else if (section === "employment") {
      prefill.department = employee.departmentId;
      prefill.designation = employee.designation;
      prefill.dateOfJoining = employee.dateOfJoining;
      prefill.reportingManager = employee.reportingManagerId;
      prefill.observer = employee.tracksAttendance === false ? "yes" : "no";
      prefill.shiftStart = employee.shiftStart;
      prefill.shiftEnd = employee.shiftEnd;
    } else if (section === "bank") {
      prefill.bankName = employee.bankDetails.bankName;
      prefill.accountNumber = employee.bankDetails.accountNumber;
      prefill.ifsc = employee.bankDetails.ifsc;
      prefill.accountType = employee.bankDetails.accountType;
    }
    setEditForm(prefill);
    setEditSection(section);
  };

  const cancelEdit = () => {
    setEditSection(null);
    setEditForm({});
  };

  const handleSectionSave = async () => {
    setSectionSaving(true);
    try {
      const update: Record<string, unknown> = {};

      if (editSection === "personal") {
        update.phone = editForm.phone;
        update.personal_email = editForm.personalEmail;
        update.date_of_birth = editForm.dob || null;
        update.gender = editForm.gender;
        update.blood_group = editForm.bloodGroup;
        update.address = editForm.permanentAddress;
        update.current_address = editForm.currentAddress;
      } else if (editSection === "emergency") {
        update.emergency_contact_name = editForm.emergencyName;
        update.emergency_contact_relation = editForm.emergencyRelationship;
        update.emergency_contact_phone = editForm.emergencyPhone;
      } else if (editSection === "identity") {
        update.pan = editForm.pan;
        update.aadhaar = editForm.aadhaar;
      } else if (editSection === "employment") {
        update.department_id = editForm.department;
        update.designation = editForm.designation;
        update.date_of_joining = editForm.dateOfJoining || null;
        update.reporting_to = editForm.reportingManager || null;
        update.tracks_attendance = editForm.observer !== "yes";
        update.shift_start = editForm.shiftStart || null;
        update.shift_end = editForm.shiftEnd || null;
      } else if (editSection === "bank") {
        update.bank_details = {
          bankName: editForm.bankName ?? "",
          accountNumber: editForm.accountNumber ?? "",
          ifsc: editForm.ifsc ?? "",
          accountType: editForm.accountType ?? "",
        };
      }

      await api.employees.update(params.id, update);
      // success

      // Update local state
      setDbEmployee((prev) => {
        if (!prev) return prev;
        const updated = { ...prev };
        if (editSection === "personal") {
          updated.phone = editForm.phone;
          updated.personalEmail = editForm.personalEmail;
          updated.dob = editForm.dob;
          updated.gender = editForm.gender;
          updated.bloodGroup = editForm.bloodGroup;
          updated.permanentAddress = editForm.permanentAddress;
          updated.currentAddress = editForm.currentAddress;
        } else if (editSection === "emergency") {
          updated.emergencyContact = {
            name: editForm.emergencyName ?? "",
            relationship: editForm.emergencyRelationship ?? "",
            phone: editForm.emergencyPhone ?? "",
          };
        } else if (editSection === "identity") {
          updated.pan = editForm.pan;
          updated.aadhaar = editForm.aadhaar;
        } else if (editSection === "employment") {
          updated.departmentId = editForm.department;
          updated.department = departmentOptions.find(d => d.value === editForm.department)?.label ?? editForm.department;
          updated.designation = editForm.designation;
          updated.dateOfJoining = editForm.dateOfJoining;
          updated.reportingManagerId = editForm.reportingManager ?? '';
          updated.reportingManagerName = employeeOptions.find(e => e.value === editForm.reportingManager)?.label ?? '';
          updated.tracksAttendance = editForm.observer !== "yes";
          updated.shiftStart = editForm.shiftStart ?? '';
          updated.shiftEnd = editForm.shiftEnd ?? '';
        } else if (editSection === "bank") {
          updated.bankDetails = {
            bankName: editForm.bankName ?? "",
            accountNumber: editForm.accountNumber ?? "",
            ifsc: editForm.ifsc ?? "",
            accountType: editForm.accountType ?? "",
          };
        }
        return updated;
      });

      toast({ variant: "success", title: "Updated", description: `${editSection} details saved.` });
      setEditSection(null);
      setEditForm({});
    } catch (err) {
      toast({ variant: "error", title: "Save failed", description: String(err) });
    }
    setSectionSaving(false);
  };

  /* ---- Custom fields (dynamic from onboarding) ---- */
  const customFieldEntries = React.useMemo(() => {
    const cf = employee.customFields;
    if (!cf || Object.keys(cf).length === 0) return [];
    return Object.entries(cf)
      .filter(([key]) => !key.startsWith('_label_'))
      .map(([key, value]) => ({
        id: key,
        label: cf[`_label_${key}`] ?? key.replace(/^field_\d+$/, 'Custom Field'),
        value: value ?? '',
      }));
  }, [employee.customFields]);

  const statusMap: Record<string, "active" | "pending" | "terminated"> = {
    active: "active",
    pending: "pending",
    terminated: "terminated",
    offboarded: "terminated",
    inactive: "terminated",
  };

  const isOffboarded =
    employee.status === "terminated" ||
    employee.status === "offboarded" ||
    employee.status === "inactive";

  /* ---- Attendance admin CRUD state ---- */
  type AttFormData = { date: string; punchIn: string; punchOut: string; status: string };
  const emptyAttForm: AttFormData = { date: '', punchIn: '', punchOut: '', status: 'present' };
  const [attDialogOpen, setAttDialogOpen] = React.useState(false);
  const [attDialogMode, setAttDialogMode] = React.useState<'add' | 'edit'>('add');
  const [attEditId, setAttEditId] = React.useState<string | null>(null);
  const [attForm, setAttForm] = React.useState<AttFormData>(emptyAttForm);
  const [attSaving, setAttSaving] = React.useState(false);
  const [attDeleteOpen, setAttDeleteOpen] = React.useState(false);
  const [attDeleteTarget, setAttDeleteTarget] = React.useState<{ id: string; date: string } | null>(null);
  const [attDeleting, setAttDeleting] = React.useState(false);

  // ── Leave balance editing (per-employee allocation overrides) ──
  const [leaveDialogOpen, setLeaveDialogOpen] = React.useState(false);
  const [leaveEditTarget, setLeaveEditTarget] = React.useState<
    MockEmployee['leaveBalances'][number] | null
  >(null);
  const [leaveDaysInput, setLeaveDaysInput] = React.useState('');
  const [leaveSaving, setLeaveSaving] = React.useState(false);

  const openEditLeave = (lb: MockEmployee['leaveBalances'][number]) => {
    setLeaveEditTarget(lb);
    setLeaveDaysInput(String(lb.total));
    setLeaveDialogOpen(true);
  };

  const handleLeaveSave = async () => {
    if (!leaveEditTarget) return;
    const days = Number(leaveDaysInput);
    if (!Number.isFinite(days) || days < 0 || !Number.isInteger(days)) {
      toast({ variant: 'error', title: 'Invalid value', description: 'Enter a whole number of days (0 or more).' });
      return;
    }
    setLeaveSaving(true);
    try {
      if (days === leaveEditTarget.defaultDays) {
        // Matches the default allocation: drop any override (revert to default).
        await api.leaveSettings.deleteOverride({
          employee_id: params.id,
          leave_type_id: leaveEditTarget.leaveTypeId,
        });
      } else {
        await api.leaveSettings.createOverride({
          employee_id: params.id,
          leave_type_id: leaveEditTarget.leaveTypeId,
          custom_days: days,
        });
      }
      await loadLeaves();
      toast({ variant: 'success', title: 'Leave balance updated', description: `${leaveEditTarget.type} set to ${days} day${days === 1 ? '' : 's'}.` });
      setLeaveDialogOpen(false);
      setLeaveEditTarget(null);
    } catch (err) {
      toast({ variant: 'error', title: 'Update failed', description: String(err) });
    } finally {
      setLeaveSaving(false);
    }
  };

  const handleLeaveResetToDefault = async (lb: MockEmployee['leaveBalances'][number]) => {
    setLeaveSaving(true);
    try {
      await api.leaveSettings.deleteOverride({
        employee_id: params.id,
        leave_type_id: lb.leaveTypeId,
      });
      await loadLeaves();
      toast({ variant: 'success', title: 'Reverted to default', description: `${lb.type} reset to the company default (${lb.defaultDays}).` });
    } catch (err) {
      toast({ variant: 'error', title: 'Reset failed', description: String(err) });
    } finally {
      setLeaveSaving(false);
    }
  };

  // ── Document view/download/verify (shared by the documents checklist) ──
  const handleDocView = async (doc: DocItem) => {
    try {
      const { url } = await api.documents.getViewUrl(doc.id);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      toast({ variant: 'error', title: 'Failed', description: 'Could not open document.' });
    }
  };

  const handleDocDownload = async (doc: DocItem) => {
    try {
      const { url, name } = await api.documents.getViewUrl(doc.id);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      toast({ variant: 'info', title: 'Download Started', description: `Downloading ${doc.name}...` });
    } catch {
      toast({ variant: 'error', title: 'Failed', description: 'Could not download document.' });
    }
  };

  const handleDocVerify = async (doc: DocItem) => {
    try {
      const newStatus = !doc.verified;
      await api.documents.verify(doc.id, newStatus);
      setDbEmployee((prev) => {
        if (!prev?.documents) return prev;
        const updated = prev.documents.map((d) =>
          d.id === doc.id ? { ...d, verified: newStatus, verifiedAt: newStatus ? new Date().toISOString() : null } : d,
        );
        return { ...prev, documents: updated };
      });
      toast({
        variant: 'success',
        title: newStatus ? 'Document Verified' : 'Verification Removed',
        description: `${doc.name} has been ${newStatus ? 'verified' : 'unverified'}.`,
      });
    } catch {
      toast({ variant: 'error', title: 'Failed', description: 'Could not update verification status.' });
    }
  };

  // ── Delete a document (with confirm) ──
  const [docDeleteTarget, setDocDeleteTarget] = React.useState<DocItem | null>(null);
  const [docDeleting, setDocDeleting] = React.useState(false);

  const handleDocDelete = async () => {
    if (!docDeleteTarget) return;
    setDocDeleting(true);
    try {
      await api.documents.remove(docDeleteTarget.id);
      setDbEmployee((prev) => {
        if (!prev?.documents) return prev;
        return { ...prev, documents: prev.documents.filter((d) => d.id !== docDeleteTarget.id) };
      });
      toast({ variant: 'success', title: 'Document deleted', description: `${docDeleteTarget.name} was removed.` });
      setDocDeleteTarget(null);
    } catch (err) {
      toast({ variant: 'error', title: 'Delete failed', description: String(err) });
    } finally {
      setDocDeleting(false);
    }
  };

  // ── Request a document from this employee (admin) ──
  const [docRequestOpen, setDocRequestOpen] = React.useState(false);
  const [docRequestText, setDocRequestText] = React.useState('');
  const [docRequesting, setDocRequesting] = React.useState(false);

  const openDocRequest = (prefill = '') => {
    setDocRequestText(prefill);
    setDocRequestOpen(true);
  };

  const handleDocRequest = async () => {
    const desc = docRequestText.trim();
    if (!desc) {
      toast({ variant: 'error', title: 'Describe the document', description: 'Enter what you need from the employee.' });
      return;
    }
    setDocRequesting(true);
    try {
      await api.documents.requestDocument(desc, params.id);
      toast({ variant: 'success', title: 'Request sent', description: `Asked ${employee.name || 'the employee'} for: ${desc}` });
      setDocRequestOpen(false);
      setDocRequestText('');
    } catch (err) {
      toast({ variant: 'error', title: 'Request failed', description: String(err) });
    } finally {
      setDocRequesting(false);
    }
  };

  const ATT_STATUS_OPTIONS = [
    { label: 'Present', value: 'present' },
    { label: 'Absent', value: 'absent' },
    { label: 'Half Day', value: 'half' },
    { label: 'Leave', value: 'leave' },
    { label: 'Holiday', value: 'holiday' },
    { label: 'Weekend', value: 'weekend' },
  ];

  // Helper to convert date + time (IST) to ISO timestamp.
  // Build the instant directly with the IST offset - works regardless of the
  // browser's timezone. (The previous version constructed IST midnight, called
  // setHours() in browser-local time AND subtracted 5.5h again, saving punch
  // times 5.5 hours early and corrupting attendance data.)
  const toIso = (date: string, time: string) => {
    if (!date || !time) return null;
    if (!/^\d{2}:\d{2}$/.test(time)) return null;
    return new Date(`${date}T${time}:00+05:30`).toISOString();
  };

  // Helper to extract HH:MM in IST from ISO string (TZ-independent).
  const isoToTimeIST = (iso: string | null) => {
    if (!iso) return '';
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso));
  };

  const refetchAttendance = React.useCallback(async () => {
    const { records: attData } = await api.attendance.list({ employeeId: params.id });
    if (attData) {
      const LATE_THRESHOLD = '04:30';
      const history = attData.map((row) => {
        const punchInTime = row.punch_in ? new Date(row.punch_in).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '-';
        const punchOutTime = row.punch_out ? new Date(row.punch_out).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '-';
        const hours = row.worked_hours != null ? `${Number(row.worked_hours).toFixed(1)}h` : '-';
        let status = 'Present';
        if (row.status === 'absent') status = 'Absent';
        else if (row.status === 'leave') status = 'Leave';
        else if (row.status === 'holiday') status = 'Holiday';
        else if (row.status === 'weekend') status = 'Weekend';
        else if (row.status === 'half') status = 'Half Day';
        else if (row.punch_in) {
          const utcTime = row.punch_in.substring(11, 16);
          if (utcTime > LATE_THRESHOLD) status = 'Late';
        }
        return {
          dbId: row.id, rawDate: row.date, rawPunchIn: row.punch_in, rawPunchOut: row.punch_out,
          date: new Date(row.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
          punchIn: punchInTime, punchOut: punchOutTime, hours, status,
        };
      });
      setDbEmployee((prev) => ({ ...prev, attendanceHistory: history }));
    }
  }, [params.id]);

  const openAddAttendance = () => {
    setAttForm(emptyAttForm);
    setAttEditId(null);
    setAttDialogMode('add');
    setAttDialogOpen(true);
  };

  const openEditAttendance = (entry: MockEmployee['attendanceHistory'][number]) => {
    setAttForm({
      date: entry.rawDate,
      punchIn: isoToTimeIST(entry.rawPunchIn),
      punchOut: isoToTimeIST(entry.rawPunchOut),
      status: entry.status.toLowerCase().replace(' ', ''),
    });
    // Map display status back to DB status
    const statusLower = entry.status.toLowerCase();
    let dbStatus = 'present';
    if (statusLower === 'absent') dbStatus = 'absent';
    else if (statusLower === 'leave') dbStatus = 'leave';
    else if (statusLower === 'holiday') dbStatus = 'holiday';
    else if (statusLower === 'weekend') dbStatus = 'weekend';
    else if (statusLower === 'half day') dbStatus = 'half';
    setAttForm((prev) => ({ ...prev, status: dbStatus }));
    setAttEditId(entry.dbId);
    setAttDialogMode('edit');
    setAttDialogOpen(true);
  };

  const handleAttSave = async () => {
    setAttSaving(true);
    try {
      const punchIn = toIso(attForm.date, attForm.punchIn);
      const punchOut = toIso(attForm.date, attForm.punchOut);

      // Calculate worked hours
      let workedHours: number | null = null;
      if (punchIn && punchOut) {
        const diff = (new Date(punchOut).getTime() - new Date(punchIn).getTime()) / 3_600_000;
        if (diff > 0) workedHours = Math.round(diff * 100) / 100;
      }

      if (attDialogMode === 'edit' && attEditId) {
        await api.attendance.edit({
          id: attEditId,
          date: attForm.date,
          punch_in: punchIn ?? undefined,
          punch_out: punchOut ?? undefined,
          worked_hours: workedHours ?? undefined,
          status: attForm.status,
        });
        toast({ variant: 'success', title: 'Attendance updated' });
      } else {
        await api.attendance.add({
          employee_id: params.id,
          date: attForm.date,
          punch_in: punchIn ?? undefined,
          punch_out: punchOut ?? undefined,
          worked_hours: workedHours ?? undefined,
          status: attForm.status,
        });
        toast({ variant: 'success', title: 'Attendance record added' });
      }
      setAttDialogOpen(false);
      await refetchAttendance();
    } catch (err) {
      toast({ variant: 'error', title: 'Failed to save', description: String(err) });
    }
    setAttSaving(false);
  };

  const handleAttDelete = async () => {
    if (!attDeleteTarget) return;
    setAttDeleting(true);
    try {
      await api.attendance.delete(attDeleteTarget.id);
      toast({ variant: 'success', title: 'Attendance record deleted' });
      setAttDeleteOpen(false);
      setAttDeleteTarget(null);
      await refetchAttendance();
    } catch (err) {
      toast({ variant: 'error', title: 'Failed to delete', description: String(err) });
    }
    setAttDeleting(false);
  };

  /* ---- Action helpers ---- */
  const handleForceLogout = async () => {
    try {
      await api.employees.forceLogout(params.id);
      toast({
        variant: "warning",
        title: "Session Revoked",
        description: `All active sessions for ${employee.name} have been terminated.`,
      });
    } catch (err) {
      toast({
        variant: "error",
        title: "Failed to revoke sessions",
        description: err instanceof Error ? err.message : "Please try again.",
      });
    }
  };

  const handleResetPassword = () => {
    // No email service in this deployment: open a dialog so the admin can set or
    // auto-generate a temporary password and share it with the employee directly.
    setResetPasswordOpen(true);
  };

  const handleOffboardConfirm = async (data: {
    lastWorkingDay: string;
    reason: string;
    notes?: string;
  }) => {
    try {
      await api.employees.offboard(params.id, data);
      toast({
        variant: "success",
        title: "Employee Offboarded",
        description: `${employee.name} has been offboarded successfully.`,
      });
      setOffboardOpen(false);
      router.push("/employees");
    } catch (err) {
      toast({
        variant: "error",
        title: "Failed to offboard employee",
        description: err instanceof Error ? err.message : "Please try again.",
      });
      throw err; // keep dialog open and form values
    }
  };

  const maskPan = (pan: string) =>
    pan.slice(0, 3) + "****" + pan.slice(-1);

  const maskAadhaar = (aadhaar: string) =>
    "XXXX XXXX " + aadhaar.slice(-4);

  const maskAccount = (acc: string) => "****" + acc.slice(-4);

  /* ---- Inline edit field helper ---- */
  const ef = (key: string) => editForm[key] ?? "";
  const setEf = (key: string, value: string) =>
    setEditForm((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="space-y-6">
      {/* ---- Back link ---- */}
      <Link
        href="/employees"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Employee Directory
      </Link>

      {/* ---- Offboarded banner ---- */}
      {isOffboarded && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
          <UserX className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <div>
            <p className="text-sm font-semibold text-red-800">
              This employee has been offboarded
            </p>
            <p className="text-sm text-red-600">
              {employee.name}&apos;s account is no longer active. Login access has
              been revoked.
            </p>
          </div>
        </div>
      )}

      {/* ---- Header card ---- */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16 text-lg">
                <AvatarFallback>{getInitials(employee.name)}</AvatarFallback>
              </Avatar>
              <div>
                <h1 className="text-[22px] font-semibold tracking-tight text-gray-900">
                  {employee.name}
                </h1>
                <p className="text-sm text-gray-500">
                  {employee.designation} &middot; {employee.department}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <StatusBadge status={statusMap[employee.status] ?? "active"} />
                  {employee.tracksAttendance === false && (
                    <Badge variant="secondary" title="Excluded from attendance tracking and reports">
                      Observer
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            {isAdmin && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={isOffboarded}
                  title={isOffboarded ? "This employee is already offboarded" : undefined}
                  onClick={() => setOffboardOpen(true)}
                >
                  <UserX className="h-4 w-4" />
                  {isOffboarded ? "Offboarded" : "Offboard"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleForceLogout}
                >
                  <LogOut className="h-4 w-4" />
                  Force Logout
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleResetPassword}
                >
                  <KeyRound className="h-4 w-4" />
                  Reset Password
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ---- Tabs ---- */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="personal">Personal Info</TabsTrigger>
          <TabsTrigger value="employment">Employment</TabsTrigger>
          <TabsTrigger value="bank">Bank Details</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="leaves">Leaves</TabsTrigger>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
          {customFieldEntries.length > 0 && (
            <TabsTrigger value="additional">Additional Info</TabsTrigger>
          )}
          <TabsTrigger value="audit">Audit Trail</TabsTrigger>
        </TabsList>

        {/* -------- Overview -------- */}
        <TabsContent value="overview">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <OverviewCard
              icon={<Phone className="h-5 w-5 text-blue-600" />}
              label="Phone"
              value={employee.phone}
            />
            <OverviewCard
              icon={<Mail className="h-5 w-5 text-blue-600" />}
              label="Work Email"
              value={employee.email}
            />
            <OverviewCard
              icon={<Building2 className="h-5 w-5 text-blue-600" />}
              label="Department"
              value={employee.department}
            />
            <OverviewCard
              icon={<Briefcase className="h-5 w-5 text-blue-600" />}
              label="Designation"
              value={employee.designation}
            />
            <OverviewCard
              icon={<CalendarDays className="h-5 w-5 text-blue-600" />}
              label="Date of Joining"
              value={employee.dateOfJoining}
            />
          </div>
        </TabsContent>

        {/* -------- Personal Info -------- */}
        <TabsContent value="personal">
          <div className="space-y-4">
            {/* Personal Information */}
            <Card>
              <CardHeader className="px-6 py-4">
                <SectionHeader
                  title="Personal Information"
                  section="personal"
                  editSection={editSection}
                  isAdmin={isAdmin}
                  sectionSaving={sectionSaving}
                  onStartEdit={startEdit}
                  onSave={handleSectionSave}
                  onCancel={cancelEdit}
                />
              </CardHeader>
              <CardContent className="space-y-4 px-6 pb-6">
                {editSection === "personal" ? (
                  <>
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
                      <span className="w-40 shrink-0 text-sm font-medium text-gray-500">Date of Birth</span>
                      <Input type="date" className="max-w-sm" value={ef("dob")} onChange={(e) => setEf("dob", e.target.value)} />
                    </div>
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
                      <span className="w-40 shrink-0 text-sm font-medium text-gray-500">Gender</span>
                      <div className="max-w-sm">
                        <Select options={GENDER_OPTIONS} value={ef("gender")} onChange={(e) => setEf("gender", e.target.value)} />
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
                      <span className="w-40 shrink-0 text-sm font-medium text-gray-500">Blood Group</span>
                      <div className="max-w-sm">
                        <Select options={BLOOD_GROUP_OPTIONS} value={ef("bloodGroup")} onChange={(e) => setEf("bloodGroup", e.target.value)} />
                      </div>
                    </div>
                    <InfoRow label="Phone" value={employee.phone} editing editValue={ef("phone")} onEditChange={(v) => setEf("phone", v)} />
                    <InfoRow label="Personal Email" value={employee.personalEmail} editing editValue={ef("personalEmail")} onEditChange={(v) => setEf("personalEmail", v)} />
                    <InfoRow label="Permanent Address" value={employee.permanentAddress} editing editValue={ef("permanentAddress")} onEditChange={(v) => setEf("permanentAddress", v)} />
                    <InfoRow label="Current Address" value={employee.currentAddress} editing editValue={ef("currentAddress")} onEditChange={(v) => setEf("currentAddress", v)} />
                  </>
                ) : (
                  <>
                    <InfoRow label="Date of Birth" value={employee.dob} />
                    <InfoRow label="Gender" value={employee.gender} />
                    <InfoRow label="Blood Group" value={employee.bloodGroup} />
                    <InfoRow label="Phone" value={employee.phone} />
                    <InfoRow label="Personal Email" value={employee.personalEmail} />
                    <InfoRow label="Permanent Address" value={employee.permanentAddress} />
                    <InfoRow label="Current Address" value={employee.currentAddress} />
                  </>
                )}
              </CardContent>
            </Card>

            {/* Emergency Contact */}
            <Card>
              <CardHeader className="px-6 py-4">
                <SectionHeader
                  title="Emergency Contact"
                  section="emergency"
                  editSection={editSection}
                  isAdmin={isAdmin}
                  sectionSaving={sectionSaving}
                  onStartEdit={startEdit}
                  onSave={handleSectionSave}
                  onCancel={cancelEdit}
                />
              </CardHeader>
              <CardContent className="space-y-4 px-6 pb-6">
                {editSection === "emergency" ? (
                  <>
                    <InfoRow label="Name" value={employee.emergencyContact.name} editing editValue={ef("emergencyName")} onEditChange={(v) => setEf("emergencyName", v)} />
                    <InfoRow label="Relationship" value={employee.emergencyContact.relationship} editing editValue={ef("emergencyRelationship")} onEditChange={(v) => setEf("emergencyRelationship", v)} />
                    <InfoRow label="Phone" value={employee.emergencyContact.phone} editing editValue={ef("emergencyPhone")} onEditChange={(v) => setEf("emergencyPhone", v)} />
                  </>
                ) : (
                  <>
                    <InfoRow label="Name" value={employee.emergencyContact.name} />
                    <InfoRow label="Relationship" value={employee.emergencyContact.relationship} />
                    <InfoRow label="Phone" value={employee.emergencyContact.phone} />
                  </>
                )}
              </CardContent>
            </Card>

            {/* Identity Documents */}
            <Card>
              <CardHeader className="px-6 py-4">
                <SectionHeader
                  title="Identity Documents"
                  section="identity"
                  editSection={editSection}
                  isAdmin={isAdmin}
                  sectionSaving={sectionSaving}
                  onStartEdit={startEdit}
                  onSave={handleSectionSave}
                  onCancel={cancelEdit}
                />
              </CardHeader>
              <CardContent className="space-y-4 px-6 pb-6">
                {editSection === "identity" ? (
                  <>
                    <InfoRow label="PAN" value={employee.pan} editing editValue={ef("pan")} onEditChange={(v) => setEf("pan", v)} />
                    <InfoRow label="Aadhaar" value={employee.aadhaar} editing editValue={ef("aadhaar")} onEditChange={(v) => setEf("aadhaar", v)} />
                  </>
                ) : (
                  <>
                    <InfoRow label="PAN" value={maskPan(employee.pan)} />
                    <InfoRow label="Aadhaar" value={maskAadhaar(employee.aadhaar)} />
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* -------- Employment -------- */}
        <TabsContent value="employment">
          <Card>
            <CardHeader className="px-6 py-4">
              <SectionHeader
                title="Employment Details"
                section="employment"
                editSection={editSection}
                isAdmin={isAdmin}
                sectionSaving={sectionSaving}
                onStartEdit={startEdit}
                onSave={handleSectionSave}
                onCancel={cancelEdit}
              />
            </CardHeader>
            <CardContent className="space-y-4 px-6 pb-6">
              {editSection === "employment" ? (
                <>
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
                    <span className="w-40 shrink-0 text-sm font-medium text-gray-500">Department</span>
                    <Select options={departmentOptions} value={ef("department")} onChange={(e) => setEf("department", e.target.value)} className="max-w-sm" placeholder="Select department" />
                  </div>
                  <InfoRow label="Designation" value={employee.designation} editing editValue={ef("designation")} onEditChange={(v) => setEf("designation", v)} />
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
                    <span className="w-40 shrink-0 text-sm font-medium text-gray-500">Date of Joining</span>
                    <Input type="date" className="max-w-sm" value={ef("dateOfJoining")} onChange={(e) => setEf("dateOfJoining", e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
                    <span className="w-40 shrink-0 text-sm font-medium text-gray-500">Reporting Manager</span>
                    <Select
                      options={[{ label: 'None', value: '' }, ...employeeOptions]}
                      value={ef("reportingManager")}
                      onChange={(e) => setEf("reportingManager", e.target.value)}
                      className="max-w-sm"
                      placeholder="Select reporting manager"
                    />
                  </div>
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
                    <span className="w-40 shrink-0 text-sm font-medium text-gray-500">Attendance Tracking</span>
                    <Select
                      options={[{ label: 'Tracks attendance', value: 'no' }, { label: 'Observer (excluded)', value: 'yes' }]}
                      value={ef("observer")}
                      onChange={(e) => setEf("observer", e.target.value)}
                      className="max-w-sm"
                    />
                  </div>
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
                    <span className="w-40 shrink-0 text-sm font-medium text-gray-500">Shift Start</span>
                    <Input type="time" className="max-w-sm" value={ef("shiftStart")} onChange={(e) => setEf("shiftStart", e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
                    <span className="w-40 shrink-0 text-sm font-medium text-gray-500">Shift End</span>
                    <Input type="time" className="max-w-sm" value={ef("shiftEnd")} onChange={(e) => setEf("shiftEnd", e.target.value)} />
                  </div>
                  <InfoRow label="Employee ID" value={employee.employeeId} />
                </>
              ) : (
                <>
                  <InfoRow label="Department" value={employee.department} />
                  <InfoRow label="Designation" value={employee.designation} />
                  <InfoRow label="Date of Joining" value={employee.dateOfJoining} />
                  <InfoRow label="Reporting Manager" value={employee.reportingManagerName || 'Not assigned'} />
                  <InfoRow label="Attendance Tracking" value={employee.tracksAttendance === false ? 'Observer (excluded from reports)' : 'Tracks attendance'} />
                  <InfoRow label="Shift" value={formatShift(employee.shiftStart, employee.shiftEnd)} />
                  <InfoRow label="Employee ID" value={employee.employeeId} />
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* -------- Bank Details -------- */}
        <TabsContent value="bank">
          <Card>
            <CardHeader className="px-6 py-4">
              <SectionHeader
                title="Bank Details"
                section="bank"
                editSection={editSection}
                isAdmin={isAdmin}
                sectionSaving={sectionSaving}
                onStartEdit={startEdit}
                onSave={handleSectionSave}
                onCancel={cancelEdit}
              />
            </CardHeader>
            <CardContent className="space-y-4 px-6 pb-6">
              {editSection === "bank" ? (
                <>
                  <InfoRow label="Bank Name" value={employee.bankDetails.bankName} editing editValue={ef("bankName")} onEditChange={(v) => setEf("bankName", v)} />
                  <InfoRow label="Account Number" value={employee.bankDetails.accountNumber} editing editValue={ef("accountNumber")} onEditChange={(v) => setEf("accountNumber", v)} />
                  <InfoRow label="IFSC Code" value={employee.bankDetails.ifsc} editing editValue={ef("ifsc")} onEditChange={(v) => setEf("ifsc", v)} />
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
                    <span className="w-40 shrink-0 text-sm font-medium text-gray-500">Account Type</span>
                    <div className="max-w-sm">
                      <Select options={ACCOUNT_TYPE_OPTIONS} value={ef("accountType")} onChange={(e) => setEf("accountType", e.target.value)} />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <InfoRow label="Bank Name" value={employee.bankDetails.bankName} />
                  <InfoRow label="Account Number" value={maskAccount(employee.bankDetails.accountNumber)} />
                  <InfoRow label="IFSC Code" value={employee.bankDetails.ifsc} />
                  <InfoRow label="Account Type" value={employee.bankDetails.accountType} />
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* -------- Documents -------- */}
        <TabsContent value="documents">
          <Card>
            <CardContent className="p-6">
              {/* Header: title + request-document action (admin) */}
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-800">Documents</h3>
                {isAdmin && (
                  <Button size="sm" variant="outline" onClick={() => openDocRequest()}>
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Request document
                  </Button>
                )}
              </div>

              {/* Summary header: how many required docs are present */}
              {expectedDocs.length > 0 && (() => {
                const total = documentChecklist.expected.length;
                const present = documentChecklist.expected.filter((e) => e.files.length > 0).length;
                const allIn = present === total;
                return (
                  <div className={`mb-4 flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${allIn ? 'border-green-200 bg-green-50 text-green-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                    {allIn ? <ShieldCheck className="h-4 w-4" /> : <ShieldX className="h-4 w-4" />}
                    <span className="font-medium">
                      {present} of {total} required document{total === 1 ? '' : 's'} uploaded
                    </span>
                    {!allIn && <span className="text-amber-700">— {total - present} missing</span>}
                  </div>
                );
              })()}

              {/* Required-document checklist */}
              {documentChecklist.expected.length > 0 && (
                <div className="space-y-3">
                  {documentChecklist.expected.map((item) => {
                    const uploaded = item.files.length > 0;
                    return (
                      <div
                        key={item.label}
                        className={`rounded-lg border p-3 ${uploaded ? 'border-gray-200' : 'border-dashed border-amber-300 bg-amber-50/40'}`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {uploaded ? (
                              <ShieldCheck className="h-4 w-4 text-green-600" />
                            ) : (
                              <ShieldX className="h-4 w-4 text-amber-500" />
                            )}
                            <span className="font-medium text-gray-800">{item.label}</span>
                          </div>
                          {uploaded ? (
                            <Badge variant="success">
                              {item.files.length > 1 ? `${item.files.length} files` : 'Uploaded'}
                            </Badge>
                          ) : (
                            <div className="flex items-center gap-2">
                              <Badge variant="warning">Missing</Badge>
                              {isAdmin && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-amber-700 hover:text-amber-800"
                                  onClick={() => openDocRequest(`Please upload: ${item.label}`)}
                                >
                                  Request
                                </Button>
                              )}
                            </div>
                          )}
                        </div>

                        {uploaded && (
                          <div className="mt-2 space-y-1">
                            {item.files.map((doc) => (
                              <div key={doc.id} className="flex items-center justify-between gap-2 rounded-md bg-gray-50 px-2 py-1.5">
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm text-gray-700">{doc.name}</p>
                                  <p className="text-xs text-gray-400">
                                    Uploaded {doc.uploadedAt}
                                    {doc.verified ? ' · Verified' : ' · Unverified'}
                                  </p>
                                </div>
                                <div className="flex shrink-0 items-center">
                                  <Button variant="ghost" size="sm" onClick={() => handleDocView(doc)}>
                                    <Eye className="mr-1 h-4 w-4" />View
                                  </Button>
                                  <Button variant="ghost" size="sm" onClick={() => handleDocDownload(doc)}>
                                    <Download className="mr-1 h-4 w-4" />
                                  </Button>
                                  {isAdmin && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className={doc.verified ? 'text-amber-600 hover:text-amber-700' : 'text-green-600 hover:text-green-700'}
                                      onClick={() => handleDocVerify(doc)}
                                    >
                                      {doc.verified ? <ShieldX className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                                    </Button>
                                  )}
                                  {isAdmin && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="text-red-600 hover:text-red-700"
                                      onClick={() => setDocDeleteTarget(doc)}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Other / unexpected uploads, and the fallback when there's no config */}
              {documentChecklist.others.length > 0 && (
                <div className="mt-6">
                  {documentChecklist.expected.length > 0 && (
                    <h4 className="mb-2 text-sm font-medium text-gray-700">Other documents</h4>
                  )}
                  <div className="space-y-1">
                    {documentChecklist.others.map((doc) => (
                      <div key={doc.id} className="flex items-center justify-between gap-2 rounded-md border border-gray-200 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-gray-800">{doc.name}</p>
                          <p className="text-xs text-gray-400">
                            {doc.category} · {doc.uploadedAt}{doc.verified ? ' · Verified' : ' · Unverified'}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center">
                          <Button variant="ghost" size="sm" onClick={() => handleDocView(doc)}>
                            <Eye className="mr-1 h-4 w-4" />View
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => handleDocDownload(doc)}>
                            <Download className="mr-1 h-4 w-4" />
                          </Button>
                          {isAdmin && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className={doc.verified ? 'text-amber-600 hover:text-amber-700' : 'text-green-600 hover:text-green-700'}
                              onClick={() => handleDocVerify(doc)}
                            >
                              {doc.verified ? <ShieldX className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                            </Button>
                          )}
                          {isAdmin && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-red-600 hover:text-red-700"
                              onClick={() => setDocDeleteTarget(doc)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Nothing at all */}
              {documentChecklist.expected.length === 0 && documentChecklist.others.length === 0 && (
                <div className="py-10 text-center">
                  <Download className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                  <p className="text-sm text-gray-500">No documents uploaded.</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Delete document confirm */}
          <Dialog open={!!docDeleteTarget} onOpenChange={(o) => { if (!o) setDocDeleteTarget(null); }}>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>Delete Document</DialogTitle>
                <DialogDescription>
                  Delete <strong>{docDeleteTarget?.name}</strong>? This permanently removes the file and cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="mt-6">
                <Button variant="outline" onClick={() => setDocDeleteTarget(null)}>Cancel</Button>
                <Button variant="destructive" onClick={handleDocDelete} disabled={docDeleting}>
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  {docDeleting ? 'Deleting...' : 'Delete'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Request document from this employee */}
          <Dialog open={docRequestOpen} onOpenChange={(o) => { setDocRequestOpen(o); if (!o) setDocRequestText(''); }}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Request a document</DialogTitle>
                <DialogDescription>
                  Ask {employee.name || 'this employee'} to upload a document. They will be notified and can upload it from their Documents page.
                </DialogDescription>
              </DialogHeader>
              <div className="mt-4">
                <Textarea
                  label="What do you need?"
                  placeholder="e.g. Please upload your latest address proof."
                  value={docRequestText}
                  onChange={(e) => setDocRequestText(e.target.value)}
                  rows={4}
                />
              </div>
              <DialogFooter className="mt-6">
                <Button variant="outline" onClick={() => setDocRequestOpen(false)}>Cancel</Button>
                <Button onClick={handleDocRequest} disabled={docRequesting}>
                  <Plus className="mr-1.5 h-4 w-4" />
                  {docRequesting ? 'Sending...' : 'Send request'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* -------- Leaves -------- */}
        <TabsContent value="leaves">
          <div className="space-y-6">
            {/* Leave Balances */}
            <Card>
              <CardHeader>
                <CardTitle>Leave Balances</CardTitle>
              </CardHeader>
              <CardContent>
                {employee.leaveBalances.length === 0 ? (
                  <div className="py-10 text-center">
                    <CalendarDays className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                    <p className="text-sm text-gray-500">No leave types configured.</p>
                  </div>
                ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Leave Type</TableHead>
                      <TableHead className="text-center">Total</TableHead>
                      <TableHead className="text-center">Used</TableHead>
                      <TableHead className="text-center">
                        Remaining
                      </TableHead>
                      {isAdmin && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {employee.leaveBalances.map((lb, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">
                          <span className="inline-flex items-center gap-2">
                            {lb.type}
                            {lb.isOverride && (
                              <Badge variant="secondary" className="text-[10px]">
                                Custom
                              </Badge>
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          {lb.total}
                          {lb.isOverride && (
                            <span className="ml-1 text-xs text-gray-400">
                              (default {lb.defaultDays})
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {lb.used}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge
                            variant={
                              lb.remaining > 3 ? "success" : "warning"
                            }
                          >
                            {lb.remaining}
                          </Badge>
                        </TableCell>
                        {isAdmin && (
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => openEditLeave(lb)}
                                disabled={leaveSaving}
                              >
                                <Pencil className="mr-1 h-3.5 w-3.5" />
                                Edit
                              </Button>
                              {lb.isOverride && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleLeaveResetToDefault(lb)}
                                  disabled={leaveSaving}
                                  title="Revert to company default"
                                >
                                  <RotateCcw className="mr-1 h-3.5 w-3.5" />
                                  Reset
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                )}
              </CardContent>
            </Card>

            {/* Leave History */}
            <Card>
              <CardHeader>
                <CardTitle>Leave History</CardTitle>
              </CardHeader>
              <CardContent>
                {employee.leaveHistory.length === 0 ? (
                  <div className="py-10 text-center">
                    <CalendarDays className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                    <p className="text-sm text-gray-500">No leave requests found.</p>
                  </div>
                ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>From</TableHead>
                      <TableHead>To</TableHead>
                      <TableHead className="text-center">Days</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {employee.leaveHistory.map((lh, i) => (
                      <TableRow key={i}>
                        <TableCell>{lh.type}</TableCell>
                        <TableCell>{lh.from}</TableCell>
                        <TableCell>{lh.to}</TableCell>
                        <TableCell className="text-center">
                          {lh.days}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              lh.status === "Approved"
                                ? "success"
                                : lh.status === "Pending"
                                  ? "warning"
                                  : "destructive"
                            }
                          >
                            {lh.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Edit leave balance dialog */}
          <Dialog open={leaveDialogOpen} onOpenChange={(o) => { setLeaveDialogOpen(o); if (!o) setLeaveEditTarget(null); }}>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>Edit Leave Balance</DialogTitle>
                <DialogDescription>
                  Set a custom annual allocation of <strong>{leaveEditTarget?.type}</strong> for this employee.
                  {leaveEditTarget && (
                    <> Company default is <strong>{leaveEditTarget.defaultDays}</strong> day{leaveEditTarget.defaultDays === 1 ? '' : 's'}.</>
                  )}
                </DialogDescription>
              </DialogHeader>
              <div className="mt-4 space-y-2">
                <label className="text-sm font-medium text-gray-700">Total days</label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={leaveDaysInput}
                  onChange={(e) => setLeaveDaysInput(e.target.value)}
                  autoFocus
                />
                {leaveEditTarget && Number(leaveDaysInput) === leaveEditTarget.defaultDays && (
                  <p className="text-xs text-gray-500">
                    Matches the company default, so any custom override will be removed.
                  </p>
                )}
              </div>
              <DialogFooter className="mt-6">
                <Button variant="outline" onClick={() => { setLeaveDialogOpen(false); setLeaveEditTarget(null); }}>Cancel</Button>
                <Button onClick={handleLeaveSave} disabled={leaveSaving}>
                  <Save className="mr-1.5 h-4 w-4" />
                  {leaveSaving ? 'Saving...' : 'Save'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* -------- Attendance -------- */}
        <TabsContent value="attendance">
          <Card>
            <CardHeader className="px-6 py-4">
              <div className="flex w-full items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-blue-600" />
                  Recent Attendance
                </CardTitle>
                {isAdmin && (
                  <Button size="sm" onClick={openAddAttendance}>
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Add Record
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {employee.attendanceHistory.length === 0 ? (
                <div className="py-10 text-center">
                  <Clock className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                  <p className="text-sm text-gray-500">No attendance records found.</p>
                </div>
              ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Punch In</TableHead>
                    <TableHead>Punch Out</TableHead>
                    <TableHead>Hours</TableHead>
                    <TableHead>Status</TableHead>
                    {isAdmin && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employee.attendanceHistory.map((entry, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs">{entry.date}</TableCell>
                      <TableCell className="font-mono text-xs">{entry.punchIn}</TableCell>
                      <TableCell className="font-mono text-xs">{entry.punchOut}</TableCell>
                      <TableCell className="font-mono text-xs">{entry.hours}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            entry.status === "Present"
                              ? "success"
                              : entry.status === "Late"
                                ? "warning"
                                : entry.status === "Absent"
                                  ? "destructive"
                                  : "secondary"
                          }
                        >
                          {entry.status}
                        </Badge>
                      </TableCell>
                      {isAdmin && (
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-gray-500 hover:text-blue-600"
                              onClick={() => openEditAttendance(entry)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-gray-500 hover:text-red-600"
                              onClick={() => {
                                setAttDeleteTarget({ id: entry.dbId, date: entry.date });
                                setAttDeleteOpen(true);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              )}
            </CardContent>
          </Card>

          {/* Add / Edit attendance dialog */}
          <Dialog open={attDialogOpen} onOpenChange={setAttDialogOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{attDialogMode === 'add' ? 'Add Attendance Record' : 'Edit Attendance Record'}</DialogTitle>
                <DialogDescription>
                  {attDialogMode === 'add'
                    ? 'Manually add an attendance entry for this employee.'
                    : 'Update the attendance details for this record.'}
                </DialogDescription>
              </DialogHeader>
              <div className="mt-6 space-y-5">
                <Input
                  label="Date"
                  type="date"
                  value={attForm.date}
                  onChange={(e) => setAttForm((p) => ({ ...p, date: e.target.value }))}
                />
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label="Punch In (IST)"
                    type="time"
                    value={attForm.punchIn}
                    onChange={(e) => setAttForm((p) => ({ ...p, punchIn: e.target.value }))}
                  />
                  <Input
                    label="Punch Out (IST)"
                    type="time"
                    value={attForm.punchOut}
                    onChange={(e) => setAttForm((p) => ({ ...p, punchOut: e.target.value }))}
                  />
                </div>
                <Select
                  label="Status"
                  options={ATT_STATUS_OPTIONS}
                  value={attForm.status}
                  onChange={(e) => setAttForm((p) => ({ ...p, status: e.target.value }))}
                />
              </div>
              <DialogFooter className="mt-8">
                <Button variant="outline" onClick={() => setAttDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleAttSave} disabled={!attForm.date || attSaving}>
                  <Save className="mr-1.5 h-4 w-4" />
                  {attSaving ? 'Saving...' : attDialogMode === 'add' ? 'Add Record' : 'Save Changes'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Delete confirmation dialog */}
          <Dialog open={attDeleteOpen} onOpenChange={setAttDeleteOpen}>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>Delete Attendance Record</DialogTitle>
                <DialogDescription>
                  Are you sure you want to delete the attendance record for <strong>{attDeleteTarget?.date}</strong>? This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="mt-6">
                <Button variant="outline" onClick={() => { setAttDeleteOpen(false); setAttDeleteTarget(null); }}>Cancel</Button>
                <Button variant="destructive" onClick={handleAttDelete} disabled={attDeleting}>
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  {attDeleting ? 'Deleting...' : 'Delete'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* -------- Additional Info (custom/dynamic fields) -------- */}
        {customFieldEntries.length > 0 && (
          <TabsContent value="additional">
            <Card>
              <CardHeader className="px-6 py-4">
                <div className="flex w-full items-center justify-between">
                  <CardTitle className="text-base">Additional Information</CardTitle>
                  {isAdmin && (
                    editSection === 'custom' ? (
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={cancelEdit} disabled={sectionSaving}>
                          <X className="h-3.5 w-3.5 mr-1" />Cancel
                        </Button>
                        <Button size="sm" onClick={async () => {
                          setSectionSaving(true);
                          try {
                            const updated = { ...employee.customFields };
                            for (const entry of customFieldEntries) {
                              updated[entry.id] = editForm[entry.id] ?? entry.value;
                            }
                            await api.employees.update(params.id, { custom_fields: updated });
                            setDbEmployee((prev) => prev ? { ...prev, customFields: updated } : prev);
                            toast({ variant: 'success', title: 'Updated', description: 'Additional info saved.' });
                            setEditSection(null);
                            setEditForm({});
                          } catch (err) {
                            toast({ variant: 'error', title: 'Save failed', description: String(err) });
                          }
                          setSectionSaving(false);
                        }} disabled={sectionSaving}>
                          <Save className="h-3.5 w-3.5 mr-1" />{sectionSaving ? 'Saving...' : 'Save'}
                        </Button>
                      </div>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => {
                        const prefill: Record<string, string> = {};
                        for (const entry of customFieldEntries) {
                          prefill[entry.id] = entry.value;
                        }
                        setEditForm(prefill);
                        setEditSection('custom');
                      }} disabled={editSection !== null && editSection !== 'custom'}>
                        <Pencil className="h-3.5 w-3.5 mr-1" />Edit
                      </Button>
                    )
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4 p-6 pt-0">
                {customFieldEntries.map((entry) => (
                  <InfoRow
                    key={entry.id}
                    label={entry.label}
                    value={entry.value}
                    editing={editSection === 'custom'}
                    editValue={editForm[entry.id]}
                    onEditChange={(v) => setEditForm((prev) => ({ ...prev, [entry.id]: v }))}
                  />
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* -------- Audit Trail -------- */}
        <TabsContent value="audit">
          <Card>
            <CardHeader>
              <CardTitle>Audit Trail</CardTitle>
            </CardHeader>
            <CardContent>
              {employee.auditTrail.length === 0 ? (
                <div className="py-10 text-center">
                  <Clock className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                  <p className="text-sm text-gray-500">No audit log entries found.</p>
                </div>
              ) : (
              <div className="space-y-4">
                {employee.auditTrail.map((entry, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 border-b border-gray-100 pb-4 last:border-0 last:pb-0"
                  >
                    <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">
                        {entry.action}
                      </p>
                      <p className="text-xs text-gray-500">
                        {entry.performedBy} &middot; {entry.timestamp}
                      </p>
                      <p className="mt-0.5 text-sm text-gray-600">
                        {entry.details}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ---- Offboard Dialog ---- */}
      <OffboardDialog
        open={offboardOpen}
        onOpenChange={setOffboardOpen}
        employeeName={employee.name}
        employeeId={employee.employeeId}
        onConfirm={handleOffboardConfirm}
      />
      <ResetPasswordDialog
        open={resetPasswordOpen}
        onOpenChange={setResetPasswordOpen}
        employeeName={employee.name}
        employeeId={params.id}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Overview Card (small helper)                                       */
/* ------------------------------------------------------------------ */

function OverviewCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50">
          {icon}
        </div>
        <div>
          <p className="text-xs font-medium text-gray-500">{label}</p>
          <p className="text-sm font-semibold text-gray-900">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
