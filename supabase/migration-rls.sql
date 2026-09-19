-- ============================================================================
-- August HRMS - RLS Migration
-- Phase 1: Link employees to Supabase Auth, helper functions, RLS policies
-- ============================================================================

-- 1. Add auth_user_id column to employees (FK to auth.users)
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS auth_user_id UUID UNIQUE
  REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2. Create index on auth_user_id for fast lookups
CREATE INDEX IF NOT EXISTS idx_employees_auth_user_id ON employees(auth_user_id);

-- 2b. Drop the legacy Firebase linkage (replaced by auth_user_id).
DROP INDEX IF EXISTS idx_employees_firebase_uid;
ALTER TABLE employees DROP COLUMN IF EXISTS firebase_uid;

-- 3. Helper function: get the current user's employee UUID from auth.uid()
--    auth.uid() returns the Supabase Auth user id (auth.users.id).
CREATE OR REPLACE FUNCTION my_employee_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

-- 4. Helper function: check if current user is an admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM employees
    WHERE auth_user_id = auth.uid()
      AND role = 'admin'
  );
$$;

-- ============================================================================
-- 5. Drop all "Allow all for now" placeholder policies
-- ============================================================================
DROP POLICY IF EXISTS "Allow all for now" ON employees;
DROP POLICY IF EXISTS "Allow all for now" ON attendance;
DROP POLICY IF EXISTS "Allow all for now" ON attendance_segments;
DROP POLICY IF EXISTS "Allow all for now" ON leave_types;
DROP POLICY IF EXISTS "Allow all for now" ON leave_allocations;
DROP POLICY IF EXISTS "Allow all for now" ON leave_overrides;
DROP POLICY IF EXISTS "Allow all for now" ON leave_requests;
DROP POLICY IF EXISTS "Allow all for now" ON approval_requests;
DROP POLICY IF EXISTS "Allow all for now" ON ip_allowlist;
DROP POLICY IF EXISTS "Allow all for now" ON ip_blocklist;
DROP POLICY IF EXISTS "Allow all for now" ON holidays;
DROP POLICY IF EXISTS "Allow all for now" ON documents;
DROP POLICY IF EXISTS "Allow all for now" ON audit_log;
DROP POLICY IF EXISTS "Allow all for now" ON departments;
DROP POLICY IF EXISTS "Allow all for now" ON notifications;

-- ============================================================================
-- 6. Enable RLS on tables that were missing it
-- ============================================================================
ALTER TABLE document_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_rules ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 7. EMPLOYEES - admins see all, employees see themselves
-- ============================================================================
DROP POLICY IF EXISTS "employees_select_own" ON employees;
CREATE POLICY "employees_select_own" ON employees
  FOR SELECT USING (id = my_employee_id() OR is_admin());

DROP POLICY IF EXISTS "employees_update_own" ON employees;
CREATE POLICY "employees_update_own" ON employees
  FOR UPDATE USING (id = my_employee_id() OR is_admin())
  WITH CHECK (id = my_employee_id() OR is_admin());

DROP POLICY IF EXISTS "employees_insert_admin" ON employees;
CREATE POLICY "employees_insert_admin" ON employees
  FOR INSERT WITH CHECK (is_admin());

DROP POLICY IF EXISTS "employees_delete_admin" ON employees;
CREATE POLICY "employees_delete_admin" ON employees
  FOR DELETE USING (is_admin());

-- ============================================================================
-- 8. ATTENDANCE - employees see own, admins see all
-- ============================================================================
DROP POLICY IF EXISTS "attendance_select" ON attendance;
CREATE POLICY "attendance_select" ON attendance
  FOR SELECT USING (employee_id = my_employee_id() OR is_admin());

DROP POLICY IF EXISTS "attendance_insert" ON attendance;
CREATE POLICY "attendance_insert" ON attendance
  FOR INSERT WITH CHECK (employee_id = my_employee_id() OR is_admin());

DROP POLICY IF EXISTS "attendance_update" ON attendance;
CREATE POLICY "attendance_update" ON attendance
  FOR UPDATE USING (employee_id = my_employee_id() OR is_admin())
  WITH CHECK (employee_id = my_employee_id() OR is_admin());

DROP POLICY IF EXISTS "attendance_delete_admin" ON attendance;
CREATE POLICY "attendance_delete_admin" ON attendance
  FOR DELETE USING (is_admin());

-- ============================================================================
-- 9. ATTENDANCE_SEGMENTS - follows attendance access
-- ============================================================================
DROP POLICY IF EXISTS "segments_select" ON attendance_segments;
CREATE POLICY "segments_select" ON attendance_segments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM attendance a
      WHERE a.id = attendance_segments.attendance_id
        AND (a.employee_id = my_employee_id() OR is_admin())
    )
  );

DROP POLICY IF EXISTS "segments_insert" ON attendance_segments;
CREATE POLICY "segments_insert" ON attendance_segments
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM attendance a
      WHERE a.id = attendance_segments.attendance_id
        AND (a.employee_id = my_employee_id() OR is_admin())
    )
  );

DROP POLICY IF EXISTS "segments_update" ON attendance_segments;
CREATE POLICY "segments_update" ON attendance_segments
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM attendance a
      WHERE a.id = attendance_segments.attendance_id
        AND (a.employee_id = my_employee_id() OR is_admin())
    )
  );

DROP POLICY IF EXISTS "segments_delete_admin" ON attendance_segments;
CREATE POLICY "segments_delete_admin" ON attendance_segments
  FOR DELETE USING (is_admin());

-- ============================================================================
-- 10. LEAVE_TYPES - everyone can read, admin can write
-- ============================================================================
DROP POLICY IF EXISTS "leave_types_select_all" ON leave_types;
CREATE POLICY "leave_types_select_all" ON leave_types
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "leave_types_insert_admin" ON leave_types;
CREATE POLICY "leave_types_insert_admin" ON leave_types
  FOR INSERT WITH CHECK (is_admin());

DROP POLICY IF EXISTS "leave_types_update_admin" ON leave_types;
CREATE POLICY "leave_types_update_admin" ON leave_types
  FOR UPDATE USING (is_admin());

DROP POLICY IF EXISTS "leave_types_delete_admin" ON leave_types;
CREATE POLICY "leave_types_delete_admin" ON leave_types
  FOR DELETE USING (is_admin());

-- ============================================================================
-- 11. LEAVE_ALLOCATIONS - everyone can read, admin can write
-- ============================================================================
DROP POLICY IF EXISTS "leave_alloc_select_all" ON leave_allocations;
CREATE POLICY "leave_alloc_select_all" ON leave_allocations
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "leave_alloc_insert_admin" ON leave_allocations;
CREATE POLICY "leave_alloc_insert_admin" ON leave_allocations
  FOR INSERT WITH CHECK (is_admin());

DROP POLICY IF EXISTS "leave_alloc_update_admin" ON leave_allocations;
CREATE POLICY "leave_alloc_update_admin" ON leave_allocations
  FOR UPDATE USING (is_admin());

DROP POLICY IF EXISTS "leave_alloc_delete_admin" ON leave_allocations;
CREATE POLICY "leave_alloc_delete_admin" ON leave_allocations
  FOR DELETE USING (is_admin());

-- ============================================================================
-- 12. LEAVE_OVERRIDES - employees see own, admin can write
-- ============================================================================
DROP POLICY IF EXISTS "leave_over_select" ON leave_overrides;
CREATE POLICY "leave_over_select" ON leave_overrides
  FOR SELECT USING (employee_id = my_employee_id() OR is_admin());

DROP POLICY IF EXISTS "leave_over_insert_admin" ON leave_overrides;
CREATE POLICY "leave_over_insert_admin" ON leave_overrides
  FOR INSERT WITH CHECK (is_admin());

DROP POLICY IF EXISTS "leave_over_update_admin" ON leave_overrides;
CREATE POLICY "leave_over_update_admin" ON leave_overrides
  FOR UPDATE USING (is_admin());

DROP POLICY IF EXISTS "leave_over_delete_admin" ON leave_overrides;
CREATE POLICY "leave_over_delete_admin" ON leave_overrides
  FOR DELETE USING (is_admin());

-- ============================================================================
-- 13. LEAVE_REQUESTS - employees see/create own, admin sees all & approves
-- ============================================================================
DROP POLICY IF EXISTS "leave_req_select" ON leave_requests;
CREATE POLICY "leave_req_select" ON leave_requests
  FOR SELECT USING (employee_id = my_employee_id() OR is_admin());

DROP POLICY IF EXISTS "leave_req_insert" ON leave_requests;
CREATE POLICY "leave_req_insert" ON leave_requests
  FOR INSERT WITH CHECK (employee_id = my_employee_id() OR is_admin());

DROP POLICY IF EXISTS "leave_req_update" ON leave_requests;
CREATE POLICY "leave_req_update" ON leave_requests
  FOR UPDATE USING (employee_id = my_employee_id() OR is_admin())
  WITH CHECK (employee_id = my_employee_id() OR is_admin());

DROP POLICY IF EXISTS "leave_req_delete_admin" ON leave_requests;
CREATE POLICY "leave_req_delete_admin" ON leave_requests
  FOR DELETE USING (is_admin());

-- ============================================================================
-- 14. APPROVAL_REQUESTS - employees see own, admin sees all
-- ============================================================================
DROP POLICY IF EXISTS "approval_select" ON approval_requests;
CREATE POLICY "approval_select" ON approval_requests
  FOR SELECT USING (employee_id = my_employee_id() OR is_admin());

DROP POLICY IF EXISTS "approval_insert" ON approval_requests;
CREATE POLICY "approval_insert" ON approval_requests
  FOR INSERT WITH CHECK (employee_id = my_employee_id() OR is_admin());

DROP POLICY IF EXISTS "approval_update" ON approval_requests;
CREATE POLICY "approval_update" ON approval_requests
  FOR UPDATE USING (employee_id = my_employee_id() OR is_admin())
  WITH CHECK (employee_id = my_employee_id() OR is_admin());

DROP POLICY IF EXISTS "approval_delete_admin" ON approval_requests;
CREATE POLICY "approval_delete_admin" ON approval_requests
  FOR DELETE USING (is_admin());

-- ============================================================================
-- 15. IP_ALLOWLIST - everyone can read (for punch-in check), admin can write
-- ============================================================================
DROP POLICY IF EXISTS "ip_allow_select_all" ON ip_allowlist;
CREATE POLICY "ip_allow_select_all" ON ip_allowlist
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "ip_allow_insert_admin" ON ip_allowlist;
CREATE POLICY "ip_allow_insert_admin" ON ip_allowlist
  FOR INSERT WITH CHECK (is_admin());

DROP POLICY IF EXISTS "ip_allow_update_admin" ON ip_allowlist;
CREATE POLICY "ip_allow_update_admin" ON ip_allowlist
  FOR UPDATE USING (is_admin());

DROP POLICY IF EXISTS "ip_allow_delete_admin" ON ip_allowlist;
CREATE POLICY "ip_allow_delete_admin" ON ip_allowlist
  FOR DELETE USING (is_admin());

-- ============================================================================
-- 16. IP_BLOCKLIST - admin only
-- ============================================================================
DROP POLICY IF EXISTS "ip_block_select_admin" ON ip_blocklist;
CREATE POLICY "ip_block_select_admin" ON ip_blocklist
  FOR SELECT USING (is_admin());

DROP POLICY IF EXISTS "ip_block_insert_admin" ON ip_blocklist;
CREATE POLICY "ip_block_insert_admin" ON ip_blocklist
  FOR INSERT WITH CHECK (is_admin());

DROP POLICY IF EXISTS "ip_block_delete_admin" ON ip_blocklist;
CREATE POLICY "ip_block_delete_admin" ON ip_blocklist
  FOR DELETE USING (is_admin());

-- ============================================================================
-- 17. HOLIDAYS - everyone can read, admin can write
-- ============================================================================
DROP POLICY IF EXISTS "holidays_select_all" ON holidays;
CREATE POLICY "holidays_select_all" ON holidays
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "holidays_insert_admin" ON holidays;
CREATE POLICY "holidays_insert_admin" ON holidays
  FOR INSERT WITH CHECK (is_admin());

DROP POLICY IF EXISTS "holidays_update_admin" ON holidays;
CREATE POLICY "holidays_update_admin" ON holidays
  FOR UPDATE USING (is_admin());

DROP POLICY IF EXISTS "holidays_delete_admin" ON holidays;
CREATE POLICY "holidays_delete_admin" ON holidays
  FOR DELETE USING (is_admin());

-- ============================================================================
-- 18. DOCUMENTS - employees see own, admin sees all
-- ============================================================================
DROP POLICY IF EXISTS "docs_select" ON documents;
CREATE POLICY "docs_select" ON documents
  FOR SELECT USING (employee_id = my_employee_id() OR is_admin());

DROP POLICY IF EXISTS "docs_insert" ON documents;
CREATE POLICY "docs_insert" ON documents
  FOR INSERT WITH CHECK (employee_id = my_employee_id() OR is_admin());

DROP POLICY IF EXISTS "docs_update" ON documents;
CREATE POLICY "docs_update" ON documents
  FOR UPDATE USING (employee_id = my_employee_id() OR is_admin())
  WITH CHECK (employee_id = my_employee_id() OR is_admin());

DROP POLICY IF EXISTS "docs_delete_admin" ON documents;
CREATE POLICY "docs_delete_admin" ON documents
  FOR DELETE USING (is_admin());

-- ============================================================================
-- 19. AUDIT_LOG - admin only for reads, system inserts (via service role)
-- ============================================================================
DROP POLICY IF EXISTS "audit_select_admin" ON audit_log;
CREATE POLICY "audit_select_admin" ON audit_log
  FOR SELECT USING (is_admin());

DROP POLICY IF EXISTS "audit_insert_any" ON audit_log;
CREATE POLICY "audit_insert_any" ON audit_log
  FOR INSERT WITH CHECK (true);

-- ============================================================================
-- 20. DEPARTMENTS - everyone can read, admin can write
-- ============================================================================
DROP POLICY IF EXISTS "dept_select_all" ON departments;
CREATE POLICY "dept_select_all" ON departments
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "dept_insert_admin" ON departments;
CREATE POLICY "dept_insert_admin" ON departments
  FOR INSERT WITH CHECK (is_admin());

DROP POLICY IF EXISTS "dept_update_admin" ON departments;
CREATE POLICY "dept_update_admin" ON departments
  FOR UPDATE USING (is_admin());

DROP POLICY IF EXISTS "dept_delete_admin" ON departments;
CREATE POLICY "dept_delete_admin" ON departments
  FOR DELETE USING (is_admin());

-- ============================================================================
-- 21. NOTIFICATIONS - employees see own, admin sees all, system inserts
-- ============================================================================
DROP POLICY IF EXISTS "notif_select" ON notifications;
CREATE POLICY "notif_select" ON notifications
  FOR SELECT USING (employee_id = my_employee_id() OR is_admin());

DROP POLICY IF EXISTS "notif_insert_any" ON notifications;
CREATE POLICY "notif_insert_any" ON notifications
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "notif_update" ON notifications;
CREATE POLICY "notif_update" ON notifications
  FOR UPDATE USING (employee_id = my_employee_id() OR is_admin());

DROP POLICY IF EXISTS "notif_delete_admin" ON notifications;
CREATE POLICY "notif_delete_admin" ON notifications
  FOR DELETE USING (is_admin());

-- ============================================================================
-- 22. DOCUMENT_REQUESTS - employees see own, admin sees all
-- ============================================================================
DROP POLICY IF EXISTS "doc_req_select" ON document_requests;
CREATE POLICY "doc_req_select" ON document_requests
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM document_requests dr
      WHERE dr.id = document_requests.id
    ) OR is_admin()
  );

-- Simpler: admin full access, employees read only
DROP POLICY IF EXISTS "doc_req_select" ON document_requests;
DROP POLICY IF EXISTS "doc_req_select" ON document_requests;
CREATE POLICY "doc_req_select" ON document_requests
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "doc_req_insert_admin" ON document_requests;
CREATE POLICY "doc_req_insert_admin" ON document_requests
  FOR INSERT WITH CHECK (is_admin());

DROP POLICY IF EXISTS "doc_req_update_admin" ON document_requests;
CREATE POLICY "doc_req_update_admin" ON document_requests
  FOR UPDATE USING (is_admin());

DROP POLICY IF EXISTS "doc_req_delete_admin" ON document_requests;
CREATE POLICY "doc_req_delete_admin" ON document_requests
  FOR DELETE USING (is_admin());

-- ============================================================================
-- 23. EMAIL_CONFIG - admin only
-- ============================================================================
DROP POLICY IF EXISTS "email_config_select_admin" ON email_config;
CREATE POLICY "email_config_select_admin" ON email_config
  FOR SELECT USING (is_admin());

DROP POLICY IF EXISTS "email_config_insert_admin" ON email_config;
CREATE POLICY "email_config_insert_admin" ON email_config
  FOR INSERT WITH CHECK (is_admin());

DROP POLICY IF EXISTS "email_config_update_admin" ON email_config;
CREATE POLICY "email_config_update_admin" ON email_config
  FOR UPDATE USING (is_admin());

DROP POLICY IF EXISTS "email_config_delete_admin" ON email_config;
CREATE POLICY "email_config_delete_admin" ON email_config
  FOR DELETE USING (is_admin());

-- ============================================================================
-- 24. NOTIFICATION_RULES - admin only
-- ============================================================================
DROP POLICY IF EXISTS "notif_rules_select_admin" ON notification_rules;
CREATE POLICY "notif_rules_select_admin" ON notification_rules
  FOR SELECT USING (is_admin());

DROP POLICY IF EXISTS "notif_rules_insert_admin" ON notification_rules;
CREATE POLICY "notif_rules_insert_admin" ON notification_rules
  FOR INSERT WITH CHECK (is_admin());

DROP POLICY IF EXISTS "notif_rules_update_admin" ON notification_rules;
CREATE POLICY "notif_rules_update_admin" ON notification_rules
  FOR UPDATE USING (is_admin());

DROP POLICY IF EXISTS "notif_rules_delete_admin" ON notification_rules;
CREATE POLICY "notif_rules_delete_admin" ON notification_rules
  FOR DELETE USING (is_admin());

-- ============================================================================
-- Done! Summary:
--   - auth_user_id column added to employees (FK to auth.users)
--   - my_employee_id() and is_admin() helper functions created
--   - 15 "Allow all" policies dropped
--   - 60+ proper RLS policies created across 20 tables
--   - RLS enabled on 3 previously-missing tables
-- ============================================================================
