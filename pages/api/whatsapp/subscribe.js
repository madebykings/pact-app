// pages/api/whatsapp/subscribe.js
// Saves or updates a user's WhatsApp phone number and opt-in status.
// Requires a valid Supabase JWT in the Authorization header.
//
// POST body: { phone: "+447700900123", optedIn: true }
// DELETE: removes the subscription row

import { supabaseAdmin } from "../../../lib/supabaseAdmin";

/** Loose E.164 validation: + followed by 7–15 digits */
function isValidE164(phone) {
  return /^\+[1-9]\d{6,14}$/.test(String(phone || "").trim());
}

export default async function handler(req, res) {
  // Authenticate via Bearer JWT in Authorization header
  const authHeader = req.headers.authorization || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!jwt) {
    return res.status(401).json({ error: "Missing Authorization header" });
  }

  // Verify the JWT and get the user
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(jwt);
  if (authErr || !user) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  const userId = user.id;

  // --- DELETE: remove subscription ---
  if (req.method === "DELETE") {
    const { error } = await supabaseAdmin
      .from("whatsapp_subscriptions")
      .delete()
      .eq("user_id", userId);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  }

  // --- POST: upsert subscription ---
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { phone, optedIn } = req.body || {};

  if (!phone) {
    return res.status(400).json({ error: "phone is required" });
  }

  const phoneTrimmed = String(phone).trim();
  if (!isValidE164(phoneTrimmed)) {
    return res.status(400).json({
      error: "phone must be in E.164 format, e.g. +447700900123",
    });
  }

  const now = new Date().toISOString();
  const row = {
    user_id: userId,
    phone_e164: phoneTrimmed,
    opted_in: Boolean(optedIn),
    updated_at: now,
    ...(optedIn ? { opted_in_at: now } : {}),
  };

  const { error } = await supabaseAdmin
    .from("whatsapp_subscriptions")
    .upsert(row, { onConflict: "user_id" });

  if (error) return res.status(500).json({ error: error.message });

  return res.json({ ok: true });
}
