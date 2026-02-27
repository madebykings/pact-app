// pages/settings.js
import { useEffect, useMemo, useState } from "react";
import Nav from "../components/Nav";
import { supabase } from "../lib/supabaseClient";
import { initOneSignal } from "../lib/onesignal";

const TONE_OPTIONS = [
  { value: "normal", label: "Normal" },
  { value: "brutal", label: "Brutal" },
  { value: "savage", label: "Savage" },
];

const ACTIVITY_OPTIONS = [
  { value: "REST", label: "Rest day" },
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

export default function Settings() {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(null);
  const [supps, setSupps] = useState([]);
  const [err, setErr] = useState("");

  const reminderTimes = useMemo(() => {
    const t = settings?.reminder_times;
    if (!Array.isArray(t)) return ["08:00", "12:00", "18:00"];
    return t.map(normalizeTime).filter(Boolean).slice(0, 5);
  }, [settings?.reminder_times]);

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

        await supabase.from("user_settings").upsert(
          {
            user_id: data.user.id,
            mode: "solo",
            tone_mode: "normal",
            water_target_ml: 3000,
            sleep_target_hours: 8,
            reminder_times: ["08:00", "12:00", "18:00"],
            included_activities: ["WALK","RUN","SPIN","SWIM","HILLWALK","WEIGHTS","HIIT","YOGA","PILATES","MOBILITY","OTHER"],
            timezone: "Europe/London",
          },
          { onConflict: "user_id" }
        );

        await refresh(data.user.id);
      } catch (e) {
        setErr(e?.message || String(e));
      }
    })();
  }, []);

  async function refresh(userId) {
    const { data: st } = await supabase
      .from("user_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    setSettings(st || null);

    const { data: s } = await supabase
      .from("supplements")
      .select("*")
      .eq("user_id", userId)
      .order("name");

    setSupps(s || []);
  }

  async function saveSettings(patch) {
    if (!user) return;

    const { error } = await supabase
      .from("user_settings")
      .update(patch)
      .eq("user_id", user.id);

    if (error) {
      alert(error.message);
      return;
    }

    await refresh(user.id);
  }

  async function toggleSupplementActive(s) {
    const { error } = await supabase
      .from("supplements")
      .update({ active: !s.active })
      .eq("id", s.id);

    if (error) alert(error.message);
    await refresh(user.id);
  }

  async function enablePush() {
    try {
      const playerId = await initOneSignal();
      if (!playerId) return alert("Push not enabled (no player id returned)");

      await supabase.from("push_devices").upsert(
        { user_id: user.id, onesignal_player_id: playerId },
        { onConflict: "user_id" }
      );

      alert("Push enabled ✅");
    } catch (e) {
      alert(e?.message || String(e));
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  if (err) {
    return <div style={{ padding: 18 }}>Error: {err}</div>;
  }

  if (!settings) {
    return <div style={{ padding: 18 }}>Loading…</div>;
  }

  const included = new Set(settings.included_activities || []);

  return (
    <div style={{ padding: 18, maxWidth: 520, margin: "0 auto" }}>
      <Nav active="settings" onLogout={logout} />

      <h2>Settings</h2>

      {/* Tone */}
      <div style={{ marginTop: 20 }}>
        <div>Tone</div>
        <select
          value={settings.tone_mode || "normal"}
          onChange={(e) => saveSettings({ tone_mode: e.target.value })}
        >
          {TONE_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Reminder Times */}
      <div style={{ marginTop: 20 }}>
        <div>Reminder Times</div>
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
          />
        ))}
      </div>

      {/* Push */}
      <div style={{ marginTop: 20 }}>
        <div>Push Notifications</div>
        <button onClick={enablePush}>Enable Push</button>
      </div>

      {/* Targets */}
      <div style={{ marginTop: 20 }}>
        <div>Water Target (ml)</div>
        <input
          type="number"
          value={settings.water_target_ml || 3000}
          onChange={(e) => saveSettings({ water_target_ml: Number(e.target.value) })}
        />

        <div style={{ marginTop: 10 }}>Sleep Target (hours)</div>
        <input
          type="number"
          step="0.5"
          value={settings.sleep_target_hours || 8}
          onChange={(e) => saveSettings({ sleep_target_hours: Number(e.target.value) })}
        />
      </div>

      {/* Workout Types */}
      <div style={{ marginTop: 20 }}>
        <div>Workout Types</div>
        {ACTIVITY_OPTIONS.filter(a => a.value !== "REST").map(a => (
          <button
            key={a.value}
            onClick={() => {
              const next = new Set(included);
              next.has(a.value) ? next.delete(a.value) : next.add(a.value);
              saveSettings({ included_activities: Array.from(next) });
            }}
            style={{ opacity: included.has(a.value) ? 1 : 0.4 }}
          >
            {included.has(a.value) ? "✅" : "⬜"} {a.label}
          </button>
        ))}
      </div>

      {/* Supplements */}
      <div style={{ marginTop: 20 }}>
        <div>Supplements</div>
        {supps.map(s => (
          <button
            key={s.id}
            onClick={() => toggleSupplementActive(s)}
            style={{ opacity: s.active ? 1 : 0.4 }}
          >
            {s.active ? "✅" : "⬜"} {s.name} — {ruleLabel(s)}
          </button>
        ))}
      </div>
    </div>
  );
}
