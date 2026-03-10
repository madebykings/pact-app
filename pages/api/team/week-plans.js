// pages/api/team/week-plans.js
// Returns the team owner's plans for a given week.
// Used by team members who can't read other users' plans via RLS.
//
// GET ?teamId=<uuid>&dates=<iso>,<iso>,... → { plans: [...] }

import { supabaseAdmin } from "../../../lib/supabaseAdmin";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const jwt = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return res.status(401).json({ error: "Missing Authorization header" });

  const { data: authData, error: authErr } = await supabaseAdmin.auth.getUser(jwt);
  if (authErr || !authData?.user) return res.status(401).json({ error: "Invalid token" });
  const userId = authData.user.id;

  const { teamId, dates } = req.query;
  if (!teamId || !dates) return res.status(400).json({ error: "teamId and dates required" });

  const dateList = String(dates).split(",").filter(Boolean);

  // Verify caller is a member of this team
  const { data: membership } = await supabaseAdmin
    .from("team_members").select("role").eq("team_id", teamId).eq("user_id", userId).maybeSingle();
  if (!membership) return res.status(403).json({ error: "Not a member of this team" });

  // Get the owner's user_id
  const { data: ownerRow } = await supabaseAdmin
    .from("team_members").select("user_id").eq("team_id", teamId).eq("role", "owner").maybeSingle();
  if (!ownerRow?.user_id) return res.status(404).json({ error: "Team owner not found" });

  // Ensure all 7 plan rows exist for the owner
  const upserts = dateList.map((d) => ({
    user_id: ownerRow.user_id,
    plan_date: d,
    plan_type: "REST",
    status: "PLANNED",
  }));
  await supabaseAdmin.from("plans").upsert(upserts, { onConflict: "user_id,plan_date", ignoreDuplicates: true });

  // Fetch the owner's plans
  const { data: plans, error } = await supabaseAdmin
    .from("plans").select("*").eq("user_id", ownerRow.user_id).in("plan_date", dateList).order("plan_date");

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ plans: plans || [], ownerUserId: ownerRow.user_id });
}
