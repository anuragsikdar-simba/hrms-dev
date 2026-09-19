# Working on August HRMS

**Read `docs/BUSINESS_RULES.md` before making any change.** It is the single
source of truth for business rules, hard constraints, and known bug classes.
If code disagrees with that document, the code is wrong.

## Non-negotiables (summary — full detail in docs/BUSINESS_RULES.md)

1. **Never change the DB schema or RLS policies.** App-logic changes only.
   If RLS blocks a legitimate flow, use `supabaseAdmin` in the API route after
   an explicit ownership/permission check.
2. **No email service exists.** Never build anything that depends on email.
3. **Commit & push as `anuragsikdar-simba`** (see BUSINESS_RULES.md §1 for exact commands).
4. **Users are in IST, timestamps are UTC.** Key days by LOCAL date.

## Definition of done for ANY change

- [ ] `npx tsc --noEmit` passes.
- [ ] `npm run build` passes (use dummy `NEXT_PUBLIC_SUPABASE_URL`,
      `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).
- [ ] `npm run test:attendance-offline` passes; new attendance logic gets new cases there.
- [ ] Checked against the **known bug classes** in BUSINESS_RULES.md §6
      (fake success toasts, silent RLS blocks, draft/active mismatch, enum
      drift, UTC/local keying, unbounded derived values).
- [ ] Every UI action that claims success actually awaited a successful API call.
- [ ] Every new DB write path was checked against the RLS policies in
      `supabase/schema.sql` for the role that will execute it.
- [ ] New/changed business rules recorded in `docs/BUSINESS_RULES.md` in the same commit.

## Testing

- No Docker → no local Supabase. Offline pure-logic tests: `npm run test:attendance-offline`.
- Timezone-sensitive logic: validate under `TZ=Asia/Kolkata`.
