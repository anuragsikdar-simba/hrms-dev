-- Employee ID allocator: atomically returns the next canonical id of the form
-- DN-YYYY-NNNN (org prefix + joining year in Asia/Kolkata + per-year sequence).
--
-- The API auto-generates an id whenever the admin leaves the field blank, and
-- validates/normalises any custom override instead. Allocation is serialised
-- per prefix+year via a transaction-scoped advisory lock so concurrent creates
-- never collide on the same number; the API additionally retries on the unique
-- constraint as a belt-and-braces guard (the lock is released at the end of the
-- generator's transaction, before the row INSERT in the next transaction).
--
-- Applied to the cloud DB already; recorded here for reproducibility. Note that
-- schema.sql is dumped with --no-privileges, so the REVOKE/GRANT below are not
-- captured there and must be (re)applied from this file on a fresh database.

CREATE OR REPLACE FUNCTION public.next_employee_id(
  p_prefix text DEFAULT 'DN',
  p_year   int  DEFAULT NULL
) RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
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
$function$;

-- Only authenticated callers (the API runs as the signed-in admin) and the
-- service role may allocate ids; never PUBLIC.
REVOKE ALL ON FUNCTION public.next_employee_id(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_employee_id(text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_employee_id(text, int) TO service_role;
