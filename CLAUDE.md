# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

**Pact** is a personal fitness tracking app with team competition features. Users log daily workouts, water intake, sleep, supplements, and weight. Points are awarded for healthy habits and shown on a weekly team leaderboard. URL: `https://pact.madebykings.com`

## Stack

- **Framework:** Next.js 16 (React 19), PWA via `next-pwa`
- **Backend/DB:** Supabase (PostgreSQL + Auth)
- **Auth:** Magic link / email OTP
- **Push notifications:** OneSignal Web SDK v16
- **Package manager:** pnpm (Node 20.x required)
- **Language:** JavaScript throughout, with TypeScript only in `lib/plans/generateWeeklyPlan.ts`

## Commands

```bash
pnpm dev      # Dev server (webpack bundler)
pnpm build    # Production build
pnpm start    # Start production server
```

No test framework is configured.

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_ONESIGNAL_APP_ID
NEXT_PUBLIC_SITE_URL          # https://pact.madebykings.com
NEXT_PUBLIC_BASE_URL          # used in invite links
SUPABASE_SERVICE_ROLE_KEY     # server-side only, in supabaseAdmin.js
CRON_SECRET                   # checked by /api/cron/generate-week
```

## Key Pages and Flows

| Page | Route | Purpose |
|------|-------|---------|
| Login | `/` | Email magic link via Supabase OTP |
| Dashboard | `/dashboard` | Daily tracking: workout, water, sleep, supplements, weigh-in |
| Leaderboard | `/leaderboard` | Weekly points ranking for team |
| Profile | `/profile` | Stats, display name, weight trend |
| Team | `/team` | Create/join/manage team, send invites |
| Settings | `/settings` | Water/sleep targets, tone, activities, reminders, push notifications |
| Week Plan | `/week-plan` | View/edit 7-day workout plan (team leader only in team mode) |
| Invite | `/invite/[token]` | Accept a team invite by token |

### API Routes

| Route | Purpose |
|-------|---------|
| `/api/team/invite` | Create invite (no auth check — trusts client) |
| `/api/team/accept` | Accept invite by token (userId from body — not authenticated) |
| `/api/team/ensure` | Get or create user's team (uses JWT from Authorization header) |
| `/api/team/commit` | Log team daily check-in (+5 on-time, +2 late) |
| `/api/cron/generate-week` | Auto-generate next week's plans (requires `CRON_SECRET`) |

## Supabase Files and Patterns

- `lib/supabaseClient.js` — Client-side singleton (anon key, `NEXT_PUBLIC_*` vars)
- `lib/supabaseAdmin.js` — Server-side singleton (service role key, session disabled)
- `lib/supabase/admin.ts` and `lib/supabase/server.ts` — Typed server clients (newer, TypeScript)

Pages access Supabase directly from client-side React code using `supabaseClient`. API routes use `supabaseAdmin`. RLS is in effect for client-side queries.

### Supabase Tables

| Table | Key Fields |
|-------|-----------|
| `user_profiles` | display_name |
| `user_settings` | mode (solo/team), timezone, water_target_ml, sleep_target_hours, target_weight_kg, included_activities, team_id, reminder_times |
| `plans` | user_id, plan_date, plan_type, status (PLANNED/DONE/CANCELLED), planned_time |
| `activity_events` | user_id, plan_id, event_type, points, event_date — **primary points source** |
| `points_events` | Mirror/fallback table for points — best-effort write, silently ignored on failure |
| `water_logs` | ml or ml_total (schema ambiguous — see risks) |
| `sleep_logs` | bed_time, wake_time |
| `weigh_ins` | weight_kg, weigh_date |
| `supplements` | name, rule_type, active, offset_minutes, window start/end |
| `supplement_logs` | supplement_id, log_date |
| `teams` | name, owner_id |
| `team_members` | user_id, team_id, role (owner/member) |
| `team_invites` | token, status (pending/accepted), expires_at, email |
| `team_weekly_plans` | week_start, plan (JSON), commit_cutoff_time |
| `team_daily_commits` | user_id, team_id, date, commit_status (on_time/late), points |
| `push_devices` | user_id, onesignal_player_id |

## Business Rules

### Points System

All events logged via `lib/activityEvents.js:logActivityEvent()`. Uses deterministic UUIDs (FNV-1a hash) for upserts — key is `plan:{userId}:{planId}:{eventType}:{eventDate}` or `day:{userId}:{eventType}:{eventDate}`.

| Event | Points |
|-------|--------|
| workout_done | +10 |
| undo_workout_done | −10 |
| workout_cancel | −5 |
| undo_workout_cancel | +5 |
| set_tomorrow_time (set) | +3 |
| set_tomorrow_time (cleared) | −3 |
| water_hit_target | +2 |
| sleep_hit_target | +2 |
| team commit on-time | +5 |
| team commit late | +2 |

Points are written to `activity_events` (primary) and `points_events` (best-effort mirror). The leaderboard and profile read from `activity_events` first; if empty, fall back to `points_events`.

### Leaderboard

- Week = Monday 00:00 to Sunday 23:59
- Ranked by total points descending; ties broken by display_name then user_id
- Only teammates (via `team_members`) appear together on the leaderboard
- **Note:** The info panel shows "+3" for water and sleep targets, but the code actually awards +2. These are out of sync.

### Plans

- Fixed weekly rotation (from `lib/weekTemplate.js`): Mon=SPIN, Tue=HIIT, Wed=REST, Thu=SPIN, Fri=HIIT, Sat=WEIGHTS, Sun=REST
- Plan types: REST, SPIN, HIIT, WEIGHTS, RUN, WALK, HILLWALK, SWIM, YOGA, PILATES, MOBILITY, OTHER
- In team mode, only the team owner can edit `week-plan`
- Setting plan_type to REST clears planned_time

### Water Tracking

- Target default: 3000ml
- Water target hit triggers +2 points (once per day via upsert)
- Column name ambiguity: code tries `ml_total` first, falls back to `ml` on constraint error (schema evolution issue)

### Supplements

Default 10 supplements created on first dashboard load:
- Creatine, L-Carnitine — PRE_WORKOUT
- Cod Liver Oil, Tongkat Ali, Shilajit, B12 Coffee — MORNING_WINDOW (06:00–10:00)
- Collagen — MIDDAY_WINDOW (10:00–16:00)
- Ashwagandha, Magnesium, ZMA — EVENING_WINDOW (18:00–23:59)

Valid `rule_type` values (DB constraint): PRE_WORKOUT, POST_WORKOUT, MORNING_WINDOW, MIDDAY_WINDOW, EVENING_WINDOW, BED_WINDOW, ANYTIME — but ANYTIME violates a DB check constraint; use MIDDAY_WINDOW instead.

### Reminders / Push Notifications

- `lib/onesignal.js` handles OneSignal Web SDK v16
- iOS requires standalone PWA (installed) for push; standard Safari browser is blocked
- Device registered in `push_devices` table; old device deleted before inserting new one
- Reminder times stored in `user_settings.reminder_times` as `["HH:MM", ...]` (max 5)

## Risky Areas

### Security Issues

1. **`/api/team/accept`** — `userId` is taken from request body without verifying the caller's identity. An attacker could accept an invite on behalf of any user.
2. **`/api/team/invite`** — No check that `createdBy` is a member or owner of the target team.
3. **`/api/team/ensure`** — Uses `supabaseClient` (anon key) in an API route. Requires the client to pass a Bearer JWT in the Authorization header; won't work with cookie-based sessions.

### Data Integrity

4. **`pages/profile.js` backfill** — `ensureWorkoutDoneEvents()` uses random UUIDs instead of deterministic ones. Concurrent calls can create duplicate +10 events for the same plan. Should use the same deterministic ID pattern as `lib/activityEvents.js`.
5. **Water column ambiguity** — `water_logs` has either `ml` or `ml_total` depending on when the row was created. The fallback logic is silent and may hide real errors.
6. **`points_events` silent failure** — Errors writing to the mirror table are swallowed. If it falls out of sync, the fallback leaderboard/profile data will be wrong.

### Logic Bugs

7. **Sleep calculation** — If `wake_time < bed_time` (crossed midnight), 24 hours are added. This is correct for overnight sleep but breaks if data is entered out of order.
8. **Cron job** — `pages/api/cron/generate-week.js` imports from `lib/planGenerator` (functions: `generateWeek`, `addDaysISO`, `mondayOfNextWeekISO`). This file does not appear to exist — the cron job likely fails silently.
9. **Timezone** — `user_settings.timezone` is stored (default `Europe/London`) but rarely applied. The cron job and commit cutoff calculation use UTC without timezone adjustment.
10. **Leaderboard info panel** — Shows "+3" for water/sleep bonuses but actual award is +2.
