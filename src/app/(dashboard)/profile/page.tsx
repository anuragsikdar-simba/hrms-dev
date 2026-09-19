"use client";

import * as React from "react";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { Avatar, AvatarFallback, getInitials } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { ChangeRequestDialog } from "@/components/profile/change-request-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Pencil,
  Lock,
  User,
  Briefcase,
  Landmark,
  FileText,
  Phone,
  Mail,
  MapPin,
  Calendar,
  Heart,
  Droplets,
  Shield,
  CreditCard,
  Building2,
  BadgeCheck,
  Clock,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Empty profile defaults (populated from Supabase)                   */
/* ------------------------------------------------------------------ */

const EMPTY_PROFILE = {
  name: "",
  email: "",
  employeeId: "",
  department: "",
  designation: "",
  dateOfJoining: "",
  employmentType: "",
  reportingManager: "",
  profilePictureUrl: null as string | null,

  // Shift (raw HH:MM, empty = no fixed shift)
  shiftStart: "",
  shiftEnd: "",

  // Personal
  personalEmail: "",
  phone: "",
  dob: "",
  gender: "",
  bloodGroup: "",

  // Addresses
  permanentAddress: "",
  currentAddress: "",

  // Emergency
  emergencyContact: {
    name: "",
    relationship: "",
    phone: "",
  },

  // Identity (masked)
  pan: "",
  aadhaar: "",

  // Bank
  bankDetails: {
    bankName: "",
    accountNumber: "",
    ifscCode: "",
    branchName: "",
  },

  // Documents
  documents: [] as { name: string; category: string; verified: boolean }[],
};

/* ------------------------------------------------------------------ */
/*  Pending change requests (empty until real change-request system)   */
/* ------------------------------------------------------------------ */

const PENDING_CHANGES: Record<string, string> = {};

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ProfileField {
  label: string;
  value: string;
  editable: boolean;
  pending?: boolean;
  pendingValue?: string;
  icon?: React.ReactNode;
}

/* ------------------------------------------------------------------ */
/*  ProfileFieldRow                                                    */
/* ------------------------------------------------------------------ */

function ProfileFieldRow({
  field,
  onEdit,
}: {
  field: ProfileField;
  onEdit?: (label: string, currentValue: string) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5">
      <div className="flex items-start gap-3 min-w-0 flex-1">
        {field.icon && (
          <span className="mt-0.5 shrink-0 text-gray-400">{field.icon}</span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-gray-500">{field.label}</p>
          <p className="mt-0.5 text-sm text-gray-900 break-words">
            {field.value || "-"}
          </p>
          {field.pending && field.pendingValue && (
            <div className="mt-1 flex items-center gap-2">
              <Badge variant="warning">Pending</Badge>
              <span className="text-xs text-yellow-700">
                Requested: {field.pendingValue}
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="shrink-0 mt-0.5">
        {field.editable ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => onEdit?.(field.label, field.value)}
            aria-label={`Edit ${field.label}`}
          >
            <Pencil className="h-3.5 w-3.5 text-gray-400 hover:text-blue-600" />
          </Button>
        ) : (
          <span className="inline-flex h-7 w-7 items-center justify-center">
            <Lock className="h-3.5 w-3.5 text-gray-300" />
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function MyProfilePage() {
  const { userProfile } = useAuth();
  const { toast } = useToast();

  // Dialog state
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [dialogField, setDialogField] = React.useState("");
  const [dialogCurrentValue, setDialogCurrentValue] = React.useState("");

  // Local pending changes (includes mock + newly submitted)
  const [pendingChanges, setPendingChanges] =
    React.useState<Record<string, string>>(PENDING_CHANGES);

  // Profile data from Supabase
  const [profile, setProfile] = React.useState(EMPTY_PROFILE);

  React.useEffect(() => {
    if (!userProfile?.id) return;

    async function fetchProfile() {
      try {
        const { employee: data } = await api.employees.get(userProfile!.id);

        if (data) {
          setProfile({
            name: data.name ?? EMPTY_PROFILE.name,
            email: data.email ?? EMPTY_PROFILE.email,
            employeeId: data.employee_id ?? EMPTY_PROFILE.employeeId,
            department: data.department?.name ?? EMPTY_PROFILE.department,
            designation: data.designation ?? EMPTY_PROFILE.designation,
            dateOfJoining: data.date_of_joining ? new Date(data.date_of_joining).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : EMPTY_PROFILE.dateOfJoining,
            employmentType: data.employment_type ?? EMPTY_PROFILE.employmentType,
            reportingManager: (Array.isArray(data.reporting_manager) ? data.reporting_manager[0]?.name : data.reporting_manager?.name) ?? EMPTY_PROFILE.reportingManager,
            profilePictureUrl: data.avatar_url ?? EMPTY_PROFILE.profilePictureUrl,
            // time columns come back as HH:MM:SS; keep HH:MM for display/compare
            shiftStart: typeof data.shift_start === 'string' ? data.shift_start.slice(0, 5) : EMPTY_PROFILE.shiftStart,
            shiftEnd: typeof data.shift_end === 'string' ? data.shift_end.slice(0, 5) : EMPTY_PROFILE.shiftEnd,
            personalEmail: data.personal_email ?? EMPTY_PROFILE.personalEmail,
            phone: data.phone ?? EMPTY_PROFILE.phone,
            dob: data.date_of_birth ? new Date(data.date_of_birth).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : EMPTY_PROFILE.dob,
            gender: data.gender ?? EMPTY_PROFILE.gender,
            bloodGroup: data.blood_group ?? EMPTY_PROFILE.bloodGroup,
            permanentAddress: data.permanent_address ?? EMPTY_PROFILE.permanentAddress,
            currentAddress: data.current_address ?? EMPTY_PROFILE.currentAddress,
            emergencyContact: data.emergency_contact ?? EMPTY_PROFILE.emergencyContact,
            pan: data.pan ? `****${(data.pan as string).slice(-4)}` : EMPTY_PROFILE.pan,
            aadhaar: data.aadhaar ? `****${(data.aadhaar as string).slice(-4)}` : EMPTY_PROFILE.aadhaar,
            bankDetails: data.bank_details ?? EMPTY_PROFILE.bankDetails,
            documents: EMPTY_PROFILE.documents,
          });
        }
      } catch (err) {
        console.error('[profile] fetch error:', err);
      }
    }
    fetchProfile();
  }, [userProfile]);

  // Fetch existing pending profile change requests
  React.useEffect(() => {
    if (!userProfile?.id) return;

    async function fetchPendingChanges() {
      try {
        const { requests } = await api.approvalRequests.list({ type: 'profile_change', status: 'pending' });
        const pending: Record<string, string> = {};
        for (const req of requests) {
          try {
            const parsed = JSON.parse(req.requested_change);
            if (parsed.field_name && parsed.new_value) {
              pending[parsed.field_name] = parsed.new_value;
            }
          } catch {
            // Skip malformed entries
          }
        }
        setPendingChanges(pending);
      } catch {
        // Non-critical: pending badges just won't show
      }
    }
    fetchPendingChanges();
  }, [userProfile]);

  const handleEditClick = (fieldName: string, currentValue: string) => {
    setDialogField(fieldName);
    setDialogCurrentValue(currentValue);
    setDialogOpen(true);
  };

  const handleChangeSubmit = async (newValue: string, reason: string) => {
    try {
      await api.approvalRequests.create({
        type: 'profile_change',
        field_name: dialogField,
        new_value: newValue,
        reason: reason || undefined,
        requested_change: `Change ${dialogField} to: ${newValue}`,
      });
      setPendingChanges((prev) => ({ ...prev, [dialogField]: newValue }));
      toast({
        title: "Change request submitted",
        description: `Your request to update ${dialogField} has been submitted for approval.`,
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Failed to submit change request",
        description: err instanceof Error ? err.message : "Something went wrong. Please try again.",
        variant: "error",
      });
      throw err; // Re-throw so dialog stays open
    }
  };

  /* ---- Shift change request ---- */

  const [shiftDialogOpen, setShiftDialogOpen] = React.useState(false);
  const [shiftForm, setShiftForm] = React.useState({ start: "", end: "", reason: "" });
  const [shiftSubmitting, setShiftSubmitting] = React.useState(false);
  const [shiftError, setShiftError] = React.useState("");
  const [pendingShiftChange, setPendingShiftChange] = React.useState<string | null>(null);

  // Load any pending shift-change request so the employee can't double-submit.
  React.useEffect(() => {
    if (!userProfile?.id) return;
    (async () => {
      try {
        const { requests } = await api.approvalRequests.list({ type: 'shift_change', status: 'pending' });
        const mine = (requests ?? []).find(
          (r: Record<string, unknown>) => r.employee_id === userProfile.id,
        );
        if (mine?.requested_change) {
          try {
            const c = JSON.parse(mine.requested_change as string) as {
              new_shift_start?: string; new_shift_end?: string;
            };
            if (c.new_shift_start && c.new_shift_end) {
              setPendingShiftChange(`${c.new_shift_start} - ${c.new_shift_end}`);
            }
          } catch { /* malformed payload: no badge */ }
        }
      } catch { /* non-critical */ }
    })();
  }, [userProfile?.id]);

  const openShiftDialog = () => {
    setShiftForm({ start: profile.shiftStart, end: profile.shiftEnd, reason: "" });
    setShiftError("");
    setShiftDialogOpen(true);
  };

  const handleShiftSubmit = async () => {
    if (!/^\d{2}:\d{2}$/.test(shiftForm.start) || !/^\d{2}:\d{2}$/.test(shiftForm.end)) {
      setShiftError("Please pick both a start and an end time.");
      return;
    }
    if (shiftForm.start === shiftForm.end) {
      setShiftError("Shift start and end cannot be the same time.");
      return;
    }
    if (shiftForm.start === profile.shiftStart && shiftForm.end === profile.shiftEnd) {
      setShiftError("This is already your current shift.");
      return;
    }
    if (!shiftForm.reason.trim()) {
      setShiftError("Please give a reason for the shift change.");
      return;
    }
    setShiftError("");
    setShiftSubmitting(true);
    try {
      await api.approvalRequests.create({
        type: 'shift_change',
        current_shift_start: profile.shiftStart || undefined,
        current_shift_end: profile.shiftEnd || undefined,
        new_shift_start: shiftForm.start,
        new_shift_end: shiftForm.end,
        reason: shiftForm.reason.trim(),
      });
      setPendingShiftChange(`${shiftForm.start} - ${shiftForm.end}`);
      toast({
        variant: "success",
        title: "Shift change requested",
        description: "Your request has been sent to HR for approval.",
      });
      setShiftDialogOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Please try again.";
      setShiftError(msg);
      toast({ variant: "error", title: "Failed to submit request", description: msg });
    } finally {
      setShiftSubmitting(false);
    }
  };

  /* ---- Field builders ---- */

  const isPending = (label: string) => label in pendingChanges;

  const personalFields: ProfileField[] = [
    {
      label: "Personal Email",
      value: profile.personalEmail,
      editable: true,
      pending: isPending("Personal Email"),
      pendingValue: pendingChanges["Personal Email"],
      icon: <Mail className="h-4 w-4" />,
    },
    {
      label: "Mobile",
      value: profile.phone,
      editable: true,
      pending: isPending("Mobile"),
      pendingValue: pendingChanges["Mobile"],
      icon: <Phone className="h-4 w-4" />,
    },
    {
      label: "Date of Birth",
      value: profile.dob,
      editable: false,
      icon: <Calendar className="h-4 w-4" />,
    },
    {
      label: "Gender",
      value: profile.gender,
      editable: false,
      icon: <User className="h-4 w-4" />,
    },
    {
      label: "Blood Group",
      value: profile.bloodGroup,
      editable: false,
      icon: <Droplets className="h-4 w-4" />,
    },
    {
      label: "PAN",
      value: profile.pan,
      editable: false,
      icon: <Shield className="h-4 w-4" />,
    },
    {
      label: "Aadhaar",
      value: profile.aadhaar,
      editable: false,
      icon: <CreditCard className="h-4 w-4" />,
    },
    {
      label: "Current Address",
      value: profile.currentAddress,
      editable: true,
      pending: isPending("Current Address"),
      pendingValue: pendingChanges["Current Address"],
      icon: <MapPin className="h-4 w-4" />,
    },
    {
      label: "Permanent Address",
      value: profile.permanentAddress,
      editable: false,
      icon: <MapPin className="h-4 w-4" />,
    },
    {
      label: "Emergency Contact",
      value: profile.emergencyContact
        ? `${profile.emergencyContact.name} (${profile.emergencyContact.relationship}) - ${profile.emergencyContact.phone}`
        : "Not provided",
      editable: true,
      pending: isPending("Emergency Contact"),
      pendingValue: pendingChanges["Emergency Contact"],
      icon: <Heart className="h-4 w-4" />,
    },
  ];

  const employmentFields: ProfileField[] = [
    {
      label: "Employee ID",
      value: profile.employeeId,
      editable: false,
      icon: <BadgeCheck className="h-4 w-4" />,
    },
    {
      label: "Department",
      value: profile.department,
      editable: false,
      icon: <Building2 className="h-4 w-4" />,
    },
    {
      label: "Designation",
      value: profile.designation,
      editable: false,
      icon: <Briefcase className="h-4 w-4" />,
    },
    {
      label: "Date of Joining",
      value: profile.dateOfJoining,
      editable: false,
      icon: <Calendar className="h-4 w-4" />,
    },
    {
      label: "Employment Type",
      value: profile.employmentType,
      editable: false,
      icon: <Clock className="h-4 w-4" />,
    },
    {
      label: "Reporting Manager",
      value: profile.reportingManager,
      editable: false,
      icon: <User className="h-4 w-4" />,
    },
  ];

  const bankFields: ProfileField[] = [
    {
      label: "Bank Name",
      value: profile.bankDetails.bankName,
      editable: true,
      pending: isPending("Bank Name"),
      pendingValue: pendingChanges["Bank Name"],
      icon: <Landmark className="h-4 w-4" />,
    },
    {
      label: "Account Number",
      value: profile.bankDetails.accountNumber,
      editable: true,
      pending: isPending("Account Number"),
      pendingValue: pendingChanges["Account Number"],
      icon: <CreditCard className="h-4 w-4" />,
    },
    {
      label: "IFSC Code",
      value: profile.bankDetails.ifscCode,
      editable: true,
      pending: isPending("IFSC Code"),
      pendingValue: pendingChanges["IFSC Code"],
      icon: <Building2 className="h-4 w-4" />,
    },
    {
      label: "Branch Name",
      value: profile.bankDetails.branchName,
      editable: true,
      pending: isPending("Branch Name"),
      pendingValue: pendingChanges["Branch Name"],
      icon: <MapPin className="h-4 w-4" />,
    },
  ];

  return (
    <div className="space-y-6">
      {/* ---- Header ---- */}
      <div className="flex items-end justify-between mb-[18px] gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <User className="h-5 w-5 text-gray-700" />
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight m-0 mb-1">My Profile</h1>
          </div>
        </div>
      </div>

      {/* ---- Profile header card ---- */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <Avatar className="h-20 w-20 text-xl">
              <AvatarFallback>{getInitials(profile.name)}</AvatarFallback>
            </Avatar>
            <div className="text-center sm:text-left">
              <h2 className="text-lg font-bold text-gray-900">
                {profile.name}
              </h2>
              <p className="text-sm text-gray-500">
                {profile.designation} &middot; {profile.department}
              </p>
              <p className="mt-1 text-sm text-gray-500">{profile.email}</p>
              <div className="mt-2 flex flex-wrap justify-center gap-2 sm:justify-start">
                <Badge variant="success">Active</Badge>
                <Badge variant="secondary">{profile.employeeId}</Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ---- Content grid ---- */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* -- Personal Info -- */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-4 w-4 text-blue-600" />
              Personal Information
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-gray-100">
              {personalFields.map((field) => (
                <ProfileFieldRow
                  key={field.label}
                  field={field}
                  onEdit={handleEditClick}
                />
              ))}
            </div>
          </CardContent>
        </Card>

        {/* -- Employment Details -- */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-blue-600" />
              Employment Details
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-gray-100">
              {employmentFields.map((field) => (
                <ProfileFieldRow
                  key={field.label}
                  field={field}
                  onEdit={handleEditClick}
                />
              ))}
              {/* Shift row: editable via a dedicated request-shift-change flow */}
              <div className="flex items-start justify-between gap-3 py-2.5">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <span className="mt-0.5 shrink-0 text-gray-400"><Clock className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-gray-500">Shift</p>
                    <p className="mt-0.5 text-sm text-gray-900 break-words">
                      {profile.shiftStart && profile.shiftEnd
                        ? `${profile.shiftStart} - ${profile.shiftEnd}`
                        : "No fixed shift"}
                    </p>
                    {pendingShiftChange && (
                      <div className="mt-1 flex items-center gap-2">
                        <Badge variant="warning">Pending</Badge>
                        <span className="text-xs text-yellow-700">
                          Requested: {pendingShiftChange}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="shrink-0 mt-0.5">
                  {pendingShiftChange ? (
                    <span className="inline-flex h-7 w-7 items-center justify-center" title="A shift change request is already pending">
                      <Lock className="h-3.5 w-3.5 text-gray-300" />
                    </span>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={openShiftDialog}
                      aria-label="Request shift change"
                    >
                      <Pencil className="h-3.5 w-3.5 text-gray-400 hover:text-blue-600" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* -- Bank Details -- */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Landmark className="h-4 w-4 text-blue-600" />
              Bank Details
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-gray-100">
              {bankFields.map((field) => (
                <ProfileFieldRow
                  key={field.label}
                  field={field}
                  onEdit={handleEditClick}
                />
              ))}
            </div>
          </CardContent>
        </Card>

        {/* -- Documents -- */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-blue-600" />
              Documents
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-gray-100">
              {profile.documents.map((doc) => (
                <div
                  key={doc.name}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <FileText className="h-4 w-4 shrink-0 text-gray-400" />
                    <div className="min-w-0">
                      <p className="text-sm text-gray-900 truncate">
                        {doc.name}
                      </p>
                      <p className="text-xs text-gray-500">{doc.category}</p>
                    </div>
                  </div>
                  <Badge variant={doc.verified ? "success" : "warning"}>
                    {doc.verified ? "Verified" : "Pending"}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ---- Change Request Dialog ---- */}
      <ChangeRequestDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        fieldName={dialogField}
        currentValue={dialogCurrentValue}
        onSubmit={handleChangeSubmit}
      />

      {/* ---- Shift Change Request Dialog ---- */}
      <Dialog open={shiftDialogOpen} onOpenChange={(open) => { if (!open) setShiftDialogOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Request Shift Change</DialogTitle>
            <DialogDescription>
              Your current shift is{" "}
              <strong>
                {profile.shiftStart && profile.shiftEnd
                  ? `${profile.shiftStart} - ${profile.shiftEnd}`
                  : "not fixed"}
              </strong>
              . Pick the shift you want and HR will review your request.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="New shift start"
                type="time"
                value={shiftForm.start}
                onChange={(e) => setShiftForm((f) => ({ ...f, start: e.target.value }))}
              />
              <Input
                label="New shift end"
                type="time"
                value={shiftForm.end}
                onChange={(e) => setShiftForm((f) => ({ ...f, end: e.target.value }))}
              />
            </div>
            <p className="text-[11px] text-gray-500">
              If the end time is earlier than the start time, the shift is treated as overnight
              (ends the next day).
            </p>
            <Textarea
              label="Reason *"
              placeholder="e.g. College classes in the morning, need the evening shift."
              value={shiftForm.reason}
              onChange={(e) => setShiftForm((f) => ({ ...f, reason: e.target.value }))}
              rows={3}
              error={shiftError || undefined}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShiftDialogOpen(false)} disabled={shiftSubmitting}>
              Cancel
            </Button>
            <Button onClick={handleShiftSubmit} disabled={shiftSubmitting}>
              {shiftSubmitting ? "Submitting..." : "Submit Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
