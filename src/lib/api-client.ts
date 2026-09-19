/**
 * API Client - All frontend data access goes through here.
 * No direct supabase.from() calls in frontend code.
 */

import type {
  PayrollRunRow,
  PayslipRow,
  SalaryComponentCalc,
  SalaryComponentRow,
  SalaryStructureRow,
} from '@/types';

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// ── Auth ──────────────────────────────────────────────────
// The Supabase Auth session lives in cookies (set by @supabase/ssr) and is
// sent automatically with every request via `credentials: 'include'`.
// No manual token injection is needed.

/**
 * In-flight + short-lived GET cache.
 *
 * Several pages mount independent components that each fetch the same endpoint
 * (e.g. the Leaves page loads /api/leaves from both the history view and the
 * balance card). Without coalescing, that doubles the network round-trips.
 *
 * - Concurrent identical GETs share a single in-flight promise.
 * - A finished GET is cached for a short TTL so a component mounting a moment
 *   later reuses it instead of refetching.
 * - Any mutation (non-GET) clears the whole cache so reads stay fresh.
 */
const GET_CACHE_TTL_MS = 1500;
interface CacheEntry {
  at: number;
  promise: Promise<unknown>;
  settled: boolean;
}
const getCache = new Map<string, CacheEntry>();

function clearGetCache(): void {
  getCache.clear();
}

async function request<T = unknown>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const isGet = method === 'GET';

  // Coalesce / serve fresh GETs from the cache.
  if (isGet) {
    const cached = getCache.get(url);
    if (cached && (!cached.settled || Date.now() - cached.at < GET_CACHE_TTL_MS)) {
      return cached.promise as Promise<T>;
    }
  }

  const exec = (async () => {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      credentials: 'include', // sends the Supabase auth session cookie
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new ApiError(body.error || res.statusText, res.status);
    }

    const body = await res.json();
    // API routes wrap in { success, data } - unwrap if present
    if (body && typeof body === 'object' && 'data' in body) {
      return body.data as T;
    }
    return body as T;
  })();

  if (isGet) {
    const entry: CacheEntry = { at: Date.now(), promise: exec, settled: false };
    getCache.set(url, entry);
    exec
      .then(() => {
        entry.at = Date.now();
        entry.settled = true;
      })
      .catch(() => {
        // Don't cache failures — let the next call retry.
        getCache.delete(url);
      });
  } else {
    // A write happened: invalidate cached reads so the UI refetches fresh data.
    exec.finally(() => clearGetCache());
  }

  return exec as Promise<T>;
}

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const entries = Object.entries(params).filter(([, v]) => v != null && v !== '');
  if (entries.length === 0) return '';
  return '?' + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
}

// ── Auth ──────────────────────────────────────────────────

export const auth = {
  /** Record a login audit entry (called after Supabase signInWithPassword). */
  loginEvent: () =>
    request('/api/auth', { method: 'POST' }),
  me: () =>
    request<{ employee: any }>('/api/auth/me'),
  /** Clear the forced-password-reset flag after a successful self password change. */
  clearResetFlag: () =>
    request<{ cleared: boolean }>('/api/auth/me', {
      method: 'POST',
      body: JSON.stringify({ action: 'clear_reset_flag' }),
    }),
};

// ── Attendance ────────────────────────────────────────────

export const attendance = {
  list: (params?: { employeeId?: string; month?: number; year?: number; date?: string; open?: 1 }) =>
    request<{ records: any[] }>(`/api/attendance${qs(params || {})}`),
  /**
   * Returns the caller's currently-open session (punched in, not yet out),
   * regardless of which calendar day it started on. Used to restore an
   * in-progress punch so an overnight shift crossing midnight still shows
   * Punch Out instead of Punch In.
   */
  openSession: () =>
    request<{ records: any[] }>(`/api/attendance${qs({ open: 1 })}`),
  /**
   * Admin: every currently-open session across all employees (punched in, not
   * yet out), regardless of start date. Lets the dashboard show night-shift
   * workers whose punch-in is dated yesterday as still working.
   */
  openSessions: () =>
    request<{ records: any[] }>(`/api/attendance${qs({ open: 'all' })}`),
  // IP detection, flagging and bypass are handled entirely server-side using
  // the real request IP; the client sends no IP/flag (any would be ignored).
  // Coordinates (when the browser grants them) ride along for geofencing;
  // the server validates them against admin-defined zones and flags punches
  // outside every zone. Missing coords are allowed (flagged if geo is on).
  punchIn: (coords?: { lat: number; lng: number; accuracy?: number }) =>
    request<{ record: any }>('/api/attendance', {
      method: 'POST',
      body: JSON.stringify({ action: 'punch_in', ...(coords ?? {}) }),
    }),
  punchOut: () =>
    request<{ record: any }>('/api/attendance', { method: 'POST', body: JSON.stringify({ action: 'punch_out' }) }),
  delete: (id: string) =>
    request('/api/attendance', { method: 'DELETE', body: JSON.stringify({ id }) }),
  edit: (data: { id: string; date?: string; punch_in?: string; punch_out?: string; worked_hours?: number; status?: string }) =>
    request<{ record: any }>('/api/attendance', { method: 'PATCH', body: JSON.stringify(data) }),
  add: (data: { employee_id: string; date: string; punch_in?: string; punch_out?: string; worked_hours?: number; status?: string }) =>
    request<{ record: any }>('/api/attendance', { method: 'PATCH', body: JSON.stringify(data) }),
  absentees: (params?: { date?: string }) =>
    request<{ absentees: { id: string; employeeId: string; name: string; department: string }[]; date: string; isHoliday?: boolean; isWeekend?: boolean }>(
      `/api/attendance/absentees${qs(params || {})}`,
    ),
  markAbsent: (data: { employee_id: string; date: string; action: 'lop' | 'deduct_leave'; leave_type_id?: string }) =>
    request<{ attendance: any; action: string; leaveType?: string }>(
      '/api/attendance/absentees',
      { method: 'POST', body: JSON.stringify(data) },
    ),
};

// ── Attendance Segments (breaks) ──────────────────────────

export const segments = {
  startBreak: (attendanceId: string) =>
    request<{ segment: any }>('/api/attendance/segments', { method: 'POST', body: JSON.stringify({ attendance_id: attendanceId }) }),
  endBreak: (segmentId: string) =>
    request<{ segment: any }>('/api/attendance/segments', { method: 'PATCH', body: JSON.stringify({ segment_id: segmentId }) }),
};

// ── Approval Requests ─────────────────────────────────────

export const approvalRequests = {
  list: (params?: { type?: string; status?: string }) =>
    request<{ requests: any[] }>(`/api/approval-requests${qs(params || {})}`),
  create: (data: { type: string; detected_ip?: string; action_type?: string; reason?: string; reg_date?: string; original_punch?: string; requested_change?: string; field_name?: string; new_value?: string; current_shift_start?: string; current_shift_end?: string; new_shift_start?: string; new_shift_end?: string }) =>
    request<{ request: any }>('/api/approval-requests', { method: 'POST', body: JSON.stringify(data) }),
  update: (data: { id: string; status: string; rejection_reason?: string }) =>
    request('/api/approval-requests', { method: 'PATCH', body: JSON.stringify(data) }),
};

// ── Bulk Approvals ────────────────────────────────────────

export const approvals = {
  bulkUpdate: (data: { items: { id: string; type: 'leave' | 'approval_request' }[]; status: string; rejection_reason?: string }) =>
    request('/api/approvals', { method: 'PATCH', body: JSON.stringify(data) }),
};

// ── Departments ───────────────────────────────────────────

export const departments = {
  list: () =>
    request<{ departments: { id: string; name: string; employeeCount: number }[] }>('/api/departments'),
  create: (name: string) =>
    request<{ department: any }>('/api/departments', { method: 'POST', body: JSON.stringify({ name }) }),
  update: (id: string, name: string) =>
    request<{ department: any }>('/api/departments', { method: 'PATCH', body: JSON.stringify({ id, name }) }),
  remove: (id: string) =>
    request<{ deleted: string }>('/api/departments', { method: 'DELETE', body: JSON.stringify({ id }) }),
};

// ── Documents ─────────────────────────────────────────────

export const documents = {
  list: (params?: { employee_id?: string }) =>
    request<{ documents: any[] }>(`/api/documents${qs(params || {})}`),
  requestDocument: (description: string, employee_id?: string) =>
    request<{ documentRequest: any }>('/api/document-requests', { method: 'POST', body: JSON.stringify({ description, employee_id }) }),
  upload: async (formData: FormData) => {
    // The Supabase session cookie is sent automatically; do not set
    // Content-Type so the browser adds the multipart boundary.
    const res = await fetch('/api/documents', {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new ApiError(body.error || res.statusText, res.status);
    }
    return res.json();
  },
  getViewUrl: (id: string) =>
    request<{ url: string; name: string }>(`/api/documents/${id}/view`),
  verify: (id: string, verified: boolean) =>
    request<{ document: any }>(`/api/documents/${id}/verify`, { method: 'PATCH', body: JSON.stringify({ verified }) }),
  remove: (id: string) =>
    request<{ deleted: string }>(`/api/documents/${id}`, { method: 'DELETE' }),
};

// ── Document Requests (admin requests docs from employees) ─

export const documentRequests = {
  list: (params?: { employee_id?: string; status?: string }) =>
    request<{ documentRequests: any[] }>(`/api/document-requests${qs(params || {})}`),
  create: (description: string, employee_id?: string) =>
    request<{ documentRequest: any }>('/api/document-requests', {
      method: 'POST',
      body: JSON.stringify({ description, employee_id }),
    }),
  setStatus: (id: string, status: 'pending' | 'fulfilled' | 'rejected') =>
    request<{ documentRequest: any }>(`/api/document-requests/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  remove: (id: string) =>
    request<{ message: string }>(`/api/document-requests/${id}`, { method: 'DELETE' }),
};

// ── Email Settings (admin) ────────────────────────────────

export const emailSettings = {
  get: () =>
    request<{ rules: any[]; smtp: Record<string, string> }>('/api/email-settings'),
  createRule: (data: { event: string; description?: string; email_enabled?: boolean; recipients?: string }) =>
    request<{ rule: any }>('/api/email-settings', { method: 'POST', body: JSON.stringify({ action: 'create_rule', ...data }) }),
  updateRule: (data: { id: string; event?: string; description?: string; email_enabled?: boolean; recipients?: string }) =>
    request<{ rule: any }>('/api/email-settings', { method: 'POST', body: JSON.stringify({ action: 'update_rule', ...data }) }),
  toggleRule: (id: string, email_enabled: boolean) =>
    request<{ rule: any }>('/api/email-settings', { method: 'POST', body: JSON.stringify({ action: 'toggle_rule', id, email_enabled }) }),
  deleteRule: (id: string) =>
    request<{ deleted: string }>('/api/email-settings', { method: 'POST', body: JSON.stringify({ action: 'delete_rule', id }) }),
  saveSmtp: (smtp: Record<string, string>) =>
    request<{ updated: number }>('/api/email-settings', { method: 'POST', body: JSON.stringify({ action: 'save_smtp', smtp }) }),
  testEmail: (to_email?: string) =>
    request<{ message: string }>('/api/email-settings', { method: 'POST', body: JSON.stringify({ action: 'test_email', to_email }) }),
};

// ── Employees ─────────────────────────────────────────────

export const employees = {
  list: () =>
    request<{ employees: any[] }>('/api/employees'),
  previewNextId: () =>
    request<{ nextId: string }>('/api/employees?preview_next_id=1'),
  get: (id: string) =>
    request<{ employee: any; leaveTypes: any[]; leaveAllocations: any[]; leaveOverrides: any[]; leaveRequests: any[]; documents: any[]; auditLog: any[] }>(`/api/employees/${id}`),
  create: (data: Record<string, any>) =>
    request<{ employee: any; tempPassword: string }>('/api/employees', { method: 'POST', body: JSON.stringify(data) }),
  /** Validate a batch of CSV rows against the live DB (no writes). */
  bulkValidate: (rows: Record<string, any>[]) =>
    request<{ rows: any[]; summary: any }>('/api/employees/bulk', {
      method: 'POST',
      body: JSON.stringify({ rows, validateOnly: true }),
    }),
  /** Commit a validated batch: creates departments + employees server-side. */
  bulkCreate: (rows: Record<string, any>[]) =>
    request<{ rows: any[]; summary: any }>('/api/employees/bulk', {
      method: 'POST',
      body: JSON.stringify({ rows, validateOnly: false }),
    }),
  update: (id: string, data: Record<string, any>) =>
    request<{ employee: any }>(`/api/employees/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  forceLogout: (id: string) =>
    request(`/api/employees/${id}/force-logout`, { method: 'POST' }),
  /**
   * Admin sets/generates a temporary password for an employee (no email service).
   * Returns the temp password once so it can be shared with the user. Pass a
   * `password` to set a specific one, omit it to auto-generate.
   */
  resetPassword: (id: string, password?: string) =>
    request<{
      employeeId: string;
      employeeName: string;
      email: string;
      tempPassword: string;
      generated: boolean;
      mustResetOnLogin: boolean;
    }>(`/api/employees/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify(password ? { password } : {}),
    }),
  offboard: (id: string, data: { lastWorkingDay: string; reason: string; notes?: string }) =>
    request<{ employee: any; message: string }>(`/api/employees/${id}/offboard`, { method: 'POST', body: JSON.stringify(data) }),
};

// ── Holidays ──────────────────────────────────────────────

export const holidays = {
  list: (params?: { financial_year?: string }) =>
    request<{ holidays: any[] }>(`/api/holidays${qs(params || {})}`),
  create: (data: { name: string; date: string; type: string; financial_year: string }) =>
    request<{ holiday: any }>('/api/holidays', { method: 'POST', body: JSON.stringify(data) }),
  update: (data: { id: string; name?: string; date?: string; type?: string }) =>
    request('/api/holidays', { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request('/api/holidays', { method: 'DELETE', body: JSON.stringify({ id }) }),
};

// ── IP Allowlist ──────────────────────────────────────────

export const ipAllowlist = {
  list: () =>
    request<{ allowlist: any[]; blocklist: any[]; bypassed: boolean }>('/api/ip-allowlist'),
  add: (data: { ip: string; label: string }) =>
    request('/api/ip-allowlist', { method: 'POST', body: JSON.stringify(data) }),
  setBypass: (bypass: boolean) =>
    request<{ bypassed: boolean }>('/api/ip-allowlist', { method: 'PATCH', body: JSON.stringify({ bypass }) }),
  remove: (data: { id: string }) =>
    request('/api/ip-allowlist', { method: 'DELETE', body: JSON.stringify({ ...data, action: 'remove' }) }),
  block: (data: { id: string; ip: string; reason: string; label: string }) =>
    request('/api/ip-allowlist', { method: 'DELETE', body: JSON.stringify({ ...data, action: 'block' }) }),
  unblock: (data: { id: string }) =>
    request('/api/ip-allowlist', { method: 'DELETE', body: JSON.stringify({ ...data, action: 'unblock' }) }),
};

// ── Punch Locations (geofencing) ──────────────────────────

export interface GeoZoneDto { id: string; label: string; lat: number; lng: number; radiusM: number }

export const geoZones = {
  get: () =>
    request<{ config: { enabled: boolean; zones: GeoZoneDto[] } }>('/api/geo-zones'),
  save: (config: { enabled: boolean; zones: GeoZoneDto[] }) =>
    request<{ config: { enabled: boolean; zones: GeoZoneDto[] } }>('/api/geo-zones', { method: 'POST', body: JSON.stringify(config) }),
};

// ── IP Check ──────────────────────────────────────────────

export const ipCheck = {
  get: () =>
    request<{ ip: string }>('/api/ip-check'),
};

// ── Leaves ────────────────────────────────────────────────

export const leaves = {
  list: (params?: { status?: string; employee_id?: string }) =>
    request<{ requests: any[]; leaveTypes: any[]; leaveAllocations: any[]; leaveOverrides: any[] }>(`/api/leaves${qs(params || {})}`),
  create: (data: { leave_type_id: string; from_date: string; to_date: string; days: number; half_day?: boolean; reason: string }) =>
    request<{ request: any }>('/api/leaves', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: { status: string; rejection_reason?: string }) =>
    request(`/api/leaves/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
};

// ── Leave Settings (admin) ────────────────────────────────

export const leaveSettings = {
  createLeaveType: (data: { name: string; key: string; annual_days: number }) =>
    request<{ leaveType: any }>('/api/leave-settings', { method: 'POST', body: JSON.stringify({ action: 'create_leave_type', ...data }) }),
  updateLeaveType: (data: { id: string; name?: string; key?: string }) =>
    request<{ leaveType: any }>('/api/leave-settings', { method: 'POST', body: JSON.stringify({ action: 'update_leave_type', ...data }) }),
  deleteLeaveType: (id: string) =>
    request<{ deleted: string }>('/api/leave-settings', { method: 'POST', body: JSON.stringify({ action: 'delete_leave_type', id }) }),
  updateAllocation: (data: { leave_type_id: string; annual_days: number }) =>
    request('/api/leave-settings', { method: 'POST', body: JSON.stringify({ action: 'update_allocation', ...data }) }),
  bulkUpdateAllocations: (allocations: { leave_type_id: string; annual_days: number }[]) =>
    request<{ updated: number }>('/api/leave-settings', { method: 'POST', body: JSON.stringify({ action: 'bulk_update_allocations', allocations }) }),
  createOverride: (data: { employee_id: string; leave_type_id: string; custom_days: number }) =>
    request<{ override: any }>('/api/leave-settings', { method: 'POST', body: JSON.stringify({ action: 'create_override', ...data }) }),
  deleteOverride: (target: string | { employee_id: string; leave_type_id: string }) =>
    request<{ deleted: string | null }>('/api/leave-settings', {
      method: 'POST',
      body: JSON.stringify(
        typeof target === 'string'
          ? { action: 'delete_override', id: target }
          : { action: 'delete_override', ...target },
      ),
    }),
};

// ── Notifications ─────────────────────────────────────────

export const notifications = {
  list: () =>
    request<{ notifications: any[] }>('/api/notifications'),
  markRead: (id: string) =>
    request('/api/notifications', { method: 'PATCH', body: JSON.stringify({ id }) }),
  markAllRead: () =>
    request('/api/notifications', { method: 'PATCH', body: JSON.stringify({ markAll: true }) }),
  create: (data: { employee_id: string; title: string; message?: string; type?: string } | Array<{ employee_id: string; title: string; message?: string; type?: string }>) =>
    request('/api/notifications', { method: 'POST', body: JSON.stringify(data) }),
};

// ── Onboarding ────────────────────────────────────────────

export const onboarding = {
  list: (params?: { employee_id?: string }) =>
    request<{ employees?: any[]; submission?: any; onboarding_status?: string }>(`/api/onboarding${qs(params || {})}`),
  submit: (data: { responses: Record<string, string>; documents: any[]; config_version: number }) =>
    request('/api/onboarding', { method: 'POST', body: JSON.stringify(data) }),
  approve: (data: { employee_id: string; department_id: string; responses?: Record<string, string> }) =>
    request('/api/onboarding', { method: 'PATCH', body: JSON.stringify(data) }),
  reject: (data: { employee_id: string; notes?: string; flagged_fields?: string[] }) =>
    request('/api/onboarding', { method: 'PATCH', body: JSON.stringify({ ...data, action: 'reject' }) }),
};

// ── Onboarding Config ─────────────────────────────────────

export const onboardingConfig = {
  get: (params?: { version?: number }) =>
    request<{ config: any }>(`/api/onboarding/config${qs(params || {})}`),
  save: (data: { version: number; sections: any[]; published?: boolean }) =>
    request('/api/onboarding/config', { method: 'POST', body: JSON.stringify(data) }),
  publish: (version: number) =>
    request('/api/onboarding/config', { method: 'PATCH', body: JSON.stringify({ version }) }),
};

// ── Team Insights ─────────────────────────────────────────

export const teamInsights = {
  get: (params?: { period?: string }) =>
    request<any>(`/api/team-insights${qs(params || {})}`),
};

// ── Dashboard Stats ───────────────────────────────────────

export const dashboardStats = {
  get: () =>
    request<any>('/api/dashboard/stats'),
};

// ── Audit ─────────────────────────────────────────────────

export const audit = {
  list: (params?: { page?: number; limit?: number; action?: string }) =>
    request<{ auditLogs: any[]; total: number; page: number; limit: number }>(`/api/audit${qs(params || {})}`),
};

// ── Payroll ───────────────────────────────────────────────

export const payroll = {
  /** Component catalog + statutory settings (admin). */
  settings: () =>
    request<{ components: SalaryComponentRow[]; settings: Record<string, unknown> }>(
      '/api/payroll/settings',
    ),
  saveSettings: (data: { key: string; value: unknown }) =>
    request('/api/payroll/settings', { method: 'PATCH', body: JSON.stringify(data) }),

  /** Salary structures. Employees may read their own; only admins write. */
  structures: (params?: { employee_id?: string }) =>
    request<{ structures: SalaryStructureRow[] }>(`/api/payroll/structures${qs(params || {})}`),
  createStructure: (data: {
    employee_id: string;
    effective_from: string;
    monthly_gross: number;
    ctc_annual?: number | null;
    note?: string;
    items: {
      component_key: string;
      calc: SalaryComponentCalc;
      amount?: number | null;
      percent?: number | null;
    }[];
  }) => request<{ structure: SalaryStructureRow }>('/api/payroll/structures', {
    method: 'POST',
    body: JSON.stringify(data),
  }),

  /** Payroll runs. */
  runs: () => request<{ runs: PayrollRunRow[] }>('/api/payroll/runs'),
  run: (id: string) =>
    request<{ run: PayrollRunRow; payslips: PayslipRow[] }>(`/api/payroll/runs/${id}`),
  /** Creates (or recomputes) the draft for a period. */
  createRun: (data: { period_year: number; period_month: number }) =>
    request<{ run: PayrollRunRow; payslips: PayslipRow[]; skipped: { name: string; reason: string }[] }>(
      '/api/payroll/runs',
      { method: 'POST', body: JSON.stringify(data) },
    ),
  /** draft -> locked -> published. One-way (§8.1). */
  transitionRun: (id: string, status: 'locked' | 'published') =>
    request<{ run: PayrollRunRow }>(`/api/payroll/runs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  deleteRun: (id: string) =>
    request(`/api/payroll/runs/${id}`, { method: 'DELETE' }),
  setTds: (data: { payslip_id: string; tds_override: number | null }) =>
    request<{ payslip: PayslipRow }>('/api/payroll/runs', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  /** Payslips visible to the caller. Employees only see published ones. */
  payslips: (params?: { employee_id?: string; year?: number }) =>
    request<{ payslips: PayslipRow[] }>(`/api/payroll/payslips${qs(params || {})}`),
  payslip: (id: string) =>
    request<{ payslip: PayslipRow; downloadUrl: string | null }>(`/api/payroll/payslips/${id}`),
};

const api = {
  auth,
  attendance,
  segments,
  approvalRequests,
  approvals,
  departments,
  documents,
  documentRequests,
  emailSettings,
  employees,
  holidays,
  ipAllowlist,
  geoZones,
  ipCheck,
  leaves,
  leaveSettings,
  notifications,
  payroll,
  onboarding,
  onboardingConfig,
  teamInsights,
  dashboardStats,
  audit,
};

export default api;
