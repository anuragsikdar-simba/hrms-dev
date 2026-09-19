-- ============================================================================
-- August HRMS — Selfie Verification for Attendance
-- ============================================================================

ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS punch_in_selfie_url text,
  ADD COLUMN IF NOT EXISTS punch_out_selfie_url text;

COMMENT ON COLUMN public.attendance.punch_in_selfie_url IS 'Storage path of the selfie taken at punch-in';
COMMENT ON COLUMN public.attendance.punch_out_selfie_url IS 'Storage path of the selfie taken at punch-out';
