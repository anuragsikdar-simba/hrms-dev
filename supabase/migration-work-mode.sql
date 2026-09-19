-- ============================================================================
-- August HRMS — Work Mode Selection (Office, Home, Client, On-site)
-- ============================================================================

ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS work_mode text DEFAULT 'office';

COMMENT ON COLUMN public.attendance.work_mode IS 'Work mode: office, home, client, onsite';
