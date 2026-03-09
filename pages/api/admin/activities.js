// pages/api/admin/activities.js
// CRUD for global activity_types table. Superadmin only.
//
// POST  body: { key, label, sort? }  → create
// DELETE ?id=<uuid>                  → delete

import { supabaseAdmin } from "../../../lib/supabaseAdmin";
import { requireAdmin } from "./_auth";

export default async function handler(req, res) {
  const { user, errorResponse } = await requireAdmin(req, res);
  if (errorResponse) return;

  // --- POST: create ---
  if (req.method === "POST") {
    const { key, label, sort = 0 } = req.body || {};

    if (!key || !label) {
      return res.status(400).json({ error: "key and label are required" });
    }

    const keyNorm = String(key).trim().toUpperCase();
    if (!/^[A-Z0-9_]+$/.test(keyNorm)) {
      return res.status(400).json({ error: "key must be uppercase letters, numbers, or underscores" });
    }

    const { data, error } = await supabaseAdmin
      .from("activity_types")
      .insert({ key: keyNorm, label: String(label).trim(), sort: Number(sort) || 0 })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ ok: true, activity: data });
  }

  // --- DELETE: remove by id ---
  if (req.method === "DELETE") {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "id query param required" });

    const { error } = await supabaseAdmin
      .from("activity_types")
      .delete()
      .eq("id", id);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
