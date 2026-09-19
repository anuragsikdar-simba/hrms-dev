# Business Rules & Design Decisions

This is the **single source of truth** for confirmed business rules and
architectural constraints. If code disagrees with this document, the code is
wrong. When a new rule is confirmed with the product owner, add it here in the
same PR/commit as the code change.

Last updated: 2026-07-02

---

## 1. Hard constraints (never violate)

| Rule | Detail |
|---|---|
| **Schema changes are gated, not banned** | Superseded 2026-09-19 (payroll). The original rule froze the schema because the old deployment was locked. The DB is now rebuilt from `supabase/schema.sql` on a Supabase project we control. New tables/columns/policies are allowed **only** when recorded in this document in the same commit, added to `supabase/schema.sql`, and shipped with RLS policies mirroring `is_admin()` / `my_employee_id()`. Ad-hoc column drift is still forbidden. If RLS blocks a legitimate app flow, route the write through `supabaseAdmin` **after verifying ownership/permission in the API route**. |
| **No email service** | The deployment has no mail provider. Never build a flow that depends on sending email (password reset, invites, notifications). Password reset = admin sets/generates a temp password (`/api/employees/[id]/reset-password`), user is forced to change it on next login via `must_reset_password`. |
| **GitHub account** | All commits/pushes go through the `anuragsikdar-simba` account. `gh auth switch --user anuragsikdar-simba`. Commit author email is `331225217+anuragsikdar-simba@users.noreply.github.com`. Repo-local git config is set correctly (`user.name=anuragsikdar-simba`, `user.email=331225217+anuragsikdar-simba@users.noreply.github.com`). |
| **Timezone** | Users are in IST. Timestamps are stored in UTC. **Always key "which day is this?" by LOCAL date**, never by UTC slice (`toISOString().slice(0,10)` is a bug for date keying). |

## 2. Attendance rules (confirmed with product owner)

- Default shift length: **9 hours**. Shift times come from the employee record when set.
- **Manual punch-out** records the employee's **real worked time** (no rounding to shift).
- **Auto punch-out** (system-forced) records exactly **shift length (9h)** of work.
- Grace threshold: **5.5 hours** (below this = half day / grace logic).
- **Breaks** are derived, not stored: `break = (punch-out − punch-in) − worked segments`. Displayed break is **capped at 2h** (`MAX_BREAK_HOURS` in `src/lib/attendance.ts`). A break reaching the cap triggers auto punch-out.
- Attendance status values in the DB include values the UI enum didn't know about (e.g. `auto_punched_out`). Any status coming from the DB **must be mapped through `mapDbStatus()`** and every status lookup needs a fallback (`?? STATUS_PILL.absent`).

## 3. Onboarding & documents

- `onboarding_config` is versioned. **Saving from the form builder publishes immediately**: new row `is_active=true`, all older rows deactivated, version computed server-side. GET returns only the active config.
- Old config versions are retained so past submissions render against the form they were filled with (`config_version` on submission).
- When an onboarding form is re-issued, File Upload fields that already have a document on file are **pre-satisfied** — employees must not be forced to re-upload PAN/Aadhaar/etc. Existing docs are carried forward on submit.
- Document requests: employee uploads with a `request_id` → the API auto-marks the request `fulfilled` (service-role write; `document_requests` UPDATE RLS is admin-only). HR must never re-request a doc that is already on file.

## 4. Approvals / regularisation / shift change

- Employees submit regularisation via the attendance page → `POST /api/approval-requests` with `type='regularisation'`, `reg_date` (LOCAL date), `original_punch`, `requested_change`, `reason`.
- Employees request a **shift change** from Profile → Employment Details (pencil on the Shift row) → `type='shift_change'` with `requested_change` JSON `{current_shift_start, current_shift_end, new_shift_start, new_shift_end}`. **Approval applies the new shift to `employees.shift_start/shift_end`** (single + bulk paths); if applying fails the request is rolled back to pending. Only one pending shift request per employee (UI-enforced).
- The approvals page groups the queue with per-type tabs (All / Leave / Reg. / Shift / WFH / Other); empty tabs are hidden.
- `approval_requests.type` has NO DB check constraint; valid types are enforced in the API: regularisation, wfh, ip_violation, profile_change, shift_change.
- RLS: employees can insert/select **their own** approval requests; admins see all.
- NOTE: approving a `profile_change` does NOT yet auto-apply the field to the employee record (admin applies manually); shift_change DOES auto-apply.

## 4b. Geofencing (punch locations)

- Admins define circular zones (lat/lng + radius 20m-50km) in Settings → Punch Locations. Stored as JSON under key `geo_zones` in the `email_config` kv table (no schema change).
- Enforcement is **allow-and-flag** (like the IP allowlist): a punch outside every zone, or with no coordinates (permission denied / no GPS), is recorded normally but creates a `location_violation` approval request (deduped: one pending per employee per IST day) and the zone/flag detail is written to `attendance.notes`.
- GPS accuracy tolerance: reported accuracy is honoured up to 200m when checking the fence (so indoor GPS drift doesn't false-flag), capped so a huge claimed accuracy cannot bypass the fence.
- TRUST NOTE: coordinates are client-reported (browser geolocation) and spoofable; geofencing is a deterrent/audit layer, not proof of presence. It composes with the IP allowlist.
- A punch must NEVER be blocked client-side on location problems; `getPunchCoords()` resolves null on denial/timeout and the punch proceeds.
- Pure geo math/validation lives in `src/lib/geo.ts` (offline-tested); server loading/eval in `src/lib/geo-check-server.ts`.

## 5. Testing / validation requirements

- No Docker on the dev machine → no local Supabase. Use the **offline harness**: `npm run test:attendance-offline` (pure-logic tests in `scripts/attendance-offline-test.mjs`). Add cases there when touching attendance logic.
- Before every commit: `npx tsc --noEmit` and `npm run build` with dummy env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).
- Timezone-sensitive logic must be validated under `TZ=Asia/Kolkata`.

## 6. Known bug classes (check for these in every review)

These are real bug patterns already found and fixed in this codebase. New code
must be checked against each one:

1. **Fake success**: UI handler shows a success toast but never calls the API (regularisation submit did this). *Every success toast must be after an awaited API call.*
2. **Silent RLS block**: API route writes with the user-scoped client but the RLS policy doesn't allow that role → write silently fails or errors for non-admins (document request fulfilment). *Check the policy in `supabase/schema.sql` for every new write path.*
3. **Draft/active mismatch**: a save writes state that the corresponding GET filters out (onboarding config saved `is_active=false`, GET only returned active). *Save and load must agree on visibility.*
4. **Enum drift**: DB contains status values the UI type doesn't know → `undefined` lookups crash (`STATUS_PILL[unknownStatus]`). *Map DB values explicitly + always fall back.*
5. **UTC/local date keying**: grouping by `toISOString()` date shifts records to the wrong day for IST users. *Key by local date.*
6. **Unbounded derived values**: computed values (like break time) growing without a cap/guard (runaway break). *Cap or validate derived quantities.*

## 7. How to keep this alive

- Confirmed a new rule with the product owner? **Add it here in the same commit.**
- Found a new class of bug? Add it to §6.
- An agent/developer starting work should read this file first (`CLAUDE.md` points here).

## 8. Payroll & payslips (confirmed with product owner, 2026-09-19)

### 8.1 Money model

- **Salary structures are effective-dated and immutable.** A revision INSERTs a new
  `salary_structures` row with a new `effective_from`; existing rows are never edited.
  A payslip resolves the structure that was live on the **last day of its period**, so
  reprinting an old payslip can never pick up a later hike.
- **Payslips are snapshots, not views.** `payslips` stores the full computed earnings and
  deductions as JSONB plus the resolved totals. A payslip must render identically years
  later even if the employee, their structure, or the component catalog has changed.
- **A locked payslip is never edited.** Corrections are issued as an arrear/adjustment line
  in a later run. Run state machine: `draft -> locked -> published`; transitions are
  one-way and audited.
- Employees can read their own payslips **only when the run is `published`**. Draft numbers
  are admin-only — staff must never see mid-calculation figures.

### 8.2 Paid days & LOP

- Divisor is the **calendar month** (Feb = 28/29, Jan = 31), not a fixed 30.
- `paid_days = days_in_month - lop_days`, and `lop_days` is **capped at `days_in_month`**
  (see §6.6 — derived values must be bounded). `paid_days` can never go negative.
- LOP sources, keyed by **IST local date** (§1 Timezone):
  1. Approved leave whose `leave_types.is_paid = false` -> 1.0 LOP/day.
  2. Attendance `absent` with no approved leave -> 1.0 LOP/day.
  3. Half-day / grace day (worked < `SHIFT_GRACE_HOURS`) -> 0.5 LOP.
- `leave_types.is_paid` is a new column, default `true`. Existing types stay paid until an
  admin marks them unpaid.
- Holidays and non-working days are never LOP, even with no attendance row.

### 8.3 Statutory deductions

- **PF**: 12% of basic, with an optional ₹15,000 wage ceiling (toggle).
- **ESI**: employee 0.75%, applied only while gross <= ₹21,000.
- **PT**: admin-maintained slab table in Settings. **No state is hardcoded** — slabs are data.
- **TDS**: manual per-employee, per-run override. There is deliberately **no tax engine** in
  v1 (no regime selection, declarations, proofs, projections, or Form 16). Do not add one
  without an explicit product decision.
- Every statutory rule is configuration, never a magic number in a component file.

### 8.4 Delivery & access

- **No email (§1).** Payslips are in-app download only, plus a `notifications` row on publish.
  Never build a "mail payslips" flow until a provider exists.
- Payslip PDFs are generated server-side once at publish and stored in the **private**
  `documents` bucket, served via short-lived signed URLs (`src/lib/documents.ts`).
  Generation must be deterministic — same payslip, same bytes.
- v1 has **no `finance` role**: any `admin` can see all salary data. Adding one means changing
  `is_admin()` and every payroll policy.
- Salary structure changes, run locks, publishes, and payslip downloads are all written to
  `audit_log`.

### 8.5 Rounding

- Each component rounds to the nearest rupee at computation; the net is the sum of already
  rounded parts. Never round only the net — the payslip lines must add up to the total shown.
