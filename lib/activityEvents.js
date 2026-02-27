// lib/activityEvents.js
// Lightweight event logger used by dashboard actions.
// Writes to `activity_events` (primary) and, if present, also mirrors to `points_events`.

import { supabase } from "./supabaseClient";

function uuidv4() {
  try {
    // modern browsers + node 20
    return crypto.randomUUID();
  } catch (_) {
    // fallback (non-crypto environments)
    const s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
    return `${s4()}${s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`;
  }
}

/**
 * @param {{
 *  userId: string,
 *  teamId?: string|null,
 *  planId?: string|null,
 *  eventType: string,
 *  points: number,
 *  eventDate: string, // ISO date (YYYY-MM-DD)
 *  meta?: any
 * }} args
 */
export async function logActivityEvent(args) {
  const {
    userId,
    teamId = null,
    planId = null,
    eventType,
    points,
    eventDate,
    meta = {},
  } = args || {};

  if (!userId) throw new Error("logActivityEvent: userId is required");
  if (!eventType) throw new Error("logActivityEvent: eventType is required");
  if (!eventDate) throw new Error("logActivityEvent: eventDate is required");

  const inferredPlanId = planId || meta?.plan_id || null;

  // 1) Insert into activity_events (best-effort)
  const payload = {
    id: uuidv4(),
    user_id: userId,
    team_id: teamId,
    plan_id: inferredPlanId,
    event_type: eventType,
    points: Number(points || 0),
    event_date: eventDate,
    meta,
  };

  const { error: aErr } = await supabase.from("activity_events").insert(payload);
  if (aErr) throw aErr;

  // 2) Mirror into points_events if the table exists in the project
  // (Some pages may read from points_events; keeping both in sync avoids "stuck" leaderboards.)
  try {
    await supabase.from("points_events").insert({
      id: payload.id,
      user_id: userId,
      team_id: teamId,
      date: eventDate,
      type: eventType,
      points: Number(points || 0),
      meta,
    });
  } catch (_) {
    // ignore if table missing or RLS blocks; activity_events remains the source of truth.
  }
}
