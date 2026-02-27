// lib/activityEvents.js
// Lightweight event logger used by dashboard actions.
// Writes to `activity_events` (primary) and, if possible, mirrors to `points_events` (best-effort).

import { supabase } from "./supabaseClient";

function uuidv4() {
  // Prefer crypto.randomUUID when available
  if (typeof crypto !== "undefined" && crypto?.randomUUID) return crypto.randomUUID();

  // Fallback UUID-ish (good enough for client-side IDs)
  const s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
  return `${s4()}${s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`;
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

  const id = uuidv4();

  // 1) activity_events (source of truth)
  const payload = {
    id,
    user_id: userId,
    team_id: teamId,
    plan_id: planId,
    event_type: eventType,
    points,
    event_date: eventDate,
    meta,
  };

  const { error: aErr } = await supabase.from("activity_events").insert(payload);
  if (aErr) throw aErr;

  // 2) points_events (best-effort mirror)
  // Note: Supabase doesn't throw; it returns { error }.
  const { error: pErr } = await supabase.from("points_events").insert({
    id,
    team_id: teamId,
    user_id: userId,
    date: eventDate,
    type: eventType,
    points,
    meta,
  });

  // Ignore mirror failures (RLS, table missing, etc.)
  // but don’t throw; activity_events is the truth.
  if (pErr) {
    // optional: console debug in dev only
    if (process?.env?.NODE_ENV !== "production") {
      console.warn("points_events mirror failed:", pErr.message);
    }
  }
}
