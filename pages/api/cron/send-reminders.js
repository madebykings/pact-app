// pages/api/cron/send-reminders.js
// Event-based WhatsApp reminders. Run every 30 minutes: */30 * * * *
//
// Four trigger types (checked each run):
//
//  1. pre_workout   — 30 mins before the user's planned_time
//  2. supplement_due — 30 mins before supplement window opens (or take-time for PRE_WORKOUT supps)
//  3. teammate_done — a teammate finished their workout today, you haven't
//  4. eod_incomplete — at 21:00 local time if workout is still pending
//
// Dedup: notifications_sent table with notif_key prevents double-sending.
// Tone: user's tone setting (normal/brutal/savage) selects the message variant.
// Templates: loaded from notification_templates DB table; falls back to hardcoded defaults.

import { supabaseAdmin } from "../../../lib/supabaseAdmin";
import { isTwilioEnabled, sendWhatsApp } from "../../../lib/twilio";

// ── Default message templates ──────────────────────────────────────────────
// Variables: {name} {workout} {supplements} {teammate}
const DEFAULT_TEMPLATES = {
  pre_workout: {
    normal: "Hey {name}! Your {workout} starts in 30 mins. You committed to it — now let's get at it 💪",
    brutal: "{name}. {workout} in 30 mins. You committed to it. Get up.",
    savage: "{name}, {workout} is in 30. You said you would. Don't be the person who doesn't show up.",
  },
  teammate_done: {
    normal: "Hey {name} — {teammate} just finished their workout. You haven't done yours yet. Get moving!",
    brutal: "{name} — {teammate}'s complete. You're not. That's a problem. Fix it.",
    savage: "{name}, {teammate}'s complete and you're not. They're pulling ahead. Embarrassing.",
  },
  supplement_due: {
    normal: "Hey {name}! Time to take: {supplements} 💊 Don't skip them.",
    brutal: "{name}. Supplements now: {supplements}. Don't skip.",
    savage: "{name}, {supplements}. Right now. What are you waiting for?",
  },
  eod_incomplete: {
    normal: "Hey {name}, day's almost done and you haven't logged your workout — you're missing out on points!",
    brutal: "{name}. Day's ending. Workout not done. You're leaving points on the table.",
    savage: "{name}, you're missing out on points while your teammates rack them up. Your call.",
  },
};

function fillTemplate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? "");
}

function toMins(hhmm) {
  if (!hhmm) return null;
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + (m || 0);
}

function localMinutes(timezone, now) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    return h * 60 + m;
  } catch {
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }
}

// Is targetMins within [nowMins - slack, nowMins + windowSize + slack]?
function inWindow(nowMins, targetMins, windowSize = 30, slack = 8) {
  if (targetMins === null || targetMins === undefined) return false;
  return targetMins >= nowMins - slack && targetMins < nowMins + windowSize + slack;
}

export default async function handler(req, res) {
  if (req.query.secret !== process.env.CRON_SECRET) {
    return res.status(403).json({ error: "forbidden" });
  }

  if (!isTwilioEnabled()) {
    return res.json({ ok: true, skipped: true, reason: "WhatsApp not configured" });
  }

  const now = new Date();
  const todayUTC = now.toISOString().slice(0, 10);

  // ── Load opted-in subscribers ────────────────────────────────────────────
  const { data: subs, error: subErr } = await supabaseAdmin
    .from("whatsapp_subscriptions")
    .select("user_id, phone_e164")
    .eq("opted_in", true);

  if (subErr) return res.status(500).json({ error: subErr.message });
  if (!subs?.length) return res.json({ ok: true, sent: 0, reason: "no subscribers" });

  const subUserIds = subs.map((s) => s.user_id);

  // ── Load data for all subscribers (and their teams) ──────────────────────
  const [
    { data: settings },
    { data: profiles },
    { data: plans },
    { data: supps },
    { data: myTeamRows },
    { data: todayDoneEvents },
    { data: dbTemplates },
  ] = await Promise.all([
    supabaseAdmin
      .from("user_settings")
      .select("user_id, timezone, tone")
      .in("user_id", subUserIds),
    supabaseAdmin
      .from("user_profiles")
      .select("user_id, display_name")
      .in("user_id", subUserIds),
    supabaseAdmin
      .from("plans")
      .select("user_id, plan_type, planned_time, status")
      .in("user_id", subUserIds)
      .eq("plan_date", todayUTC),
    supabaseAdmin
      .from("supplements")
      .select("user_id, id, name, rule_type, window_start, offset_minutes")
      .in("user_id", subUserIds)
      .eq("active", true),
    supabaseAdmin
      .from("team_members")
      .select("user_id, team_id")
      .in("user_id", subUserIds),
    supabaseAdmin
      .from("activity_events")
      .select("user_id, event_type")
      .eq("event_date", todayUTC)
      .eq("event_type", "workout_done"),
    supabaseAdmin
      .from("notification_templates")
      .select("trigger_type, tone, template"),
  ]);

  // ── Merge DB templates over defaults ─────────────────────────────────────
  const templates = JSON.parse(JSON.stringify(DEFAULT_TEMPLATES));
  for (const t of dbTemplates || []) {
    if (templates[t.trigger_type]) templates[t.trigger_type][t.tone] = t.template;
  }

  // ── Build lookup maps ────────────────────────────────────────────────────
  const settingsMap = Object.fromEntries((settings || []).map((s) => [s.user_id, s]));
  const profileMap  = Object.fromEntries((profiles || []).map((p) => [p.user_id, p]));
  const planMap     = Object.fromEntries((plans || []).map((p) => [p.user_id, p]));
  const subMap      = Object.fromEntries(subs.map((s) => [s.user_id, s]));

  const suppsByUser = {};
  for (const s of supps || []) {
    if (!suppsByUser[s.user_id]) suppsByUser[s.user_id] = [];
    suppsByUser[s.user_id].push(s);
  }

  // Users with workout_done today (across ALL team members, not just subscribers)
  const doneUserIds = new Set((todayDoneEvents || []).map((e) => e.user_id));

  // Team maps
  const userToTeam = {};
  const teamToMembers = {};
  for (const tm of myTeamRows || []) {
    userToTeam[tm.user_id] = tm.team_id;
    if (!teamToMembers[tm.team_id]) teamToMembers[tm.team_id] = [];
    teamToMembers[tm.team_id].push(tm.user_id);
  }

  // Load workout_done status for ALL team members (not just subscribers) so
  // we can correctly detect when a subscriber's teammate has finished
  const allTeamIds = [...new Set(Object.values(userToTeam))];
  let allTeamMemberIds = [];
  if (allTeamIds.length) {
    const { data: allTmRows } = await supabaseAdmin
      .from("team_members")
      .select("user_id, team_id")
      .in("team_id", allTeamIds);
    for (const tm of allTmRows || []) {
      if (!teamToMembers[tm.team_id]) teamToMembers[tm.team_id] = [];
      if (!teamToMembers[tm.team_id].includes(tm.user_id)) {
        teamToMembers[tm.team_id].push(tm.user_id);
      }
      allTeamMemberIds.push(tm.user_id);
    }
  }

  // Load today's done events for all team members
  if (allTeamMemberIds.length) {
    const { data: teamDoneEvts } = await supabaseAdmin
      .from("activity_events")
      .select("user_id")
      .eq("event_date", todayUTC)
      .eq("event_type", "workout_done")
      .in("user_id", allTeamMemberIds);
    for (const e of teamDoneEvts || []) doneUserIds.add(e.user_id);
  }

  // Load display names for all team members (for teammate_done message)
  const allMemberIdsSet = new Set([...subUserIds, ...allTeamMemberIds]);
  const { data: allProfiles } = await supabaseAdmin
    .from("user_profiles")
    .select("user_id, display_name")
    .in("user_id", [...allMemberIdsSet]);
  const allProfileMap = Object.fromEntries((allProfiles || []).map((p) => [p.user_id, p]));

  // ── Send loop ─────────────────────────────────────────────────────────────
  let sent = 0;
  const errors = [];

  for (const userId of subUserIds) {
    try {
      const sub     = subMap[userId];
      const st      = settingsMap[userId];
      const plan    = planMap[userId];
      const userSupps = suppsByUser[userId] || [];
      const timezone  = st?.timezone || "Europe/London";
      const tone      = st?.tone || "normal";
      const name      = allProfileMap[userId]?.display_name?.trim() || "there";

      const localDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone, dateStyle: "short",
      }).format(now);
      const nowMins = localMinutes(timezone, now);

      // Helper: deduplicate and send
      async function maybeSend(triggerKey, triggerType, vars) {
        const notifKey = `${triggerKey}:${userId}:${localDate}`;
        const { data: existing } = await supabaseAdmin
          .from("notifications_sent")
          .select("id")
          .eq("notif_key", notifKey)
          .maybeSingle();
        if (existing) return false;

        const tpl = templates[triggerType]?.[tone] || templates[triggerType]?.normal || "";
        const message = fillTemplate(tpl, { name, ...vars });
        const result = await sendWhatsApp(sub.phone_e164, message);

        if (result.ok) {
          await supabaseAdmin
            .from("notifications_sent")
            .insert({ user_id: userId, notif_key: notifKey })
            .catch(() => {});
          sent++;
          return true;
        }
        errors.push({ userId, triggerKey, error: result.error });
        return false;
      }

      const hasActiveWorkout = plan && plan.plan_type !== "REST" && plan.status === "PLANNED";
      const alreadyDone = doneUserIds.has(userId);

      // ── 1. Pre-workout: 30 mins before planned_time ──────────────────────
      if (hasActiveWorkout && plan.planned_time) {
        const targetMins = toMins(plan.planned_time) - 30;
        if (inWindow(nowMins, targetMins)) {
          await maybeSend("pre_workout", "pre_workout", { workout: plan.plan_type });
        }
      }

      // ── 2. Supplement due ─────────────────────────────────────────────────
      if (userSupps.length > 0) {
        const dueNow = [];
        for (const s of userSupps) {
          if (s.rule_type === "PRE_WORKOUT" && plan?.planned_time) {
            // Take time = planned_time + offset_minutes (offset is negative e.g. -45)
            // Remind 30 mins before take time
            const takeMins = toMins(plan.planned_time) + (s.offset_minutes || 0);
            if (inWindow(nowMins, takeMins - 30)) dueNow.push(s.name);
          } else if (s.window_start) {
            // Remind 30 mins before window opens
            if (inWindow(nowMins, toMins(s.window_start) - 30)) dueNow.push(s.name);
          }
        }
        if (dueNow.length > 0) {
          const key = `supp_due:${dueNow.slice().sort().join(",")}`;
          await maybeSend(key, "supplement_due", { supplements: dueNow.join(", ") });
        }
      }

      // ── 3. Teammate done, you haven't ────────────────────────────────────
      if (!alreadyDone && hasActiveWorkout) {
        const teamId = userToTeam[userId];
        if (teamId) {
          const teammates = (teamToMembers[teamId] || []).filter((id) => id !== userId);
          const doneTeammates = teammates.filter((id) => doneUserIds.has(id));
          if (doneTeammates.length > 0) {
            const doneName =
              allProfileMap[doneTeammates[0]]?.display_name?.trim() || "A teammate";
            // One notification per day (dedup key doesn't include specific teammate)
            await maybeSend("teammate_done", "teammate_done", { teammate: doneName });
          }
        }
      }

      // ── 4. EOD incomplete: at 21:00 local time ───────────────────────────
      if (!alreadyDone && inWindow(nowMins, 21 * 60, 30, 8)) {
        if (plan && plan.plan_type !== "REST" && plan.status !== "CANCELLED") {
          await maybeSend("eod_incomplete", "eod_incomplete", {});
        }
      }
    } catch (e) {
      console.error("send-reminders: error for user", userId, e);
      errors.push({ userId, error: e?.message || String(e) });
    }
  }

  return res.json({ ok: true, sent, errors: errors.length ? errors : undefined });
}
