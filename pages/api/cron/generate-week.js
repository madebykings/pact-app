import { supabaseAdmin } from "../../../lib/supabaseAdmin";
import { mondayOfNextWeekISO, addDaysISO, generateWeek } from "../../../lib/planGenerator";

export default async function handler(req, res) {
  const { secret } = req.query;
  if (secret !== process.env.CRON_SECRET) return res.status(403).json({ error: "forbidden" });

  const weekStart = mondayOfNextWeekISO();

  // 1) SOLO users: generate plans into `plans`
  const { data: settings } = await supabaseAdmin
    .from("user_settings")
    .select("user_id, mode, included_activities")
    .neq("mode", "team");

  // included_activities: if you don’t have it yet, we store it in brutal_copy or add a column later.
  // For now, fallback list:
  const solo = settings || [];
  for (const s of solo) {
    const allowed = Array.isArray(s.included_activities) ? s.included_activities : ["walk","run","spin","weights","swim","hillwalk","stretch"];
    const days = generateWeek(weekStart, allowed, 1);

    const rows = [];
    for (let i = 0; i < 7; i++) {
      const date = addDaysISO(weekStart, i);
      rows.push({
        user_id: s.user_id,
        plan_date: date,
        plan_type: days[date],
        status: "PLANNED",
      });
    }

    await supabaseAdmin.from("plans").upsert(rows, { onConflict: "user_id,plan_date" });
  }

  // 2) TEAM users: use team_weekly_plans.plan JSON
  // Expect plan JSON like: { "YYYY-MM-DD": "SPIN", ... } or { days: {..} }
  const { data: teamPlans } = await supabaseAdmin
    .from("team_weekly_plans")
    .select("team_id, week_start, plan")
    .eq("week_start", weekStart);

  if (teamPlans?.length) {
    for (const tp of teamPlans) {
      const { data: members } = await supabaseAdmin
        .from("team_members")
        .select("user_id")
        .eq("team_id", tp.team_id);

      const mIds = (members || []).map(m => m.user_id);

      const p = tp.plan || {};
      const days = p.days || p; // allow either shape

      const rows = [];
      for (let i = 0; i < 7; i++) {
        const date = addDaysISO(weekStart, i);
        const planType = (days[date]?.type ? days[date].type.toUpperCase() : days[date]) || "REST";
        rows.push({
          user_id: mIds[0], // placeholder, we expand below
          plan_date: date,
          plan_type: planType,
          status: "PLANNED",
        });
      }

      for (const uid of mIds) {
        const perUser = rows.map(r => ({ ...r, user_id: uid }));
        await supabaseAdmin.from("plans").upsert(perUser, { onConflict: "user_id,plan_date" });
      }
    }
  }

  res.json({ ok: true, weekStart });
}
