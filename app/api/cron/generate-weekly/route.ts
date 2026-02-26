import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateWeeklyPlan } from "@/lib/plans/generateWeeklyPlan";

function mondayOfNextWeekUTC() {
  const d = new Date();
  // next Monday
  const day = d.getUTCDay(); // 0..6
  const daysToNextMonday = (8 - day) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + daysToNextMonday);
  d.setUTCHours(0,0,0,0);
  return d.toISOString().slice(0,10);
}

export async function GET(req: Request) {
  const secret = new URL(req.url).searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const weekStart = mondayOfNextWeekUTC();
  const plan = generateWeeklyPlan(weekStart, { minRestDays: 1 });

  // SOLO users: upsert weekly plan
  const { data: users } = await supabaseAdmin
    .from("user_settings")
    .select("user_id, mode");

  const soloUserIds = (users || []).filter(u => u.mode === "solo").map(u => u.user_id);

  if (soloUserIds.length) {
    await supabaseAdmin.from("weekly_plans").upsert(
      soloUserIds.map(user_id => ({ user_id, week_start: weekStart, plan })),
      { onConflict: "user_id,week_start" }
    );
  }

  // TEAM plans: you can either auto-generate drafts, or require leader publish.
  // Here: auto-generate for each team and set created_by=owner
  const { data: teams } = await supabaseAdmin.from("teams").select("id, owner_id");
  if (teams?.length) {
    await supabaseAdmin.from("team_weekly_plans").upsert(
      teams.map(t => ({
        team_id: t.id,
        week_start: weekStart,
        created_by: t.owner_id,
        plan,
        commit_cutoff_time: "23:59",
        timezone: "Europe/London",
      })),
      { onConflict: "team_id,week_start" }
    );
  }

  return NextResponse.json({ ok: true, weekStart });
}
