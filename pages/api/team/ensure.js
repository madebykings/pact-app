import { supabase } from "../../../lib/supabaseClient";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { data: auth } = await supabase.auth.getUser(req.headers.authorization?.replace("Bearer ", ""));
  // NOTE: supabaseClient in API routes usually won’t read browser session cookies.
  // Easiest: call this route with a Supabase JWT in Authorization header.
  // If you don’t want that, we can switch API routes to use @supabase/auth-helpers-nextjs.
  if (!auth?.user) return res.status(401).json({ error: "unauth" });

  const userId = auth.user.id;
  const { name } = req.body;

  // If user already owns a team, return it
  const { data: existing } = await supabase
    .from("teams")
    .select("*")
    .eq("owner_id", userId)
    .maybeSingle();

  if (existing) return res.json({ team: existing });

  const { data: team, error } = await supabase
    .from("teams")
    .insert({ name: name || "My Pact Team", owner_id: userId })
    .select("*")
    .single();

  if (error) return res.status(400).json({ error: error.message });

  await supabase.from("team_members").insert({ team_id: team.id, user_id: userId, role: "owner" });

  res.json({ team });
}
