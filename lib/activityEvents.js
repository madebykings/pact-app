// lib/activityEvents.js
import { supabase } from "./supabaseClient";

function uuidv4() {
  if (typeof crypto !== "undefined" && crypto?.randomUUID) return crypto.randomUUID();
  const s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
  return `${s4()}${s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`;
}

function isNoConflictConstraintMatch(err) {
  const msg = String(err?.message || "").toLowerCase();
  return msg.includes("no unique or exclusion constraint matching the on conflict specification");
}

/**
 * Log an activity event.
 * - If planId exists: UPSERT against the unique plan/day constraint (no duplicates possible)
 * - If no planId: INSERT (append history)
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

  // Non-plan events can be appended (no uq_plan_event_day applies)
  if (!planId) {
    const { error } = await supabase.from("activity_events").insert(payload);
    if (error) throw error;
    return;
  }

  // Plan-bound events MUST not create duplicates for the same plan/day.
  // We upsert using the project's actual unique key.
  const conflictTargets = [
    "plan_id,event_date",
    "user_id,plan_id,event_date",
  ];

  let lastNoMatch = null;

  for (const onConflict of conflictTargets) {
    const { error } = await supabase
      .from("activity_events")
      .upsert(payload, { onConflict });

    if (!error) {
      lastNoMatch = null;
      break;
    }

    // If we guessed the wrong constraint columns, try the next.
    if (isNoConflictConstraintMatch(error)) {
      lastNoMatch = error;
      continue;
    }

    // Any other error should surface (RLS, invalid columns, etc.)
    throw error;
  }

  if (lastNoMatch) {
    throw new Error(
      "activity_events upsert failed: could not find matching unique constraint for onConflict. " +
      "Your uq_plan_event_day is not (plan_id,event_date) or (user_id,plan_id,event_date)."
    );
  }
}
