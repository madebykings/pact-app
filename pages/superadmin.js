// pages/superadmin.js
// Superadmin panel — accessible only to the user whose email matches NEXT_PUBLIC_SUPERADMIN_EMAIL.
// Manages: activity types, supplement templates, notification message templates, Twilio config.

import { useEffect, useState } from "react";
import TopNav from "../components/Nav";
import { supabase } from "../lib/supabaseClient";

const PRIMARY = "#5B4FE9";

const RULE_TYPE_OPTIONS = [
  { value: "MORNING_WINDOW",  label: "Morning window",  defaults: { start: "06:00", end: "10:00" } },
  { value: "MIDDAY_WINDOW",   label: "Midday window",   defaults: { start: "10:00", end: "16:00" } },
  { value: "EVENING_WINDOW",  label: "Evening window",  defaults: { start: "18:00", end: "23:59" } },
  { value: "BED_WINDOW",      label: "Before bed",      defaults: { start: "21:00", end: "23:59" } },
  { value: "PRE_WORKOUT",     label: "Pre-workout",     defaults: {} },
  { value: "POST_WORKOUT",    label: "Post-workout",    defaults: {} },
];

const TRIGGER_TYPES = [
  {
    key: "pre_workout",
    label: "30 mins before workout",
    desc: 'Sent when planned_time is 30 mins away. Variables: {name} {workout}',
  },
  {
    key: "teammate_done",
    label: "Teammate finished, you haven't",
    desc: 'Sent when a teammate logs workout_done and you haven\'t. Variables: {name} {teammate}',
  },
  {
    key: "supplement_due",
    label: "Supplements due",
    desc: 'Sent 30 mins before a supplement window opens. Variables: {name} {supplements}',
  },
  {
    key: "eod_incomplete",
    label: "End of day — workout not done",
    desc: 'Sent at 21:00 local time if workout still pending. Variables: {name}',
  },
];

const TONES = ["normal", "brutal", "savage"];

const DEFAULT_TEMPLATES = {
  pre_workout: {
    normal: "Hey {name}! Your {workout} starts in 30 mins. You committed to it — now let's get at it 💪",
    brutal: "{name}. {workout} in 30 mins. You committed to it. Get up.",
    savage: "{name}, {workout} is in 30. You said you would. Don't be the person who doesn't show up.",
  },
  teammate_done: {
    normal: "Hey {name} — {teammate} just finished their workout. You haven't done yours yet. Get moving!",
    brutal: "{name} — {teammate}'s complete. You're not. That's a problem. Fix it.",
    savage: "{name}, {teammate}'s complete and you're not. They're pulling ahead. Embarrassing.",
  },
  supplement_due: {
    normal: "Hey {name}! Time to take: {supplements} 💊 Don't skip them.",
    brutal: "{name}. Supplements now: {supplements}. Don't skip.",
    savage: "{name}, {supplements}. Right now. What are you waiting for?",
  },
  eod_incomplete: {
    normal: "Hey {name}, day's almost done and you haven't logged your workout — you're missing out on points!",
    brutal: "{name}. Day's ending. Workout not done. You're leaving points on the table.",
    savage: "{name}, you're missing out on points while your teammates rack them up. Your call.",
  },
};

function windowLabel(t) {
  if (t.rule_type === "PRE_WORKOUT")  return `${Math.abs(t.offset_minutes || 0)}m before workout`;
  if (t.rule_type === "POST_WORKOUT") return "After workout";
  if (t.window_start) return `${t.window_start} – ${t.window_end}`;
  return "—";
}

const sectionStyle = { marginBottom: 48 };
const h2Style = { margin: "0 0 16px", fontSize: 20, fontWeight: 800 };
const tableStyle = { width: "100%", borderCollapse: "collapse", marginBottom: 16, fontSize: 14 };
const thStyle = { padding: "4px 10px", opacity: 0.55, textAlign: "left", fontWeight: 600 };
const tdStyle = { padding: "10px 10px", borderTop: "1px solid rgba(0,0,0,.07)" };
const inputBase = { padding: "9px 12px", fontSize: 14, borderRadius: 8, border: "1.5px solid #e5e5ea", background: "#f9f9f9", fontFamily: "system-ui" };

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

  // Notification message templates
  // notifTemplates: { [triggerType]: { [tone]: string } }
  const [notifTemplates, setNotifTemplates] = useState(
    JSON.parse(JSON.stringify(DEFAULT_TEMPLATES))
  );
  const [notifMsg, setNotifMsg] = useState({});    // { [triggerType]: string }
  const [notifSaving, setNotifSaving] = useState({}); // { [triggerType]: bool }
  const [notifTableExists, setNotifTableExists] = useState(null);

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

  function handleRuleChange(val) {
    setSuppRule(val);
    const opt = RULE_TYPE_OPTIONS.find((o) => o.value === val);
    if (opt?.defaults?.start) {
      setSuppWinStart(opt.defaults.start);
      setSuppWinEnd(opt.defaults.end);
    }
  }

  async function getJwt() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token;
  }

  async function refreshAll() {
    const jwt = await getJwt();
    const headers = { Authorization: `Bearer ${jwt}` };

    // Activities — use public API endpoint (no auth needed)
    const { data: acts } = await supabase.from("activity_types").select("*").order("sort");
    setActivities(acts || []);

    // Supplement templates
    const { data: tmpl } = await supabase.from("supplement_templates").select("*").order("sort");
    setTemplates(tmpl || []);

    // Notification templates (via admin API)
    try {
      const r = await fetch("/api/admin/notification-templates", { headers });
      const body = await r.json();
      setNotifTableExists(body.tableExists ?? true);
      const merged = JSON.parse(JSON.stringify(DEFAULT_TEMPLATES));
      for (const t of body.templates || []) {
        if (merged[t.trigger_type]) merged[t.trigger_type][t.tone] = t.template;
      }
      setNotifTemplates(merged);
    } catch {
      setNotifTableExists(false);
    }
  }

  // ── Activities ──────────────────────────────────────────────────────────────

  async function addActivity() {
    if (!actKey.trim() || !actLabel.trim()) {
      setActMsg("Both key and label are required.");
      return;
    }
    setActSaving(true); setActMsg("");
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
    setSuppSaving(true); setSuppMsg("");
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

  // ── Notification message templates ──────────────────────────────────────────

  async function saveNotifTemplate(triggerType) {
    setNotifSaving((s) => ({ ...s, [triggerType]: true }));
    setNotifMsg((m) => ({ ...m, [triggerType]: "" }));
    try {
      const jwt = await getJwt();
      const toneData = notifTemplates[triggerType];
      for (const tone of TONES) {
        const template = toneData[tone]?.trim();
        if (!template) continue;
        const res = await fetch("/api/admin/notification-templates", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
          body: JSON.stringify({ trigger_type: triggerType, tone, template }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error);
      }
      setNotifMsg((m) => ({ ...m, [triggerType]: "Saved." }));
    } catch (e) {
      setNotifMsg((m) => ({ ...m, [triggerType]: `Error: ${e?.message || String(e)}` }));
    } finally {
      setNotifSaving((s) => ({ ...s, [triggerType]: false }));
    }
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
  const waEnabled = process.env.NEXT_PUBLIC_WHATSAPP_ENABLED === "true";

  return (
    <div style={{ fontFamily: "system-ui" }}>
      <TopNav onLogout={logout} />

      <div style={{ padding: "18px 18px 60px", maxWidth: 860, margin: "0 auto" }}>
        <h1 style={{ margin: "0 0 4px", fontSize: 26, fontWeight: 800 }}>Super Admin</h1>
        <div style={{ marginBottom: 32, fontSize: 13, opacity: 0.55 }}>{user?.email}</div>

        {/* ── WhatsApp / Twilio Setup ──────────────────────────────────────── */}
        <section style={sectionStyle}>
          <h2 style={h2Style}>WhatsApp / Twilio Setup</h2>
          <div style={{ background: waEnabled ? "rgba(52,199,89,0.08)" : "#fff8e6", border: `1.5px solid ${waEnabled ? "rgba(52,199,89,0.3)" : "#f0a000"}`, borderRadius: 14, padding: 18, fontSize: 14, lineHeight: 1.7 }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>
              {waEnabled ? "✅ WhatsApp enabled" : "⚠️ WhatsApp not enabled"}
            </div>
            <p style={{ margin: "0 0 12px", opacity: 0.8 }}>
              Set these environment variables on your server (not NEXT_PUBLIC — they must stay secret):
            </p>
            <table style={{ ...tableStyle, marginBottom: 0, fontSize: 13, fontFamily: "monospace" }}>
              <tbody>
                {[
                  ["WHATSAPP_ENABLED",      "true", "Gates all WhatsApp sending"],
                  ["NEXT_PUBLIC_WHATSAPP_ENABLED", "true", "Shows WhatsApp UI in settings"],
                  ["TWILIO_ACCOUNT_SID",    "ACxxxxxxx…", "From Twilio Console → Account Info"],
                  ["TWILIO_AUTH_TOKEN",     "xxxxxxx…",   "From Twilio Console → Account Info"],
                  ["TWILIO_WHATSAPP_FROM",  "whatsapp:+14155238886", "Sandbox: join keyword number. Production: your approved sender"],
                  ["CRON_SECRET",           "any-secret", "Passed as ?secret= when calling /api/cron/send-reminders"],
                  ["SUPERADMIN_EMAIL",      "your@email.com", "Server-side check for admin API routes (no NEXT_PUBLIC prefix)"],
                ].map(([key, example, note]) => (
                  <tr key={key} style={{ borderTop: "1px solid rgba(0,0,0,.07)" }}>
                    <td style={{ ...tdStyle, fontWeight: 700, paddingLeft: 0, whiteSpace: "nowrap" }}>{key}</td>
                    <td style={{ ...tdStyle, opacity: 0.5 }}>{example}</td>
                    <td style={{ ...tdStyle, fontFamily: "system-ui", opacity: 0.7, fontSize: 12 }}>{note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ margin: "14px 0 0", fontSize: 12, opacity: 0.7 }}>
              <b>Sandbox first:</b> Go to Twilio Console → Messaging → Try WhatsApp. Your users must text the sandbox join keyword before messages will deliver. Once you have an approved WhatsApp Business sender, update TWILIO_WHATSAPP_FROM.
            </p>
          </div>
        </section>

        {/* ── Notification Message Templates ──────────────────────────────── */}
        <section style={sectionStyle}>
          <h2 style={h2Style}>Notification Messages</h2>
          {notifTableExists === false && (
            <div style={{ background: "#fff8e6", border: "1.5px solid #f0a000", borderRadius: 12, padding: 14, marginBottom: 18, fontSize: 13 }}>
              <b>Table not created yet.</b> Run this SQL in Supabase → SQL Editor to enable saving:
              <pre style={{ margin: "10px 0 0", fontSize: 11, background: "#f9f9f9", padding: 10, borderRadius: 8, overflowX: "auto" }}>{`CREATE TABLE notification_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_type  TEXT NOT NULL CHECK (trigger_type IN ('pre_workout','teammate_done','supplement_due','eod_incomplete')),
  tone          TEXT NOT NULL CHECK (tone IN ('normal','brutal','savage')),
  template      TEXT NOT NULL,
  UNIQUE (trigger_type, tone),
  created_at    TIMESTAMPTZ DEFAULT now()
);
-- No public read needed (admin API uses service role)
ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;`}</pre>
            </div>
          )}
          <p style={{ margin: "0 0 20px", fontSize: 13, opacity: 0.65 }}>
            Four automatic triggers replace manual reminder times. Each has three tone variants matching the user's tone setting in their preferences. Use <code>{"{name}"}</code>, <code>{"{workout}"}</code>, <code>{"{supplements}"}</code>, <code>{"{teammate}"}</code> as variables.
          </p>

          {TRIGGER_TYPES.map((trigger) => (
            <div
              key={trigger.key}
              style={{ border: "1.5px solid #e5e5ea", borderRadius: 14, padding: 18, marginBottom: 16 }}
            >
              <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>{trigger.label}</div>
              <div style={{ fontSize: 12, opacity: 0.55, marginBottom: 16 }}>{trigger.desc}</div>

              <div style={{ display: "grid", gap: 12 }}>
                {TONES.map((tone) => (
                  <div key={tone}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#8e8e93", letterSpacing: 0.5, marginBottom: 6, textTransform: "uppercase" }}>
                      {tone}
                    </div>
                    <textarea
                      value={notifTemplates[trigger.key]?.[tone] || ""}
                      onChange={(e) =>
                        setNotifTemplates((prev) => ({
                          ...prev,
                          [trigger.key]: { ...prev[trigger.key], [tone]: e.target.value },
                        }))
                      }
                      rows={2}
                      style={{ ...inputBase, width: "100%", boxSizing: "border-box", resize: "vertical" }}
                    />
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
                <button
                  onClick={() => saveNotifTemplate(trigger.key)}
                  disabled={notifSaving[trigger.key]}
                  style={{ padding: "9px 22px", fontWeight: 800, fontSize: 13, background: PRIMARY, color: "#fff", border: "none", borderRadius: 10, cursor: "pointer" }}
                >
                  {notifSaving[trigger.key] ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={() =>
                    setNotifTemplates((prev) => ({
                      ...prev,
                      [trigger.key]: { ...DEFAULT_TEMPLATES[trigger.key] },
                    }))
                  }
                  style={{ padding: "9px 16px", fontWeight: 600, fontSize: 13, background: "#f2f2f7", color: "#555", border: "none", borderRadius: 10, cursor: "pointer" }}
                >
                  Reset to defaults
                </button>
                {notifMsg[trigger.key] && (
                  <span style={{ fontSize: 13, color: notifMsg[trigger.key].startsWith("Error") ? "#c00" : "#34c759" }}>
                    {notifMsg[trigger.key]}
                  </span>
                )}
              </div>
            </div>
          ))}
        </section>

        {/* ── Activity Types ───────────────────────────────────────────────── */}
        <section style={sectionStyle}>
          <h2 style={h2Style}>Activity Types</h2>
          <p style={{ margin: "0 0 14px", fontSize: 13, opacity: 0.65 }}>
            These sync to the workout type picker in user settings. If this table is empty the app falls back to built-in defaults. Run the SQL below to create the table if needed.
          </p>

          {activities.length === 0 && (
            <div style={{ background: "#fff8e6", border: "1.5px solid #f0a000", borderRadius: 12, padding: 14, marginBottom: 16, fontSize: 13 }}>
              <b>No activity types found.</b> If the table doesn't exist yet, create it:
              <pre style={{ margin: "10px 0 0", fontSize: 11, background: "#f9f9f9", padding: 10, borderRadius: 8, overflowX: "auto" }}>{`CREATE TABLE activity_types (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key   TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  sort  INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE activity_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read" ON activity_types FOR SELECT USING (true);`}</pre>
            </div>
          )}

          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Key</th>
                <th style={thStyle}>Label</th>
                <th style={thStyle}>Sort</th>
                <th style={thStyle} />
              </tr>
            </thead>
            <tbody>
              {activities.map((a) => (
                <tr key={a.id}>
                  <td style={{ ...tdStyle, fontFamily: "monospace", fontWeight: 700 }}>{a.key}</td>
                  <td style={tdStyle}>{a.label}</td>
                  <td style={{ ...tdStyle, opacity: 0.5 }}>{a.sort}</td>
                  <td style={tdStyle}>
                    <button onClick={() => removeActivity(a.id)} style={{ color: "#c00", background: "none", border: "none", cursor: "pointer", fontSize: 13 }}>Remove</button>
                  </td>
                </tr>
              ))}
              {activities.length === 0 && (
                <tr><td colSpan={4} style={{ ...tdStyle, opacity: 0.45 }}>No activity types yet.</td></tr>
              )}
            </tbody>
          </table>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, opacity: 0.6 }}>Key (e.g. SPIN)</span>
              <input value={actKey} onChange={(e) => { setActKey(e.target.value.toUpperCase()); setActMsg(""); }} placeholder="SPIN" style={{ ...inputBase, width: 120, fontFamily: "monospace" }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, opacity: 0.6 }}>Label</span>
              <input value={actLabel} onChange={(e) => { setActLabel(e.target.value); setActMsg(""); }} placeholder="Spin" style={{ ...inputBase, width: 160 }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, opacity: 0.6 }}>Sort order</span>
              <input type="number" value={actSort} onChange={(e) => setActSort(e.target.value)} placeholder="0" style={{ ...inputBase, width: 72 }} />
            </label>
            <button onClick={addActivity} disabled={actSaving} style={{ padding: "9px 22px", fontWeight: 800, alignSelf: "flex-end", background: PRIMARY, color: "#fff", border: "none", borderRadius: 10, cursor: "pointer" }}>
              {actSaving ? "Adding…" : "Add"}
            </button>
          </div>
          {actMsg && <div style={{ marginTop: 10, fontSize: 13, color: actMsg.startsWith("Error") ? "#c00" : "#34c759" }}>{actMsg}</div>}
        </section>

        {/* ── Supplement Templates ─────────────────────────────────────────── */}
        <section style={sectionStyle}>
          <h2 style={h2Style}>Supplement Templates</h2>
          <p style={{ margin: "0 0 14px", fontSize: 13, opacity: 0.65 }}>
            Default supplements seeded for new users on first dashboard load. Existing users are not affected when templates change.
          </p>

          {templates.length === 0 && (
            <div style={{ background: "#fff8e6", border: "1.5px solid #f0a000", borderRadius: 12, padding: 14, marginBottom: 16, fontSize: 13 }}>
              <b>No supplement templates found.</b> If the table doesn't exist:
              <pre style={{ margin: "10px 0 0", fontSize: 11, background: "#f9f9f9", padding: 10, borderRadius: 8, overflowX: "auto" }}>{`CREATE TABLE supplement_templates (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  rule_type      TEXT NOT NULL,
  window_start   TEXT,
  window_end     TEXT,
  offset_minutes INTEGER,
  sort           INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE supplement_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read" ON supplement_templates FOR SELECT USING (true);`}</pre>
            </div>
          )}

          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Rule</th>
                <th style={thStyle}>Window / Offset</th>
                <th style={thStyle}>Sort</th>
                <th style={thStyle} />
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id}>
                  <td style={{ ...tdStyle, fontWeight: 700 }}>{t.name}</td>
                  <td style={{ ...tdStyle, fontSize: 13, opacity: 0.75 }}>{t.rule_type}</td>
                  <td style={{ ...tdStyle, fontSize: 13, opacity: 0.65 }}>{windowLabel(t)}</td>
                  <td style={{ ...tdStyle, opacity: 0.5 }}>{t.sort}</td>
                  <td style={tdStyle}>
                    <button onClick={() => removeTemplate(t.id)} style={{ color: "#c00", background: "none", border: "none", cursor: "pointer", fontSize: 13 }}>Remove</button>
                  </td>
                </tr>
              ))}
              {templates.length === 0 && (
                <tr><td colSpan={5} style={{ ...tdStyle, opacity: 0.45 }}>No supplement templates yet.</td></tr>
              )}
            </tbody>
          </table>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, opacity: 0.6 }}>Name</span>
              <input value={suppName} onChange={(e) => { setSuppName(e.target.value); setSuppMsg(""); }} placeholder="Creatine" style={{ ...inputBase, width: 180 }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, opacity: 0.6 }}>Rule type</span>
              <select value={suppRule} onChange={(e) => handleRuleChange(e.target.value)} style={{ ...inputBase }}>
                {RULE_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            {isWindow && (
              <>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 12, opacity: 0.6 }}>Window start</span>
                  <input type="time" value={suppWinStart} onChange={(e) => setSuppWinStart(e.target.value)} style={inputBase} />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 12, opacity: 0.6 }}>Window end</span>
                  <input type="time" value={suppWinEnd} onChange={(e) => setSuppWinEnd(e.target.value)} style={inputBase} />
                </label>
              </>
            )}
            {!isWindow && (
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 12, opacity: 0.6 }}>Offset (mins, e.g. −45)</span>
                <input type="number" value={suppOffset} onChange={(e) => setSuppOffset(e.target.value)} placeholder="-45" style={{ ...inputBase, width: 110 }} />
              </label>
            )}
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, opacity: 0.6 }}>Sort order</span>
              <input type="number" value={suppSort} onChange={(e) => setSuppSort(e.target.value)} placeholder="0" style={{ ...inputBase, width: 72 }} />
            </label>
            <button onClick={addTemplate} disabled={suppSaving} style={{ padding: "9px 22px", fontWeight: 800, alignSelf: "flex-end", background: PRIMARY, color: "#fff", border: "none", borderRadius: 10, cursor: "pointer" }}>
              {suppSaving ? "Adding…" : "Add"}
            </button>
          </div>
          {suppMsg && <div style={{ marginTop: 10, fontSize: 13, color: suppMsg.startsWith("Error") ? "#c00" : "#34c759" }}>{suppMsg}</div>}
        </section>
      </div>
    </div>
  );
}
