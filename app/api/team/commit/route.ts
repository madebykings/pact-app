import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

function parseISODate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  const supa = supabaseServer();
  const { data: auth } = await supa.auth.getUser();
  if (!auth?.user) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const body = await req.json();
  const { teamId, dateISO } = body as { teamId: string; dateISO: string };

  // Load team weekly plan for that date's week
  // (Simple: pick most recent plan that includes the date; here we infer weekStart=Monday)
  const date = new Date(dateISO + "T00:00:00Z");
  const day = date.getUTCDay(); // 0 Sun..6 Sat
  const mondayOffset = (day + 6) % 7;
  const weekStart = new Date(date);
  weekStart.setUTCDate(weekStart.getUTCDate() - mondayOffset);
  const weekStartISO = parseISODate(weekStart);

  const { data: planRow, error: planErr } = await supa
    .from("team_weekly_plans")
    .select("commit_cutoff_time, timezone")
    .eq("team_id", teamId)
    .eq("week_start", weekStartISO)
    .maybeSingle();

  if (planErr || !planRow) {
    return NextResponse.json({ error: "no_team_plan" }, { status: 400 });
  }

  // Cutoff logic (assume Europe/London but we treat as local clock on server UTC)
  // For now: cutoff applies on the DAY BEFORE dateISO at cutoff_time in Europe/London.
  // You can refine later with a proper TZ lib if needed.
  const cutoffTime = planRow.commit_cutoff_time as string; // "23:59:00"
  const [hh, mm] = cutoffTime.split(":").map(Number);

  const now = new Date();
  const commitForDate = new Date(dateISO + "T00:00:00Z");
  const cutoffDate = new Date(commitForDate);
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - 1);
  cutoffDate.setUTCHours(hh, mm, 0, 0);

  const onTime = now.getTime() <= cutoffDate.getTime();
  const commit_status = onTime ? "on_time" : "late";

  // Upsert commit
  const { error: upErr } = await supa
    .from("team_daily_commits")
    .upsert({
      team_id: teamId,
      user_id: auth.user.id,
      date: dateISO,
      committed: true,
      committed_at: now.toISOString(),
      commit_status,
    });

  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });

  // Award points via admin (prevents cheating)
  const points = onTime ? 5 : 2;
  await supabaseAdmin.from("points_events").insert({
    team_id: teamId,
    user_id: auth.user.id,
    date: dateISO,
    type: onTime ? "commit_on_time" : "commit_late",
    points,
    meta: { cutoff: cutoffTime },
  });

  return NextResponse.json({ ok: true, commit_status, points });
}
