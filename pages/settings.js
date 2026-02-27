// pages/settings.js
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

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
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
      <h2 style={{ margin: 0 }}>Pact</h2>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <a href="/dashboard" style={linkStyle(active === "dashboard")}>Dashboard</a>
        <a href="/team" style={linkStyle(active === "pact")}>Pact</a>
        <a href="/profile" style={linkStyle(active === "profile")}>Profile</a>
        <button onClick={onLogout}>Logout</button>
      </div>
    </div>
  );
}

export default function Settings() {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(null);
  const [supps, setSupps] = useState([]);
  const [err, setErr] = useState("");

  // form state
  const [tone, setTone] = useState("normal");
  const [waterTarget, setWaterTarget] = useState(3000);
  const [sleepTarget, setSleepTarget] = useState(8);
  const [includedActivities, setIncludedActivities] = useState([]);

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

        // Ensure settings row exists
        await supabase.from("user_settings").upsert(
          { user_id: data.user.id, mode: "solo", timezone: "Europe/London" },
          { onConflict: "user_id" }
        );

        // Ensure default supplements exist (if none)
        const { data: existingSupp, error: exErr } = await supabase
          .from("supplements")
          .select("id")
          .eq("user_id", data.user.id)
          .limit(1);
        if (exErr) throw exErr;
        if (!existingSupp || existingSupp.length === 0) {
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
          ].map((s) => ({ ...s, user_id: data.user.id, active: true }));

          await supabase.from("supplements").insert(defaults);
        }

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
    setTone(st?.tone || "normal");
    setWaterTarget(Number(st?.water_target_ml ?? 3000));
    setSleepTarget(Number(st?.sleep_target_hours ?? 8));
    setIncludedActivities(st?.included_activities || []);

    const { data: s, error: sErr } = await supabase
      .from("supplements")
      .select("*")
      .eq("user_id", userId)
      .order("name");
    if (sErr) throw sErr;
    setSupps(s || []);
  }

  async function save() {
    if (!user) return;
    const patch = {
      user_id: user.id,
      tone,
      water_target_ml: Number(waterTarget) || 3000,
      sleep_target_hours: Number(sleepTarget) || 8,
      included_activities: includedActivities,
      timezone: "Europe/London",
    };
    const { error } = await supabase.from("user_settings").upsert(patch, { onConflict: "user_id" });
    if (error) return alert(error.message);
    alert("Saved ✅");
    await refresh(user.id);
  }

  async function toggleSupplement(id, active) {
    const { error } = await supabase.from("supplements").update({ active }).eq("id", id);
    if (error) return alert(error.message);
    if (user) await refresh(user.id);
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  const activitySet = useMemo(() => new Set(includedActivities || []), [includedActivities]);

  if (err) {
    return (
      <div style={{ padding: 18, fontFamily: "system-ui", maxWidth: 520, margin: "0 auto" }}>
        <h2>Settings</h2>
        <div><b>Error:</b> {err}</div>
        <button style={{ marginTop: 12 }} onClick={logout}>Logout</button>
      </div>
    );
  }

  if (!user || settings === null) return <div style={{ padding: 18, fontFamily: "system-ui" }}>Loading…</div>;

  return (
    <div style={{ padding: 18, fontFamily: "system-ui", maxWidth: 520, margin: "0 auto" }}>
      <TopNav active="settings" onLogout={logout} />

      {/* TONE */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Preferred “bull” style</div>
        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          {TONE_OPTIONS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTone(t.value)}
              style={{
                padding: 12,
                textAlign: "left",
                border: "1px solid #eee",
                borderRadius: 12,
                fontWeight: tone === t.value ? 800 : 600,
                opacity: tone === t.value ? 1 : 0.75,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* TARGETS */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Targets</div>

        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 13, opacity: 0.7 }}>Water target (ml)</div>
          <input
            type="number"
            value={waterTarget}
            onChange={(e) => setWaterTarget(e.target.value)}
            style={{ width: "100%", padding: 12, fontSize: 16, marginTop: 6 }}
          />
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, opacity: 0.7 }}>Sleep target (hours)</div>
          <input
            type="number"
            value={sleepTarget}
            onChange={(e) => setSleepTarget(e.target.value)}
            style={{ width: "100%", padding: 12, fontSize: 16, marginTop: 6 }}
          />
        </div>
      </div>

      {/* ACTIVITIES */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Workout types available</div>
        <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
          {ACTIVITY_OPTIONS.map((a) => {
            const on = activitySet.has(a.value);
            return (
              <button
                key={a.value}
                style={{ padding: 12, textAlign: "left", opacity: on ? 1 : 0.6, borderRadius: 12, border: "1px solid #eee" }}
                onClick={() => {
                  const next = new Set(activitySet);
                  if (on) next.delete(a.value);
                  else next.add(a.value);
                  setIncludedActivities(Array.from(next));
                }}
              >
                <b>{on ? "✅" : "⬜"} {a.label}</b>
              </button>
            );
          })}
        </div>
      </div>

      {/* SUPPLEMENTS (toggle only, no adding/removing) */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Included supplements</div>
        <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
          {supps.map((s) => (
            <button
              key={s.id}
              style={{
                padding: 12,
                textAlign: "left",
                opacity: s.active ? 1 : 0.6,
                borderRadius: 12,
                border: "1px solid #eee",
              }}
              onClick={() => toggleSupplement(s.id, !s.active)}
            >
              <b>{s.active ? "✅" : "⬜"} {s.name}</b>
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                {s.rule_type === "PRE_WORKOUT" ? "Pre-workout" : ""}
                {s.rule_type === "MORNING_WINDOW" ? `Morning (${s.window_start}–${s.window_end})` : ""}
                {s.rule_type === "EVENING_WINDOW" ? `Evening (${s.window_start}–${s.window_end})` : ""}
                {s.rule_type === "BED_WINDOW" ? `Bed (${s.window_start}–${s.window_end})` : ""}
              </div>
            </button>
          ))}
          {supps.length === 0 && <div style={{ opacity: 0.7 }}>No supplements found.</div>}
        </div>
      </div>

      <button style={{ width: "100%", padding: 14, marginTop: 14, fontWeight: 800 }} onClick={save}>
        Save settings
      </button>
    </div>
  );
}
