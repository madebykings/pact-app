// pages/api/whatsapp/test-send.js
// Sends a single test WhatsApp message to the calling user's registered phone.
// Use this to verify your Twilio credentials and sandbox join before waiting
// for the hourly cron to fire.
//
// POST /api/whatsapp/test-send
// Headers: Authorization: Bearer <supabase-jwt>
// Returns: { ok, sid } on success, { error } on failure

import { supabaseAdmin } from "../../../lib/supabaseAdmin";
import { sendWhatsApp, isTwilioEnabled } from "../../../lib/twilio";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // --- Authenticate ---
  const jwt = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) {
    return res.status(401).json({ error: "Missing Authorization header" });
  }

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(jwt);
  if (authErr || !user) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  // --- Check Twilio is configured ---
  if (!isTwilioEnabled()) {
    return res.status(400).json({
      error: "WhatsApp not enabled. Set WHATSAPP_ENABLED=true and all TWILIO_* env vars.",
    });
  }

  // --- Look up subscription ---
  const { data: sub, error: subErr } = await supabaseAdmin
    .from("whatsapp_subscriptions")
    .select("phone_e164, opted_in")
    .eq("user_id", user.id)
    .maybeSingle();

  if (subErr) {
    return res.status(500).json({ error: `DB error: ${subErr.message}` });
  }

  if (!sub) {
    return res.status(400).json({
      error: "No WhatsApp subscription found. Save your phone number in Settings first.",
    });
  }

  if (!sub.opted_in) {
    return res.status(400).json({
      error: "Opt-in not confirmed. Tick 'I consent' and save in Settings.",
    });
  }

  // --- Send test message ---
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://pact.madebykings.com";
  const body = `✅ Pact WhatsApp test message. Your reminders are set up correctly! Open the app: ${siteUrl}/dashboard`;

  const result = await sendWhatsApp(sub.phone_e164, body);

  if (!result.ok) {
    return res.status(502).json({ error: result.error });
  }

  return res.json({ ok: true, sid: result.sid, phone: sub.phone_e164 });
}
