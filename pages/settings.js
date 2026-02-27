// pages/settings.js
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { initOneSignal } from "../lib/onesignal";

function TopNav({ active, onLogout }) {
  const linkStyle = (isActive) => ({
    padding: "6px 10px",
    border: "1px solid #ddd",
    borderRadius: 10,
    textDecoration: "none",
    opacity: isActive ? 1 : 0.8,
    fontWeight: isActive ? 800 : 600,
  });

  return (
    <TopNav active="settings" onLogout={logout} />
    </div>
  );
}


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

        // Ensure defaults exist, but don't overwrite existing user choices.
        await supabase.from("user_settings").upsert(
          {
            user_id: data.user.id,
            mode: "solo",
            tone_mode: "normal",
            water_target_ml: 3000,
            sleep_target_hours: 8,
            reminder_times: ["08:00", "12:00", "18:00"],
            included_activities: ["WALK", "RUN", "SPIN", "SWIM", "HILLWALK", "WEIGHTS", "HIIT", "YOGA", "PILATES", "OTHER"],
            timezone: "Europe/London",
          },
          { onConflict: "user_id", ignoreDuplicates: true }
        );

        await refresh(data.user.id);
      } catch (e) {
        setErr(e?.message || String(e));
      }
    })();
  }, []);

  async function refresh(userId) {
    const { data: st, error: stErr } = await supabase
      .from("user_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (stErr) throw stErr;
    setSettings(st || null);

    const { data: s, error: sErr } = await supabase
      .from("supplements")
      .select("*")
      .eq("user_id", userId)
      .order("name");
    if (sErr) throw sErr;
    if (!s || s.length === 0) {
      // Seed defaults (settings page may be visited before dashboard)
      const defaults = [
        { name: "Creatine", rule_type: "PRE_WORKOUT", offset_minutes: -45 },
        { name: "L-Carnitine", rule_type: "PRE_WORKOUT", offset_minutes: -30 },
        { name: "Cod Liver Oil", rule_type: "MORNING_WINDOW", window_start: "06:00", window_end: "10:00" },
        { name: "Tongkat Ali", rule_type: "MORNING_WINDOW", window_start: "06:00", window_end: "10:00" },
        { name: "Shilajit", rule_type: "MORNING_WINDOW", window_start: "06:00", window_end: "10:00" },
        { name: "Collagen", rule_type: "MORNING_WINDOW", window_start: "06:00", window_end: "10:00" },
        { name: "B12 Coffee", rule_type: "MORNING_WINDOW", window_start: "06:00", window_end: "10:00" },
        { name: "Ashwagandha", rule_type: "EVENING_WINDOW", window_start: "17:00", window_end: "21:00" },
        { name: "ZMA", rule_type: "BED_WINDOW", window_start: "21:00", window_end: "23:59" },
      ].map((row) => ({ ...row, user_id: userId, active: true }));

      await supabase.from("supplements").insert(defaults);
      const { data: s2 } = await supabase
        .from("supplements")
        .select("*")
        .eq("user_id", userId)
        .order("name");
      setSupps(s2 || []);
    } else {
      setSupps(s || []);
    }
  }

  async function saveSettings(patch) {
    if (!user) return;

    // Try update; if schema is missing a column (common after changing DB), retry without it.
    const first = await supabase
      .from("user_settings")
      .update({ ...patch })
      .eq("user_id", user.id);

    if (first?.error) {
      const msg = String(first.error.message || "");
      // If 'tone' column missing, retry without it so other settings still save.
      if (msg.toLowerCase().includes("tone")) {
        const { tone, ...rest } = patch || {};
        const second = await supabase.from("user_settings").update({ ...rest }).eq("user_id", user.id);
        if (second?.error) {
          alert(second.error.message);
          return;
        }
        alert("Saved (but tone column is missing in DB — run the SQL patch to add it).");
      } else {
        alert(first.error.message);
        return;
      }
    }

    await refresh(user.id);
  }


  async function toggleSupplementActive(s) {
    if (!user) return;
    const { error } = await supabase
      .from("supplements")
      .update({ active: !s.active })
      .eq("id", s.id);
    if (error) alert(error.message);
    await refresh(user.id);
  }

  async function enablePushNow() {
    if (!user) return;
    try {
      const playerId = await initOneSignal();
      if (!playerId) return alert("Push not enabled (no player id returned)");

      const { error } = await supabase
        .from("push_devices")
        .upsert({ user_id: user.id, onesignal_player_id: playerId }, { onConflict: "user_id" });
      if (error) return alert(error.message);

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
    return (
      <div style={{ padding: 18, fontFamily: "system-ui", maxWidth: 520, margin: "0 auto" }}>
        <h2>Settings</h2>
        <div><b>Error:</b> {err}</div>
        <button style={{ marginTop: 12 }} onClick={logout}>Logout</button>
      </div>
    );
  }

  if (!settings) {
    return <div style={{ padding: 18, fontFamily: "system-ui" }}>Loading…</div>;
  }

  const included = new Set(Array.isArray(settings.included_activities) ? settings.included_activities : []);

  return (
    <div style={{ padding: 18, fontFamily: "system-ui", maxWidth: 520, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Settings</h2>
        <a href="/dashboard" style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 10, textDecoration: "none" }}>
          Back
        </a>
      </div>

      {/* TONE / MODE */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Tone</div>
        <select
          value={settings.tone_mode || "normal"}
          onChange={(e) => saveSettings({ tone_mode: e.target.value })}
          style={{ width: "100%", padding: 12, fontSize: 16, marginTop: 10 }}
        >
          {TONE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <div style={{ marginTop: 12, fontSize: 12, opacity: 0.7 }}>
          Tone affects the copy in reminders + “brutal” messages.
        </div>
      </div>

      {/* REMINDERS */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Reminder times</div>
        <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
          {reminderTimes.map((t, idx) => (
            <input
              key={idx}
              type="time"
              value={t}
              onChange={(e) => {
                const next = [...reminderTimes];
                next[idx] = normalizeTime(e.target.value);
                saveSettings({ reminder_times: next.filter(Boolean) });
              }}
              style={{ width: "100%", padding: 12, fontSize: 16 }}
            />
          ))}
        </div>
        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
          These are used for push notifications. If push is disabled, they do nothing.
        </div>
      </div>

      {/* PUSH */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Push notifications</div>
        <button style={{ width: "100%", padding: 12, marginTop: 10, fontSize: 16, fontWeight: 800 }} onClick={enablePushNow}>
          Enable push
        </button>
        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
          Android tip: if you tapped “Block” earlier, you need to allow notifications for your browser in Android settings.
        </div>
      </div>

      {/* TARGETS */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Targets</div>

        <label style={{ display: "grid", gap: 6, marginTop: 10 }}>
          <div style={{ fontSize: 13, opacity: 0.7 }}>Water target (ml)</div>
          <input
            type="number"
            value={settings.water_target_ml ?? 3000}
            onChange={(e) => saveSettings({ water_target_ml: Number(e.target.value || 0) })}
            style={{ width: "100%", padding: 12, fontSize: 16 }}
          />
        </label>

        <label style={{ display: "grid", gap: 6, marginTop: 10 }}>
          <div style={{ fontSize: 13, opacity: 0.7 }}>Sleep target (hours)</div>
          <input
            type="number"
            step="0.5"
            value={settings.sleep_target_hours ?? 8}
            onChange={(e) => saveSettings({ sleep_target_hours: Number(e.target.value || 0) })}
            style={{ width: "100%", padding: 12, fontSize: 16 }}
          />
        </label>
      </div>

      {/* INCLUDED WORKOUT TYPES */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Workout types (for week planning)</div>
        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          {ACTIVITY_OPTIONS.filter((a) => a.value !== "REST").map((a) => (
            <button
              key={a.value}
              onClick={() => {
                const next = new Set(included);
                if (next.has(a.value)) next.delete(a.value);
                else next.add(a.value);
                saveSettings({ included_activities: Array.from(next) });
              }}
              style={{
                padding: 12,
                textAlign: "left",
                border: "1px solid #eee",
                borderRadius: 12,
                opacity: included.has(a.value) ? 1 : 0.45,
              }}
            >
              <b>{included.has(a.value) ? "✅" : "⬜"} {a.label}</b>
            </button>
          ))}
        </div>
      </div>

      {/* SUPPLEMENTS */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Supplements included</div>
        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          {supps.map((s) => (
            <button
              key={s.id}
              onClick={() => toggleSupplementActive(s)}
              style={{
                padding: 12,
                textAlign: "left",
                border: "1px solid #eee",
                borderRadius: 12,
                opacity: s.active ? 1 : 0.45,
              }}
            >
              <div style={{ fontWeight: 800 }}>{s.active ? "✅" : "⬜"} {s.name}</div>
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>{ruleLabel(s)}</div>
            </button>
          ))}
        </div>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
          (Deliberately locked) Supplements are managed centrally for now — no adding custom ones in settings.
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <button style={{ width: "100%", padding: 12 }} onClick={logout}>
          Logout
        </button>
      </div>
    </div>
  );
}
