import { supabaseAdmin } from "../../../lib/supabaseAdmin";

function iso(d) {
  return d.toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { teamId, userId, dateISO } = req.body;
  if (!teamId || !userId || !dateISO) return res.status(400).json({ error: "missing_fields" });

  // Determine week_start (Monday)
  const d = new Date(dateISO + "T00:00:00Z");
  const day = d.getUTCDay(); // 0..6
  const mondayOffset = (day + 6) % 7;
  const weekStart = new Date(d);
  weekStart.setUTCDate(weekStart.getUTCDate() - mondayOffset);
  const weekStartISO = iso(weekStart);

  const { data: plan, error: pErr } = await supabaseAdmin
    .from("team_weekly_plans")
    .select("commit_cutoff_time, timezone")
    .eq("team_id", teamId)
    .eq("week_start", weekStartISO)
    .maybeSingle();

  if (pErr || !plan) return res.status(400).json({ error: "no_team_weekly_plan" });

  const cutoffTime = (plan.commit_cutoff_time || "23:59:00").slice(0, 5); // HH:MM
  const [hh, mm] = cutoffTime.split(":").map(Number);

  // cutoff applies day before the committed date, at HH:MM (server UTC for now)
  const cutoff = new Date(dateISO + "T00:00:00Z");
  cutoff.setUTCDate(cutoff.getUTCDate() - 1);
  cutoff.setUTCHours(hh, mm, 0, 0);

  const now = new Date();
  const onTime = now.getTime() <= cutoff.getTime();
  const status = onTime ? "on_time" : "late";
  const points = onTime ? 5 : 2;

  await supabaseAdmin.from("team_daily_commits").upsert(
    {
      team_id: teamId,
      user_id: userId,
      date: dateISO,
      committed: true,
      committed_at: now.toISOString(),
      commit_status: status,
    },
    { onConflict: "team_id,user_id,date" }
  );

  await supabaseAdmin.from("points_events").insert({
    team_id: teamId,
    user_id: userId,
    date: dateISO,
    type: onTime ? "commit_on_time" : "commit_late",
    points,
    meta: { cutoffTime },
  });

  res.json({ ok: true, status, points, cutoffTime });
}
