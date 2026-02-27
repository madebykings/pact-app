// pages/profile.js
import { useEffect, useMemo, useRef, useState } from "react";
import TopNav from "../components/Nav";
import { supabase } from "../lib/supabaseClient";

function startOfWeek(d) {
  // Monday start
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

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default function Profile() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);

  const [weekPoints, setWeekPoints] = useState(0);
  const [weekDoneCount, setWeekDoneCount] = useState(0);

  const [weightStatus, setWeightStatus] = useState(null); // { thisWeek, lastWeek, delta }
  const [targetProgress, setTargetProgress] = useState(null); // { current, target, toGo }

  const [err, setErr] = useState("");

  const now = useMemo(() => new Date(), []);
  const weekStart = useMemo(() => startOfWeek(now), [now]);
  const weekEnd = useMemo(() => {
    const x = new Date(weekStart);
    x.setDate(x.getDate() + 7);
    return x;
  }, [weekStart]);

  const lastWeekStart = useMemo(() => {
    const x = new Date(weekStart);
    x.setDate(x.getDate() - 7);
    return x;
  }, [weekStart]);

  const lastWeekEnd = useMemo(() => {
    const x = new Date(weekStart);
    return x;
  }, [weekStart]);

  // Debounce display-name saves so typing doesn't spam DB
  const nameSaveTimer = useRef(null);
  const [nameDraft, setNameDraft] = useState("");

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

        // Ensure profile row exists WITHOUT overwriting existing values
const { data: existingProfile, error: profSelErr } = await supabase
  .from("user_profiles")
  .select("user_id")
  .eq("user_id", data.user.id)
  .maybeSingle();

if (profSelErr) throw profSelErr;

if (!existingProfile) {
  const { error: profInsErr } = await supabase
    .from("user_profiles")
    .insert({ user_id: data.user.id, display_name: "" });
  if (profInsErr) throw profInsErr;
}

        await refresh(data.user.id);
      } catch (e) {
        setErr(e?.message || String(e));
      }
    })();

    return () => {
      if (nameSaveTimer.current) clearTimeout(nameSaveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh(userId) {
    // user settings (for team + target weight)
    let teamId = null;
    let targetWeight = null;
    {
      const { data: st, error: stErr } = await supabase
        .from("user_settings")
        .select("team_id,target_weight_kg")
        .eq("user_id", userId)
        .maybeSingle();
      if (!stErr) {
        teamId = st?.team_id || null;
        targetWeight = st?.target_weight_kg ?? null;
      }
    }

    // profile
    {
      const { data: p, error: pErr } = await supabase
        .from("user_profiles")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (pErr) throw pErr;
      const prof = p || null;
      setProfile(prof);
      setNameDraft(prof?.display_name || "");

      if (targetWeight == null) targetWeight = prof?.target_weight_kg ?? null;
    }

    // ✅ points this week
    // Prefer activity_events (team aware), fallback to events / points_events.
    {
      // 1) activity_events (if present)
      const startStr = isoDay(weekStart);
      const endStr = isoDay(new Date(weekEnd.getTime() - 1));

      const { data: ae, error: aeErr } = await supabase
        .from("activity_events")
        .select("points")
        .eq("user_id", userId)
        .gte("event_date", startStr)
        .lte("event_date", endStr);

      if (!aeErr && Array.isArray(ae)) {
        const total = ae.reduce((sum, r) => sum + Number(r.points || 0), 0);
        setWeekPoints(total);
      } else {
        // 2) events
        const { data: ev, error: evErr } = await supabase
          .from("events")
          .select("points,created_at")
          .eq("user_id", userId)
          .gte("created_at", weekStart.toISOString())
          .lt("created_at", weekEnd.toISOString());

        if (!evErr) {
          const total = (ev || []).reduce((sum, r) => sum + Number(r.points || 0), 0);
          setWeekPoints(total);
        } else {
          // 3) points_events (legacy)
          const { data: pts, error: ptsErr } = await supabase
            .from("points_events")
            .select("points,created_at")
            .eq("user_id", userId)
            .gte("created_at", weekStart.toISOString())
            .lt("created_at", weekEnd.toISOString());

          if (!ptsErr) {
            const total = (pts || []).reduce((sum, r) => sum + Number(r.points || 0), 0);
            setWeekPoints(total);
          } else {
            setWeekPoints(0);
          }
        }
      }
    }

    // workouts done this week (plans)
    {
      const { data: doneRows, error: dErr } = await supabase
        .from("plans")
        .select("id")
        .eq("user_id", userId)
        .eq("status", "DONE")
        .gte("plan_date", isoDay(weekStart))
        .lt("plan_date", isoDay(weekEnd));
      if (!dErr) setWeekDoneCount((doneRows || []).length);
      else setWeekDoneCount(0);
    }

    // ✅ weight status (this week vs last week)
    {
      const { data: thisWeekRows } = await supabase
        .from("weigh_ins")
        .select("*")
        .eq("user_id", userId)
        .gte("created_at", weekStart.toISOString())
        .lt("created_at", weekEnd.toISOString())
        .order("created_at", { ascending: false })
        .limit(1);

      const { data: lastWeekRows } = await supabase
        .from("weigh_ins")
        .select("*")
        .eq("user_id", userId)
        .gte("created_at", lastWeekStart.toISOString())
        .lt("created_at", lastWeekEnd.toISOString())
        .order("created_at", { ascending: false })
        .limit(1);

      const tw = thisWeekRows?.[0] || null;
      const lw = lastWeekRows?.[0] || null;

      const thisWeight = safeNum(tw?.weight ?? tw?.kg);
      const lastWeight = safeNum(lw?.weight ?? lw?.kg);

      if (thisWeight == null && lastWeight == null) {
        setWeightStatus(null);
      } else {
        const delta = thisWeight != null && lastWeight != null ? thisWeight - lastWeight : null;
        setWeightStatus({
          thisWeek: thisWeight,
          lastWeek: lastWeight,
          delta,
        });
      }

      // progress to target
      if (targetWeight != null && thisWeight != null) {
        const toGo = thisWeight - targetWeight;
        setTargetProgress({ current: thisWeight, target: targetWeight, toGo });
      } else {
        setTargetProgress(null);
      }
    }
  }

  // ✅ FIX: remove updated_at write (your table doesn’t have it, so schema cache errors)
  async function saveDisplayName(name) {
  if (!user) return;
  const clean = (name || "").trim();

  const { error } = await supabase
    .from("user_profiles")
    .upsert({ user_id: user.id, display_name: clean }, { onConflict: "user_id" });

  if (error) {
    alert(error.message);
    return;
  }
  await refresh(user.id);
}

  function onNameChange(next) {
    setNameDraft(next);

    // debounce writes
    if (nameSaveTimer.current) clearTimeout(nameSaveTimer.current);
    nameSaveTimer.current = setTimeout(() => {
      saveDisplayName(next);
    }, 500);
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  if (err) {
    return (
      <div>
        <TopNav active="profile" onLogout={logout} />
        <div style={{ padding: 18, maxWidth: 980, margin: "0 auto" }}>
          <h1 style={{ margin: "0 0 14px" }}>Profile</h1>
          <div>
            <b>Error:</b> {err}
          </div>
        </div>
      </div>
    );
  }

  if (!user || !profile) {
    return (
      <div>
        {/* ✅ FIX: nav present even while loading */}
        <TopNav active="profile" onLogout={logout} />
        <div style={{ padding: 18, maxWidth: 980, margin: "0 auto" }}>Loading…</div>
      </div>
    );
  }

  const delta = weightStatus?.delta;
  const deltaLabel =
    delta == null
      ? null
      : delta === 0
      ? "↔ same"
      : delta < 0
      ? `↓ ${Math.abs(delta).toFixed(1)}`
      : `↑ ${Math.abs(delta).toFixed(1)}`;

  return (
    <div>
      {/* ✅ FIX: nav menu rendered on profile page */}
      <TopNav active="profile" onLogout={logout} />

      {/* ✅ Match Dashboard page styling */}
      <div style={{ padding: 18, maxWidth: 980, margin: "0 auto" }}>
        <h1 style={{ margin: "0 0 14px" }}>Profile</h1>

        <div style={{ padding: 14, border: "1px solid rgba(0,0,0,.08)", borderRadius: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 14, opacity: 0.8 }}>Display name</div>
          <input
            value={nameDraft}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Your name"
            style={{ width: "100%", padding: 12, fontSize: 16, marginTop: 10 }}
          />
          <div style={{ marginTop: 10, fontSize: 13, opacity: 0.75 }}>
            Email: <b>{user.email}</b>
          </div>
        </div>

        <div style={{ padding: 14, border: "1px solid rgba(0,0,0,.08)", borderRadius: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 14, opacity: 0.8 }}>This week</div>
          <div style={{ marginTop: 8, fontSize: 22, fontWeight: 900 }}>{weekPoints} points</div>
          <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75 }}>Workouts completed: {weekDoneCount}</div>

          {/* ✅ Weight status */}
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(0,0,0,.06)" }}>
            <div style={{ fontSize: 14, opacity: 0.8 }}>Weight trend</div>
            {weightStatus ? (
              <div style={{ marginTop: 6, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "baseline" }}>
                <div>
                  <span style={{ opacity: 0.7, fontSize: 13 }}>This week: </span>
                  <b>{weightStatus.thisWeek != null ? weightStatus.thisWeek : "—"}</b>
                </div>
                <div>
                  <span style={{ opacity: 0.7, fontSize: 13 }}>Last week: </span>
                  <b>{weightStatus.lastWeek != null ? weightStatus.lastWeek : "—"}</b>
                </div>
                {deltaLabel ? (
                  <div>
                    <span style={{ opacity: 0.7, fontSize: 13 }}>Change: </span>
                    <b>{deltaLabel}</b>
                  </div>
                ) : null}
              </div>
            ) : (
              <div style={{ marginTop: 6, opacity: 0.7 }}>No weigh-ins yet.</div>
            )}
          </div>

          {/* ✅ Progress to target */}
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(0,0,0,.06)" }}>
            <div style={{ fontSize: 14, opacity: 0.8 }}>Progress to target</div>
            {targetProgress ? (
              <div style={{ marginTop: 6, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "baseline" }}>
                <div>
                  <span style={{ opacity: 0.7, fontSize: 13 }}>Current: </span>
                  <b>{targetProgress.current.toFixed(1)}kg</b>
                </div>
                <div>
                  <span style={{ opacity: 0.7, fontSize: 13 }}>Target: </span>
                  <b>{Number(targetProgress.target).toFixed(1)}kg</b>
                </div>
                <div>
                  <span style={{ opacity: 0.7, fontSize: 13 }}>To go: </span>
                  <b>{Math.abs(targetProgress.toGo).toFixed(1)}kg {targetProgress.toGo > 0 ? "↓" : "✓"}</b>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 6, opacity: 0.7 }}>Set a target weight in Settings to see progress.</div>
            )}
          </div>

          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
            Week: {isoDay(weekStart)} → {isoDay(weekEnd)}
          </div>
        </div>

        {/* Push settings live in /settings */}
      </div>
    </div>
  );
}
