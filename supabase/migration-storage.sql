-- ============================================================================
-- August HRMS — Storage: private `documents` bucket + RLS policies
--
-- Why this file exists: `schema.sql` is a pg_dump of the PUBLIC schema only, so
-- it never carried the storage bucket or its policies. A freshly created
-- Supabase project therefore has no `documents` bucket, which breaks BOTH the
-- employee-documents feature and payslip PDFs:
--   - `src/app/api/documents/[id]/view/route.ts` signs URLs with the per-user
--     client and relies on storage RLS ("Uses the per-user Supabase client so
--     storage RLS is enforced").
--   - `src/lib/documents.ts#getDocumentUrl` silently falls back to a PUBLIC url
--     when signing fails, which then 404s on a private bucket.
--
-- Safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The bucket. Private: every read goes through a short-lived signed URL.
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- ---------------------------------------------------------------------------
-- 2. Policies on storage.objects, scoped to this bucket only.
--
-- Two path layouts are in use and both must resolve to an owning employee:
--   employee documents : <employee_id>/<timestamp>_<name>.<ext>
--   payslip PDFs       : payslips/<employee_id>/<YYYY>-<MM>.pdf
--
-- storage.foldername(name) returns the folder segments as text[] (1-indexed).
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS documents_read_own_or_admin ON storage.objects;
CREATE POLICY documents_read_own_or_admin ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'documents'
    AND (
      public.is_admin()
      OR (storage.foldername(name))[1] = public.my_employee_id()::text
      OR (
        (storage.foldername(name))[1] = 'payslips'
        AND (storage.foldername(name))[2] = public.my_employee_id()::text
      )
    )
  );

-- Employees may upload only into their own document folder. Payslip PDFs are
-- written by the server with the service-role key (which bypasses RLS), so no
-- user-facing insert path for `payslips/` is granted here.
DROP POLICY IF EXISTS documents_insert_own_or_admin ON storage.objects;
CREATE POLICY documents_insert_own_or_admin ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'documents'
    AND (
      public.is_admin()
      OR (storage.foldername(name))[1] = public.my_employee_id()::text
    )
  );

-- Mutating an existing object is an admin action; the app deletes through
-- `supabaseAdmin` after its own permission check (BUSINESS_RULES §1).
DROP POLICY IF EXISTS documents_update_admin ON storage.objects;
CREATE POLICY documents_update_admin ON storage.objects
  FOR UPDATE USING (bucket_id = 'documents' AND public.is_admin());

DROP POLICY IF EXISTS documents_delete_admin ON storage.objects;
CREATE POLICY documents_delete_admin ON storage.objects
  FOR DELETE USING (bucket_id = 'documents' AND public.is_admin());
