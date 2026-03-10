// pages/api/admin/notification-templates.js
// CRUD for per-tone, per-trigger WhatsApp message templates. Superadmin only.
//
// GET  → list all templates
// POST body: { trigger_type, tone, template } → upsert
//
// Trigger types: pre_workout | teammate_done | supplement_due | eod_incomplete
// Tones:         normal | brutal | savage
//
// Template variables available: {name} {workout} {supplements} {teammate}
//
// DB table (create in Supabase if not exists):
//   CREATE TABLE notification_templates (
//     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//     trigger_type TEXT NOT NULL CHECK (trigger_type IN ('pre_workout','teammate_done','supplement_due','eod_incomplete')),
//     tone         TEXT NOT NULL CHECK (tone IN ('normal','brutal','savage')),
//     template     TEXT NOT NULL,
//     UNIQUE (trigger_type, tone),
//     created_at   TIMESTAMPTZ DEFAULT now()
//   );

import { supabaseAdmin } from "../../../lib/supabaseAdmin";
import { requireAdmin } from "./_auth";

const VALID_TRIGGERS = new Set(["pre_workout", "teammate_done", "supplement_due", "eod_incomplete"]);
const VALID_TONES = new Set(["normal", "brutal", "savage"]);

export default async function handler(req, res) {
  const { errorResponse } = await requireAdmin(req, res);
  if (errorResponse) return;

  if (req.method === "GET") {
    const { data, error } = await supabaseAdmin
      .from("notification_templates")
      .select("trigger_type, tone, template")
      .order("trigger_type");

    if (error) {
      // Table may not exist yet — return empty so UI falls back to defaults
      return res.json({ templates: [], tableExists: false });
    }
    return res.json({ templates: data || [], tableExists: true });
  }

  if (req.method === "POST") {
    const { trigger_type, tone, template } = req.body || {};

    if (!trigger_type || !VALID_TRIGGERS.has(trigger_type)) {
      return res.status(400).json({ error: `trigger_type must be one of: ${[...VALID_TRIGGERS].join(", ")}` });
    }
    if (!tone || !VALID_TONES.has(tone)) {
      return res.status(400).json({ error: `tone must be one of: ${[...VALID_TONES].join(", ")}` });
    }
    if (!template?.trim()) {
      return res.status(400).json({ error: "template is required" });
    }

    const { data, error } = await supabaseAdmin
      .from("notification_templates")
      .upsert({ trigger_type, tone, template: template.trim() }, { onConflict: "trigger_type,tone" })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true, template: data });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
