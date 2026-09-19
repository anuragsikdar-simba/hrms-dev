"use client";

import * as React from "react";
import api from "@/lib/api-client";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  FileUpload,
  type UploadedFile,
} from "@/components/onboarding/file-upload";
import { CheckCircle, ArrowLeft, ArrowRight, Users, Eye, CheckCheck, Loader2, FileText, Clock, XCircle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
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
import { Textarea } from "@/components/ui/textarea";
import { User, CreditCard, Building2 } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Shared types for onboarding config                                 */
/* ------------------------------------------------------------------ */

interface ConfigField {
  id: string;
  label: string;
  type: "Text" | "Number" | "Date" | "Dropdown" | "File Upload";
  required: boolean;
  editablePostOnboarding: boolean;
  deletable: boolean;
  dropdownOptions?: string[];
  acceptedFormats?: string;
  maxFileSize?: number;
}

interface ConfigSection {
  id: string;
  title: string;
  description: string;
  deletable: boolean;
  fields: ConfigField[];
}

/* ================================================================== */
/*  Admin Onboarding Panel                                             */
/* ================================================================== */

interface PendingEmployee {
  id: string;
  employee_id: string;
  name: string;
  email: string;
  department: { id: string; name: string } | null;
  onboarding_status: string;
  date_of_joining: string | null;
}

interface SubmissionData {
  id: string;
  responses: Record<string, string>;
  documents: Array<{ fieldId: string; label: string; url: string; fileName: string; docId?: string }>;
  status: string;
  submitted_at: string | null;
}

function AdminOnboardingPanel() {
  const [employees, setEmployees] = React.useState<PendingEmployee[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [reviewEmployee, setReviewEmployee] = React.useState<PendingEmployee | null>(null);
  const [submission, setSubmission] = React.useState<SubmissionData | null>(null);
  const [configSections, setConfigSections] = React.useState<ConfigSection[]>([]);
  const [approving, setApproving] = React.useState(false);
  const [rejecting, setRejecting] = React.useState(false);
  const [showRejectDialog, setShowRejectDialog] = React.useState(false);
  const [rejectReason, setRejectReason] = React.useState('');
  // Field ids the admin has flagged for correction. When non-empty, the
  // rejection becomes field-level: the employee only fixes these fields.
  const [flaggedFields, setFlaggedFields] = React.useState<Record<string, string>>({});

  const toggleFlag = (fieldId: string, label: string) => {
    setFlaggedFields((prev) => {
      const next = { ...prev };
      if (next[fieldId]) delete next[fieldId];
      else next[fieldId] = label;
      return next;
    });
  };
  const [departmentOptions, setDepartmentOptions] = React.useState<{label:string;value:string}[]>([]);
  const [assignedDepartment, setAssignedDepartment] = React.useState('');
  const { toast } = useToast();

  React.useEffect(() => {
    api.departments.list().then(({ departments }) => {
      if (departments) setDepartmentOptions(departments.map(d => ({ label: d.name, value: d.id })));
    }).catch((err) => {
      toast({ variant: 'error', title: 'Failed to load departments', description: String(err) });
    });
  }, []);

  const fetchPending = React.useCallback(async () => {
    try {
      const { employees: data } = await api.onboarding.list();
      setEmployees((data ?? []) as PendingEmployee[]);
    } catch (err) {
      toast({ variant: 'error', title: 'Failed to load onboarding list', description: String(err) });
    }
    setLoading(false);
  }, []);

  React.useEffect(() => { fetchPending(); }, [fetchPending]);

  const openReview = async (emp: PendingEmployee) => {
    // Fetch submission via API
    const { submission: sub } = await api.onboarding.list({ employee_id: emp.id });

    if (sub) {
      const subData = sub as unknown as SubmissionData & { config_version: number };
      setSubmission(subData);

      // Load the config version that matches this submission (not latest)
      try {
        const { config: matchingConfig } = await api.onboardingConfig.get({ version: subData.config_version });
        if (matchingConfig) {
          setConfigSections(matchingConfig.sections as ConfigSection[]);
        } else {
          // Fallback: load latest active config
          const { config: latestConfig } = await api.onboardingConfig.get();
          if (latestConfig) setConfigSections(latestConfig.sections as ConfigSection[]);
        }
      } catch (err) {
        // Fallback: load latest active config
        try {
          const { config: latestConfig } = await api.onboardingConfig.get();
          if (latestConfig) setConfigSections(latestConfig.sections as ConfigSection[]);
        } catch (err2) {
          toast({ variant: 'error', title: 'Failed to load onboarding config', description: String(err2) });
        }
      }
    } else {
      // Fallback: read from employees table (for legacy or direct updates)
      try {
        const { employee: empData } = await api.employees.get(emp.id);

        if (empData) {
          const d = empData as Record<string, unknown>;
          const bank = d.bank_details as Record<string, string> | null;
          const responses: Record<string, string> = {
            full_name: (d.name as string) ?? '',
            personal_email: (d.personal_email as string) ?? '',
            mobile_number: (d.phone as string) ?? '',
            date_of_birth: (d.dob as string) ?? '',
            gender: (d.gender as string) ?? '',
            blood_group: (d.blood_group as string) ?? '',
            permanent_address: (d.permanent_address as string) ?? '',
            current_address: (d.current_address as string) ?? '',
            emergency_contact_name: (d.emergency_contact_name as string) ?? '',
            emergency_contact_phone: (d.emergency_contact_phone as string) ?? '',
            emergency_contact_relationship: (d.emergency_contact_relation as string) ?? '',
            pan_number: (d.pan as string) ?? '',
            aadhaar_number: (d.aadhaar as string) ?? '',
            bank_name: bank?.bankName ?? '',
            account_number: bank?.accountNumber ?? '',
            ifsc_code: bank?.ifsc ?? '',
            account_type: bank?.accountType ?? '',
          };
          setSubmission({ id: '', responses, documents: [], status: 'submitted', submitted_at: null });
        }
      } catch (err) {
        toast({ variant: 'error', title: 'Failed to load employee data', description: String(err) });
      }
    }

    setReviewEmployee(emp);
    setAssignedDepartment(emp.department?.id ?? '');
  };

  const handleApprove = async (emp: PendingEmployee) => {
    setApproving(true);
    try {
      await api.onboarding.approve({
        employee_id: emp.id,
        department_id: assignedDepartment,
        responses: submission?.responses,
      });

      toast({ variant: "success", title: "Approved", description: `${emp.name}'s onboarding marked as complete.` });
      setReviewEmployee(null);
      setSubmission(null);
      fetchPending();
    } catch (err) {
      toast({ variant: "error", title: "Error", description: String(err) });
    }
    setApproving(false);
  };

  const handleReject = async (emp: PendingEmployee) => {
    setRejecting(true);
    try {
      const flagIds = Object.keys(flaggedFields);
      await api.onboarding.reject({
        employee_id: emp.id,
        notes: rejectReason.trim() || undefined,
        flagged_fields: flagIds.length > 0 ? flagIds : undefined,
      });
      toast({
        variant: "success",
        title: "Returned to employee",
        description:
          flagIds.length > 0
            ? `${emp.name} only needs to fix: ${Object.values(flaggedFields).join(', ')}.`
            : `${emp.name} can now edit and resubmit their onboarding form.`,
      });
      setShowRejectDialog(false);
      setRejectReason('');
      setFlaggedFields({});
      setReviewEmployee(null);
      setSubmission(null);
      fetchPending();
    } catch (err) {
      toast({ variant: "error", title: "Error", description: String(err) });
    }
    setRejecting(false);
  };

  // Build review sections from config + submission data
  const buildReviewSections = () => {
    if (!submission) return [];
    const r = submission.responses;
    const docs = submission.documents;

    if (configSections.length > 0) {
      return configSections.map((sec) => ({
        title: sec.title,
        fields: sec.fields.map((f) => {
          if (f.type === "File Upload") {
            const doc = docs.find((d) => d.fieldId === f.id);
            return { id: f.id, label: f.label, value: doc?.url ?? '', fileName: doc?.fileName, isDocument: true };
          }
          return { id: f.id, label: f.label, value: r[f.id] ?? '', isDocument: false };
        }),
      }));
    }

    // Fallback: group by known sections
    return [
      {
        title: "Personal Information",
        fields: [
          { id: "full_name", label: "Full Name", value: r.full_name ?? '', isDocument: false },
          { id: "personal_email", label: "Personal Email", value: r.personal_email ?? '', isDocument: false },
          { id: "mobile_number", label: "Mobile", value: r.mobile_number ?? '', isDocument: false },
          { id: "date_of_birth", label: "Date of Birth", value: r.date_of_birth ?? '', isDocument: false },
          { id: "gender", label: "Gender", value: r.gender ?? '', isDocument: false },
          { id: "blood_group", label: "Blood Group", value: r.blood_group ?? '', isDocument: false },
          { id: "permanent_address", label: "Permanent Address", value: r.permanent_address ?? '', isDocument: false },
          { id: "current_address", label: "Current Address", value: r.current_address ?? '', isDocument: false },
          { id: "emergency_contact_name", label: "Emergency Contact", value: r.emergency_contact_name ?? '', isDocument: false },
          { id: "emergency_contact_phone", label: "Emergency Phone", value: r.emergency_contact_phone ?? '', isDocument: false },
        ],
      },
      {
        title: "Identity & Bank",
        fields: [
          { id: "pan_number", label: "PAN", value: r.pan_number ? r.pan_number.slice(0, 5) + '****' + r.pan_number.slice(-1) : '', isDocument: false },
          { id: "aadhaar_number", label: "Aadhaar", value: r.aadhaar_number ? 'XXXX XXXX ' + r.aadhaar_number.slice(-4) : '', isDocument: false },
          { id: "bank_name", label: "Bank Name", value: r.bank_name ?? '', isDocument: false },
          { id: "account_number", label: "Account", value: r.account_number ? 'XXXX' + r.account_number.slice(-4) : '', isDocument: false },
          { id: "ifsc_code", label: "IFSC", value: r.ifsc_code ?? '', isDocument: false },
        ],
      },
      {
        title: "Documents",
        fields: docs.map((d) => ({ id: d.fieldId, label: d.label, value: d.url, fileName: d.fileName, isDocument: true })),
      },
    ];
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Onboarding Management</h1>
          <p className="text-[13px] text-gray-500 mt-0.5">Review and approve employee onboarding submissions</p>
        </div>
        <Badge variant="amber">{employees.length} pending</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Pending Onboarding
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="px-4 py-8 text-center text-[13px] text-gray-400">Loading...</div>
          ) : employees.length === 0 ? (
            <div className="px-4 py-8 text-center text-[13px] text-gray-400">No pending onboarding submissions</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees.map((emp) => (
                  <TableRow key={emp.id}>
                    <TableCell className="font-mono text-[12px]">{emp.employee_id}</TableCell>
                    <TableCell className="font-medium">{emp.name}</TableCell>
                    <TableCell className="text-[12px] text-gray-500">{emp.email}</TableCell>
                    <TableCell>{emp.department?.name}</TableCell>
                    <TableCell>
                      <Badge variant={emp.onboarding_status === 'pending' ? 'amber' : 'blue'}>
                        {emp.onboarding_status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-[12px] text-gray-500">
                      {emp.date_of_joining ? new Date(emp.date_of_joining).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button size="sm" variant="outline" onClick={() => openReview(emp)}>
                          <Eye className="h-3.5 w-3.5 mr-1" />
                          Review
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Review Dialog */}
      <Dialog open={!!reviewEmployee} onOpenChange={(open) => { if (!open) { setReviewEmployee(null); setSubmission(null); } }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review: {reviewEmployee?.name}</DialogTitle>
          </DialogHeader>

          {!submission ? (
            <div className="py-8 text-center text-[13px] text-gray-400">
              No submission data found. Employee has not completed the onboarding form yet.
            </div>
          ) : (
            <div className="space-y-4 mt-4">
              <p className="text-[12px] text-gray-500">
                Spot a problem with a specific answer? Click <em>Flag</em> on that field - the employee will only
                need to fix flagged fields instead of redoing the whole form.
              </p>
              {buildReviewSections().map((sec) => (
                <Card key={sec.title}>
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm">{sec.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {sec.fields.map((f) => {
                        const isFlagged = !!flaggedFields[f.id];
                        return (
                          <div
                            key={f.id || f.label}
                            className={
                              isFlagged
                                ? "rounded-md border border-red-200 bg-red-50 p-2 -m-2"
                                : undefined
                            }
                          >
                            <dt className="flex items-center justify-between text-xs font-medium uppercase tracking-wider text-gray-500">
                              <span>{f.label}</span>
                              <button
                                type="button"
                                onClick={() => toggleFlag(f.id, f.label)}
                                className={
                                  "ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal transition-colors " +
                                  (isFlagged
                                    ? "bg-red-600 text-white hover:bg-red-700"
                                    : "border border-gray-200 text-gray-400 hover:border-red-300 hover:text-red-600")
                                }
                              >
                                {isFlagged ? "Flagged ✕" : "Flag"}
                              </button>
                            </dt>
                            <dd className="mt-0.5 text-sm text-gray-800">
                              {f.isDocument && f.value ? (
                                <a href={f.value} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline">
                                  <FileText className="h-3.5 w-3.5" />
                                  {(f as { fileName?: string }).fileName || 'View Document'}
                                </a>
                              ) : (
                                f.value || <span className="text-gray-300">-</span>
                              )}
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <div className="border-t pt-4 mt-4">
            <h4 className="text-sm font-medium text-gray-700 mb-2">Assign Department</h4>
            <Select
              options={departmentOptions}
              value={assignedDepartment}
              onChange={(e) => setAssignedDepartment(e.target.value)}
              placeholder="Select department"
              className="max-w-sm"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setReviewEmployee(null); setSubmission(null); setFlaggedFields({}); }}>Close</Button>
            {submission && reviewEmployee && (
              <>
                <Button
                  variant="outline"
                  className="border-red-300 text-red-600 hover:bg-red-50"
                  onClick={() => setShowRejectDialog(true)}
                  disabled={approving || rejecting}
                >
                  <XCircle className="h-4 w-4 mr-1" />
                  {Object.keys(flaggedFields).length > 0
                    ? `Return ${Object.keys(flaggedFields).length} field${Object.keys(flaggedFields).length > 1 ? 's' : ''} for fixing`
                    : 'Reject'}
                </Button>
                <Button onClick={() => handleApprove(reviewEmployee)} disabled={approving || rejecting}>
                  {approving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCheck className="h-4 w-4 mr-1" />}
                  Approve &amp; Complete
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject reason dialog */}
      <Dialog open={showRejectDialog} onOpenChange={(open) => { if (!open) { setShowRejectDialog(false); setRejectReason(''); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {Object.keys(flaggedFields).length > 0 ? 'Return fields for correction' : 'Reject onboarding'}
            </DialogTitle>
            <DialogDescription>
              {Object.keys(flaggedFields).length > 0
                ? `${reviewEmployee?.name ?? 'The employee'} will be asked to fix only the flagged fields below - everything else stays as submitted.`
                : `The submission will be returned to ${reviewEmployee?.name ?? 'the employee'} so they can correct it and resubmit. Optionally tell them what to fix.`}
            </DialogDescription>
          </DialogHeader>
          {Object.keys(flaggedFields).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(flaggedFields).map(([id, label]) => (
                <span key={id} className="inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-200 px-2 py-0.5 text-[11px] font-medium text-red-700">
                  {label}
                  <button type="button" onClick={() => toggleFlag(id, label)} className="hover:text-red-900">✕</button>
                </span>
              ))}
            </div>
          )}
          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="e.g. The PAN card image is blurry. Please re-upload a clear copy."
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowRejectDialog(false); setRejectReason(''); }} disabled={rejecting}>
              Cancel
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700"
              onClick={() => reviewEmployee && handleReject(reviewEmployee)}
              disabled={rejecting}
            >
              {rejecting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <XCircle className="h-4 w-4 mr-1" />}
              Reject &amp; Return
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ================================================================== */
/*  Main Page                                                          */
/* ================================================================== */

export default function OnboardingPage() {
  const { isAdmin } = useAuth();

  if (isAdmin) {
    return <AdminOnboardingPanel />;
  }

  return <EmployeeOnboardingForm />;
}

/* ================================================================== */
/*  Employee Onboarding Form (config-driven)                           */
/* ================================================================== */

function EmployeeOnboardingForm() {
  const { userProfile } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const [configSections, setConfigSections] = React.useState<ConfigSection[]>([]);
  const [configLoading, setConfigLoading] = React.useState(true);
  const [configVersion, setConfigVersion] = React.useState(1);

  // Form state: responses keyed by field.id, files keyed by field.id
  const [responses, setResponses] = React.useState<Record<string, string>>({});
  const [files, setFiles] = React.useState<Record<string, UploadedFile[]>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const [currentStep, setCurrentStep] = React.useState(0);
  const [showReview, setShowReview] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [isReturning, setIsReturning] = React.useState(false);
  const [rejectionNote, setRejectionNote] = React.useState<string | null>(null);
  // Field-level rejection: when HR flags specific fields, only these need
  // fixing - the rest of the submission is carried forward untouched.
  const [flaggedFieldIds, setFlaggedFieldIds] = React.useState<string[]>([]);
  // File Upload fields that already have a document on file from a prior
  // submission. These should NOT force the employee to re-upload when the
  // onboarding form is re-issued (e.g. after HR adds a new required doc).
  const [satisfiedFileFields, setSatisfiedFileFields] = React.useState<
    Record<string, { fileName: string; docId?: string }>
  >({});

  /* ---- localStorage draft cache (survives refresh, expires in 24h) ---- */

  const DRAFT_KEY = userProfile?.id ? `onboarding_draft_${userProfile.id}` : null;
  const DRAFT_TTL = 24 * 60 * 60 * 1000; // 24 hours

  // Restore draft from localStorage on mount
  const draftRestoredRef = React.useRef(false);
  React.useEffect(() => {
    if (!DRAFT_KEY || draftRestoredRef.current) return;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw) as { responses: Record<string, string>; step: number; ts: number };
        if (Date.now() - draft.ts < DRAFT_TTL) {
          setResponses((prev) => ({ ...prev, ...draft.responses }));
          setCurrentStep(draft.step ?? 0);
          draftRestoredRef.current = true;
        } else {
          localStorage.removeItem(DRAFT_KEY); // expired
        }
      }
    } catch { /* ignore corrupt data */ }
    draftRestoredRef.current = true;
  }, [DRAFT_KEY, DRAFT_TTL]);

  // Save draft to localStorage whenever responses or step changes
  React.useEffect(() => {
    if (!DRAFT_KEY || !draftRestoredRef.current) return;
    // Don't save if form hasn't been touched (empty responses)
    const hasData = Object.values(responses).some((v) => v.trim() !== '');
    if (!hasData) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        responses,
        step: currentStep,
        ts: Date.now(),
      }));
    } catch { /* storage full, ignore */ }
  }, [responses, currentStep, DRAFT_KEY]);

  // Clear draft on successful submission
  const clearDraft = React.useCallback(() => {
    if (DRAFT_KEY) {
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
    }
  }, [DRAFT_KEY]);

  // Redirect only if truly completed AND no pending form updates
  // (onboarding_status gets reset to 'pending' when admin adds new fields)
  React.useEffect(() => {
    if (userProfile?.onboardingStatus === 'completed') {
      router.replace('/profile');
    }
  }, [userProfile, router]);

  // Show "awaiting review" screen if already submitted
  const alreadySubmitted = userProfile?.onboardingStatus === 'in_progress';

  // Load config
  React.useEffect(() => {
    (async () => {
      try {
        const { config } = await api.onboardingConfig.get();

        if (config) {
          setConfigSections(config.sections as ConfigSection[]);
          setConfigVersion(config.version);
        } else {
          // Use hardcoded defaults if no config
          setConfigSections(DEFAULT_CONFIG_SECTIONS);
        }
      } catch {
        setConfigSections(DEFAULT_CONFIG_SECTIONS);
      }
      setConfigLoading(false);
    })();
  }, []);

  // Pre-fill from existing profile (only fills empty fields, won't overwrite draft)
  React.useEffect(() => {
    if (userProfile) {
      setResponses((prev) => ({
        ...prev,
        full_name: prev.full_name || userProfile.name || '',
        personal_email: prev.personal_email || userProfile.personalEmail || '',
        mobile_number: prev.mobile_number || userProfile.phone || '',
        gender: prev.gender || userProfile.gender || '',
        blood_group: prev.blood_group || userProfile.bloodGroup || '',
        permanent_address: prev.permanent_address || userProfile.permanentAddress?.line1 || '',
        current_address: prev.current_address || userProfile.currentAddress?.line1 || '',
        pan_number: prev.pan_number || userProfile.pan || '',
        aadhaar_number: prev.aadhaar_number || userProfile.aadhaar || '',
        emergency_contact_name: prev.emergency_contact_name || userProfile.emergencyContact?.name || '',
        emergency_contact_phone: prev.emergency_contact_phone || userProfile.emergencyContact?.phone || '',
        emergency_contact_relationship: prev.emergency_contact_relationship || userProfile.emergencyContact?.relationship || '',
        bank_name: prev.bank_name || userProfile.bankDetails?.bankName || '',
        account_number: prev.account_number || userProfile.bankDetails?.accountNumber || '',
        ifsc_code: prev.ifsc_code || userProfile.bankDetails?.ifsc || '',
        account_type: prev.account_type || userProfile.bankDetails?.accountType || '',
      }));
    }
  }, [userProfile]);

  // Load existing draft submission from DB
  React.useEffect(() => {
    if (!userProfile?.id) return;
    (async () => {
      try {
        const { submission: data } = await api.onboarding.list({ employee_id: userProfile.id });

        if (data) {
          setResponses((prev) => ({ ...prev, ...(data.responses as Record<string, string>) }));
          // Mark File Upload fields that already have a document on file so the
          // employee isn't forced to re-upload them when the form is re-issued.
          const existingDocs = (data.documents ?? []) as Array<{
            fieldId: string; fileName?: string; docId?: string;
          }>;
          if (existingDocs.length > 0) {
            const satisfied: Record<string, { fileName: string; docId?: string }> = {};
            for (const d of existingDocs) {
              if (d.fieldId) {
                satisfied[d.fieldId] = { fileName: d.fileName ?? 'Uploaded document', docId: d.docId };
              }
            }
            setSatisfiedFileFields(satisfied);
          }
          if (data.status === 'approved' || data.status === 'submitted') {
            setIsReturning(true);
          }
          // If a prior submission was rejected, surface the admin's note so the
          // employee knows what to fix before resubmitting. admin_notes may be
          // plain text (whole-form rejection) or JSON {note, flagged_fields}
          // (field-level rejection: only the flagged fields need fixing).
          if (data.status === 'rejected') {
            setIsReturning(true);
            const raw = (data.admin_notes as string) ?? '';
            let note = raw;
            let flags: string[] = [];
            if (raw.startsWith('{')) {
              try {
                const parsed = JSON.parse(raw) as { note?: string | null; flagged_fields?: string[] };
                note = parsed.note ?? '';
                if (Array.isArray(parsed.flagged_fields)) {
                  flags = parsed.flagged_fields.filter((f): f is string => typeof f === 'string');
                }
              } catch { /* legacy plain-text note that happens to start with { */ }
            }
            setRejectionNote(note);
            setFlaggedFieldIds(flags);
          }
        }
      } catch (err) {
        console.error('[onboarding] failed to load existing submission:', err);
      }
    })();
  }, [userProfile?.id]);

  /* ---- Helpers ---- */

  const setField = (fieldId: string, value: string) => {
    setResponses((prev) => ({ ...prev, [fieldId]: value }));
    setErrors((prev) => { const n = { ...prev }; delete n[fieldId]; return n; });
  };

  const setFileField = (fieldId: string, value: UploadedFile[]) => {
    setFiles((prev) => ({ ...prev, [fieldId]: value }));
    setErrors((prev) => { const n = { ...prev }; delete n[fieldId]; return n; });
  };

  /* ---- Fix mode (field-level rejection) ---- */
  // When HR flagged specific fields, the employee only sees and fixes those.
  // Everything else from the prior submission is carried forward untouched.
  const fixSections = React.useMemo(() => {
    if (flaggedFieldIds.length === 0) return null;
    const flagged = new Set(flaggedFieldIds);
    const filtered = configSections
      .map((sec) => ({ ...sec, fields: sec.fields.filter((f) => flagged.has(f.id)) }))
      .filter((sec) => sec.fields.length > 0);
    // If the config changed since rejection and no flagged field exists any
    // more, fall back to the full form rather than an empty wizard.
    return filtered.length > 0 ? filtered : null;
  }, [configSections, flaggedFieldIds]);
  const fixMode = fixSections !== null;
  const effectiveSections = fixSections ?? configSections;
  const flaggedLabels = React.useMemo(() => {
    if (!fixSections) return [];
    return fixSections.flatMap((s) => s.fields.map((f) => f.label));
  }, [fixSections]);

  // The fix-mode wizard is shorter than the full form; a restored draft step
  // (or the step from before flags loaded) can point past the end. Clamp it.
  React.useEffect(() => {
    setCurrentStep((s) => (s >= effectiveSections.length ? 0 : s));
  }, [effectiveSections.length]);

  /* ---- Validation ---- */

  const validateStep = (stepIndex: number): boolean => {
    const section = effectiveSections[stepIndex];
    if (!section) return true;

    const newErrors: Record<string, string> = {};
    for (const field of section.fields) {
      // In fix mode every rendered field was explicitly flagged by HR, so it
      // must be (re-)provided even if a value/document already exists.
      if (!field.required && !fixMode) continue;
      // Skip current_address validation if same as permanent
      if (field.id === 'current_address' && responses['_same_as_permanent'] === 'true') continue;

      if (field.type === "File Upload") {
        const fieldFiles = files[field.id] ?? [];
        // Already on file from a prior submission counts as satisfied - except
        // in fix mode, where HR flagged this document as needing replacement.
        if (fieldFiles.length === 0 && (fixMode || !satisfiedFileFields[field.id])) {
          newErrors[field.id] = fixMode
            ? `Please re-upload ${field.label}`
            : `${field.label} is required`;
        }
      } else {
        const val = responses[field.id]?.trim() ?? '';
        if (!val) {
          newErrors[field.id] = `${field.label} is required`;
        }
        // Special validations for known fields
        if (field.id === 'pan_number' && val && !/^[A-Z]{5}\d{4}[A-Z]$/.test(val)) {
          newErrors[field.id] = 'Enter a valid PAN (e.g. ABCDE1234F)';
        }
        if (field.id === 'aadhaar_number' && val && !/^\d{12}$/.test(val)) {
          newErrors[field.id] = 'Enter a valid 12-digit Aadhaar number';
        }
        if (field.id === 'ifsc_code' && val && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(val)) {
          newErrors[field.id] = 'Enter a valid IFSC code';
        }
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  /* ---- Navigation ---- */

  const handleNext = () => {
    if (!validateStep(currentStep)) return;
    if (currentStep < effectiveSections.length - 1) {
      setCurrentStep((s) => s + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep((s) => s - 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleShowReview = () => {
    if (!validateStep(currentStep)) return;
    setShowReview(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  /* ---- Submit ---- */

  const handleSubmit = async () => {
    if (!userProfile?.id) return;
    setSubmitting(true);

    try {
      // 1. Upload files via API
      const uploadedDocs: Array<{ fieldId: string; label: string; url: string; fileName: string; docId?: string }> = [];

      for (const section of configSections) {
        for (const field of section.fields) {
          if (field.type !== "File Upload") continue;
          const fieldFiles = files[field.id] ?? [];
          // No new file but one already on record: carry it forward so we don't
          // lose the previously-uploaded document on re-submission.
          if (fieldFiles.length === 0 && satisfiedFileFields[field.id]) {
            const existing = satisfiedFileFields[field.id];
            uploadedDocs.push({
              fieldId: field.id,
              label: field.label,
              url: '',
              docId: existing.docId,
              fileName: existing.fileName,
            });
            continue;
          }
          for (const uf of fieldFiles) {
            const formData = new FormData();
            formData.append('file', uf.file);
            formData.append('name', `${field.label} - ${uf.file.name}`);
            formData.append('category', 'onboarding');
            formData.append('employee_id', userProfile.id);

            const result = await api.documents.upload(formData);
            // upload() returns the raw envelope { success, data: { document } }.
            const doc = result?.data?.document ?? result?.document;
            uploadedDocs.push({
              fieldId: field.id,
              label: field.label,
              // file_url is a private storage path, not directly viewable; the
              // document id is what lets us mint a signed URL on demand.
              url: doc?.file_url ?? '',
              docId: doc?.id,
              fileName: uf.file.name,
            });
          }
        }
      }

      // 2. Submit onboarding form via API (handles upsert + employee status update)
      await api.onboarding.submit({
        responses,
        documents: uploadedDocs,
        config_version: configVersion,
      });

      clearDraft();
      setSubmitted(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      toast({ variant: "error", title: "Submission failed", description: String(err) });
    }
    setSubmitting(false);
  };

  /* ---- Loading ---- */

  if (configLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        <p className="ml-2 text-sm text-gray-500">Loading onboarding form...</p>
      </div>
    );
  }

  /* ---- Already submitted, awaiting admin review ---- */

  if (alreadySubmitted && !submitted) {
    return (
      <div className="mx-auto max-w-lg py-20">
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-100">
              <Clock className="h-8 w-8 text-blue-600" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900">
              Onboarding Submitted
            </h2>
            <p className="text-sm text-gray-600 max-w-sm">
              Your onboarding information has been submitted successfully.
              HR will review your details and documents. You&apos;ll be notified once it&apos;s approved.
            </p>
            <Badge variant="blue" className="mt-1">Awaiting Review</Badge>
            <Button variant="outline" onClick={() => router.push('/dashboard')} className="mt-2">
              Go to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ---- Success (just submitted) ---- */

  if (submitted) {
    return (
      <div className="mx-auto max-w-lg py-20">
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900">
              Onboarding Complete!
            </h2>
            <p className="text-sm text-gray-600 max-w-sm">
              Your information has been submitted and saved to your profile.
              HR will review your documents and notify you if anything else is needed.
            </p>
            <Button onClick={() => router.push('/dashboard')} className="mt-2">
              Go to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ---- Progress ---- */

  const totalSteps = effectiveSections.length;
  const progressPercent = showReview ? 100 : totalSteps > 0 ? Math.round((currentStep / totalSteps) * 100) : 0;
  const currentSection = effectiveSections[currentStep];
  const isLastStep = currentStep === totalSteps - 1;

  /* ---- Review summary ---- */

  if (showReview) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 py-6">
        <div className="h-2 w-full rounded-full bg-gray-200">
          <div className="h-full rounded-full bg-blue-600 transition-all duration-500" style={{ width: "100%" }} />
        </div>

        <h2 className="text-xl font-semibold text-gray-900">Review Your Information</h2>
        <p className="text-sm text-gray-500">
          {fixMode
            ? "Review your corrections before resubmitting. Only the fields HR flagged are shown - the rest of your submission is unchanged."
            : 'Please review all information before submitting. Click "Edit" to go back.'}
        </p>

        {effectiveSections.map((section) => (
          <Card key={section.id}>
            <CardHeader>
              <CardTitle className="text-base">{section.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {section.fields.map((field) => {
                  if (field.type === "File Upload") {
                    const fieldFiles = files[field.id] ?? [];
                    return (
                      <div key={field.id}>
                        <dt className="text-xs font-medium uppercase tracking-wider text-gray-500">{field.label}</dt>
                        <dd className="mt-0.5 text-sm text-gray-800">
                          {fieldFiles.length > 0 ? fieldFiles.map((f) => f.file.name).join(", ") : "None uploaded"}
                        </dd>
                      </div>
                    );
                  }

                  let displayValue = responses[field.id] ?? '';
                  // Mask sensitive fields
                  if (field.id === 'pan_number' && displayValue.length >= 6) {
                    displayValue = displayValue.slice(0, 5) + '****' + displayValue.slice(-1);
                  }
                  if (field.id === 'aadhaar_number' && displayValue.length >= 4) {
                    displayValue = 'XXXX XXXX ' + displayValue.slice(-4);
                  }
                  if (field.id === 'account_number' && displayValue.length >= 4) {
                    displayValue = 'XXXX' + displayValue.slice(-4);
                  }

                  return (
                    <div key={field.id}>
                      <dt className="text-xs font-medium uppercase tracking-wider text-gray-500">{field.label}</dt>
                      <dd className="mt-0.5 text-sm text-gray-800">{displayValue || "-"}</dd>
                    </div>
                  );
                })}
              </dl>
            </CardContent>
          </Card>
        ))}

        <div className="flex justify-between">
          <Button variant="outline" onClick={() => { setShowReview(false); setCurrentStep(0); }}>
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Edit
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
            {submitting ? "Submitting..." : "Submit"}
          </Button>
        </div>
      </div>
    );
  }

  /* ---- Form steps (config-driven) ---- */

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-6">
      <div className="flex items-end justify-between mb-[18px] gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight m-0 mb-1">Employee Onboarding</h1>
          <p className="text-xs text-gray-500">Complete all steps to finish your onboarding.</p>
        </div>
        {DRAFT_KEY && Object.values(responses).some((v) => v.trim() !== '') && (
          <p className="text-[11px] text-gray-400 flex items-center gap-1">
            <CheckCircle className="h-3 w-3 text-green-500" />
            Draft auto-saved
          </p>
        )}
      </div>

      {userProfile && !isReturning && (
        <div className="rounded-lg border border-blue-200 bg-blue-50/50 px-4 py-3">
          <p className="text-[12px] text-blue-800">
            <strong>Hi {userProfile.name?.split(' ')[0]}!</strong> Some fields are pre-filled from your HR records.
            Please verify and complete the remaining information.
          </p>
        </div>
      )}

      {rejectionNote !== null && (
        <div className="rounded-lg border border-red-200 bg-red-50/60 px-4 py-3">
          <p className="text-[12px] text-red-800">
            <strong>Your onboarding submission was returned for changes.</strong>
            {rejectionNote
              ? <> Reason: {rejectionNote}</>
              : fixMode
                ? null
                : <> Please review your details, make the necessary corrections, and resubmit.</>}
          </p>
          {fixMode && (
            <p className="mt-1 text-[12px] text-red-800">
              You only need to fix: <strong>{flaggedLabels.join(', ')}</strong>. Everything else you
              submitted is kept as-is.
            </p>
          )}
        </div>
      )}

      {isReturning && rejectionNote === null && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/50 px-4 py-3">
          <p className="text-[12px] text-amber-800">
            <strong>Welcome back, {userProfile?.name?.split(' ')[0]}!</strong> HR has updated the onboarding form with new fields.
            Your previously submitted information is pre-filled. Please review and fill in any new fields, then re-submit.
          </p>
        </div>
      )}

      {/* Progress bar */}
      <div className="h-2 w-full rounded-full bg-gray-200">
        <div className="h-full rounded-full bg-blue-600 transition-all duration-500" style={{ width: `${progressPercent}%` }} />
      </div>

      {/* Step indicator */}
      <nav className="flex items-center gap-2 flex-wrap" aria-label="Onboarding progress">
        {effectiveSections.map((sec, i) => (
          <div key={sec.id} className="flex items-center gap-2">
            <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold ${
              i < currentStep ? 'border-blue-600 bg-blue-600 text-white' :
              i === currentStep ? 'border-blue-600 bg-white text-blue-600' :
              'border-gray-300 bg-white text-gray-400'
            }`}>
              {i < currentStep ? <CheckCircle className="h-4 w-4" /> : i + 1}
            </div>
            <span className={`text-xs font-medium hidden sm:inline ${
              i <= currentStep ? 'text-blue-600' : 'text-gray-400'
            }`}>
              {sec.title}
            </span>
            {i < effectiveSections.length - 1 && (
              <div className={`h-0.5 w-6 ${i < currentStep ? 'bg-blue-600' : 'bg-gray-200'}`} />
            )}
          </div>
        ))}
      </nav>

      {/* Current section */}
      {currentSection && (
        <Card>
          <CardHeader>
            <CardTitle>{currentSection.title}</CardTitle>
            <CardDescription>
              Step {currentStep + 1} of {totalSteps}{currentSection.description ? ` \u2014 ${currentSection.description}` : ''}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Same as permanent address toggle for the address section */}
            {currentSection.id === 'sec_address' && currentSection.fields.some((f) => f.id === 'current_address') && (
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={responses['_same_as_permanent'] === 'true'}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setField('_same_as_permanent', checked ? 'true' : 'false');
                    if (checked) {
                      setField('current_address', responses['permanent_address'] ?? '');
                    }
                  }}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                Current address same as permanent address
              </label>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {currentSection.fields.map((field) => {
                // Hide current address field if "same as permanent" is checked
                if (field.id === 'current_address' && responses['_same_as_permanent'] === 'true') {
                  return null;
                }
                if (field.type === "File Upload") {
                  const alreadyOnFile = satisfiedFileFields[field.id];
                  const hasNewFile = (files[field.id] ?? []).length > 0;
                  return (
                    <div key={field.id} className="sm:col-span-2">
                      <FileUpload
                        label={`${field.label}${field.required ? ' *' : ''}`}
                        accept={field.acceptedFormats ?? ".pdf,.jpg,.jpeg,.png"}
                        maxSize={field.maxFileSize ?? 2097152}
                        value={files[field.id] ?? []}
                        onChange={(v) => setFileField(field.id, v)}
                        error={errors[field.id]}
                      />
                      {alreadyOnFile && !hasNewFile && (
                        fixMode ? (
                          <p className="mt-1 text-xs text-red-600">
                            HR asked for a new copy of this document. Please upload a replacement
                            for {alreadyOnFile.fileName}.
                          </p>
                        ) : (
                          <p className="mt-1 text-xs text-green-600">
                            Already on file: {alreadyOnFile.fileName}. Upload again only to replace it.
                          </p>
                        )
                      )}
                    </div>
                  );
                }

                if (field.type === "Dropdown" && field.dropdownOptions) {
                  return (
                    <Select
                      key={field.id}
                      label={`${field.label}${field.required ? ' *' : ''}`}
                      placeholder={`Select ${field.label.toLowerCase()}`}
                      options={field.dropdownOptions.map((o) => ({ label: o, value: o }))}
                      value={responses[field.id] ?? ''}
                      onChange={(e) => setField(field.id, e.target.value)}
                      error={errors[field.id]}
                    />
                  );
                }

                if (field.type === "Date") {
                  return (
                    <Input
                      key={field.id}
                      label={`${field.label}${field.required ? ' *' : ''}`}
                      type="date"
                      value={responses[field.id] ?? ''}
                      onChange={(e) => setField(field.id, e.target.value)}
                      error={errors[field.id]}
                    />
                  );
                }

                if (field.type === "Number") {
                  return (
                    <Input
                      key={field.id}
                      label={`${field.label}${field.required ? ' *' : ''}`}
                      type="number"
                      placeholder={`Enter ${field.label.toLowerCase()}`}
                      value={responses[field.id] ?? ''}
                      onChange={(e) => setField(field.id, e.target.value)}
                      error={errors[field.id]}
                    />
                  );
                }

                // Text (default)
                return (
                  <Input
                    key={field.id}
                    label={`${field.label}${field.required ? ' *' : ''}`}
                    placeholder={`Enter ${field.label.toLowerCase()}`}
                    value={responses[field.id] ?? ''}
                    onChange={(e) => setField(field.id, e.target.value)}
                    error={errors[field.id]}
                    type={field.id.includes('email') ? 'email' : field.id.includes('phone') || field.id.includes('mobile') ? 'tel' : 'text'}
                  />
                );
              })}
            </div>
          </CardContent>
          <CardFooter className="justify-between">
            {currentStep > 0 ? (
              <Button variant="outline" onClick={handleBack}>
                <ArrowLeft className="mr-1.5 h-4 w-4" />
                Back
              </Button>
            ) : <div />}
            {isLastStep ? (
              <Button onClick={handleShowReview}>
                Review & Submit
              </Button>
            ) : (
              <Button onClick={handleNext}>
                Next
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            )}
          </CardFooter>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Fallback config (when no DB config exists)                         */
/* ------------------------------------------------------------------ */

const DEFAULT_CONFIG_SECTIONS: ConfigSection[] = [
  {
    id: "sec_personal", title: "Personal Information", description: "Basic personal details", deletable: false,
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
    id: "sec_address", title: "Address", description: "Permanent and current address details", deletable: false,
    fields: [
      { id: "permanent_address", label: "Permanent Address", type: "Text", required: true, editablePostOnboarding: false, deletable: false },
      { id: "current_address", label: "Current Address", type: "Text", required: true, editablePostOnboarding: true, deletable: false },
    ],
  },
  {
    id: "sec_emergency", title: "Emergency Contact", description: "Emergency contact person details", deletable: false,
    fields: [
      { id: "emergency_contact_name", label: "Contact Name", type: "Text", required: true, editablePostOnboarding: true, deletable: false },
      { id: "emergency_contact_phone", label: "Contact Phone", type: "Text", required: true, editablePostOnboarding: true, deletable: false },
      { id: "emergency_contact_relationship", label: "Relationship", type: "Dropdown", required: true, editablePostOnboarding: true, dropdownOptions: ["Spouse", "Parent", "Sibling", "Friend", "Other"], deletable: false },
    ],
  },
  {
    id: "sec_identity", title: "Identity Documents", description: "Government identity proofs", deletable: false,
    fields: [
      { id: "pan_number", label: "PAN Number", type: "Text", required: true, editablePostOnboarding: false, deletable: false },
      { id: "aadhaar_number", label: "Aadhaar Number", type: "Text", required: true, editablePostOnboarding: false, deletable: false },
    ],
  },
  {
    id: "sec_bank", title: "Bank Details", description: "Salary account information", deletable: false,
    fields: [
      { id: "bank_name", label: "Bank Name", type: "Text", required: true, editablePostOnboarding: true, deletable: false },
      { id: "account_number", label: "Account Number", type: "Text", required: true, editablePostOnboarding: true, deletable: false },
      { id: "ifsc_code", label: "IFSC Code", type: "Text", required: true, editablePostOnboarding: true, deletable: false },
      { id: "account_type", label: "Account Type", type: "Dropdown", required: true, editablePostOnboarding: true, dropdownOptions: ["Savings", "Current"], deletable: false },
    ],
  },
  {
    id: "sec_documents", title: "Document Uploads", description: "Upload required documents", deletable: false,
    fields: [
      { id: "aadhaar_doc", label: "Aadhaar Card Copy", type: "File Upload", required: true, editablePostOnboarding: false, deletable: false, acceptedFormats: ".pdf,.jpg,.jpeg,.png", maxFileSize: 2097152 },
      { id: "pan_doc", label: "PAN Card Copy", type: "File Upload", required: true, editablePostOnboarding: false, deletable: false, acceptedFormats: ".pdf,.jpg,.jpeg,.png", maxFileSize: 2097152 },
      { id: "education_docs", label: "Education Certificates", type: "File Upload", required: false, editablePostOnboarding: false, deletable: false, acceptedFormats: ".pdf,.jpg,.jpeg,.png", maxFileSize: 2097152 },
    ],
  },
];
