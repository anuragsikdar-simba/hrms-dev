-- ============================================================================
-- DemandNexus HRMS - Database Schema for Supabase
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;
--
-- Name: is_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.employees
    WHERE auth_user_id = auth.uid()
      AND role = 'admin'
  );
END;
$$;


--
-- Name: my_employee_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.my_employee_id() RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.employees WHERE auth_user_id = auth.uid() LIMIT 1;
  RETURN v_id;
END;
$$;


--
-- Name: next_employee_id(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.next_employee_id(p_prefix text DEFAULT 'AU'::text, p_year integer DEFAULT NULL::integer) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
DECLARE
  v_year int := COALESCE(p_year, EXTRACT(YEAR FROM (now() AT TIME ZONE 'Asia/Kolkata'))::int);
  v_pat  text := '^' || p_prefix || '-' || v_year || '-([0-9]+)$';
  v_max  int;
  v_next int;
BEGIN
  -- Serialise allocations for this prefix+year across concurrent transactions.
  PERFORM pg_advisory_xact_lock(hashtext(p_prefix || '-' || v_year));

  SELECT COALESCE(MAX((regexp_match(employee_id, v_pat))[1]::int), 0)
    INTO v_max
    FROM public.employees
   WHERE employee_id ~ v_pat;

  v_next := v_max + 1;
  RETURN p_prefix || '-' || v_year || '-' || lpad(v_next::text, 4, '0');
END;
$_$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: approval_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approval_requests (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    employee_id uuid NOT NULL,
    type text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    reg_date date,
    original_punch text,
    requested_change text,
    wfh_from date,
    wfh_to date,
    detected_ip text,
    action_type text,
    reason text,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    rejection_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: attendance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    employee_id uuid NOT NULL,
    date date NOT NULL,
    punch_in timestamp with time zone,
    punch_out timestamp with time zone,
    status text DEFAULT 'present'::text NOT NULL,
    worked_hours numeric(5,2),
    ip_address text,
    ip_flagged boolean DEFAULT false,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: attendance_segments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance_segments (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    attendance_id uuid NOT NULL,
    segment_start timestamp with time zone NOT NULL,
    segment_end timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    performed_by uuid,
    action text NOT NULL,
    target_employee uuid,
    details text,
    ip_address text,
    before_data jsonb,
    after_data jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: departments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.departments (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    head_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: document_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    description text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    fulfilled_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT document_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'fulfilled'::text, 'rejected'::text])))
);


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    employee_id uuid NOT NULL,
    name text NOT NULL,
    category text NOT NULL,
    file_url text,
    file_size integer,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    verified boolean DEFAULT false,
    verified_by uuid,
    verified_at timestamp with time zone
);


--
-- Name: email_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_config (
    key text NOT NULL,
    value text DEFAULT ''::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: employees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employees (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    employee_id text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    phone text,
    role text DEFAULT 'employee'::text NOT NULL,
    designation text,
    date_of_joining date,
    date_of_birth date,
    gender text,
    address text,
    city text,
    state text,
    pin_code text,
    blood_group text,
    emergency_contact_name text,
    emergency_contact_phone text,
    emergency_contact_relation text,
    reporting_to uuid,
    status text DEFAULT 'active'::text NOT NULL,
    onboarding_status text DEFAULT 'pending'::text NOT NULL,
    avatar_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    personal_email text,
    pan text,
    aadhaar text,
    bank_details jsonb,
    permanent_address text,
    current_address text,
    dob date,
    custom_fields jsonb DEFAULT '{}'::jsonb,
    department_id uuid,
    must_reset_password boolean DEFAULT false NOT NULL,
    auth_user_id uuid,
    tracks_attendance boolean DEFAULT true NOT NULL,
    shift_start time without time zone,
    shift_end time without time zone
);


--
-- Name: COLUMN employees.shift_start; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.employees.shift_start IS 'Local shift start time (IST). NULL = no fixed shift.';


--
-- Name: COLUMN employees.shift_end; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.employees.shift_end IS 'Local shift end time (IST). If <= shift_start the shift is overnight (ends next day).';


--
-- Name: holidays; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.holidays (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    date date NOT NULL,
    type text DEFAULT 'mandatory'::text NOT NULL,
    financial_year text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ip_allowlist; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ip_allowlist (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    ip text NOT NULL,
    label text NOT NULL,
    added_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ip_blocklist; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ip_blocklist (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    ip text NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: leave_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leave_allocations (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    leave_type_id uuid NOT NULL,
    annual_days integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: leave_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leave_overrides (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    employee_id uuid NOT NULL,
    leave_type_id uuid NOT NULL,
    custom_days integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: leave_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leave_requests (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    employee_id uuid NOT NULL,
    leave_type_id uuid NOT NULL,
    from_date date NOT NULL,
    to_date date NOT NULL,
    days numeric(4,1) NOT NULL,
    half_day boolean DEFAULT false,
    reason text,
    status text DEFAULT 'pending'::text NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    rejection_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: leave_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leave_types (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notification_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    email_enabled boolean DEFAULT true NOT NULL,
    recipients text DEFAULT 'employee'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    employee_id uuid NOT NULL,
    title text NOT NULL,
    message text,
    type text DEFAULT 'info'::text NOT NULL,
    read boolean DEFAULT false,
    actionable boolean DEFAULT false,
    action_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: onboarding_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.onboarding_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    sections jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: onboarding_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.onboarding_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    config_version integer DEFAULT 1 NOT NULL,
    responses jsonb DEFAULT '{}'::jsonb NOT NULL,
    documents jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    admin_notes text,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    submitted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT onboarding_submissions_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'submitted'::text, 'approved'::text, 'rejected'::text, 'revision_requested'::text])))
);


--
-- Name: approval_requests approval_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_requests
    ADD CONSTRAINT approval_requests_pkey PRIMARY KEY (id);


--
-- Name: attendance attendance_employee_id_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_employee_id_date_key UNIQUE (employee_id, date);


--
-- Name: attendance attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_pkey PRIMARY KEY (id);


--
-- Name: attendance_segments attendance_segments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_segments
    ADD CONSTRAINT attendance_segments_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: departments departments_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_name_key UNIQUE (name);


--
-- Name: departments departments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_pkey PRIMARY KEY (id);


--
-- Name: document_requests document_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_requests
    ADD CONSTRAINT document_requests_pkey PRIMARY KEY (id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: email_config email_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_config
    ADD CONSTRAINT email_config_pkey PRIMARY KEY (key);


--
-- Name: employees employees_auth_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_auth_user_id_key UNIQUE (auth_user_id);


--
-- Name: employees employees_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_email_key UNIQUE (email);


--
-- Name: employees employees_employee_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_employee_id_key UNIQUE (employee_id);


--
-- Name: employees employees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (id);


--
-- Name: holidays holidays_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holidays
    ADD CONSTRAINT holidays_pkey PRIMARY KEY (id);


--
-- Name: ip_allowlist ip_allowlist_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ip_allowlist
    ADD CONSTRAINT ip_allowlist_pkey PRIMARY KEY (id);


--
-- Name: ip_blocklist ip_blocklist_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ip_blocklist
    ADD CONSTRAINT ip_blocklist_pkey PRIMARY KEY (id);


--
-- Name: leave_allocations leave_allocations_leave_type_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_allocations
    ADD CONSTRAINT leave_allocations_leave_type_id_key UNIQUE (leave_type_id);


--
-- Name: leave_allocations leave_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_allocations
    ADD CONSTRAINT leave_allocations_pkey PRIMARY KEY (id);


--
-- Name: leave_overrides leave_overrides_employee_id_leave_type_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_overrides
    ADD CONSTRAINT leave_overrides_employee_id_leave_type_id_key UNIQUE (employee_id, leave_type_id);


--
-- Name: leave_overrides leave_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_overrides
    ADD CONSTRAINT leave_overrides_pkey PRIMARY KEY (id);


--
-- Name: leave_requests leave_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_requests
    ADD CONSTRAINT leave_requests_pkey PRIMARY KEY (id);


--
-- Name: leave_types leave_types_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_types
    ADD CONSTRAINT leave_types_key_key UNIQUE (key);


--
-- Name: leave_types leave_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_types
    ADD CONSTRAINT leave_types_pkey PRIMARY KEY (id);


--
-- Name: notification_rules notification_rules_event_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_rules
    ADD CONSTRAINT notification_rules_event_key UNIQUE (event);


--
-- Name: notification_rules notification_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_rules
    ADD CONSTRAINT notification_rules_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: onboarding_config onboarding_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_config
    ADD CONSTRAINT onboarding_config_pkey PRIMARY KEY (id);


--
-- Name: onboarding_submissions onboarding_submissions_employee_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_submissions
    ADD CONSTRAINT onboarding_submissions_employee_id_key UNIQUE (employee_id);


--
-- Name: onboarding_submissions onboarding_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_submissions
    ADD CONSTRAINT onboarding_submissions_pkey PRIMARY KEY (id);


--
-- Name: idx_approval_requests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_approval_requests_status ON public.approval_requests USING btree (status);


--
-- Name: idx_attendance_employee_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_employee_date ON public.attendance USING btree (employee_id, date);


--
-- Name: idx_audit_log_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_created ON public.audit_log USING btree (created_at DESC);


--
-- Name: idx_employees_auth_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_auth_user_id ON public.employees USING btree (auth_user_id);


--
-- Name: idx_leave_requests_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leave_requests_employee ON public.leave_requests USING btree (employee_id);


--
-- Name: idx_leave_requests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leave_requests_status ON public.leave_requests USING btree (status);


--
-- Name: idx_notifications_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_employee ON public.notifications USING btree (employee_id, read);


--
-- Name: approval_requests approval_requests_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_requests
    ADD CONSTRAINT approval_requests_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: approval_requests approval_requests_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_requests
    ADD CONSTRAINT approval_requests_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.employees(id);


--
-- Name: attendance attendance_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: attendance_segments attendance_segments_attendance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_segments
    ADD CONSTRAINT attendance_segments_attendance_id_fkey FOREIGN KEY (attendance_id) REFERENCES public.attendance(id) ON DELETE CASCADE;


--
-- Name: audit_log audit_log_performed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES public.employees(id);


--
-- Name: audit_log audit_log_target_employee_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_target_employee_fkey FOREIGN KEY (target_employee) REFERENCES public.employees(id);


--
-- Name: departments departments_head_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_head_id_fkey FOREIGN KEY (head_id) REFERENCES public.employees(id);


--
-- Name: document_requests document_requests_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_requests
    ADD CONSTRAINT document_requests_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id);


--
-- Name: document_requests document_requests_fulfilled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_requests
    ADD CONSTRAINT document_requests_fulfilled_by_fkey FOREIGN KEY (fulfilled_by) REFERENCES public.employees(id);


--
-- Name: documents documents_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: documents documents_verified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.employees(id);


--
-- Name: employees employees_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: employees employees_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id);


--
-- Name: employees employees_reporting_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_reporting_to_fkey FOREIGN KEY (reporting_to) REFERENCES public.employees(id);


--
-- Name: ip_allowlist ip_allowlist_added_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ip_allowlist
    ADD CONSTRAINT ip_allowlist_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.employees(id);


--
-- Name: leave_allocations leave_allocations_leave_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_allocations
    ADD CONSTRAINT leave_allocations_leave_type_id_fkey FOREIGN KEY (leave_type_id) REFERENCES public.leave_types(id) ON DELETE CASCADE;


--
-- Name: leave_overrides leave_overrides_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_overrides
    ADD CONSTRAINT leave_overrides_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: leave_overrides leave_overrides_leave_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_overrides
    ADD CONSTRAINT leave_overrides_leave_type_id_fkey FOREIGN KEY (leave_type_id) REFERENCES public.leave_types(id) ON DELETE CASCADE;


--
-- Name: leave_requests leave_requests_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_requests
    ADD CONSTRAINT leave_requests_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.employees(id);


--
-- Name: leave_requests leave_requests_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_requests
    ADD CONSTRAINT leave_requests_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: leave_requests leave_requests_leave_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_requests
    ADD CONSTRAINT leave_requests_leave_type_id_fkey FOREIGN KEY (leave_type_id) REFERENCES public.leave_types(id);


--
-- Name: notifications notifications_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: onboarding_config onboarding_config_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_config
    ADD CONSTRAINT onboarding_config_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.employees(id);


--
-- Name: onboarding_submissions onboarding_submissions_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_submissions
    ADD CONSTRAINT onboarding_submissions_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: onboarding_submissions onboarding_submissions_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_submissions
    ADD CONSTRAINT onboarding_submissions_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.employees(id);


--
-- Name: onboarding_config Admins can manage config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage config" ON public.onboarding_config USING (true);


--
-- Name: onboarding_submissions Admins can read all submissions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read all submissions" ON public.onboarding_submissions FOR SELECT USING (true);


--
-- Name: onboarding_config Anyone can read active config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can read active config" ON public.onboarding_config FOR SELECT USING (true);


--
-- Name: onboarding_submissions Employees can manage own submission; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Employees can manage own submission" ON public.onboarding_submissions USING (true);


--
-- Name: approval_requests approval_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY approval_delete_admin ON public.approval_requests FOR DELETE USING (public.is_admin());


--
-- Name: approval_requests approval_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY approval_insert ON public.approval_requests FOR INSERT WITH CHECK (((employee_id = public.my_employee_id()) OR public.is_admin()));


--
-- Name: approval_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: approval_requests approval_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY approval_select ON public.approval_requests FOR SELECT USING (((employee_id = public.my_employee_id()) OR public.is_admin()));


--
-- Name: approval_requests approval_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY approval_update ON public.approval_requests FOR UPDATE USING (((employee_id = public.my_employee_id()) OR public.is_admin())) WITH CHECK (((employee_id = public.my_employee_id()) OR public.is_admin()));


--
-- Name: attendance; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;

--
-- Name: attendance attendance_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attendance_delete_admin ON public.attendance FOR DELETE USING (public.is_admin());


--
-- Name: attendance attendance_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attendance_insert ON public.attendance FOR INSERT WITH CHECK (((employee_id = public.my_employee_id()) OR public.is_admin()));


--
-- Name: attendance_segments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.attendance_segments ENABLE ROW LEVEL SECURITY;

--
-- Name: attendance attendance_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attendance_select ON public.attendance FOR SELECT USING (((employee_id = public.my_employee_id()) OR public.is_admin()));


--
-- Name: attendance attendance_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attendance_update ON public.attendance FOR UPDATE USING (((employee_id = public.my_employee_id()) OR public.is_admin())) WITH CHECK (((employee_id = public.my_employee_id()) OR public.is_admin()));


--
-- Name: audit_log audit_insert_any; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_insert_any ON public.audit_log FOR INSERT WITH CHECK (true);


--
-- Name: audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log audit_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_select_admin ON public.audit_log FOR SELECT USING (public.is_admin());


--
-- Name: departments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

--
-- Name: departments dept_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dept_delete_admin ON public.departments FOR DELETE USING (public.is_admin());


--
-- Name: departments dept_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dept_insert_admin ON public.departments FOR INSERT WITH CHECK (public.is_admin());


--
-- Name: departments dept_select_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dept_select_all ON public.departments FOR SELECT USING (true);


--
-- Name: departments dept_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dept_update_admin ON public.departments FOR UPDATE USING (public.is_admin());


--
-- Name: document_requests doc_req_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY doc_req_delete_admin ON public.document_requests FOR DELETE USING (public.is_admin());


--
-- Name: document_requests doc_req_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY doc_req_insert_admin ON public.document_requests FOR INSERT WITH CHECK (public.is_admin());


--
-- Name: document_requests doc_req_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY doc_req_select ON public.document_requests FOR SELECT USING (true);


--
-- Name: document_requests doc_req_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY doc_req_update_admin ON public.document_requests FOR UPDATE USING (public.is_admin());


--
-- Name: documents docs_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY docs_delete_admin ON public.documents FOR DELETE USING (public.is_admin());


--
-- Name: documents docs_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY docs_insert ON public.documents FOR INSERT WITH CHECK (((employee_id = public.my_employee_id()) OR public.is_admin()));


--
-- Name: documents docs_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY docs_select ON public.documents FOR SELECT USING (((employee_id = public.my_employee_id()) OR public.is_admin()));


--
-- Name: documents docs_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY docs_update ON public.documents FOR UPDATE USING (((employee_id = public.my_employee_id()) OR public.is_admin())) WITH CHECK (((employee_id = public.my_employee_id()) OR public.is_admin()));


--
-- Name: document_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

--
-- Name: email_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_config ENABLE ROW LEVEL SECURITY;

--
-- Name: email_config email_config_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_config_delete_admin ON public.email_config FOR DELETE USING (public.is_admin());


--
-- Name: email_config email_config_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_config_insert_admin ON public.email_config FOR INSERT WITH CHECK (public.is_admin());


--
-- Name: email_config email_config_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_config_select_admin ON public.email_config FOR SELECT USING (public.is_admin());


--
-- Name: email_config email_config_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_config_update_admin ON public.email_config FOR UPDATE USING (public.is_admin());


--
-- Name: employees; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

--
-- Name: employees employees_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employees_delete_admin ON public.employees FOR DELETE USING (public.is_admin());


--
-- Name: employees employees_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employees_insert_admin ON public.employees FOR INSERT WITH CHECK (public.is_admin());


--
-- Name: employees employees_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employees_select_own ON public.employees FOR SELECT USING (((id = public.my_employee_id()) OR public.is_admin()));


--
-- Name: employees employees_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employees_update_own ON public.employees FOR UPDATE USING (((id = public.my_employee_id()) OR public.is_admin())) WITH CHECK (((id = public.my_employee_id()) OR public.is_admin()));


--
-- Name: holidays; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;

--
-- Name: holidays holidays_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY holidays_delete_admin ON public.holidays FOR DELETE USING (public.is_admin());


--
-- Name: holidays holidays_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY holidays_insert_admin ON public.holidays FOR INSERT WITH CHECK (public.is_admin());


--
-- Name: holidays holidays_select_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY holidays_select_all ON public.holidays FOR SELECT USING (true);


--
-- Name: holidays holidays_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY holidays_update_admin ON public.holidays FOR UPDATE USING (public.is_admin());


--
-- Name: ip_allowlist ip_allow_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ip_allow_delete_admin ON public.ip_allowlist FOR DELETE USING (public.is_admin());


--
-- Name: ip_allowlist ip_allow_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ip_allow_insert_admin ON public.ip_allowlist FOR INSERT WITH CHECK (public.is_admin());


--
-- Name: ip_allowlist ip_allow_select_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ip_allow_select_all ON public.ip_allowlist FOR SELECT USING (true);


--
-- Name: ip_allowlist ip_allow_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ip_allow_update_admin ON public.ip_allowlist FOR UPDATE USING (public.is_admin());


--
-- Name: ip_allowlist; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ip_allowlist ENABLE ROW LEVEL SECURITY;

--
-- Name: ip_blocklist ip_block_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ip_block_delete_admin ON public.ip_blocklist FOR DELETE USING (public.is_admin());


--
-- Name: ip_blocklist ip_block_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ip_block_insert_admin ON public.ip_blocklist FOR INSERT WITH CHECK (public.is_admin());


--
-- Name: ip_blocklist ip_block_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ip_block_select_admin ON public.ip_blocklist FOR SELECT USING (public.is_admin());


--
-- Name: ip_blocklist; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ip_blocklist ENABLE ROW LEVEL SECURITY;

--
-- Name: leave_allocations leave_alloc_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leave_alloc_delete_admin ON public.leave_allocations FOR DELETE USING (public.is_admin());


--
-- Name: leave_allocations leave_alloc_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leave_alloc_insert_admin ON public.leave_allocations FOR INSERT WITH CHECK (public.is_admin());


--
-- Name: leave_allocations leave_alloc_select_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leave_alloc_select_all ON public.leave_allocations FOR SELECT USING (true);


--
-- Name: leave_allocations leave_alloc_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leave_alloc_update_admin ON public.leave_allocations FOR UPDATE USING (public.is_admin());


--
-- Name: leave_allocations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.leave_allocations ENABLE ROW LEVEL SECURITY;

--
-- Name: leave_overrides leave_over_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leave_over_delete_admin ON public.leave_overrides FOR DELETE USING (public.is_admin());


--
-- Name: leave_overrides leave_over_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leave_over_insert_admin ON public.leave_overrides FOR INSERT WITH CHECK (public.is_admin());


--
-- Name: leave_overrides leave_over_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leave_over_select ON public.leave_overrides FOR SELECT USING (((employee_id = public.my_employee_id()) OR public.is_admin()));


--
-- Name: leave_overrides leave_over_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leave_over_update_admin ON public.leave_overrides FOR UPDATE USING (public.is_admin());


--
-- Name: leave_overrides; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.leave_overrides ENABLE ROW LEVEL SECURITY;

--
-- Name: leave_requests leave_req_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leave_req_delete_admin ON public.leave_requests FOR DELETE USING (public.is_admin());


--
-- Name: leave_requests leave_req_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leave_req_insert ON public.leave_requests FOR INSERT WITH CHECK (((employee_id = public.my_employee_id()) OR public.is_admin()));


--
-- Name: leave_requests leave_req_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leave_req_select ON public.leave_requests FOR SELECT USING (((employee_id = public.my_employee_id()) OR public.is_admin()));


--
-- Name: leave_requests leave_req_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leave_req_update ON public.leave_requests FOR UPDATE USING (((employee_id = public.my_employee_id()) OR public.is_admin())) WITH CHECK (((employee_id = public.my_employee_id()) OR public.is_admin()));


--
-- Name: leave_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: leave_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.leave_types ENABLE ROW LEVEL SECURITY;

--
-- Name: leave_types leave_types_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leave_types_delete_admin ON public.leave_types FOR DELETE USING (public.is_admin());


--
-- Name: leave_types leave_types_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leave_types_insert_admin ON public.leave_types FOR INSERT WITH CHECK (public.is_admin());


--
-- Name: leave_types leave_types_select_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leave_types_select_all ON public.leave_types FOR SELECT USING (true);


--
-- Name: leave_types leave_types_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leave_types_update_admin ON public.leave_types FOR UPDATE USING (public.is_admin());


--
-- Name: notifications notif_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notif_delete_admin ON public.notifications FOR DELETE USING (public.is_admin());


--
-- Name: notifications notif_insert_any; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notif_insert_any ON public.notifications FOR INSERT WITH CHECK (true);


--
-- Name: notification_rules notif_rules_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notif_rules_delete_admin ON public.notification_rules FOR DELETE USING (public.is_admin());


--
-- Name: notification_rules notif_rules_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notif_rules_insert_admin ON public.notification_rules FOR INSERT WITH CHECK (public.is_admin());


--
-- Name: notification_rules notif_rules_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notif_rules_select_admin ON public.notification_rules FOR SELECT USING (public.is_admin());


--
-- Name: notification_rules notif_rules_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notif_rules_update_admin ON public.notification_rules FOR UPDATE USING (public.is_admin());


--
-- Name: notifications notif_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notif_select ON public.notifications FOR SELECT USING (((employee_id = public.my_employee_id()) OR public.is_admin()));


--
-- Name: notifications notif_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notif_update ON public.notifications FOR UPDATE USING (((employee_id = public.my_employee_id()) OR public.is_admin()));


--
-- Name: notification_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: onboarding_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.onboarding_config ENABLE ROW LEVEL SECURITY;

--
-- Name: onboarding_submissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.onboarding_submissions ENABLE ROW LEVEL SECURITY;

--
-- Name: attendance_segments segments_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY segments_delete_admin ON public.attendance_segments FOR DELETE USING (public.is_admin());


--
-- Name: attendance_segments segments_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY segments_insert ON public.attendance_segments FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.attendance a
  WHERE ((a.id = attendance_segments.attendance_id) AND ((a.employee_id = public.my_employee_id()) OR public.is_admin())))));


--
-- Name: attendance_segments segments_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY segments_select ON public.attendance_segments FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.attendance a
  WHERE ((a.id = attendance_segments.attendance_id) AND ((a.employee_id = public.my_employee_id()) OR public.is_admin())))));


--
-- Name: attendance_segments segments_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY segments_update ON public.attendance_segments FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.attendance a
  WHERE ((a.id = attendance_segments.attendance_id) AND ((a.employee_id = public.my_employee_id()) OR public.is_admin())))));



