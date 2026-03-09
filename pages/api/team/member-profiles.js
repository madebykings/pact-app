// pages/api/team/member-profiles.js
// Returns display_name for a list of user IDs using the service role key,
// bypassing RLS so team members can see each other's names.
import { supabaseAdmin } from "../../../lib/supabaseAdmin";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { userIds } = req.body || {};
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return res.status(200).json({ profiles: [] });
  }

  const { data, error } = await supabaseAdmin
    .from("user_profiles")
    .select("user_id,display_name")
    .in("user_id", userIds);

  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ profiles: data || [] });
}
