// pages/api/team/accept.js
import { supabaseAdmin } from "../../../lib/supabaseAdmin";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { token, userId } = req.body || {};
  if (!token || !userId) return res.status(400).json({ ok: false, error: "missing_fields" });

  const { data: invite, error } = await supabaseAdmin
    .from("team_invites")
    .select("*")
    .eq("token", token)
    .maybeSingle();

  if (error || !invite) return res.status(400).json({ ok: false, error: "invalid_invite" });

  // DB constraint expects lowercase: pending/accepted/expired/revoked
  const status = String(invite.status || "").toLowerCase();
  if (status !== "pending") return res.status(400).json({ ok: false, error: "invite_not_pending" });

  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    return res.status(400).json({ ok: false, error: "invite_expired" });
  }

  // add membership
  const { error: memErr } = await supabaseAdmin.from("team_members").upsert(
    {
      team_id: invite.team_id,
      user_id: userId,
      role: "member",
    },
    { onConflict: "team_id,user_id" }
  );
  if (memErr) return res.status(400).json({ ok: false, error: memErr.message });

  // mark accepted (lowercase)
  const { error: updErr } = await supabaseAdmin
    .from("team_invites")
    .update({ status: "accepted", accepted_at: new Date().toISOString() })
    .eq("id", invite.id);

  if (updErr) return res.status(400).json({ ok: false, error: updErr.message });

  // set user_settings team_id + mode=team
  const { error: setErr } = await supabaseAdmin
    .from("user_settings")
    .upsert({ user_id: userId, team_id: invite.team_id, mode: "team" }, { onConflict: "user_id" });

  if (setErr) return res.status(400).json({ ok: false, error: setErr.message });

  return res.json({ ok: true, team_id: invite.team_id });
}
