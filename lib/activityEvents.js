// lib/activityEvents.js
import { supabase } from "./supabaseClient";

function uuidv4() {
  if (typeof crypto !== "undefined" && crypto?.randomUUID) return crypto.randomUUID();
  const s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
  return `${s4()}${s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`;
}

function isNoConstraintMatch(err) {
  const msg = String(err?.message || "").toLowerCase();
  return msg.includes("there is no unique or exclusion constraint matching the on conflict specification");
}

/**
 * @param {{
 *  userId: string,
 *  teamId?: string|null,
 *  planId?: string|null,
 *  eventType: string,
 *  points: number,
 *  eventDate: string, // YYYY-MM-DD
 *  meta?: any
 * }} args
 */
export async function logActivityEvent(args) {
  const a = args || {};
  const userId = a.userId;
  const teamId = a.teamId ?? null;
  const planId = a.planId ?? a.meta?.plan_id ?? null;
  const eventType = a.eventType;
  const eventDate = a.eventDate;
  const meta = a.meta ?? {};
  const points = Number(a.points ?? 0);

  if (!userId) throw new Error("logActivityEvent: userId is required");
  if (!eventType) throw new Error("logActivityEvent: eventType is required");
  if (!eventDate) throw new Error("logActivityEvent: eventDate is required");

  const payload = {
    id: uuidv4(),
    user_id: userId,
    team_id: teamId,
    plan_id: planId,
    event_type: eventType,
    points,
    event_date: eventDate,
    meta,
  };

  // If no planId, we just append events (no unique plan/day constraint)
  if (!planId) {
    const { error } = await supabase.from("activity_events").insert(payload);
    if (error) throw error;
  } else {
    // If planId exists, we must UPSERT on the project’s actual unique key
    // Try likely conflict targets (covers your uq_plan_event_day variations)
    const conflictTargets = [
      "plan_id,event_date",
      "user_id,plan_id,event_date",
      // just in case your unique includes event_type too (less likely):
      "plan_id,event_date,event_type",
      "user_id,plan_id,event_date,event_type",
    ];

    let lastErr = null;

    for (const onConflict of conflictTargets) {
      const { error } = await supabase
        .from("activity_events")
        .upsert(payload, { onConflict });

      if (!error) {
        lastErr = null;
        break;
      }

      // If we picked the wrong constraint columns, try next.
      if (isNoConstraintMatch(error)) {
        lastErr = error;
        continue;
      }

      // Any other error: stop and throw
      throw error;
    }

    if (lastErr) {
      // We tried all targets and none matched; fall back to a safer approach:
      // Fetch existing row and update it.
      const { data: existing, error: selErr } = await supabase
        .from("activity_events")
        .select("id")
        .eq("plan_id", planId)
        .eq("event_date", eventDate)
        .maybeSingle();

      if (selErr) throw selErr;

      if (existing?.id) {
        const { error: updErr } = await supabase
          .from("activity_events")
          .update({
            event_type: eventType,
            points,
            meta,
            team_id: teamId,
            user_id: userId,
          })
          .eq("id", existing.id);

        if (updErr) throw updErr;
      } else {
        const { error: insErr } = await supabase.from("activity_events").insert(payload);
        if (insErr) throw insErr;
      }
    }
  }

  // Best-effort mirror (don’t throw)
  const { error: pErr } = await supabase.from("points_events").insert({
    id: payload.id,
    team_id: teamId,
    user_id: userId,
    date: eventDate,
    type: eventType,
    points,
    meta,
  });

  if (pErr && process?.env?.NODE_ENV !== "production") {
    console.warn("points_events mirror failed:", pErr.message);
  }
}
