# Backlog: designs agreed but not yet built

## Heartbeat-based auto punch-out (deferred by product owner, 2026-07-06)

**Problem:** auto punch-out has 3 leaky triggers (daily Vercel cron on Hobby
plan = max 1/day, lazy per-employee close on API calls, browser timer that
dies with the tab). Stale open sessions render as runaway "16h working" on
dashboards. AND the current design cannot distinguish "forgot to punch out"
from "genuinely working a 16h shift" - a real 16h worker gets force-credited
only 9h.

**Agreed design (see chat 2026-07-02/06):**

1. **Compute-on-read truth**: a shared `effectiveSession(record, shift)`
   helper computes the deterministic auto-close state
   (`punch_out = punch_in + shift` once `now > punch_in + shift + grace`)
   so every display is correct even before any job closes the row.
2. **Activity heartbeat** (no schema change): while the employee dashboard is
   open AND the user is actually active (mouse/keyboard/visibility events,
   NOT just an open tab), ping every ~5 min -> bump `attendance.updated_at`
   on the open session.
3. **Evidence-based close**: stale heartbeat (>60 min) -> auto-close with
   shift credit; fresh heartbeat -> session stays open (real 16h shifts keep
   counting and are credited fully on manual punch-out).
4. **Hard ceiling**: close regardless at ~18h and flag for admin review.
5. **Lazy org-wide sweep**: on admin page loads, run the org-wide closer
   (service role), throttled to ~1/10min via kv timestamp - replaces
   dependence on the once-daily Hobby cron. Optional: GitHub Actions
   scheduled workflow curling /api/cron/close-sessions every 15-30 min.
6. Then remove the browser 12h timer (least reliable trigger, races the
   server).

**OPEN PRODUCT DECISION (blocks implementation):** when the heartbeat died
mid-shift (e.g. laptop battery at 14h), credit worked time **up to the last
heartbeat** (fairer, can exceed shift length) or the flat **shift credit
(9h)**? Owner preference not yet given.

**Rules that must hold (BUSINESS_RULES.md):** manual punch-out = real worked
time; auto punch-out = assumption, only fired when evidence says abandoned;
grace = 5.5h; default shift 9h; break cap 2h.
