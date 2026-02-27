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

export default function Profile() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [weekPoints, setWeekPoints] = useState(0);
  const [weekDoneCount, setWeekDoneCount] = useState(0);
  const [err, setErr] = useState("");
  const [draftName, setDraftName] = useState("");
  const [saving, setSaving] = useState(false);

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

        await supabase
          .from("user_profiles")
          .upsert({ user_id: data.user.id, display_name: "" }, { onConflict: "user_id" });

        await refresh(data.user.id);
      } catch (e) {
        setErr(e?.message || String(e));
      }
    })();
  }, []);

  async function refresh(userId) {
    const { data: p, error: pErr } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (pErr) throw pErr;
    setProfile(p || null);
    setDraftName(p?.display_name || "");

    // points this week
    const { data: pts, error: ptsErr } = await supabase
      .from("activity_events")
      .select("points,event_date")
      .eq("user_id", userId)
      .gte("event_date", isoDay(weekStart))
      .lt("event_date", isoDay(weekEnd));
    if (!ptsErr) {
      const total = (pts || []).reduce((sum, r) => sum + Number(r.points || 0), 0);
      setWeekPoints(total);
    }

    // workouts done this week (plans)
    const { data: doneRows, error: dErr } = await supabase
      .from("plans")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "DONE")
      .gte("plan_date", isoDay(weekStart))
      .lt("plan_date", isoDay(weekEnd));
    if (!dErr) setWeekDoneCount((doneRows || []).length);
  }

  async function saveDisplayName(name) {
    if (!user) return;
    const next = (name || "").trim();
    setSaving(true);

    // Try update first (avoids duplicate rows if unique constraint isn't present yet)
    const { data: upd, error: uErr } = await supabase
      .from("user_profiles")
      .update({ display_name: next })
      .eq("user_id", user.id)
      .select("user_id")
      .maybeSingle();

    if (uErr) {
      setSaving(false);
      alert(uErr.message);
      return;
    }

    if (!upd) {
      const { error: iErr } = await supabase
        .from("user_profiles")
        .insert({ user_id: user.id, display_name: next });
      if (iErr) {
        setSaving(false);
        alert(iErr.message);
        return;
      }
    }

    setSaving(false);
    await refresh(user.id);
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  if (err) {
    return (
      <div style={{ padding: 18, fontFamily: "system-ui", maxWidth: 520, margin: "0 auto" }}>
        <h2>Profile</h2>
        <div><b>Error:</b> {err}</div>
        <button style={{ marginTop: 12 }} onClick={logout}>Logout</button>
      </div>
    );
  }

  if (!user || !profile) return <div style={{ padding: 18, fontFamily: "system-ui" }}>Loading…</div>;

  return (
    <div style={{ padding: 18, fontFamily: "system-ui", maxWidth: 520, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Profile</h2>
        <a href="/dashboard" style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 10, textDecoration: "none" }}>
          Back
        </a>
      </div>

      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Display name</div>
        <input
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          placeholder="Your name"
          style={{ width: "100%", padding: 12, fontSize: 16, marginTop: 10 }}
        />
        <button
          style={{ width: "100%", padding: 12, marginTop: 10, fontWeight: 900, opacity: saving ? 0.7 : 1 }}
          onClick={() => saveDisplayName(draftName)}
          disabled={saving}
        >
          Save name
        </button>
        <div style={{ marginTop: 10, fontSize: 13, opacity: 0.75 }}>
          Email: <b>{user.email}</b>
        </div>
      </div>

      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>This week</div>
        <div style={{ marginTop: 8, fontSize: 22, fontWeight: 900 }}>{weekPoints} points</div>
        <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75 }}>
          Workouts completed: {weekDoneCount}
        </div>
        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
          Week: {isoDay(weekStart)} → {isoDay(weekEnd)}
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <button style={{ width: "100%", padding: 12 }} onClick={logout}>Logout</button>
      </div>
    </div>
  );
}
