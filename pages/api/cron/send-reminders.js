// pages/api/cron/send-reminders.js
// Sends WhatsApp reminders to opted-in users whose reminder_times match the current
// local hour in their stored timezone.
//
// Trigger: GET /api/cron/send-reminders?secret=CRON_SECRET
// Recommended schedule: every hour (e.g. "0 * * * *")
//
// Dedup: uses notifications_sent table with notif_key = "wa:{userId}:{YYYY-MM-DD}:{HH:MM}"
// so each (user, time-slot) is sent at most once per day, even if the cron runs multiple times.

import { supabaseAdmin } from "../../../lib/supabaseAdmin";
import { isTwilioEnabled, sendWhatsApp, localHour, localHHMM } from "../../../lib/twilio";

export default async function handler(req, res) {
  // --- Auth ---
  if (req.query.secret !== process.env.CRON_SECRET) {
    return res.status(403).json({ error: "forbidden" });
  }

  if (!isTwilioEnabled()) {
    return res.json({ ok: true, skipped: true, reason: "WHATSAPP_ENABLED is not true or Twilio not configured" });
  }

  const now = new Date();

  // --- Load all opted-in WhatsApp subscriptions ---
  const { data: subs, error: subErr } = await supabaseAdmin
    .from("whatsapp_subscriptions")
    .select("user_id, phone_e164")
    .eq("opted_in", true);

  if (subErr) {
    console.error("send-reminders: failed to load whatsapp_subscriptions", subErr);
    return res.status(500).json({ error: subErr.message });
  }

  if (!subs?.length) {
    return res.json({ ok: true, sent: 0, reason: "no opted-in subscribers" });
  }

  const userIds = subs.map((s) => s.user_id);

  // --- Load user settings (reminder_times, timezone, display context) ---
  const { data: settings, error: stErr } = await supabaseAdmin
    .from("user_settings")
    .select("user_id, reminder_times, timezone")
    .in("user_id", userIds);

  if (stErr) {
    console.error("send-reminders: failed to load user_settings", stErr);
    return res.status(500).json({ error: stErr.message });
  }

  // --- Load display names ---
  const { data: profiles } = await supabaseAdmin
    .from("user_profiles")
    .select("user_id, display_name")
    .in("user_id", userIds);

  const profileMap = Object.fromEntries((profiles || []).map((p) => [p.user_id, p]));
  const settingsMap = Object.fromEntries((settings || []).map((s) => [s.user_id, s]));
  const subMap = Object.fromEntries(subs.map((s) => [s.user_id, s]));

  // --- Load today's plans so we can personalise the message ---
  // We need per-user "today" which depends on timezone, so we fetch a date window.
  // Simple approach: fetch plans for today UTC date — close enough for most timezones.
  const todayUTC = now.toISOString().slice(0, 10); // YYYY-MM-DD

  const { data: plans } = await supabaseAdmin
    .from("plans")
    .select("user_id, plan_type, plan_date, status, planned_time")
    .in("user_id", userIds)
    .eq("plan_date", todayUTC);

  const planMap = Object.fromEntries((plans || []).map((p) => [p.user_id, p]));

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://pact.madebykings.com";

  let sent = 0;
  let skipped = 0;
  const errors = [];

  for (const userId of userIds) {
    try {
      const sub = subMap[userId];
      const st = settingsMap[userId];
      const profile = profileMap[userId];

      if (!st?.reminder_times?.length) continue;

      const timezone = st.timezone || "Europe/London";
      const reminderTimes = st.reminder_times; // ["HH:MM", ...]

      // Find which reminder slots fall within the current local hour for this user
      const currentLocalHour = localHour(timezone, now);
      const matchingSlots = reminderTimes.filter((t) => {
        const h = Number(String(t).split(":")[0]);
        return h === currentLocalHour;
      });

      if (!matchingSlots.length) continue;

      // For each matching slot, check dedup and send
      for (const slot of matchingSlots) {
        // notif_key: "wa:{userId}:{YYYY-MM-DD}:{HH:MM}" — unique per user per time-slot per day
        // Use the user's local date so midnight-crossing doesn't double-send
        const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, dateStyle: "short" }).format(now); // YYYY-MM-DD
        const notifKey = `wa:${userId}:${localDate}:${slot}`;

        // Check if already sent
        const { data: existing } = await supabaseAdmin
          .from("notifications_sent")
          .select("id")
          .eq("user_id", userId)
          .eq("notif_key", notifKey)
          .maybeSingle();

        if (existing) {
          skipped++;
          continue;
        }

        // Build the message
        const name = (profile?.display_name || "").trim() || "there";
        const plan = planMap[userId];
        const message = buildReminderMessage({ name, plan, slot, siteUrl });

        // Send via Twilio
        const result = await sendWhatsApp(sub.phone_e164, message);

        if (result.ok) {
          // Record as sent to prevent duplicates.
          // If this insert fails (e.g. transient DB error), log but don't re-throw —
          // the message was delivered; a duplicate send next run is preferable to a crash.
          const { error: dedupErr } = await supabaseAdmin.from("notifications_sent").insert({
            user_id: userId,
            notif_key: notifKey,
          });
          if (dedupErr) {
            console.warn("send-reminders: failed to write notifications_sent for", notifKey, dedupErr.message);
          }
          sent++;
        } else {
          errors.push({ userId, slot, error: result.error });
        }
      }
    } catch (e) {
      console.error("send-reminders: error processing user", userId, e);
      errors.push({ userId, error: e?.message || String(e) });
    }
  }

  return res.json({ ok: true, sent, skipped, errors: errors.length ? errors : undefined });
}

/**
 * Build a personalised WhatsApp reminder message.
 * Keep messages short — WhatsApp works best under ~160 chars.
 *
 * NOTE: In production with WhatsApp templates, the body text here must match
 * your approved template content exactly (or use template SIDs via Content API).
 */
function buildReminderMessage({ name, plan, slot, siteUrl }) {
  const greeting = `Hey ${name}!`;

  if (!plan || plan.status === "DONE") {
    return `${greeting} Pact reminder (${slot}). Log in to track today: ${siteUrl}/dashboard`;
  }

  if (plan.plan_type === "REST") {
    return `${greeting} Today is a rest day — enjoy the recovery 🛌\nLog water & sleep: ${siteUrl}/dashboard`;
  }

  if (plan.status === "CANCELLED") {
    return `${greeting} Your ${plan.plan_type} was cancelled. No worries — don't skip the next one 💪`;
  }

  const timeNote = plan.planned_time ? ` at ${plan.planned_time}` : "";
  return `${greeting} You have ${plan.plan_type}${timeNote} today. Tap DONE when you're finished 🏃\n${siteUrl}/dashboard`;
}
