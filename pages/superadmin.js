// pages/superadmin.js
// Superadmin panel — accessible only to the user whose email matches NEXT_PUBLIC_SUPERADMIN_EMAIL.
// Manages global activity types and supplement templates.

import { useEffect, useState } from "react";
import TopNav from "../components/Nav";
import { supabase } from "../lib/supabaseClient";

const RULE_TYPE_OPTIONS = [
  { value: "MORNING_WINDOW",  label: "Morning window",  defaults: { start: "06:00", end: "10:00" } },
  { value: "MIDDAY_WINDOW",   label: "Midday window",   defaults: { start: "10:00", end: "16:00" } },
  { value: "EVENING_WINDOW",  label: "Evening window",  defaults: { start: "18:00", end: "23:59" } },
  { value: "BED_WINDOW",      label: "Before bed",      defaults: { start: "21:00", end: "23:59" } },
  { value: "PRE_WORKOUT",     label: "Pre-workout",     defaults: {} },
  { value: "POST_WORKOUT",    label: "Post-workout",    defaults: {} },
];

function windowLabel(t) {
  if (t.rule_type === "PRE_WORKOUT")  return `${Math.abs(t.offset_minutes || 0)}m before workout`;
  if (t.rule_type === "POST_WORKOUT") return `After workout`;
  if (t.window_start) return `${t.window_start} – ${t.window_end}`;
  return "—";
}

export default function SuperAdmin() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  // Activities
  const [activities, setActivities] = useState([]);
  const [actKey, setActKey] = useState("");
  const [actLabel, setActLabel] = useState("");
  const [actSort, setActSort] = useState("");
  const [actMsg, setActMsg] = useState("");
  const [actSaving, setActSaving] = useState(false);

  // Supplement templates
  const [templates, setTemplates] = useState([]);
  const [suppName, setSuppName] = useState("");
  const [suppRule, setSuppRule] = useState("MORNING_WINDOW");
  const [suppWinStart, setSuppWinStart] = useState("06:00");
  const [suppWinEnd, setSuppWinEnd] = useState("10:00");
  const [suppOffset, setSuppOffset] = useState("-45");
  const [suppSort, setSuppSort] = useState("");
  const [suppMsg, setSuppMsg] = useState("");
  const [suppSaving, setSuppSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data?.user) { window.location.href = "/"; return; }

      const adminEmail = process.env.NEXT_PUBLIC_SUPERADMIN_EMAIL;
      if (!adminEmail || data.user.email !== adminEmail) {
        window.location.href = "/dashboard";
        return;
      }

      setUser(data.user);
      await refreshAll();
      setReady(true);
    })();
  }, []);

  // When the rule type changes, pre-fill sensible window defaults
  function handleRuleChange(val) {
    setSuppRule(val);
    const opt = RULE_TYPE_OPTIONS.find((o) => o.value === val);
    if (opt?.defaults?.start) {
      setSuppWinStart(opt.defaults.start);
      setSuppWinEnd(opt.defaults.end);
    }
  }

  async function refreshAll() {
    const { data: acts } = await supabase.from("activity_types").select("*").order("sort");
    setActivities(acts || []);

    const { data: tmpl } = await supabase.from("supplement_templates").select("*").order("sort");
    setTemplates(tmpl || []);
  }

  async function getJwt() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token;
  }

  // ── Activities ──────────────────────────────────────────────────────────────

  async function addActivity() {
    if (!actKey.trim() || !actLabel.trim()) {
      setActMsg("Both key and label are required.");
      return;
    }
    setActSaving(true);
    setActMsg("");
    try {
      const jwt = await getJwt();
      const res = await fetch("/api/admin/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ key: actKey, label: actLabel, sort: Number(actSort) || 0 }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setActKey(""); setActLabel(""); setActSort("");
      setActMsg("Activity added.");
      await refreshAll();
    } catch (e) {
      setActMsg(`Error: ${e?.message || String(e)}`);
    } finally {
      setActSaving(false);
    }
  }

  async function removeActivity(id) {
    const jwt = await getJwt();
    await fetch(`/api/admin/activities?id=${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    await refreshAll();
  }

  // ── Supplement templates ────────────────────────────────────────────────────

  async function addTemplate() {
    if (!suppName.trim()) { setSuppMsg("Name is required."); return; }
    setSuppSaving(true);
    setSuppMsg("");
    try {
      const jwt = await getJwt();
      const isWindow = suppRule.endsWith("_WINDOW");
      const res = await fetch("/api/admin/supplement-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({
          name: suppName,
          rule_type: suppRule,
          window_start:   isWindow ? suppWinStart : null,
          window_end:     isWindow ? suppWinEnd   : null,
          offset_minutes: !isWindow ? Number(suppOffset) || null : null,
          sort:           Number(suppSort) || 0,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setSuppName(""); setSuppSort("");
      setSuppMsg("Template added.");
      await refreshAll();
    } catch (e) {
      setSuppMsg(`Error: ${e?.message || String(e)}`);
    } finally {
      setSuppSaving(false);
    }
  }

  async function removeTemplate(id) {
    const jwt = await getJwt();
    await fetch(`/api/admin/supplement-templates?id=${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    await refreshAll();
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  if (!ready) {
    return (
      <div style={{ padding: 20, fontFamily: "system-ui" }}>
        <TopNav onLogout={logout} />
        <div style={{ padding: 18 }}>Checking access…</div>
      </div>
    );
  }

  const isWindow = suppRule.endsWith("_WINDOW");

  return (
    <div style={{ fontFamily: "system-ui" }}>
      <TopNav onLogout={logout} />

      <div style={{ padding: 18, maxWidth: 860, margin: "0 auto" }}>
        <h1 style={{ margin: "0 0 4px" }}>Super Admin</h1>
        <div style={{ marginBottom: 28, fontSize: 13, opacity: 0.55 }}>{user?.email}</div>

        {/* ── Activity Types ─────────────────────────────────────────────── */}
        <section style={{ marginBottom: 40 }}>
          <h2 style={{ margin: "0 0 14px", fontSize: 18 }}>Activity Types</h2>

          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16, fontSize: 14 }}>
            <thead>
              <tr style={{ opacity: 0.55, textAlign: "left" }}>
                <th style={{ padding: "4px 10px" }}>Key</th>
                <th style={{ padding: "4px 10px" }}>Label</th>
                <th style={{ padding: "4px 10px" }}>Sort</th>
                <th style={{ padding: "4px 10px" }} />
              </tr>
            </thead>
            <tbody>
              {activities.map((a) => (
                <tr key={a.id} style={{ borderTop: "1px solid rgba(0,0,0,.07)" }}>
                  <td style={{ padding: "10px 10px", fontFamily: "monospace", fontWeight: 700 }}>{a.key}</td>
                  <td style={{ padding: "10px 10px" }}>{a.label}</td>
                  <td style={{ padding: "10px 10px", opacity: 0.5 }}>{a.sort}</td>
                  <td style={{ padding: "10px 10px" }}>
                    <button
                      onClick={() => removeActivity(a.id)}
                      style={{ color: "#c00", background: "none", border: "none", cursor: "pointer", fontSize: 13 }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {activities.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ padding: "14px 10px", opacity: 0.45 }}>
                    No activity types yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, opacity: 0.6 }}>Key (e.g. SPIN)</span>
              <input
                value={actKey}
                onChange={(e) => { setActKey(e.target.value.toUpperCase()); setActMsg(""); }}
                placeholder="SPIN"
                style={{ padding: 10, fontSize: 15, width: 120, fontFamily: "monospace" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, opacity: 0.6 }}>Label</span>
              <input
                value={actLabel}
                onChange={(e) => { setActLabel(e.target.value); setActMsg(""); }}
                placeholder="Spin"
                style={{ padding: 10, fontSize: 15, width: 160 }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, opacity: 0.6 }}>Sort order</span>
              <input
                type="number"
                value={actSort}
                onChange={(e) => setActSort(e.target.value)}
                placeholder="0"
                style={{ padding: 10, fontSize: 15, width: 72 }}
              />
            </label>
            <button
              onClick={addActivity}
              disabled={actSaving}
              style={{ padding: "10px 20px", fontWeight: 800, alignSelf: "flex-end" }}
            >
              {actSaving ? "Adding…" : "Add"}
            </button>
          </div>
          {actMsg && <div style={{ marginTop: 10, fontSize: 13 }}>{actMsg}</div>}
        </section>

        {/* ── Supplement Templates ───────────────────────────────────────── */}
        <section>
          <h2 style={{ margin: "0 0 14px", fontSize: 18 }}>Supplement Templates</h2>

          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16, fontSize: 14 }}>
            <thead>
              <tr style={{ opacity: 0.55, textAlign: "left" }}>
                <th style={{ padding: "4px 10px" }}>Name</th>
                <th style={{ padding: "4px 10px" }}>Rule</th>
                <th style={{ padding: "4px 10px" }}>Window / Offset</th>
                <th style={{ padding: "4px 10px" }}>Sort</th>
                <th style={{ padding: "4px 10px" }} />
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} style={{ borderTop: "1px solid rgba(0,0,0,.07)" }}>
                  <td style={{ padding: "10px 10px", fontWeight: 700 }}>{t.name}</td>
                  <td style={{ padding: "10px 10px", fontSize: 13, opacity: 0.75 }}>{t.rule_type}</td>
                  <td style={{ padding: "10px 10px", fontSize: 13, opacity: 0.65 }}>{windowLabel(t)}</td>
                  <td style={{ padding: "10px 10px", opacity: 0.5 }}>{t.sort}</td>
                  <td style={{ padding: "10px 10px" }}>
                    <button
                      onClick={() => removeTemplate(t.id)}
                      style={{ color: "#c00", background: "none", border: "none", cursor: "pointer", fontSize: 13 }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {templates.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: "14px 10px", opacity: 0.45 }}>
                    No supplement templates yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, opacity: 0.6 }}>Name</span>
              <input
                value={suppName}
                onChange={(e) => { setSuppName(e.target.value); setSuppMsg(""); }}
                placeholder="Creatine"
                style={{ padding: 10, fontSize: 15, width: 180 }}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, opacity: 0.6 }}>Rule type</span>
              <select
                value={suppRule}
                onChange={(e) => handleRuleChange(e.target.value)}
                style={{ padding: 10, fontSize: 15 }}
              >
                {RULE_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>

            {isWindow && (
              <>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 12, opacity: 0.6 }}>Window start</span>
                  <input
                    type="time"
                    value={suppWinStart}
                    onChange={(e) => setSuppWinStart(e.target.value)}
                    style={{ padding: 10, fontSize: 15 }}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 12, opacity: 0.6 }}>Window end</span>
                  <input
                    type="time"
                    value={suppWinEnd}
                    onChange={(e) => setSuppWinEnd(e.target.value)}
                    style={{ padding: 10, fontSize: 15 }}
                  />
                </label>
              </>
            )}

            {!isWindow && (
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 12, opacity: 0.6 }}>Offset (mins, e.g. −45)</span>
                <input
                  type="number"
                  value={suppOffset}
                  onChange={(e) => setSuppOffset(e.target.value)}
                  placeholder="-45"
                  style={{ padding: 10, fontSize: 15, width: 110 }}
                />
              </label>
            )}

            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, opacity: 0.6 }}>Sort order</span>
              <input
                type="number"
                value={suppSort}
                onChange={(e) => setSuppSort(e.target.value)}
                placeholder="0"
                style={{ padding: 10, fontSize: 15, width: 72 }}
              />
            </label>

            <button
              onClick={addTemplate}
              disabled={suppSaving}
              style={{ padding: "10px 20px", fontWeight: 800, alignSelf: "flex-end" }}
            >
              {suppSaving ? "Adding…" : "Add"}
            </button>
          </div>
          {suppMsg && <div style={{ marginTop: 10, fontSize: 13 }}>{suppMsg}</div>}
        </section>
      </div>
    </div>
  );
}
