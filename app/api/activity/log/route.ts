import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  const supa = supabaseServer();
  const { data: auth } = await supa.auth.getUser();
  if (!auth?.user) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const body = await req.json();
  const { dateISO, activityKey, minutes, intensity, teamId } = body as {
    dateISO: string;
    activityKey: string;
    minutes?: number;
    intensity?: "easy" | "moderate" | "hard";
    teamId?: string | null;
  };

  const { error } = await supa
    .from("daily_activity_logs")
    .upsert({
      user_id: auth.user.id,
      date: dateISO,
      activity_key: activityKey,
      minutes: minutes ?? null,
      intensity: intensity ?? null,
      completed: true,
      meta: {},
    });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Points (simple rules)
  const isRest = activityKey === "rest";
  const points = isRest ? 10 : 15;

  await supabaseAdmin.from("points_events").insert({
    team_id: teamId ?? null,
    user_id: auth.user.id,
    date: dateISO,
    type: isRest ? "rest_complete" : "activity_complete",
    points,
    meta: { activityKey, minutes, intensity },
  });

  return NextResponse.json({ ok: true, points });
}
