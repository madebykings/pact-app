import { supabaseAdmin } from "../../../lib/supabaseAdmin";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { token, userId } = req.body;
  if (!token || !userId) return res.status(400).json({ error: "missing_fields" });

  const { data: invite, error } = await supabaseAdmin
    .from("team_invites")
    .select("*")
    .eq("token", token)
    .maybeSingle();

  if (error || !invite) return res.status(400).json({ error: "invalid_invite" });
  if (invite.status !== "pending") return res.status(400).json({ error: "invite_not_pending" });
  if (new Date(invite.expires_at).getTime() < Date.now()) return res.status(400).json({ error: "invite_expired" });

  // add membership
  await supabaseAdmin.from("team_members").upsert({
    team_id: invite.team_id,
    user_id: userId,
    role: "member",
  });

  // mark accepted
  await supabaseAdmin.from("team_invites").update({ status: "accepted" }).eq("id", invite.id);

  // set user_settings mode=team
  await supabaseAdmin.from("user_settings").upsert({ user_id: userId, mode: "team" }, { onConflict: "user_id" });

  res.json({ ok: true, team_id: invite.team_id });
}
