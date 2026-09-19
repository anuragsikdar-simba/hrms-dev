/**
 * August HRMS - TypeScript types
 *
 * Convention:
 * - "Row" suffixed types match DB columns (snake_case) for use in API routes
 * - Frontend types (Employee, etc.) use camelCase for component consumption
 * - Dates are ISO strings (no Firestore Timestamp)
 * - UUIDs are strings
 * - JSONB columns are typed as their expected shape
 */

// -------------------------------------------------------
// Enums & Literal Unions (match DB CHECK constraints)
// -------------------------------------------------------

export type EmployeeRole = 'admin' | 'employee';

/** DB values: active, inactive, offboarded. Derived display values added for frontend. */
export type EmployeeStatus =
  | 'active'
  | 'inactive'
  | 'offboarded'
  // Derived statuses used in frontend employee list
  | 'pending_onboarding'
  | 'onboarding_submitted'
  | 'terminated';

export type OnboardingStatus = 'pending' | 'in_progress' | 'completed';

export type Gender = 'male' | 'female' | 'other' | 'prefer_not_to_say';

export type LeaveRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export type AttendanceStatus =
  | 'present'
  | 'absent'
  | 'half'
  | 'leave'
  | 'holiday'
  | 'weekend';

export type WorkMode = 'office' | 'home' | 'client' | 'onsite';

export type ApprovalRequestType = 'regularisation' | 'wfh' | 'ip_violation';

export type ApprovalRequestStatus = 'pending' | 'approved' | 'rejected';

export type HolidayType = 'mandatory' | 'optional';

export type DocumentCategory = 'identity' | 'education' | 'employment' | 'other' | 'onboarding';

export type NotificationType = 'info' | 'warning' | 'success' | 'error';

export type OnboardingConfigStatus = 'draft' | 'published';

export type OnboardingSubmissionStatus = 'pending' | 'approved' | 'rejected';

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'login'
  | 'logout'
  | 'approve'
  | 'reject'
  | 'upload'
  | 'punch_in'
  | 'punch_out'
  // Payslip / document downloads (BUSINESS_RULES §8.4).
  | 'view';

// -------------------------------------------------------
// Embedded / JSONB types
// -------------------------------------------------------

export interface BankDetails {
  bankName: string;
  accountNumber: string;
  ifsc: string;
  accountType?: string;
}

export interface Address {
  line1: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
}

export interface EmergencyContact {
  name: string;
  phone: string;
  relationship: string;
}

export type CustomFields = Record<string, string>;

// -------------------------------------------------------
// Frontend types (camelCase, used in components)
// -------------------------------------------------------

export interface Department {
  id: string;
  name: string;
  headId: string | null;
  createdAt: string;
}

/**
 * Employee type -- used across all frontend components.
 * Mapped from DB snake_case in AuthContext.mapRowToEmployee().
 */
export interface Employee {
  id: string;
  employeeId: string;              // e.g. "EMP001"
  name: string;
  email: string;                   // company email
  personalEmail?: string;
  phone?: string;
  role: EmployeeRole;
  department: string;              // resolved department name (display)
  departmentId?: string;           // FK -> departments.id (for forms)
  designation: string;
  dateOfJoining: string | null;    // DATE: "2024-06-10"
  employmentType: string;
  dob?: string | null;             // DATE
  gender?: Gender;
  bloodGroup?: string;

  // Permanent address
  permanentAddress?: Address;

  // Current address
  currentAddress?: Address;

  // Emergency contact
  emergencyContact?: EmergencyContact;

  // Identity (PII)
  pan?: string;
  aadhaar?: string;

  // Bank
  bankDetails?: BankDetails;

  // Management & status
  reportingManagerId?: string;
  status: EmployeeStatus;
  onboardingStatus: OnboardingStatus;
  mustResetPassword: boolean;
  /** Whether this person participates in punch in/out and counts in
   * attendance reports. Observers (e.g. authority figures) are false. */
  tracksAttendance: boolean;
  profilePictureUrl?: string;

  // Dynamic fields
  customFields?: CustomFields;

  createdAt: string;               // TIMESTAMPTZ
  updatedAt: string;               // TIMESTAMPTZ
  deletedAt: string | null;
}

// -------------------------------------------------------
// DB Row types (snake_case, used in API routes)
// -------------------------------------------------------

/** Raw employee row from Supabase */
export interface EmployeeRow {
  id: string;
  employee_id: string;
  name: string;
  email: string;
  personal_email: string | null;
  phone: string | null;
  role: EmployeeRole;
  department_id: string | null;
  designation: string | null;
  date_of_joining: string | null;
  date_of_birth: string | null;
  gender: Gender | null;
  blood_group: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pin_code: string | null;
  current_address: string | null;
  current_city: string | null;
  current_state: string | null;
  current_pin_code: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relation: string | null;
  pan: string | null;
  aadhaar: string | null;
  bank_details: BankDetails | null;
  reporting_to: string | null;
  status: EmployeeStatus;
  onboarding_status: OnboardingStatus;
  must_reset_password: boolean;
  avatar_url: string | null;
  custom_fields: CustomFields;
  created_at: string;
  updated_at: string;
  // Supabase join - present when selected with department:departments(id, name)
  department?: { id: string; name: string } | null;
}

/** attendance table */
export interface AttendanceRecord {
  id: string;
  employee_id: string;
  date: string;
  punch_in: string | null;
  punch_out: string | null;
  status: AttendanceStatus;
  worked_hours: number | null;
  ip_address: string | null;
  ip_flagged: boolean;
  notes: string | null;
  punch_in_selfie_url?: string | null;
  punch_out_selfie_url?: string | null;
  work_mode?: WorkMode | null;
  created_at: string;
  updated_at: string;
}

/** attendance_segments table */
export interface AttendanceSegment {
  id: string;
  attendance_id: string;
  segment_start: string;
  segment_end: string | null;
  created_at: string;
}

/** leave_types table */
export interface LeaveType {
  id: string;
  name: string;
  key: string;
  created_at: string;
}

/** leave_allocations table */
export interface LeaveAllocation {
  id: string;
  leave_type_id: string;
  annual_days: number;
  created_at: string;
}

/** leave_overrides table */
export interface LeaveOverride {
  id: string;
  employee_id: string;
  leave_type_id: string;
  custom_days: number;
  created_at: string;
}

/** leave_requests table */
export interface LeaveRequest {
  id: string;
  employee_id: string;
  leave_type_id: string;
  from_date: string;
  to_date: string;
  days: number;
  half_day: boolean;
  reason: string | null;
  status: LeaveRequestStatus;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

/** approval_requests table */
export interface ApprovalRequest {
  id: string;
  employee_id: string;
  type: ApprovalRequestType;
  status: ApprovalRequestStatus;
  reg_date: string | null;
  original_punch: string | null;
  requested_change: string | null;
  wfh_from: string | null;
  wfh_to: string | null;
  detected_ip: string | null;
  action_type: string | null;
  reason: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

/** ip_allowlist table */
export interface IPAllowlistEntry {
  id: string;
  ip: string;
  label: string;
  added_by: string | null;
  created_at: string;
}

/** ip_blocklist table */
export interface IPBlocklistEntry {
  id: string;
  ip: string;
  reason: string | null;
  created_at: string;
}

/** holidays table */
export interface Holiday {
  id: string;
  name: string;
  date: string;
  type: HolidayType;
  financial_year: string;
  created_at: string;
}

/** documents table */
export interface Document {
  id: string;
  employee_id: string;
  name: string;
  category: DocumentCategory;
  file_url: string | null;
  file_size: number | null;
  uploaded_at: string;
  verified: boolean;
  verified_by: string | null;
  verified_at: string | null;
}

/** audit_log table */
export interface AuditLogEntry {
  id: string;
  performed_by: string | null;
  action: string;
  target_employee: string | null;
  details: string | null;
  ip_address: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  created_at: string;
}

/** notifications table */
export interface Notification {
  id: string;
  employee_id: string;
  title: string;
  message: string | null;
  type: NotificationType;
  read: boolean;
  actionable: boolean;
  action_url: string | null;
  created_at: string;
}

/** onboarding_configs table */
export interface OnboardingConfig {
  id: string;
  version: number;
  sections: OnboardingSection[];
  status: OnboardingConfigStatus;
  published_at: string | null;
  published_by: string | null;
  created_at: string;
  updated_at: string;
}

/** onboarding_submissions table */
export interface OnboardingSubmission {
  id: string;
  employee_id: string;
  config_version: number;
  responses: Record<string, string>;
  document_ids: string[];
  status: OnboardingSubmissionStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  remarks: string | null;
  submitted_at: string;
  created_at: string;
  updated_at: string;
}

// -------------------------------------------------------
// Onboarding Config JSONB shapes
// -------------------------------------------------------

export type OnboardingFieldType = 'text' | 'number' | 'date' | 'dropdown' | 'file_upload';

export interface OnboardingField {
  id: string;
  label: string;
  type: OnboardingFieldType;
  required: boolean;
  options?: string[];
  acceptedFormats?: string[];
  maxSize?: number;
  editablePostOnboarding?: boolean;
  deletable?: boolean;
}

export interface OnboardingSection {
  id: string;
  title: string;
  order: number;
  fields: OnboardingField[];
}

// -------------------------------------------------------
// API response helpers
// -------------------------------------------------------

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface LeaveBalance {
  leave_type: LeaveType;
  allocated: number;
  used: number;
  remaining: number;
}

export interface AuthUser {
  uid: string;
  email: string;
  role: EmployeeRole;
  employee: Employee;
}

export interface DashboardStats {
  pendingLeaves: number;
  pendingIpViolations: number;
  pendingRegularisations: number;
  pendingOnboarding: number;
}

export interface TeamInsights {
  employeeCounts: {
    active: number;
    newHires: number;
    offboarded: number;
    pendingOnboarding: number;
  };
  attendance: {
    averageHours: number;
    lateArrivals: number;
    leaveDays: number;
    regularisations: number;
  };
  period: string;
  dateRange: { from: string; to: string };
}

// -------------------------------------------------------
// Payroll (docs/BUSINESS_RULES.md §8)
// -------------------------------------------------------

export type SalaryComponentKind = 'earning' | 'deduction';

export type SalaryComponentCalc = 'fixed' | 'pct_of_basic' | 'pct_of_gross' | 'balance';

/** One-way state machine: draft -> locked -> published (§8.1). */
export type PayrollRunStatus = 'draft' | 'locked' | 'published';

/** salary_components table */
export interface SalaryComponentRow {
  id: string;
  key: string;
  name: string;
  kind: SalaryComponentKind;
  calc: SalaryComponentCalc;
  taxable: boolean;
  display_order: number;
  is_active: boolean;
  created_at: string;
}

/** salary_structures table — effective-dated, never edited in place (§8.1) */
export interface SalaryStructureRow {
  id: string;
  employee_id: string;
  effective_from: string;
  ctc_annual: number | null;
  monthly_gross: number;
  note: string | null;
  created_by: string | null;
  created_at: string;
  // Supabase join
  items?: SalaryStructureItemRow[];
  employees?: { name: string; employee_id: string } | null;
}

/** salary_structure_items table */
export interface SalaryStructureItemRow {
  id: string;
  structure_id: string;
  component_key: string;
  calc: SalaryComponentCalc;
  amount: number | null;
  percent: number | null;
}

/** payroll_runs table */
export interface PayrollRunRow {
  id: string;
  period_year: number;
  period_month: number;
  status: PayrollRunStatus;
  total_gross: number;
  total_deductions: number;
  total_net: number;
  employee_count: number;
  note: string | null;
  created_by: string | null;
  locked_by: string | null;
  locked_at: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A stored payslip line. Snapshotted, so the label travels with the amount
 *  and stays correct even if the component is later renamed (§8.1). */
export interface PayslipLineRow {
  key: string;
  label: string;
  amount: number;
}

/** payslips table — immutable snapshot (§8.1) */
export interface PayslipRow {
  id: string;
  payroll_run_id: string;
  employee_id: string;
  structure_id: string | null;
  period_year: number;
  period_month: number;
  days_in_month: number;
  lop_days: number;
  paid_days: number;
  earnings: PayslipLineRow[];
  deductions: PayslipLineRow[];
  gross: number;
  total_deductions: number;
  net_pay: number;
  tds_override: number | null;
  /** Frozen copy of the employee/bank/statutory context at generation time. */
  snapshot: Record<string, unknown>;
  pdf_path: string | null;
  created_at: string;
  updated_at: string;
  // Supabase joins
  employees?: { name: string; employee_id: string; email: string } | null;
  payroll_runs?: { status: PayrollRunStatus } | null;
}
