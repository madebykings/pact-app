// pages/profile.js
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

function startOfWeek(d) {
  // Monday as start
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay(); // 0=Sun
  const diff = (day === 0 ? -6 : 1) - day;
  x.setDate(x.getDate() + diff);
  return x;
}

function isoDay(d) {
  const x = new Date(d);
  const yyyy = x.getFullYear();
  const mm = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

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
        <a href="/settings" style={linkStyle(active === "settings")}>Settings</a>
        <button onClick={onLogout}>Logout</button>
      </div>
    </div>
  );
}

export default function Profile() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [nameInput, setNameInput] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [weekPoints, setWeekPoints] = useState(0);
  const [weekDoneCount, setWeekDoneCount] = useState(0);

  const [latestWeight, setLatestWeight] = useState(null);
  const [weightDelta, setWeightDelta] = useState(null);

  const [errMsg, setErrMsg] = useState("");

  const now = useMemo(() => new Date(), []);
  const weekStart = useMemo(() => startOfWeek(now), [now]);
  const weekEnd = useMemo(() => {
    const x = new Date(weekStart);
    x.setDate(x.getDate() + 7);
    return x;
  }, [weekStart]);

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

        // Ensure profile row exists
        await supabase.from("user_profiles").upsert(
          { user_id: data.user.id, display_name: "" },
          { onConflict: "user_id" }
        );

        await refresh(data.user.id);
      } catch (e) {
        setErrMsg(e?.message || String(e));
      }
    })();
  }, []);

  // Realtime refresh for points (optional, harmless if Realtime disabled)
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel("activity_events_user_" + user.id)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "activity_events", filter: "user_id=eq." + user.id },
        () => refresh(user.id)
      )
      .subscribe();

    return () => {
      try { supabase.removeChannel(ch); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);


  async function refresh(userId) {
    const { data: p, error: pErr } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (pErr) throw pErr;
    setProfile(p || null);
    setNameInput(p?.display_name || "");

    // Weekly points + weekly done count
    // NOTE: points are allocated immediately when actions occur (DONE / set time / water target / sleep target etc.)
    // We sum points from activity_events for the current week.
    let points = 0;
    {
      const { data: evRows, error: evErr } = await supabase
        .from("activity_events")
        .select("points,created_at")
        .eq("user_id", userId)
        .gte("created_at", weekStart.toISOString())
        .lt("created_at", weekEnd.toISOString());
      if (!evErr) points = (evRows || []).reduce((sum, r) => sum + (Number(r.points) || 0), 0);
    }
    setWeekPoints(points);

const { data: doneRows, error: dErr } = await supabase
      .from("plans")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "DONE")
      .gte("plan_date", isoDay(weekStart))
      .lt("plan_date", isoDay(weekEnd));
    if (!dErr) setWeekDoneCount((doneRows || []).length);

    // Weight: latest + previous (for delta)
    const { data: ws, error: wErr } = await supabase
      .from("weigh_ins")
      .select("weigh_date,weight_kg")
      .eq("user_id", userId)
      .order("weigh_date", { ascending: false })
      .limit(2);
    if (!wErr && ws && ws.length) {
      setLatestWeight(ws[0]);
      if (ws.length >= 2) {
        const delta = Number(ws[0].weight_kg) - Number(ws[1].weight_kg);
        setWeightDelta(Number.isFinite(delta) ? delta : null);
      } else {
        setWeightDelta(null);
      }
    } else {
      setLatestWeight(null);
      setWeightDelta(null);
    }
  }

  async function saveDisplayName() {
    if (!user) return;
    const name = (nameInput || "").trim();
    setSaveStatus("Saving…");
    const { error } = await supabase.from("user_profiles").upsert(
      { user_id: user.id, display_name: name },
      { onConflict: "user_id" }
    );
    if (error) {
      setSaveStatus("Could not save: " + error.message);
      return alert(error.message);
    }
    setSaveStatus("Saved ✅");
    await refresh(user.id);
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  if (errMsg) {
    return (
      <div style={{ padding: 20, fontFamily: "system-ui", maxWidth: 520, margin: "0 auto" }}>
        <h2>Pact</h2>
        <p><b>Error:</b> {errMsg}</p>
        <button onClick={logout}>Logout</button>
      </div>
    );
  }

  if (!user || profile === null) {
    return <div style={{ padding: 20, fontFamily: "system-ui" }}>Loading…</div>;
  }

  return (
    <div style={{ padding: 18, fontFamily: "system-ui", maxWidth: 520, margin: "0 auto" }}>
      <TopNav active="profile" onLogout={logout} />

      {/* PROFILE */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Profile</div>

        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 13, opacity: 0.7 }}>Email</div>
          <div style={{ fontWeight: 800 }}>{user.email}</div>
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, opacity: 0.7 }}>Display name</div>
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Your name"
              style={{ flex: 1, padding: 12, fontSize: 16 }}
            />
            <button onClick={saveDisplayName} style={{ padding: "12px 14px", fontWeight: 800 }}>
              Save
            </button>
          </div>
            {saveStatus && (
              <div style={{ marginTop: 8, fontSize: 13, opacity: 0.75 }}>{saveStatus}</div>
            )}
        </div>
      </div>

      {/* THIS WEEK */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>This week</div>
        <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
          <div><b>Points:</b> {weekPoints}</div>
          <div><b>Workouts done:</b> {weekDoneCount}</div>
        </div>
      </div>

      {/* WEIGHT */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Weight</div>

        {latestWeight ? (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{latestWeight.weight_kg} kg</div>
            <div style={{ marginTop: 4, fontSize: 13, opacity: 0.75 }}>
              Logged: {latestWeight.weigh_date}
              {weightDelta != null && (
                <> — change vs previous: {weightDelta > 0 ? "+" : ""}{weightDelta.toFixed(1)} kg</>
              )}
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 8, opacity: 0.75 }}>No weigh-in logged yet.</div>
        )}

        <div style={{ marginTop: 10, fontSize: 13, opacity: 0.75 }}>
          Weigh-in is only available on Sundays from the Dashboard.
        </div>
      </div>
    </div>
  );
}
