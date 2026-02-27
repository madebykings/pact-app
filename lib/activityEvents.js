// lib/activityEvents.js
import { supabase } from "./supabaseClient";

function uuidv4() {
  if (typeof crypto !== "undefined" && crypto?.randomUUID) return crypto.randomUUID();
  const s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
  return `${s4()}${s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`;
}

/**
 * Plan-bound events must not create duplicates for the same plan/day.
 * We avoid .single() entirely (no "JSON object requested..." errors).
 */
export async function logActivityEvent(args) {
  const a = args || {};
  const userId = a.userId;
  const teamId = a.teamId ?? null;
  const planId = a.planId ?? a.meta?.plan_id ?? null;
  const eventType = a.eventType;
  const eventDate = a.eventDate; // YYYY-MM-DD
  const meta = a.meta ?? {};
  const points = Number(a.points ?? 0);

  if (!userId) throw new Error("logActivityEvent: userId is required");
  if (!eventType) throw new Error("logActivityEvent: eventType is required");
  if (!eventDate) throw new Error("logActivityEvent: eventDate is required");

  // If NO planId: append event row
  if (!planId) {
    const payload = {
      id: uuidv4(),
      user_id: userId,
      team_id: teamId,
      plan_id: null,
      event_type: eventType,
      points,
      event_date: eventDate,
      meta,
    };

    const { error } = await supabase.from("activity_events").insert(payload);
    if (error) throw error;

    // mirror best-effort
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

    return;
  }

  // Plan-bound: update-first to avoid unique constraint + avoid .single()
  const updatePatch = {
    user_id: userId,
    team_id: teamId,
    event_type: eventType,
    points,
    meta,
    plan_id: planId,
    event_date: eventDate,
  };

  const { data: updatedRows, error: updErr } = await supabase
    .from("activity_events")
    .update(updatePatch)
    .eq("plan_id", planId)
    .eq("event_date", eventDate)
    .select("id");

  if (updErr) throw updErr;

  // If we updated at least one row, we’re done (don’t insert again)
  if (Array.isArray(updatedRows) && updatedRows.length > 0) {
    return;
  }

  // Otherwise insert a new row
  const payload = { id: uuidv4(), ...updatePatch };
  const { error: insErr } = await supabase.from("activity_events").insert(payload);
  if (insErr) throw insErr;

  // mirror best-effort
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
