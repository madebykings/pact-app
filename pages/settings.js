// pages/settings.js
import { useEffect, useMemo, useRef, useState } from "react";
import TopNav from "../components/Nav";
import { supabase } from "../lib/supabaseClient";

const TONE_OPTIONS = [
  { value: "normal", label: "Normal" },
  { value: "brutal", label: "Brutal" },
  { value: "savage", label: "Savage" },
];

const ACTIVITY_OPTIONS = [
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
    const sign = off < 0 ? "" : "+";
    return `Pre-workout (${sign}${off}m)`;
  }
  if (s.rule_type === "MORNING_WINDOW") return `Morning (${s.window_start || "06:00"}–${s.window_end || "10:00"})`;
  if (s.rule_type === "EVENING_WINDOW") return `Evening (${s.window_start || "17:00"}–${s.window_end || "21:00"})`;
  if (s.rule_type === "BED_WINDOW") return `Before bed (${s.window_start || "21:00"}–${s.window_end || "23:59"})`;
  return "Anytime";
}

async function ensureUserSettingsRow(userId) {
  const { data: existing, error: selErr } = await supabase
    .from("user_settings")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (selErr) throw selErr;

  if (!existing) {
    const { error: insErr } = await supabase.from("user_settings").insert({
      user_id: userId,
      mode: "solo",
      tone: "normal",
      water_target_ml: 3000,
      sleep_target_hours: 8,
      reminder_times: ["08:00", "12:00", "18:00"],
      included_activities: ["WALK", "RUN", "SPIN", "SWIM", "HILLWALK", "WEIGHTS", "HIIT", "YOGA", "PILATES", "MOBILITY", "OTHER"],
      timezone: "Europe/London",
      target_weight_kg: null,
    });
    if (insErr) throw insErr;
  }
}

async function ensureProfileRow(userId) {
  const { data: existing, error } = await supabase
    .from("user_profiles")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
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
  const [err, setErr] = useState("");

  const [targetDraft, setTargetDraft] = useState("");
  const targetTimer = useRef(null);

  const [waterTargetDraft, setWaterTargetDraft] = useState("");
  const waterTargetTimer = useRef(null);

  const [sleepTargetDraft, setSleepTargetDraft] = useState("");
  const sleepTargetTimer = useRef(null);

  // WhatsApp subscription state (only used when NEXT_PUBLIC_WHATSAPP_ENABLED=true)
  const [waSub, setWaSub] = useState(null);       // { phone_e164, opted_in } | null
  const [waPhone, setWaPhone] = useState("");
  const [waOptedIn, setWaOptedIn] = useState(false);
  const [waLoading, setWaLoading] = useState(false);
  const [waMsg, setWaMsg] = useState("");
  const [waTesting, setWaTesting] = useState(false);
  const [waTestMsg, setWaTestMsg] = useState("");

  const reminderTimes = useMemo(() => {
    const t = settings?.reminder_times;
    if (!Array.isArray(t) || t.length === 0) return ["08:00", "12:00", "18:00"];
    const norm = t.map(normalizeTime).filter(Boolean);
    return (norm.length ? norm : ["08:00", "12:00", "18:00"]).slice(0, 5);
  }, [settings?.reminder_times]);

  const included = useMemo(() => new Set(settings?.included_activities || []), [settings?.included_activities]);

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;
        if (!data?.user) {
          window.location.href = "/";
          return;
        }

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
    const { data: st, error: stErr } = await supabase.from("user_settings").select("*").eq("user_id", userId).maybeSingle();
    if (stErr) throw stErr;
    setSettings(st || null);
    setTargetDraft(st?.target_weight_kg ?? "");
    setWaterTargetDraft(st?.water_target_ml ?? 3000);
    setSleepTargetDraft(st?.sleep_target_hours ?? 8);

    const { data: s, error: sErr } = await supabase.from("supplements").select("*").eq("user_id", userId).order("name");
    if (!sErr) setSupps(s || []);

    // Load WhatsApp subscription if feature is enabled.
    // Wrapped in try/catch: if the migration hasn't been applied yet the table won't
    // exist and we don't want that to crash the whole settings page.
    if (process.env.NEXT_PUBLIC_WHATSAPP_ENABLED === "true") {
      try {
        const { data: wa, error: waErr } = await supabase
          .from("whatsapp_subscriptions")
          .select("phone_e164, opted_in")
          .eq("user_id", userId)
          .maybeSingle();
        if (!waErr) {
          setWaSub(wa || null);
          setWaPhone(wa?.phone_e164 || "");
          setWaOptedIn(wa?.opted_in || false);
        } else {
          console.warn("WhatsApp subscriptions unavailable (migration not applied?):", waErr.message);
        }
      } catch {
        // Silently skip — WA section will display empty
      }
    }
  }

  async function saveWhatsappSub() {
    if (!user) return;
    setWaLoading(true);
    setWaMsg("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const jwt = session?.access_token;
      if (!jwt) throw new Error("Not authenticated");

      const phone = waPhone.trim();
      if (!phone) {
        // Remove subscription
        await fetch("/api/whatsapp/subscribe", {
          method: "DELETE",
          headers: { Authorization: `Bearer ${jwt}` },
        });
        setWaSub(null);
        setWaOptedIn(false);
        setWaMsg("WhatsApp subscription removed.");
        return;
      }

      const res = await fetch("/api/whatsapp/subscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
        },
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
    setWaTesting(true);
    setWaTestMsg("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const jwt = session?.access_token;
      if (!jwt) throw new Error("Not authenticated");

      const res = await fetch("/api/whatsapp/test-send", {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}` },
      });

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
    if (error) {
      alert(error.message);
      await refresh(user.id);
      return;
    }
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
      await refresh(user.id);
      return;
    }

    const n = Number(s);
    if (!Number.isFinite(n)) return;
    if (n < 30 || n > 250) return; // DB constraint

    const { error } = await supabase.from("user_settings").update({ target_weight_kg: n }).eq("user_id", user.id);
    if (error) {
      alert(error.message);
      await refresh(user.id);
      return;
    }
    await refresh(user.id);
  }

  async function toggleSupplementActive(s) {
    const { error } = await supabase.from("supplements").update({ active: !s.active }).eq("id", s.id);
    if (error) {
      alert(error.message);
      return;
    }
    await refresh(user.id);
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  if (err) {
    return (
      <div>
        <TopNav active="settings" onLogout={logout} />
        <div style={{ padding: 18, maxWidth: 980, margin: "0 auto" }}>
          <h1 style={{ margin: "0 0 14px" }}>Settings</h1>
          <div><b>Error:</b> {err}</div>
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div>
        <TopNav active="settings" onLogout={logout} />
        <div style={{ padding: 18, maxWidth: 980, margin: "0 auto" }}>Loading…</div>
      </div>
    );
  }

  return (
    <div>
      <TopNav active="settings" onLogout={logout} />

      <div style={{ padding: 18, maxWidth: 980, margin: "0 auto" }}>
        <h1 style={{ margin: "0 0 14px" }}>Settings</h1>

        {/* Tone */}
        <div style={{ padding: 14, border: "1px solid rgba(0,0,0,.08)", borderRadius: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 14, opacity: 0.8 }}>Tone</div>
          <select
            value={settings.tone || "normal"}
            onChange={(e) => saveSettings({ tone: e.target.value })}
            style={{ width: "100%", padding: 12, fontSize: 16, marginTop: 10 }}
          >
            {TONE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {/* Reminder Times */}
        <div style={{ padding: 14, border: "1px solid rgba(0,0,0,.08)", borderRadius: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 14, opacity: 0.8 }}>
            Reminder times
            <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.6 }}>— sent via WhatsApp</span>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
            {reminderTimes.map((t, i) => (
              <input
                key={i}
                type="time"
                value={t}
                onChange={(e) => {
                  const next = [...reminderTimes];
                  next[i] = normalizeTime(e.target.value);
                  saveSettings({ reminder_times: next });
                }}
                style={{ padding: 10, fontSize: 16 }}
              />
            ))}
          </div>
        </div>

        {/* Targets */}
        <div style={{ padding: 14, border: "1px solid rgba(0,0,0,.08)", borderRadius: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 14, opacity: 0.8 }}>Targets</div>

          <div style={{ display: "grid", gap: 12, marginTop: 10 }}>
            <div>
              <div style={{ fontSize: 13, opacity: 0.75 }}>Water target (ml)</div>
              <input
                type="number"
                value={waterTargetDraft}
                onChange={(e) => scheduleWaterTargetSave(e.target.value)}
                style={{ width: "100%", padding: 12, fontSize: 16, marginTop: 6 }}
              />
            </div>

            <div>
              <div style={{ fontSize: 13, opacity: 0.75 }}>Sleep target (hours)</div>
              <input
                type="number"
                step="0.5"
                value={sleepTargetDraft}
                onChange={(e) => scheduleSleepTargetSave(e.target.value)}
                style={{ width: "100%", padding: 12, fontSize: 16, marginTop: 6 }}
              />
            </div>

            <div>
              <div style={{ fontSize: 13, opacity: 0.75 }}>Target weight (kg)</div>
              <input
                type="number"
                step="0.1"
                value={targetDraft}
                onChange={(e) => scheduleTargetSave(e.target.value)}
                style={{ width: "100%", padding: 12, fontSize: 16, marginTop: 6 }}
                placeholder="e.g. 95.0"
              />
              <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
                Saves after you stop typing. Valid range: 30–250kg.
              </div>
            </div>
          </div>
        </div>

        {/* Workout Types */}
        <div style={{ padding: 14, border: "1px solid rgba(0,0,0,.08)", borderRadius: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 14, opacity: 0.8 }}>Workout types shown</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
            {ACTIVITY_OPTIONS.map((a) => {
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
                    padding: "10px 12px",
                    border: "1px solid rgba(0,0,0,.08)",
                    borderRadius: 12,
                    opacity: on ? 1 : 0.45,
                    fontWeight: 800,
                  }}
                >
                  {on ? "✅" : "⬜"} {a.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Supplements */}
        <div style={{ padding: 14, border: "1px solid rgba(0,0,0,.08)", borderRadius: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 14, opacity: 0.8 }}>Supplements on dashboard</div>
          <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
            {supps.map((s) => (
              <button
                key={s.id}
                onClick={() => toggleSupplementActive(s)}
                style={{
                  padding: 12,
                  textAlign: "left",
                  border: "1px solid rgba(0,0,0,.08)",
                  borderRadius: 12,
                  opacity: s.active ? 1 : 0.4,
                }}
              >
                <div style={{ fontWeight: 900 }}>
                  {s.active ? "✅" : "⬜"} {s.name}
                </div>
                <div style={{ marginTop: 4, fontSize: 12, opacity: 0.75 }}>{ruleLabel(s)}</div>
              </button>
            ))}
            {supps.length === 0 && <div style={{ opacity: 0.7 }}>No supplements found.</div>}
          </div>
        </div>

        {/* WhatsApp reminders */}
        <div style={{ padding: 14, border: "1px solid rgba(0,0,0,.08)", borderRadius: 12 }}>
            <div style={{ fontSize: 14, opacity: 0.8 }}>WhatsApp reminders</div>

            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13, opacity: 0.75 }}>Phone number (E.164 format)</div>
              <input
                type="tel"
                value={waPhone}
                onChange={(e) => { setWaPhone(e.target.value); setWaMsg(""); }}
                placeholder="+447700900123"
                style={{ width: "100%", padding: 12, fontSize: 16, marginTop: 6 }}
              />
              <div style={{ marginTop: 4, fontSize: 12, opacity: 0.65 }}>
                Include country code, e.g. +44 for UK. Leave blank to remove.
              </div>
            </div>

            <label style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={waOptedIn}
                onChange={(e) => { setWaOptedIn(e.target.checked); setWaMsg(""); }}
                style={{ width: 18, height: 18 }}
              />
              <span style={{ fontSize: 14 }}>
                I consent to receive WhatsApp reminders from Pact
              </span>
            </label>

            <button
              style={{ width: "100%", padding: 12, marginTop: 14, fontWeight: 900 }}
              onClick={saveWhatsappSub}
              disabled={waLoading}
            >
              {waLoading ? "Saving…" : "Save WhatsApp settings"}
            </button>

            {waMsg && (
              <div style={{ marginTop: 10, fontSize: 13, opacity: 0.85 }}>{waMsg}</div>
            )}

            {waSub?.opted_in && (
              <div style={{ marginTop: 10, fontSize: 12, opacity: 0.65 }}>
                Reminders active for: <b>{waSub.phone_e164}</b>. Times are set in Reminder times above.
              </div>
            )}

            {waSub?.opted_in && (
              <div style={{ marginTop: 14 }}>
                <button
                  style={{ width: "100%", padding: 12, fontWeight: 700 }}
                  onClick={sendTestWhatsApp}
                  disabled={waTesting}
                >
                  {waTesting ? "Sending…" : "Send test message"}
                </button>
                {waTestMsg && (
                  <div style={{ marginTop: 8, fontSize: 13, opacity: 0.85 }}>{waTestMsg}</div>
                )}
              </div>
            )}

            <div style={{ marginTop: 14, fontSize: 12, opacity: 0.6 }}>
              <b>Sandbox:</b> Before saving your number, message the Twilio sandbox number with
              the join keyword (e.g. <i>join example-word</i>) from the phone you're registering.
              Then save your number here and send a test message to confirm.
            </div>
        </div>
      </div>
    </div>
  );
}
