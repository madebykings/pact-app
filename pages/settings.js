// pages/settings.js
import { useEffect, useMemo, useRef, useState } from "react";
import BottomNav from "../components/Nav";
import { supabase } from "../lib/supabaseClient";

const PRIMARY = "#5B4FE9";
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

const pageStyle = {
  background: "#f2f2f7",
  minHeight: "100vh",
  fontFamily: FONT,
  paddingBottom: 88,
};

const card = {
  background: "#fff",
  borderRadius: 18,
  padding: 18,
  marginBottom: 12,
  boxShadow: "0 1px 3px rgba(0,0,0,0.07)",
};

const inputStyle = {
  width: "100%",
  padding: "11px 13px",
  fontSize: 15,
  borderRadius: 11,
  border: "1.5px solid #e5e5ea",
  background: "#f9f9f9",
  boxSizing: "border-box",
  fontFamily: FONT,
};

const TONE_OPTIONS = [
  { value: "normal", label: "Normal" },
  { value: "brutal", label: "Brutal" },
  { value: "savage", label: "Savage" },
];

const ACTIVITY_FALLBACK = [
  { value: "WALK", label: "Walk" },
  { value: "RUN", label: "Run" },
  { value: "SPIN", label: "Spin" },
  { value: "HIIT", label: "HIIT" },
  { value: "SWIM", label: "Swim" },
  { value: "HILLWALK", label: "Hillwalk" },
  { value: "WEIGHTS", label: "Weights" },
  { value: "YOGA", label: "Yoga" },
  { value: "PILATES", label: "Pilates" },
  { value: "MOBILITY", label: "Mobility" },
  { value: "OTHER", label: "Other" },
];

function normalizeTime(t) {
  if (!t) return "";
  const m = /^([0-9]{1,2}):([0-9]{2})$/.exec(String(t).trim());
  if (!m) return "";
  const hh = String(Math.max(0, Math.min(23, Number(m[1])))).padStart(2, "0");
  const mm = String(Math.max(0, Math.min(59, Number(m[2])))).padStart(2, "0");
  return `${hh}:${mm}`;
}

function ruleLabel(s) {
  if (!s?.rule_type) return "Anytime";
  if (s.rule_type === "PRE_WORKOUT") {
    const off = Number(s.offset_minutes || 0);
    return `Pre-workout (${off < 0 ? "" : "+"}${off}m)`;
  }
  if (s.rule_type === "MORNING_WINDOW") return `Morning (${s.window_start || "06:00"}–${s.window_end || "10:00"})`;
  if (s.rule_type === "EVENING_WINDOW") return `Evening (${s.window_start || "17:00"}–${s.window_end || "21:00"})`;
  if (s.rule_type === "BED_WINDOW") return `Before bed (${s.window_start || "21:00"}–${s.window_end || "23:59"})`;
  return "Anytime";
}

async function ensureUserSettingsRow(userId) {
  const { data: existing, error: selErr } = await supabase
    .from("user_settings").select("user_id").eq("user_id", userId).maybeSingle();
  if (selErr) throw selErr;
  if (!existing) {
    const { error: insErr } = await supabase.from("user_settings").insert({
      user_id: userId, mode: "solo", tone: "normal",
      water_target_ml: 3000, sleep_target_hours: 8,
      reminder_times: ["08:00", "12:00", "18:00"],
      included_activities: ["WALK", "RUN", "SPIN", "SWIM", "HILLWALK", "WEIGHTS", "HIIT", "YOGA", "PILATES", "MOBILITY", "OTHER"],
      timezone: "Europe/London", target_weight_kg: null,
    });
    if (insErr) throw insErr;
  }
}

async function ensureProfileRow(userId) {
  const { data: existing, error } = await supabase
    .from("user_profiles").select("user_id").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!existing) {
    const { error: insErr } = await supabase.from("user_profiles").insert({ user_id: userId, display_name: "" });
    if (insErr) throw insErr;
  }
}

export default function Settings() {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(null);
  const [supps, setSupps] = useState([]);
  const [activityOptions, setActivityOptions] = useState(ACTIVITY_FALLBACK);
  const [err, setErr] = useState("");

  const [targetDraft, setTargetDraft] = useState("");
  const targetTimer = useRef(null);
  const [waterTargetDraft, setWaterTargetDraft] = useState("");
  const waterTargetTimer = useRef(null);
  const [sleepTargetDraft, setSleepTargetDraft] = useState("");
  const sleepTargetTimer = useRef(null);

  const [waSub, setWaSub] = useState(null);
  const [waPhone, setWaPhone] = useState("");
  const [waOptedIn, setWaOptedIn] = useState(false);
  const [waLoading, setWaLoading] = useState(false);
  const [waMsg, setWaMsg] = useState("");
  const [waTesting, setWaTesting] = useState(false);
  const [waTestMsg, setWaTestMsg] = useState("");

  const included = useMemo(() => new Set(settings?.included_activities || []), [settings?.included_activities]);

  useEffect(() => {
    // Load activity types from API (falls back to hardcoded if table not yet seeded)
    fetch("/api/activities")
      .then((r) => r.json())
      .then(({ activities }) => {
        if (activities?.length) {
          setActivityOptions(activities.map((a) => ({ value: a.key, label: a.label })));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;
        if (!data?.user) { window.location.href = "/"; return; }
        setUser(data.user);
        await ensureUserSettingsRow(data.user.id);
        await ensureProfileRow(data.user.id);
        await refresh(data.user.id);
      } catch (e) {
        setErr(e?.message || String(e));
      }
    })();
    return () => {
      if (targetTimer.current) clearTimeout(targetTimer.current);
      if (waterTargetTimer.current) clearTimeout(waterTargetTimer.current);
      if (sleepTargetTimer.current) clearTimeout(sleepTargetTimer.current);
    };
  }, []);

  async function refresh(userId) {
    const { data: stRaw, error: stErr } = await supabase
      .from("user_settings").select("*").eq("user_id", userId).maybeSingle();
    if (stErr) throw stErr;
    let st = stRaw || null;
    setSettings(st);
    setTargetDraft(st?.target_weight_kg ?? "");
    setWaterTargetDraft(st?.water_target_ml ?? 3000);
    setSleepTargetDraft(st?.sleep_target_hours ?? 8);

    const { data: s, error: sErr } = await supabase
      .from("supplements").select("*").eq("user_id", userId).order("name");
    if (!sErr) setSupps(s || []);

    const { data: acts, error: actsErr } = await supabase
      .from("activity_types").select("key,label").order("sort");
    if (!actsErr && acts?.length) {
      setActivityOptions(acts.map((a) => ({ value: a.key, label: a.label })));

      // Auto-include any new activities that aren't in the user's saved list
      const currentIncluded = new Set(st?.included_activities || []);
      const newKeys = acts.map((a) => a.key).filter((k) => !currentIncluded.has(k));
      if (newKeys.length > 0) {
        const updated = [...(st?.included_activities || []), ...newKeys];
        await supabase.from("user_settings").update({ included_activities: updated }).eq("user_id", userId);
        st = { ...st, included_activities: updated };
        setSettings(st);
      }
    }

    if (process.env.NEXT_PUBLIC_WHATSAPP_ENABLED === "true") {
      try {
        const { data: wa, error: waErr } = await supabase
          .from("whatsapp_subscriptions").select("phone_e164, opted_in")
          .eq("user_id", userId).maybeSingle();
        if (!waErr) {
          setWaSub(wa || null);
          setWaPhone(wa?.phone_e164 || "");
          setWaOptedIn(wa?.opted_in || false);
        }
      } catch { /* silently skip */ }
    }
  }

  async function saveWhatsappSub() {
    if (!user) return;
    setWaLoading(true); setWaMsg("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const jwt = session?.access_token;
      if (!jwt) throw new Error("Not authenticated");

      const phone = waPhone.trim();
      if (!phone) {
        await fetch("/api/whatsapp/subscribe", { method: "DELETE", headers: { Authorization: `Bearer ${jwt}` } });
        setWaSub(null); setWaOptedIn(false); setWaMsg("WhatsApp subscription removed.");
        return;
      }

      const res = await fetch("/api/whatsapp/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ phone, optedIn: waOptedIn }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setWaSub({ phone_e164: phone, opted_in: waOptedIn });
      setWaMsg(waOptedIn ? "WhatsApp reminders enabled." : "Phone saved (opt-in off).");
    } catch (e) {
      setWaMsg(`Error: ${e?.message || String(e)}`);
    } finally {
      setWaLoading(false);
    }
  }

  async function sendTestWhatsApp() {
    setWaTesting(true); setWaTestMsg("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const jwt = session?.access_token;
      if (!jwt) throw new Error("Not authenticated");
      const res = await fetch("/api/whatsapp/test-send", { method: "POST", headers: { Authorization: `Bearer ${jwt}` } });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setWaTestMsg(`Test message sent to ${body.phone} ✅`);
    } catch (e) {
      setWaTestMsg(`Failed: ${e?.message || String(e)}`);
    } finally {
      setWaTesting(false);
    }
  }

  async function saveSettings(patch) {
    if (!user) return;
    setSettings((prev) => ({ ...(prev || {}), ...patch }));
    const { error } = await supabase.from("user_settings").update(patch).eq("user_id", user.id);
    if (error) { alert(error.message); await refresh(user.id); return; }
    await refresh(user.id);
  }

  function scheduleTargetSave(val) {
    setTargetDraft(val);
    if (targetTimer.current) clearTimeout(targetTimer.current);
    targetTimer.current = setTimeout(() => saveTargetWeightKg(val), 500);
  }

  function scheduleWaterTargetSave(val) {
    setWaterTargetDraft(val);
    if (waterTargetTimer.current) clearTimeout(waterTargetTimer.current);
    waterTargetTimer.current = setTimeout(() => saveSettings({ water_target_ml: Number(val || 0) }), 500);
  }

  function scheduleSleepTargetSave(val) {
    setSleepTargetDraft(val);
    if (sleepTargetTimer.current) clearTimeout(sleepTargetTimer.current);
    sleepTargetTimer.current = setTimeout(() => saveSettings({ sleep_target_hours: Number(val || 0) }), 500);
  }

  async function saveTargetWeightKg(val) {
    if (!user) return;
    const s = String(val ?? "").trim();
    if (s === "") {
      const { error } = await supabase.from("user_settings").update({ target_weight_kg: null }).eq("user_id", user.id);
      if (error) alert(error.message);
      await refresh(user.id); return;
    }
    const n = Number(s);
    if (!Number.isFinite(n) || n < 30 || n > 250) return;
    const { error } = await supabase.from("user_settings").update({ target_weight_kg: n }).eq("user_id", user.id);
    if (error) { alert(error.message); await refresh(user.id); return; }
    await refresh(user.id);
  }

  async function toggleSupplementActive(s) {
    const { error } = await supabase.from("supplements").update({ active: !s.active }).eq("id", s.id);
    if (error) { alert(error.message); return; }
    await refresh(user.id);
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  if (err) {
    return (
      <div style={pageStyle}>
        <div style={{ padding: 18 }}><b>Error:</b> {err}</div>
        <BottomNav active="settings" />
      </div>
    );
  }

  if (!settings) {
    return (
      <div style={pageStyle}>
        <div style={{ padding: "40px 18px", textAlign: "center", color: "#8e8e93" }}>Loading…</div>
        <BottomNav active="settings" />
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <div style={{ padding: "24px 18px 8px" }}>
        <div style={{ fontSize: 28, fontWeight: 800, color: "#111", letterSpacing: -0.5 }}>Settings</div>
      </div>

      <div style={{ padding: "0 18px" }}>

        {/* Tone */}
        <div style={card}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#8e8e93", letterSpacing: 1, marginBottom: 10 }}>TONE</div>
          <div style={{ display: "flex", gap: 8, background: "#f2f2f7", borderRadius: 13, padding: 4 }}>
            {TONE_OPTIONS.map((o) => {
              const active = (settings.tone || "normal") === o.value;
              return (
                <button
                  key={o.value}
                  onClick={() => saveSettings({ tone: o.value })}
                  style={{
                    flex: 1, padding: "9px 0", fontWeight: 700, fontSize: 13,
                    border: "none", borderRadius: 10, cursor: "pointer", fontFamily: FONT,
                    background: active ? "#fff" : "transparent",
                    color: active ? PRIMARY : "#8e8e93",
                    boxShadow: active ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                  }}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Targets */}
        <div style={card}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#8e8e93", letterSpacing: 1, marginBottom: 14 }}>TARGETS</div>
          <div style={{ display: "grid", gap: 14 }}>
            {[
              { label: "Water (ml)", value: waterTargetDraft, onChange: scheduleWaterTargetSave, type: "number" },
              { label: "Sleep (hours)", value: sleepTargetDraft, onChange: scheduleSleepTargetSave, type: "number", step: "0.5" },
              { label: "Target weight (kg)", value: targetDraft, onChange: scheduleTargetSave, type: "number", step: "0.1", placeholder: "e.g. 95.0" },
            ].map((f) => (
              <div key={f.label}>
                <div style={{ fontSize: 13, color: "#555", marginBottom: 6 }}>{f.label}</div>
                <input
                  type={f.type}
                  step={f.step}
                  value={f.value}
                  placeholder={f.placeholder}
                  onChange={(e) => f.onChange(e.target.value)}
                  style={inputStyle}
                />
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10, fontSize: 12, color: "#8e8e93" }}>
            Saves automatically. Weight range: 30–250 kg.
          </div>
        </div>

        {/* Workout types */}
        <div style={card}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#8e8e93", letterSpacing: 1, marginBottom: 12 }}>
            WORKOUT TYPES
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {activityOptions.map((a) => {
              const on = included.has(a.value);
              return (
                <button
                  key={a.value}
                  onClick={() => {
                    const next = new Set(included);
                    on ? next.delete(a.value) : next.add(a.value);
                    saveSettings({ included_activities: Array.from(next) });
                  }}
                  style={{
                    padding: "8px 14px", fontWeight: 700, fontSize: 13,
                    border: "none", borderRadius: 20, cursor: "pointer", fontFamily: FONT,
                    background: on ? "rgba(91,79,233,0.1)" : "#f2f2f7",
                    color: on ? PRIMARY : "#8e8e93",
                  }}
                >
                  {a.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Supplements */}
        <div style={card}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#8e8e93", letterSpacing: 1, marginBottom: 12 }}>
            SUPPLEMENTS
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {supps.map((s) => (
              <button
                key={s.id}
                onClick={() => toggleSupplementActive(s)}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "11px 13px", borderRadius: 13, border: "none",
                  cursor: "pointer", textAlign: "left", fontFamily: FONT,
                  background: s.active ? "rgba(91,79,233,0.07)" : "#f9f9f9",
                }}
              >
                <div style={{
                  width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                  background: s.active ? PRIMARY : "#e5e5ea",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {s.active && <span style={{ color: "#fff", fontSize: 11, fontWeight: 900 }}>✓</span>}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: s.active ? "#111" : "#8e8e93" }}>{s.name}</div>
                  <div style={{ fontSize: 12, color: "#8e8e93", marginTop: 1 }}>{ruleLabel(s)}</div>
                </div>
              </button>
            ))}
            {supps.length === 0 && <div style={{ color: "#8e8e93", fontSize: 14 }}>No supplements found.</div>}
          </div>
        </div>

        {/* WhatsApp reminders */}
        <div style={card}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#8e8e93", letterSpacing: 1, marginBottom: 14 }}>
            WHATSAPP REMINDERS
          </div>
          <div style={{ fontSize: 13, color: "#555", marginBottom: 6 }}>Phone number (E.164)</div>
          <input
            type="tel"
            value={waPhone}
            onChange={(e) => { setWaPhone(e.target.value); setWaMsg(""); }}
            placeholder="+447700900123"
            style={{ ...inputStyle, marginBottom: 4 }}
          />
          <div style={{ fontSize: 12, color: "#8e8e93", marginBottom: 14 }}>
            Include country code, e.g. +44. Leave blank to remove.
          </div>

          <label style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={waOptedIn}
              onChange={(e) => { setWaOptedIn(e.target.checked); setWaMsg(""); }}
              style={{ width: 18, height: 18 }}
            />
            <span style={{ fontSize: 14 }}>I consent to receive WhatsApp reminders</span>
          </label>

          <button
            onClick={saveWhatsappSub}
            disabled={waLoading}
            style={{
              width: "100%", padding: 13, fontWeight: 800, fontSize: 15,
              background: PRIMARY, color: "#fff", border: "none",
              borderRadius: 13, cursor: "pointer", fontFamily: FONT,
            }}
          >
            {waLoading ? "Saving…" : "Save WhatsApp settings"}
          </button>

          {waMsg && <div style={{ marginTop: 10, fontSize: 13, color: "#555" }}>{waMsg}</div>}

          {waSub?.opted_in && (
            <>
              <div style={{ marginTop: 10, fontSize: 12, color: "#8e8e93" }}>
                Active for: <b>{waSub.phone_e164}</b>
              </div>
              <button
                onClick={sendTestWhatsApp}
                disabled={waTesting}
                style={{
                  width: "100%", padding: 12, marginTop: 12, fontWeight: 700, fontSize: 14,
                  background: "#f2f2f7", color: "#111", border: "none",
                  borderRadius: 13, cursor: "pointer", fontFamily: FONT,
                }}
              >
                {waTesting ? "Sending…" : "Send test message"}
              </button>
              {waTestMsg && <div style={{ marginTop: 8, fontSize: 13, color: "#555" }}>{waTestMsg}</div>}
            </>
          )}

          <div style={{ marginTop: 14, fontSize: 12, color: "#8e8e93" }}>
            WhatsApp reminders will be sent from <b>+447360269111</b>. Save your number and opt in above to receive them.
          </div>
        </div>

        {/* Sign out */}
        <div style={{ ...card, marginBottom: 24 }}>
          <div style={{ fontSize: 13, color: "#8e8e93", marginBottom: 14 }}>{user?.email}</div>
          <button
            onClick={logout}
            style={{
              width: "100%", padding: 14, fontWeight: 800, fontSize: 15,
              background: "rgba(255,69,58,0.1)", color: "#ff453a",
              border: "none", borderRadius: 13, cursor: "pointer", fontFamily: FONT,
            }}
          >
            Sign out
          </button>
        </div>

      </div>

      <BottomNav active="settings" />
    </div>
  );
}
