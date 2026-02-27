// pages/profile.js
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { addDays, isoDate } from "../lib/weekTemplate";
import { promptForPush, initOneSignal } from "../lib/onesignal";

function mondayStart(d) {
  // Week starts Monday
  const x = new Date(d);
  const day = x.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

function fmtDate(d) {
  return isoDate(d);
}

export default function Profile() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [settings, setSettings] = useState(null);
  const [pushId, setPushId] = useState(null);

  const [weekPoints, setWeekPoints] = useState(0);
  const [breakdown, setBreakdown] = useState([]);
  const [achievements, setAchievements] = useState([]);

  const [err, setErr] = useState("");

  const today = useMemo(() => new Date(), []);
  const weekStart = useMemo(() => mondayStart(today), [today]);
  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);

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

        // safe: ensure rows exist
        await supabase.from("user_profiles").upsert(
          { user_id: data.user.id, display_name: "" },
          { onConflict: "user_id" }
        );

        await supabase.from("user_settings").upsert(
          {
            user_id: data.user.id,
            mode: "solo",
            tone_mode: "normal",
            water_target_ml: 3000,
            sleep_target_hours: 8,
            reminder_times: ["08:00", "12:00", "18:00"],
            included_activities: ["WALK", "RUN", "SPIN", "SWIM", "WEIGHTS"],
            timezone: "Europe/London",
          },
          { onConflict: "user_id" }
        );

        // push (no prompt)
        const id = await initOneSignal();
        if (id) setPushId(id);

        await refreshAll(data.user.id);
      } catch (e) {
        setErr(e?.message || String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshAll(userId) {
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

    const startStr = fmtDate(weekStart);
    const endStr = fmtDate(weekEnd);

    // Points from activity_events
    const { data: evs, error: evErr } = await supabase
      .from("activity_events")
      .select("event_type, points, event_date")
      .eq("user_id", userId)
      .gte("event_date", startStr)
      .lte("event_date", endStr);
    if (evErr) throw evErr;

    const total = (evs || []).reduce((a, r) => a + Number(r.points || 0), 0);
    setWeekPoints(total);

    const map = new Map();
    (evs || []).forEach((r) => {
      const k = r.event_type || "unknown";
      map.set(k, (map.get(k) || 0) + Number(r.points || 0));
    });
    const bd = Array.from(map.entries())
      .map(([k, v]) => ({ event_type: k, points: v }))
      .sort((a, b) => b.points - a.points);
    setBreakdown(bd);

    // Achievements: use plans (this week)
    const { data: plans, error: plErr } = await supabase
      .from("plans")
      .select("plan_date,status,plan_type,planned_time")
      .eq("user_id", userId)
      .gte("plan_date", startStr)
      .lte("plan_date", endStr)
      .order("plan_date");
    if (plErr) throw plErr;

    const doneCount = (plans || []).filter((p2) => p2.status === "DONE").length;
    const plannedCount = (plans || []).filter((p2) => p2.plan_type !== "REST").length;
    const cancelled = (plans || []).filter((p2) => p2.status === "CANCELLED").length;

    const a = [];
    if (doneCount >= 1) a.push(`On the board (${doneCount} done)`);
    if (doneCount >= 3) a.push("3-workout week ✅");
    if (plannedCount > 0 && doneCount === plannedCount) a.push("Perfect week (all planned workouts done) 🥇");
    if (cancelled === 0 && doneCount >= 3) a.push("No excuses (no cancels) 👊");
    if (weekPoints >= 30) a.push("30+ points club 🔥");

    setAchievements(a);
  }

  async function saveDisplayName(name) {
    if (!user) return;
    const { error } = await supabase
      .from("user_profiles")
      .update({ display_name: name, updated_at: new Date().toISOString() })
      .eq("user_id", user.id);
    if (error) return alert(error.message);
    await refreshAll(user.id);
  }

  async function enablePush() {
    if (!user) return;
    const id = await promptForPush();
    if (id) {
      setPushId(id);
      await supabase.from("push_devices").upsert(
        { user_id: user.id, onesignal_player_id: id },
        { onConflict: "user_id" }
      );
      alert("Push enabled ✅");
    } else {
      alert("Push not enabled (blocked/denied?)");
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  if (err) {
    return (
      <div style={{ padding: 18, fontFamily: "system-ui", maxWidth: 520, margin: "0 auto" }}>
        <h2>Profile</h2>
        <div style={{ marginTop: 10 }}><b>Error:</b> {err}</div>
        <button style={{ marginTop: 12 }} onClick={logout}>Logout</button>
      </div>
    );
  }

  if (!user || !settings) {
    return <div style={{ padding: 18, fontFamily: "system-ui" }}>Loading…</div>;
  }

  return (
    <div style={{ padding: 18, fontFamily: "system-ui", maxWidth: 520, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Profile</h2>
        <a href="/dashboard" style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 10, textDecoration: "none" }}>
          Back
        </a>
      </div>

      {/* Identity */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Username</div>
        <input
          defaultValue={profile?.display_name || ""}
          placeholder="Your name"
          style={{ width: "100%", padding: 12, fontSize: 16, marginTop: 8 }}
          onBlur={(e) => saveDisplayName(e.target.value)}
        />
        <div style={{ marginTop: 12, fontSize: 14, opacity: 0.8 }}>Email</div>
        <div style={{ marginTop: 6, fontWeight: 700 }}>{user.email}</div>
      </div>

      {/* Push */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Push notifications</div>
        <div style={{ marginTop: 6, fontWeight: 700 }}>
          {pushId ? "Enabled ✅" : "Not enabled"}
        </div>
        {!pushId && (
          <button style={{ width: "100%", padding: 12, marginTop: 10 }} onClick={enablePush}>
            Enable push
          </button>
        )}
      </div>

      {/* Weekly points */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>
          This week ({fmtDate(weekStart)} → {fmtDate(weekEnd)})
        </div>
        <div style={{ marginTop: 6, fontSize: 28, fontWeight: 900 }}>
          {weekPoints} pts
        </div>

        {breakdown.length > 0 && (
          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            {breakdown.map((b) => (
              <div key={b.event_type} style={{ display: "flex", justifyContent: "space-between" }}>
                <div style={{ opacity: 0.8 }}>{b.event_type}</div>
                <div style={{ fontWeight: 800 }}>{b.points}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Achievements */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Achievements</div>
        {achievements.length ? (
          <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
            {achievements.map((x, idx) => (
              <div key={idx} style={{ padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
                {x}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ marginTop: 10, opacity: 0.7 }}>No badges yet — get one workout done and it starts.</div>
        )}
      </div>

      <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
        <a href="/settings" style={{ flex: 1, padding: 12, border: "1px solid #ddd", borderRadius: 12, textAlign: "center", textDecoration: "none" }}>
          Settings
        </a>
        <a href="/team" style={{ flex: 1, padding: 12, border: "1px solid #ddd", borderRadius: 12, textAlign: "center", textDecoration: "none" }}>
          Team
        </a>
      </div>

      <button style={{ width: "100%", padding: 12, marginTop: 14 }} onClick={logout}>
        Logout
      </button>
    </div>
  );
}
