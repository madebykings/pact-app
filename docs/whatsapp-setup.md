# WhatsApp Reminders — Setup Guide

Pact sends WhatsApp reminders at the times users configure in Settings → Reminder times.
All Twilio calls are server-side. The feature is gated by environment variables and is completely
inert if those variables are absent.

---

## How it works end-to-end

```
User sets reminder_times in Settings (e.g. ["08:00", "18:00"])
User enters phone + opts in → POST /api/whatsapp/subscribe → whatsapp_subscriptions table

Hourly cron fires:
  GET /api/cron/send-reminders?secret=CRON_SECRET
    → reads whatsapp_subscriptions WHERE opted_in = true
    → reads user_settings (reminder_times, timezone)
    → for each user: does current local hour match a reminder slot?
    → checks notifications_sent to avoid duplicate sends
    → calls Twilio REST API → WhatsApp message delivered
    → writes to notifications_sent (notif_key: wa:{userId}:{date}:{slot})
```

---

## Environment variables

| Variable | Side | Required | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_WHATSAPP_ENABLED` | Client | Yes | Shows WhatsApp UI, hides push button |
| `WHATSAPP_ENABLED` | Server | Yes | Gates all Twilio calls in cron + API |
| `TWILIO_ACCOUNT_SID` | Server | Yes | From Twilio Console → Account Info |
| `TWILIO_AUTH_TOKEN` | Server | Yes | From Twilio Console → Account Info |
| `TWILIO_WHATSAPP_FROM` | Server | Yes | Sender number — see below |
| `CRON_SECRET` | Server | Yes | Shared secret for cron endpoint auth |
| `NEXT_PUBLIC_SITE_URL` | Both | No | Used in message links; defaults to pact.madebykings.com |

`TWILIO_WHATSAPP_FROM` values:
- **Sandbox:** `whatsapp:+14155238886`
- **Production:** `whatsapp:+your-approved-number`

Both `NEXT_PUBLIC_WHATSAPP_ENABLED` and `WHATSAPP_ENABLED` must be `"true"`. They are
separate so you can deploy the UI changes before activating server-side sending.

---

## Local sandbox testing — step by step

### Prerequisites

- Node 20, pnpm installed
- A Twilio account (free trial works)
- Your `.env.local` file

### Step 1 — Apply the database migration

The `whatsapp_subscriptions` table must exist before you set `NEXT_PUBLIC_WHATSAPP_ENABLED=true`.
If you set the flag without the table, the Settings page will show an empty WhatsApp section
(gracefully degraded — it won't crash).

To apply:
1. Open your Supabase project → **SQL Editor**
2. Paste the contents of `supabase/migrations/20260310000000_whatsapp_subscriptions.sql`
3. Click **Run**
4. Verify: the `whatsapp_subscriptions` table appears in **Table Editor**

### Step 2 — Set up Twilio WhatsApp Sandbox

1. Log in to [twilio.com/console](https://console.twilio.com)
2. Go to **Messaging → Try it out → Send a WhatsApp message**
3. Note the **sandbox number** (e.g. `+14155238886`) and your **join keyword** (e.g. `join example-word`)

### Step 3 — Join the sandbox from your phone

On the phone whose number you'll use for testing:

1. Open WhatsApp
2. Add the Twilio sandbox number as a contact if needed
3. Send the join keyword exactly as shown, e.g.:
   ```
   join example-word
   ```
4. You should receive a confirmation reply from Twilio within seconds
5. **You must repeat this step for each phone number used in testing**, and again after 72 hours of inactivity (sandbox sessions expire)

### Step 4 — Configure env vars

Add to `.env.local`:

```
NEXT_PUBLIC_WHATSAPP_ENABLED=true
WHATSAPP_ENABLED=true
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
CRON_SECRET=any-secret-string-you-choose
```

### Step 5 — Start the dev server

```bash
pnpm dev
```

### Step 6 — Register your phone in Settings

1. Open `http://localhost:3000` and sign in
2. Go to **Settings**
3. You should see a **WhatsApp reminders** section at the bottom
4. Enter your phone number in E.164 format (e.g. `+447700900123` for a UK number)
5. Tick **I consent to receive WhatsApp reminders from Pact**
6. Click **Save WhatsApp settings**
7. You should see "WhatsApp reminders enabled."

### Step 7 — Send a test message

After saving, click **Send test message**. Within a few seconds you should receive:

```
✅ Pact WhatsApp test message. Your reminders are set up correctly! Open the app: ...
```

If you see an error:
- `"No WhatsApp subscription found"` → you haven't saved your phone yet (step 6)
- `"Opt-in not confirmed"` → tick the consent checkbox and save again
- `"WhatsApp not enabled"` → check your env vars; both flags must be `"true"`
- A Twilio error (e.g. 63016) → you haven't joined the sandbox (step 3); the session may have expired

You can also call the endpoint directly with curl:
```bash
# Get your JWT from the browser: DevTools → Application → Local Storage → supabase auth token
curl -X POST http://localhost:3000/api/whatsapp/test-send \
  -H "Authorization: Bearer YOUR_JWT_HERE"
```

### Step 8 — Test the reminder cron

The cron matches by local hour, not exact minute. To test without adjusting your reminder times:

```bash
curl "http://localhost:3000/api/cron/send-reminders?secret=any-secret-string-you-choose"
```

Expected response when a slot matches and a message is sent:
```json
{ "ok": true, "sent": 1, "skipped": 0 }
```

Expected response when no slots match the current hour:
```json
{ "ok": true, "sent": 0, "skipped": 0 }
```

Expected response when already sent this slot today:
```json
{ "ok": true, "sent": 0, "skipped": 1 }
```

To force a send regardless of time, temporarily set a reminder_time that matches the current
hour in Settings, then call the cron endpoint.

---

## Production setup

### 1 — Get a production WhatsApp sender

Options:
- **Twilio phone number with WhatsApp** — purchase a number and enable WhatsApp capability in the Console
- **WhatsApp Business Account (WABA)** — apply via [Twilio's WABA process](https://www.twilio.com/docs/whatsapp/self-sign-up)

Update env var:
```
TWILIO_WHATSAPP_FROM=whatsapp:+your-production-number
```

### 2 — Message template approval (required for production outbound)

WhatsApp requires pre-approved **message templates** for proactive outbound messages
(any message not in reply to a user-initiated conversation within 24 hours).

The message bodies in `pages/api/cron/send-reminders.js` → `buildReminderMessage()` are
your template content. To get them approved:

1. Log in to Twilio Console → **Messaging → Content Template Builder**
2. Create a template for each message variant:
   - Workout reminder (with plan type and time)
   - Rest day reminder
   - Cancelled plan reminder
   - Generic fallback (no plan found)
3. Submit each for WhatsApp approval — typically 24–48 hours
4. Once approved, you can either:
   - Keep using freeform strings if your sender account is approved for freeform
   - Switch to Content API template SIDs — update `buildReminderMessage()` to call the
     Twilio Content API with the template SID and variables

The sandbox uses freeform with no approval needed.

### 3 — Schedule the cron

The reminder cron must run **every hour**. The generate-week cron should run **Monday morning**.

**Vercel Cron** (if hosted on Vercel) — add `vercel.json` to the project root:
```json
{
  "crons": [
    {
      "path": "/api/cron/send-reminders?secret=YOUR_CRON_SECRET",
      "schedule": "0 * * * *"
    },
    {
      "path": "/api/cron/generate-week?secret=YOUR_CRON_SECRET",
      "schedule": "0 6 * * 1"
    }
  ]
}
```

**External cron** (cron-job.org, GitHub Actions, etc.):
- URL: `https://pact.madebykings.com/api/cron/send-reminders?secret=YOUR_CRON_SECRET`
- Method: GET
- Schedule: every hour (`0 * * * *`)

---

## Removing OneSignal (after WhatsApp is confirmed in production)

OneSignal code is intact and not called when `NEXT_PUBLIC_WHATSAPP_ENABLED=true`.
When you're ready to clean it up:

1. Delete `lib/onesignal.js`
2. Delete `public/OneSignalSDKWorker.js` and `public/OneSignalSDKUpdaterWorker.js`
3. Remove the push section from `pages/settings.js` (the block guarded by `NEXT_PUBLIC_WHATSAPP_ENABLED !== "true"`)
4. Remove `NEXT_PUBLIC_ONESIGNAL_APP_ID` from env and `.env.example`
5. Drop the `push_devices` table via a Supabase migration (confirm nothing else reads it first)

---

## Database schema reference

```sql
-- Applied by: supabase/migrations/20260310000000_whatsapp_subscriptions.sql
whatsapp_subscriptions (
  user_id      uuid  PRIMARY KEY  → auth.users (cascade delete)
  phone_e164   text  NOT NULL     e.g. +447700900123
  opted_in     bool  NOT NULL     DEFAULT false
  opted_in_at  timestamptz
  created_at   timestamptz        DEFAULT now()
  updated_at   timestamptz        DEFAULT now()
)
RLS: users own their row; service_role reads all
```

Existing tables used (no schema changes needed):

| Table | Column(s) used |
|---|---|
| `user_settings` | `reminder_times` (text[]), `timezone` (text) |
| `user_profiles` | `display_name` (text) — for message personalisation |
| `plans` | `plan_type`, `status`, `planned_time` — for message content |
| `notifications_sent` | `user_id`, `notif_key` (unique) — dedup log |

Dedup key format: `wa:{userId}:{YYYY-MM-DD}:{HH:MM}` (local date in user's timezone)
