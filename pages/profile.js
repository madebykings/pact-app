import { useEffect, useMemo, useRef, useState } from "react";
import TopNav from "../components/Nav";
import { supabase } from "../lib/supabaseClient";

function startOfWeek(d) {
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

async function ensureProfileRow(userId) {
  const { data: existing, error } = await supabase
    .from("user_profiles")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;

  if (!existing) {
    const { error: insErr } = await supabase
      .from("user_profiles")
      .insert({ user_id: userId, display_name: "" });
    if (insErr) throw insErr;
  }
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

  const lastWeekEnd = useMemo(() => new Date(weekStart), [weekStart]);

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

        await ensureProfileRow(data.user.id);
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
    // settings (for target weight + team)
    let teamId = null;
    let targetWeight = null;
    {
      const { data: st } = await supabase
        .from("user_settings")
        .select("team_id,target_weight_kg")
        .eq("user_id", userId)
        .maybeSingle();

      teamId = st?.team_id || null;
      targetWeight = st?.target_weight_kg ?? null;
    }

    // profile
    {
      const { data: p, error: pErr } = await supabase
        .from("user_profiles")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (pErr) throw pErr;
      setProfile(p || null);
      setNameDraft(p?.display_name || "");
    }

    // ✅ POINTS: match Leaderboard = activity_events by event_date
    {
      const startStr = isoDay(weekStart);
      const endStr = isoDay(new Date(weekEnd.getTime() - 1));

      let q = supabase
        .from("activity_events")
        .select("points")
        .eq("user_id", userId)
        .gte("event_date", startStr)
        .lte("event_date", endStr);

      // If team mode, points are still fine by user_id alone,
      // but this keeps it consistent with team-scoped writes.
      if (teamId) q = q.eq("team_id", teamId);

      const { data: ae, error: aeErr } = await q;

      if (aeErr) {
        setWeekPoints(0);
      } else {
        const total = (ae || []).reduce((sum, r) => sum + Number(r.points || 0), 0);
        setWeekPoints(total);
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

    // ✅ weight status should use weigh_date + weight_kg (not created_at / kg)
    {
      const { data: thisWeekRows } = await supabase
        .from("weigh_ins")
        .select("weight_kg,weigh_date")
        .eq("user_id", userId)
        .gte("weigh_date", isoDay(weekStart))
        .lt("weigh_date", isoDay(weekEnd))
        .order("weigh_date", { ascending: false })
        .limit(1);

      const { data: lastWeekRows } = await supabase
        .from("weigh_ins")
        .select("weight_kg,weigh_date")
        .eq("user_id", userId)
        .gte("weigh_date", isoDay(lastWeekStart))
        .lt("weigh_date", isoDay(lastWeekEnd))
        .order("weigh_date", { ascending: false })
        .limit(1);

      const tw = thisWeekRows?.[0] || null;
      const lw = lastWeekRows?.[0] || null;

      const thisWeight = safeNum(tw?.weight_kg);
      const lastWeight = safeNum(lw?.weight_kg);

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

      if (targetWeight != null && thisWeight != null) {
        const toGo = thisWeight - targetWeight;
        setTargetProgress({ current: thisWeight, target: targetWeight, toGo });
      } else {
        setTargetProgress(null);
      }
    }
  }

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
        <TopNav active="profile" onLogout={logout} />
        <div style={{ padding: 18, maxWidth: 980, margin: "0 auto" }}>Loading…</div>
      </div>
    );
  }

  const delta = weightStatus?.delta;
  const deltaLabel =
    delta == null ? null : delta === 0 ? "↔ same" : delta < 0 ? `↓ ${Math.abs(delta).toFixed(1)}` : `↑ ${Math.abs(delta).toFixed(1)}`;

  return (
    <div>
      <TopNav active="profile" onLogout={logout} />

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
      </div>
    </div>
  );
}
