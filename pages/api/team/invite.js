import crypto from "crypto";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { teamId, email, createdBy, ttlHours = 72 } = req.body;

  if (!teamId || !email || !createdBy) return res.status(400).json({ error: "missing_fields" });

  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();

  const { data, error } = await supabaseAdmin
    .from("team_invites")
    .insert({
      team_id: teamId,
      email: email.toLowerCase().trim(),
      token,
      expires_at: expiresAt,
      status: "pending",
      created_by: createdBy,
    })
    .select("*")
    .single();

  if (error) return res.status(400).json({ error: error.message });

  res.json({
    invite: data,
    link: `${process.env.NEXT_PUBLIC_BASE_URL || "https://pact.madebykings.com"}/invite/${token}`,
  });
}
