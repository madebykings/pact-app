// pages/api/activities.js
// Public read-only endpoint for global activity types.
// Used by settings page to load the canonical list dynamically.
//
// GET → returns activity_types table ordered by sort, falls back to hardcoded defaults
// if the table is empty or doesn't exist yet.

import { supabaseAdmin } from "../../lib/supabaseAdmin";

const HARDCODED_DEFAULTS = [
  { key: "WALK",     label: "Walk",     sort: 1 },
  { key: "RUN",      label: "Run",      sort: 2 },
  { key: "SPIN",     label: "Spin",     sort: 3 },
  { key: "HIIT",     label: "HIIT",     sort: 4 },
  { key: "SWIM",     label: "Swim",     sort: 5 },
  { key: "HILLWALK", label: "Hillwalk", sort: 6 },
  { key: "WEIGHTS",  label: "Weights",  sort: 7 },
  { key: "YOGA",     label: "Yoga",     sort: 8 },
  { key: "PILATES",  label: "Pilates",  sort: 9 },
  { key: "MOBILITY", label: "Mobility", sort: 10 },
  { key: "OTHER",    label: "Other",    sort: 99 },
];

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { data, error } = await supabaseAdmin
    .from("activity_types")
    .select("key, label, sort")
    .order("sort");

  if (error || !data?.length) {
    // Table doesn't exist yet or is empty — serve hardcoded defaults
    return res.json({ activities: HARDCODED_DEFAULTS, source: "defaults" });
  }

  return res.json({ activities: data, source: "db" });
}
