/**
 * Shared, FK-safe teardown helpers for e2e test scripts.
 *
 * Deleting an employees row fails if it is still referenced by audit_log
 * (audit_log_target_employee_fkey has no ON DELETE CASCADE) or by attendance.
 * These helpers detach/remove dependents first so test data never leaks.
 */

/** The three accounts seeded for tests; never delete these. */
export const PROTECTED_EMAILS = [
  'admin@demandnexus.io',
  'emp1@demandnexus.io',
  'emp2@demandnexus.io',
];

/**
 * Fully remove an employee created during a test: its attendance rows, any
 * audit_log rows that target it, the employees row, and its auth user.
 * Safe to call with a partial object; missing fields are skipped.
 */
export async function deleteEmployee(svc, emp) {
  if (!emp) return;
  if (emp.email && PROTECTED_EMAILS.includes(emp.email)) return;
  if (emp.id) {
    await svc.from('attendance').delete().eq('employee_id', emp.id);
    await svc.from('audit_log').delete().eq('target_employee', emp.id);
    await svc.from('employees').delete().eq('id', emp.id);
  }
  if (emp.auth_user_id) {
    await svc.auth.admin.deleteUser(emp.auth_user_id).catch(() => {});
  }
}

/** Delete many employees (array of {id, auth_user_id, email}). */
export async function deleteEmployees(svc, emps) {
  for (const e of emps ?? []) await deleteEmployee(svc, e);
}
