// pages/settings.js
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const TONES = [
  { value: "normal", label: "Normal" },
  { value: "brutal", label: "Brutal" },
  { value: "savage", label: "Savage" },
];

const ACTIVITIES = [
  { value: "WALK", label: "Walk" },
  { value: "RUN", label: "Run" },
  { value: "SPIN", label: "Spin" },
  { value: "SWIM", label: "Swim" },
  { value: "HILLWALK", label: "Hill walk" },
  { value: "WEIGHTS", label: "Weights" },
  { value: "HIIT", label: "HIIT" },
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
        <a href="/settings" style={linkStyle(active === "settings")}>Settings</a>
        <button onClick={onLogout}>Logout</button>
      </div>
    </div>
  );
}

export default function Settings() {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(null);
  const [err, setErr] = useState("");

  // Editable fields (autosave)
  const [tone, setTone] = useState("normal");
  const [waterTarget, setWaterTarget] = useState(3000);
  const [sleepTarget, setSleepTarget] = useState(8);
  const [included, setIncluded] = useState([]);

  const [saveState, setSaveState] = useState("Saved ✅");
  const saveTimer = useRef(null);

  const patch = useMemo(
    () => ({
      tone,
      water_target_ml: Number(waterTarget) || 3000,
      sleep_target_hours: Number(sleepTarget) || 8,
      included_activities: included,
    }),
    [tone, waterTarget, sleepTarget, included]
  );

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

        // Ensure row exists (do not overwrite)
        await supabase.from("user_settings").upsert(
          {
            user_id: data.user.id,
            mode: "solo",
            timezone: "Europe/London",
            water_target_ml: 3000,
            sleep_target_hours: 8,
            tone: "normal",
            included_activities: ["WALK","RUN","SPIN","SWIM","HILLWALK","WEIGHTS","HIIT","YOGA","PILATES","MOBILITY","OTHER"],
          },
          { onConflict: "user_id", ignoreDuplicates: true }
        );

        const { data: st, error: stErr } = await supabase
          .from("user_settings")
          .select("*")
          .eq("user_id", data.user.id)
          .maybeSingle();
        if (stErr) throw stErr;

        setSettings(st || null);

        setTone(st?.tone || "normal");
        setWaterTarget(st?.water_target_ml ?? 3000);
        setSleepTarget(st?.sleep_target_hours ?? 8);
        setIncluded(Array.isArray(st?.included_activities) ? st.included_activities : []);
      } catch (e) {
        setErr(e?.message || String(e));
      }
    })();
  }, []);

  // Autosave whenever patch changes (debounced)
  useEffect(() => {
    if (!user) return;
    if (!settings) return;

    setSaveState("Saving…");

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const { error } = await supabase
        .from("user_settings")
        .update({ ...patch })
        .eq("user_id", user.id);

      if (error) {
        setSaveState("Could not save: " + error.message);
        return;
      }
      setSaveState("Saved ✅");
    }, 500);

    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patch, user?.id]);

  function toggleActivity(code) {
    setIncluded((prev) => {
      const set = new Set(prev || []);
      if (set.has(code)) set.delete(code);
      else set.add(code);
      return Array.from(set);
    });
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

  if (!user || !settings) return <div style={{ padding: 18, fontFamily: "system-ui" }}>Loading…</div>;

  return (
    <div style={{ padding: 18, fontFamily: "system-ui", maxWidth: 520, margin: "0 auto" }}>
      <TopNav active="settings" onLogout={logout} />

      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div>
            <div style={{ fontSize: 14, opacity: 0.75 }}>Preferences</div>
            <div style={{ fontSize: 22, fontWeight: 900 }}>Settings</div>
          </div>
          <div style={{ fontSize: 13, opacity: 0.8, fontWeight: 800 }}>{saveState}</div>
        </div>

        <div style={{ marginTop: 14, fontWeight: 900, fontSize: 14, opacity: 0.85 }}>Bill style</div>
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          {TONES.map((t) => (
            <button
              key={t.value}
              onClick={() => setTone(t.value)}
              style={{
                flex: 1,
                padding: 12,
                border: "1px solid #ddd",
                borderRadius: 12,
                fontWeight: tone === t.value ? 900 : 700,
                opacity: tone === t.value ? 1 : 0.7,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ marginTop: 16, fontWeight: 900, fontSize: 14, opacity: 0.85 }}>Water target (ml)</div>
        <input
          type="number"
          value={waterTarget}
          onChange={(e) => setWaterTarget(e.target.value)}
          style={{ width: "100%", padding: 12, fontSize: 16, marginTop: 8 }}
        />

        <div style={{ marginTop: 16, fontWeight: 900, fontSize: 14, opacity: 0.85 }}>Sleep target (hours)</div>
        <input
          type="number"
          value={sleepTarget}
          step="0.5"
          onChange={(e) => setSleepTarget(e.target.value)}
          style={{ width: "100%", padding: 12, fontSize: 16, marginTop: 8 }}
        />
      </div>

      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.75 }}>Included workouts</div>
        <div style={{ fontSize: 13, opacity: 0.7, marginTop: 6 }}>
          You’re not building a training plan — this just controls what’s selectable in your week plan.
        </div>

        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          {ACTIVITIES.map((a) => {
            const checked = (included || []).includes(a.value);
            return (
              <button
                key={a.value}
                onClick={() => toggleActivity(a.value)}
                style={{
                  padding: 12,
                  textAlign: "left",
                  border: "1px solid #eee",
                  borderRadius: 12,
                  opacity: checked ? 1 : 0.7,
                }}
              >
                <div style={{ fontWeight: 900 }}>{checked ? "✅" : "⬜"} {a.label}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ marginTop: 14, fontSize: 12, opacity: 0.65 }}>
        Push notifications are disabled for now (we’ll re-add once Android subscription is stable).
      </div>
    </div>
  );
}
