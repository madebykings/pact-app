// pages/profile.js
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { addDays, isoDate } from "../lib/weekTemplate";

export default function Profile() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [settings, setSettings] = useState(null);
  const [weekPoints, setWeekPoints] = useState(0);
  const [achievements, setAchievements] = useState([]);
  const [errMsg, setErrMsg] = useState("");

  const today = useMemo(() => new Date(), []);
  const todayStr = isoDate(today);

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

        await ensureProfile(data.user.id);
        await ensureSettings(data.user.id);
        await refresh(data.user.id);
      } catch (e) {
        setErrMsg(e?.message || String(e));
      }
    })();
  }, []);

  async function ensureProfile(userId) {
    const { data: p, error } = await supabase
      .from("user_profiles")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;

    if (!p) {
      const { error: insErr } = await supabase.from("user_profiles").insert({ user_id: userId, display_name: "" });
      if (insErr) throw insErr;
    }
  }

  async function ensureSettings(userId) {
    const { data: s, error } = await supabase
      .from("user_settings")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;

    if (!s) {
      const { error: insErr } = await supabase.from("user_settings").insert({
        user_id: userId,
        mode: "solo",
        tone_mode: "normal",
        timezone: "Europe/London",
        water_target_ml: 3000,
        sleep_target_hours: 8,
        reminder_times: ["08:00", "12:00", "18:00"],
        included_activities: ["WALK", "RUN", "SPIN", "HIIT", "SWIM", "WEIGHTS"],
      });
      if (insErr) throw insErr;
    }
  }

  async function refresh(userId) {
    const { data: p, error: pErr } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (pErr) throw pErr;
    setProfile(p || null);

    const { data: s, error: sErr } = await supabase
      .from("user_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (sErr) throw sErr;
    setSettings(s || null);

    // Week points: sum points_events for current Mon-Sun (simple)
    const monday = new Date(today);
    const dow = monday.getDay();
    const delta = (dow + 6) % 7; // Mon=0
    monday.setDate(monday.getDate() - delta);
    const mondayStr = isoDate(monday);
    const sundayStr = isoDate(addDays(monday, 6));

    const { data: pe, error: peErr } = await supabase
      .from("points_events")
      .select("points")
      .eq("user_id", userId)
      .gte("event_date", mondayStr)
      .lte("event_date", sundayStr);
    if (!peErr) {
      const sum = (pe || []).reduce((a, r) => a + Number(r.points || 0), 0);
      setWeekPoints(sum);
    }

    // Achievements placeholder
    setAchievements([]);
  }

  async function saveName() {
    if (!user) return;
    const name = (profile?.display_name || "").trim();
    const { error } = await supabase
      .from("user_profiles")
      .update({ display_name: name })
      .eq("user_id", user.id);
    if (error) return alert(error.message);
    await refresh(user.id);
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  if (errMsg) {
    return (
      <div style={{ padding: 20, fontFamily: "system-ui", maxWidth: 520, margin: "0 auto" }}>
        <h2>Profile</h2>
        <p>
          <b>Error:</b> {errMsg}
        </p>
        <button onClick={logout}>Logout</button>
      </div>
    );
  }

  if (!profile || !settings) {
    return <div style={{ padding: 20, fontFamily: "system-ui" }}>Loading…</div>;
  }

  return (
    <div style={{ padding: 18, fontFamily: "system-ui", maxWidth: 520, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <h2 style={{ margin: 0 }}>Profile</h2>
        <a
          href="/dashboard"
          style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 10, textDecoration: "none" }}
        >
          Back
        </a>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
        <a
          href="/team"
          style={{ flex: 1, padding: 12, border: "1px solid #ddd", borderRadius: 12, textAlign: "center", textDecoration: "none" }}
        >
          Pact
        </a>
        <a
          href="/settings"
          style={{ flex: 1, padding: 12, border: "1px solid #ddd", borderRadius: 12, textAlign: "center", textDecoration: "none" }}
        >
          Settings
        </a>
      </div>

      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Username</div>
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <input
            value={profile.display_name || ""}
            onChange={(e) => setProfile({ ...profile, display_name: e.target.value })}
            placeholder="Your name"
            style={{ flex: 1, padding: 12, fontSize: 16 }}
          />
          <button onClick={saveName} style={{ padding: "12px 14px" }}>
            Save
          </button>
        </div>
        <div style={{ marginTop: 10, fontSize: 14, opacity: 0.8 }}>Email</div>
        <div style={{ fontWeight: 800, marginTop: 6 }}>{user?.email}</div>
      </div>

      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>This week</div>
        <div style={{ fontSize: 26, fontWeight: 900, marginTop: 6 }}>{weekPoints} pts</div>
        <div style={{ marginTop: 8, fontSize: 13, opacity: 0.7 }}>Updated from points events.</div>
      </div>

      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Achievements</div>
        {achievements.length === 0 ? (
          <div style={{ marginTop: 8, opacity: 0.7 }}>Coming next.</div>
        ) : (
          <div style={{ marginTop: 8 }}>{achievements.join(", ")}</div>
        )}
      </div>

      <div style={{ marginTop: 14 }}>
        <button style={{ width: "100%", padding: 12 }} onClick={logout}>
          Logout
        </button>
      </div>
    </div>
  );
}
