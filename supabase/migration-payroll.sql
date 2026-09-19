-- ============================================================================
-- August HRMS — Payroll & Payslips
-- Recorded in docs/BUSINESS_RULES.md §8. Safe to re-run (idempotent).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Leave types gain a paid/unpaid flag (§8.2 LOP source 1)
--    Default true: every existing type stays paid until an admin says otherwise.
-- ---------------------------------------------------------------------------

ALTER TABLE public.leave_types
  ADD COLUMN IF NOT EXISTS is_paid boolean DEFAULT true NOT NULL;

COMMENT ON COLUMN public.leave_types.is_paid IS
  'false = days approved under this type count as Loss of Pay (BUSINESS_RULES 8.2).';

-- ---------------------------------------------------------------------------
-- 2. Payroll settings (kv). PF/ESI toggles and PT slabs live here as data —
--    no state or statutory rate is ever hardcoded in app code (§8.3).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.payroll_settings (
    key text PRIMARY KEY,
    value jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- ---------------------------------------------------------------------------
-- 3. Salary component catalog (org-level, like leave_types)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.salary_components (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    kind text DEFAULT 'earning'::text NOT NULL,
    calc text DEFAULT 'fixed'::text NOT NULL,
    taxable boolean DEFAULT true NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT salary_components_pkey PRIMARY KEY (id),
    CONSTRAINT salary_components_key_key UNIQUE (key),
    CONSTRAINT salary_components_kind_check
      CHECK ((kind = ANY (ARRAY['earning'::text, 'deduction'::text]))),
    CONSTRAINT salary_components_calc_check
      CHECK ((calc = ANY (ARRAY['fixed'::text, 'pct_of_basic'::text, 'pct_of_gross'::text, 'balance'::text])))
);

-- ---------------------------------------------------------------------------
-- 4. Salary structures — effective-dated, never edited in place (§8.1)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.salary_structures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    effective_from date NOT NULL,
    ctc_annual numeric(12,2),
    monthly_gross numeric(12,2) NOT NULL,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT salary_structures_pkey PRIMARY KEY (id),
    CONSTRAINT salary_structures_employee_effective_key UNIQUE (employee_id, effective_from),
    CONSTRAINT salary_structures_employee_id_fkey
      FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE,
    CONSTRAINT salary_structures_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES public.employees(id),
    CONSTRAINT salary_structures_monthly_gross_check CHECK ((monthly_gross >= (0)::numeric))
);

CREATE INDEX IF NOT EXISTS idx_salary_structures_employee
  ON public.salary_structures USING btree (employee_id, effective_from DESC);

CREATE TABLE IF NOT EXISTS public.salary_structure_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    structure_id uuid NOT NULL,
    component_key text NOT NULL,
    calc text DEFAULT 'fixed'::text NOT NULL,
    amount numeric(12,2),
    percent numeric(6,3),
    CONSTRAINT salary_structure_items_pkey PRIMARY KEY (id),
    CONSTRAINT salary_structure_items_structure_component_key UNIQUE (structure_id, component_key),
    CONSTRAINT salary_structure_items_structure_id_fkey
      FOREIGN KEY (structure_id) REFERENCES public.salary_structures(id) ON DELETE CASCADE,
    CONSTRAINT salary_structure_items_calc_check
      CHECK ((calc = ANY (ARRAY['fixed'::text, 'pct_of_basic'::text, 'pct_of_gross'::text, 'balance'::text])))
);

CREATE INDEX IF NOT EXISTS idx_salary_structure_items_structure
  ON public.salary_structure_items USING btree (structure_id);

-- ---------------------------------------------------------------------------
-- 5. Payroll runs — one per calendar month, one-way state machine (§8.1)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.payroll_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    period_year integer NOT NULL,
    period_month integer NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    total_gross numeric(14,2) DEFAULT 0 NOT NULL,
    total_deductions numeric(14,2) DEFAULT 0 NOT NULL,
    total_net numeric(14,2) DEFAULT 0 NOT NULL,
    employee_count integer DEFAULT 0 NOT NULL,
    note text,
    created_by uuid,
    locked_by uuid,
    locked_at timestamp with time zone,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payroll_runs_pkey PRIMARY KEY (id),
    CONSTRAINT payroll_runs_period_key UNIQUE (period_year, period_month),
    CONSTRAINT payroll_runs_status_check
      CHECK ((status = ANY (ARRAY['draft'::text, 'locked'::text, 'published'::text]))),
    CONSTRAINT payroll_runs_month_check
      CHECK (((period_month >= 1) AND (period_month <= 12))),
    CONSTRAINT payroll_runs_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES public.employees(id),
    CONSTRAINT payroll_runs_locked_by_fkey
      FOREIGN KEY (locked_by) REFERENCES public.employees(id)
);

-- ---------------------------------------------------------------------------
-- 6. Payslips — immutable snapshots (§8.1). earnings/deductions are stored as
--    JSONB line arrays so a payslip renders identically years later.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.payslips (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payroll_run_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    structure_id uuid,
    period_year integer NOT NULL,
    period_month integer NOT NULL,
    days_in_month integer NOT NULL,
    lop_days numeric(4,1) DEFAULT 0 NOT NULL,
    paid_days numeric(4,1) NOT NULL,
    earnings jsonb DEFAULT '[]'::jsonb NOT NULL,
    deductions jsonb DEFAULT '[]'::jsonb NOT NULL,
    gross numeric(12,2) DEFAULT 0 NOT NULL,
    total_deductions numeric(12,2) DEFAULT 0 NOT NULL,
    net_pay numeric(12,2) DEFAULT 0 NOT NULL,
    tds_override numeric(12,2),
    snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    pdf_path text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payslips_pkey PRIMARY KEY (id),
    CONSTRAINT payslips_run_employee_key UNIQUE (payroll_run_id, employee_id),
    CONSTRAINT payslips_payroll_run_id_fkey
      FOREIGN KEY (payroll_run_id) REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
    CONSTRAINT payslips_employee_id_fkey
      FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE,
    CONSTRAINT payslips_structure_id_fkey
      FOREIGN KEY (structure_id) REFERENCES public.salary_structures(id),
    -- §8.2: derived values are bounded. paid_days can never be negative and
    -- LOP can never exceed the month.
    CONSTRAINT payslips_lop_bounded
      CHECK (((lop_days >= (0)::numeric) AND (lop_days <= (days_in_month)::numeric))),
    CONSTRAINT payslips_paid_days_bounded
      CHECK (((paid_days >= (0)::numeric) AND (paid_days <= (days_in_month)::numeric)))
);

CREATE INDEX IF NOT EXISTS idx_payslips_employee_period
  ON public.payslips USING btree (employee_id, period_year DESC, period_month DESC);

CREATE INDEX IF NOT EXISTS idx_payslips_run
  ON public.payslips USING btree (payroll_run_id);

-- ---------------------------------------------------------------------------
-- 7. Row Level Security — mirrors the existing is_admin() / my_employee_id()
--    pattern used by every other table in this schema.
-- ---------------------------------------------------------------------------

ALTER TABLE public.payroll_settings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_components      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_structures      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_structure_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_runs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payslips               ENABLE ROW LEVEL SECURITY;

-- payroll_settings: admin-only in every direction.
DROP POLICY IF EXISTS payroll_settings_select_admin ON public.payroll_settings;
CREATE POLICY payroll_settings_select_admin ON public.payroll_settings
  FOR SELECT USING (public.is_admin());
DROP POLICY IF EXISTS payroll_settings_insert_admin ON public.payroll_settings;
CREATE POLICY payroll_settings_insert_admin ON public.payroll_settings
  FOR INSERT WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS payroll_settings_update_admin ON public.payroll_settings;
CREATE POLICY payroll_settings_update_admin ON public.payroll_settings
  FOR UPDATE USING (public.is_admin());
DROP POLICY IF EXISTS payroll_settings_delete_admin ON public.payroll_settings;
CREATE POLICY payroll_settings_delete_admin ON public.payroll_settings
  FOR DELETE USING (public.is_admin());

-- salary_components: everyone may read the catalog (payslips reference it);
-- only admins may change it.
DROP POLICY IF EXISTS salary_components_select_all ON public.salary_components;
CREATE POLICY salary_components_select_all ON public.salary_components
  FOR SELECT USING (true);
DROP POLICY IF EXISTS salary_components_insert_admin ON public.salary_components;
CREATE POLICY salary_components_insert_admin ON public.salary_components
  FOR INSERT WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS salary_components_update_admin ON public.salary_components;
CREATE POLICY salary_components_update_admin ON public.salary_components
  FOR UPDATE USING (public.is_admin());
DROP POLICY IF EXISTS salary_components_delete_admin ON public.salary_components;
CREATE POLICY salary_components_delete_admin ON public.salary_components
  FOR DELETE USING (public.is_admin());

-- salary_structures: an employee may read their own; only admins write.
DROP POLICY IF EXISTS salary_structures_select ON public.salary_structures;
CREATE POLICY salary_structures_select ON public.salary_structures
  FOR SELECT USING (((employee_id = public.my_employee_id()) OR public.is_admin()));
DROP POLICY IF EXISTS salary_structures_insert_admin ON public.salary_structures;
CREATE POLICY salary_structures_insert_admin ON public.salary_structures
  FOR INSERT WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS salary_structures_update_admin ON public.salary_structures;
CREATE POLICY salary_structures_update_admin ON public.salary_structures
  FOR UPDATE USING (public.is_admin());
DROP POLICY IF EXISTS salary_structures_delete_admin ON public.salary_structures;
CREATE POLICY salary_structures_delete_admin ON public.salary_structures
  FOR DELETE USING (public.is_admin());

-- salary_structure_items: visibility follows the parent structure.
DROP POLICY IF EXISTS salary_structure_items_select ON public.salary_structure_items;
CREATE POLICY salary_structure_items_select ON public.salary_structure_items
  FOR SELECT USING ((EXISTS ( SELECT 1
     FROM public.salary_structures s
    WHERE ((s.id = salary_structure_items.structure_id)
      AND ((s.employee_id = public.my_employee_id()) OR public.is_admin())))));
DROP POLICY IF EXISTS salary_structure_items_insert_admin ON public.salary_structure_items;
CREATE POLICY salary_structure_items_insert_admin ON public.salary_structure_items
  FOR INSERT WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS salary_structure_items_update_admin ON public.salary_structure_items;
CREATE POLICY salary_structure_items_update_admin ON public.salary_structure_items
  FOR UPDATE USING (public.is_admin());
DROP POLICY IF EXISTS salary_structure_items_delete_admin ON public.salary_structure_items;
CREATE POLICY salary_structure_items_delete_admin ON public.salary_structure_items
  FOR DELETE USING (public.is_admin());

-- payroll_runs: employees may see that a PUBLISHED run exists (their payslip
-- joins to it); drafts and locked runs are admin-only (§8.1).
DROP POLICY IF EXISTS payroll_runs_select ON public.payroll_runs;
CREATE POLICY payroll_runs_select ON public.payroll_runs
  FOR SELECT USING (((status = 'published'::text) OR public.is_admin()));
DROP POLICY IF EXISTS payroll_runs_insert_admin ON public.payroll_runs;
CREATE POLICY payroll_runs_insert_admin ON public.payroll_runs
  FOR INSERT WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS payroll_runs_update_admin ON public.payroll_runs;
CREATE POLICY payroll_runs_update_admin ON public.payroll_runs
  FOR UPDATE USING (public.is_admin());
DROP POLICY IF EXISTS payroll_runs_delete_admin ON public.payroll_runs;
CREATE POLICY payroll_runs_delete_admin ON public.payroll_runs
  FOR DELETE USING (public.is_admin());

-- payslips: own payslip, and ONLY once the run is published. Admins see all.
DROP POLICY IF EXISTS payslips_select ON public.payslips;
CREATE POLICY payslips_select ON public.payslips
  FOR SELECT USING ((public.is_admin() OR ((employee_id = public.my_employee_id()) AND (EXISTS ( SELECT 1
     FROM public.payroll_runs r
    WHERE ((r.id = payslips.payroll_run_id) AND (r.status = 'published'::text)))))));
DROP POLICY IF EXISTS payslips_insert_admin ON public.payslips;
CREATE POLICY payslips_insert_admin ON public.payslips
  FOR INSERT WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS payslips_update_admin ON public.payslips;
CREATE POLICY payslips_update_admin ON public.payslips
  FOR UPDATE USING (public.is_admin());
DROP POLICY IF EXISTS payslips_delete_admin ON public.payslips;
CREATE POLICY payslips_delete_admin ON public.payslips
  FOR DELETE USING (public.is_admin());

-- ---------------------------------------------------------------------------
-- 8. Seed: default component catalog and statutory settings.
--    Values are configuration (§8.3) — an admin can change all of them.
-- ---------------------------------------------------------------------------

INSERT INTO public.salary_components (key, name, kind, calc, taxable, display_order) VALUES
    ('basic',        'Basic',              'earning',   'pct_of_gross', true,  10),
    ('hra',          'House Rent Allowance','earning',  'pct_of_basic', true,  20),
    ('conveyance',   'Conveyance',         'earning',   'fixed',        true,  30),
    ('special',      'Special Allowance',  'earning',   'balance',      true,  90),
    ('pf',           'Provident Fund',     'deduction', 'fixed',        false, 10),
    ('esi',          'ESI',                'deduction', 'fixed',        false, 20),
    ('pt',           'Professional Tax',   'deduction', 'fixed',        false, 30),
    ('tds',          'TDS',                'deduction', 'fixed',        false, 40)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.payroll_settings (key, value) VALUES
    ('pf',  '{"enabled": true, "employee_percent": 12, "wage_ceiling": 15000, "apply_ceiling": true}'::jsonb),
    ('esi', '{"enabled": true, "employee_percent": 0.75, "gross_limit": 21000}'::jsonb),
    ('pt',  '{"enabled": true, "slabs": [{"upto": 7500, "amount": 0}, {"upto": 10000, "amount": 175}, {"upto": null, "amount": 200}]}'::jsonb)
ON CONFLICT (key) DO NOTHING;
