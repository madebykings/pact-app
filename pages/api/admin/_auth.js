// pages/api/admin/_auth.js
// Shared superadmin auth helper for admin API routes.
// Verifies the JWT and checks the user's email against SUPERADMIN_EMAIL env var.
//
// Usage:
//   const { user, errorResponse } = await requireAdmin(req, res);
//   if (errorResponse) return;  // response already sent

import { supabaseAdmin } from "../../../lib/supabaseAdmin";

export async function requireAdmin(req, res) {
  const jwt = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();

  if (!jwt) {
    res.status(401).json({ error: "Missing Authorization header" });
    return { user: null, errorResponse: true };
  }

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(jwt);
  if (error || !user) {
    res.status(401).json({ error: "Invalid or expired token" });
    return { user: null, errorResponse: true };
  }

  const adminEmail = process.env.SUPERADMIN_EMAIL;
  if (!adminEmail) {
    res.status(500).json({ error: "SUPERADMIN_EMAIL not configured on server" });
    return { user: null, errorResponse: true };
  }

  if (user.email !== adminEmail) {
    res.status(403).json({ error: "Forbidden" });
    return { user: null, errorResponse: true };
  }

  return { user, errorResponse: false };
}
