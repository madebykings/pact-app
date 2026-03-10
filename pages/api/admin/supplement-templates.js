// pages/api/admin/supplement-templates.js
// CRUD for global supplement_templates table. Superadmin only.
//
// POST  body: { name, rule_type, window_start?, window_end?, offset_minutes?, sort? }  → create
// DELETE ?id=<uuid>  → delete

import { supabaseAdmin } from "../../../lib/supabaseAdmin";
import { requireAdmin } from "./_auth";

const VALID_RULE_TYPES = new Set([
  "PRE_WORKOUT", "POST_WORKOUT",
  "MORNING_WINDOW", "MIDDAY_WINDOW", "EVENING_WINDOW", "BED_WINDOW",
]);

export default async function handler(req, res) {
  const { user, errorResponse } = await requireAdmin(req, res);
  if (errorResponse) return;

  // --- POST: create ---
  if (req.method === "POST") {
    const { name, rule_type, window_start, window_end, offset_minutes, sort = 0 } = req.body || {};

    if (!name) return res.status(400).json({ error: "name is required" });
    if (!rule_type) return res.status(400).json({ error: "rule_type is required" });
    if (!VALID_RULE_TYPES.has(rule_type)) {
      return res.status(400).json({ error: `rule_type must be one of: ${[...VALID_RULE_TYPES].join(", ")}` });
    }

    const row = {
      name: String(name).trim(),
      rule_type,
      sort: Number(sort) || 0,
      window_start: window_start || null,
      window_end: window_end || null,
      offset_minutes: offset_minutes != null ? Number(offset_minutes) : null,
    };

    const { data, error } = await supabaseAdmin
      .from("supplement_templates")
      .insert(row)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ ok: true, template: data });
  }

  // --- DELETE: remove by id ---
  if (req.method === "DELETE") {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "id query param required" });

    const { error } = await supabaseAdmin
      .from("supplement_templates")
      .delete()
      .eq("id", id);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  }

  // --- PUT: seed defaults ---
  if (req.method === "PUT") {
    const defaults = [
      { name: "Creatine",      rule_type: "PRE_WORKOUT",    offset_minutes: -45, sort: 1 },
      { name: "L-Carnitine",   rule_type: "PRE_WORKOUT",    offset_minutes: -30, sort: 2 },
      { name: "Cod Liver Oil", rule_type: "MORNING_WINDOW", window_start: "06:00", window_end: "10:00", sort: 3 },
      { name: "Tongkat Ali",   rule_type: "MORNING_WINDOW", window_start: "06:00", window_end: "10:00", sort: 4 },
      { name: "Shilajit",      rule_type: "MORNING_WINDOW", window_start: "06:00", window_end: "10:00", sort: 5 },
      { name: "B12 Coffee",    rule_type: "MORNING_WINDOW", window_start: "06:00", window_end: "10:00", sort: 6 },
      { name: "Collagen",      rule_type: "MIDDAY_WINDOW",  window_start: "10:00", window_end: "16:00", sort: 7 },
      { name: "Ashwagandha",   rule_type: "EVENING_WINDOW", window_start: "18:00", window_end: "23:59", sort: 8 },
      { name: "Magnesium",     rule_type: "EVENING_WINDOW", window_start: "18:00", window_end: "23:59", sort: 9 },
      { name: "ZMA",           rule_type: "EVENING_WINDOW", window_start: "18:00", window_end: "23:59", sort: 10 },
    ];

    const { data, error } = await supabaseAdmin
      .from("supplement_templates")
      .insert(defaults)
      .select();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ ok: true, seeded: data.length });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
