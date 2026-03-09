// lib/activityEvents.js
import { supabase } from "./supabaseClient";

/**
 * Deterministic UUID-ish generator from a string key.
 * (Uses FNV-1a 32-bit x4 to make 128 bits. Low collision risk for our use-case.)
 */
function stableIdFromKey(key) {
  const fnv1a = (str, seed) => {
    let h = seed >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      // h *= 16777619 (but keep in 32-bit)
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };

  const a = fnv1a(key, 0x811c9dc5);
  const b = fnv1a(key, 0x811c9dc5 ^ 0x9e3779b9);
  const c = fnv1a(key, 0x811c9dc5 ^ 0x85ebca6b);
  const d = fnv1a(key, 0x811c9dc5 ^ 0xc2b2ae35);

  const hex = (n) => n.toString(16).padStart(8, "0");
  const raw = hex(a) + hex(b) + hex(c) + hex(d); // 32 hex chars

  // Format as UUID. Set version nibble to 5 and variant to 8..b
  const timeLow = raw.slice(0, 8);
  const timeMid = raw.slice(8, 12);
  const timeHiAndVersion = "5" + raw.slice(13, 16); // version 5
  const clkSeq = ((parseInt(raw.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0") + raw.slice(18, 20);
  const node = raw.slice(20, 32);

  return `${timeLow}-${timeMid}-${timeHiAndVersion}-${clkSeq}-${node}`;
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
  const eventDate = a.eventDate; // YYYY-MM-DD
  const meta = a.meta ?? {};
  const points = Number(a.points ?? 0);

  if (!userId) throw new Error("logActivityEvent: userId is required");
  if (!eventType) throw new Error("logActivityEvent: eventType is required");
  if (!eventDate) throw new Error("logActivityEvent: eventDate is required");

  // Match your DB uniqueness exactly:
  // - If planId present: (user_id, plan_id, event_type, event_date) unique (partial)
  // - If planId null: (user_id, event_type, event_date) unique (partial)
  const key = planId
    ? `plan:${userId}:${planId}:${eventType}:${eventDate}`
    : `day:${userId}:${eventType}:${eventDate}`;

  const id = stableIdFromKey(key);

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

  // Upsert on PRIMARY KEY (id) — always supported.
  // Because id is deterministic per unique key, this behaves like "upsert by unique key"
  // without relying on partial index inference.
  const { error } = await supabase
    .from("activity_events")
    .upsert(payload, { onConflict: "id" });

  if (error) throw error;

  // Mirror best-effort (don't break UX if it fails)
  // Upsert on id so re-runs (e.g. profile backfill) don't silently fail on duplicate.
  try {
    await supabase.from("points_events").upsert(
      { id, team_id: teamId, user_id: userId, date: eventDate, type: eventType, points, meta },
      { onConflict: "id" }
    );
  } catch (_) {}
}
