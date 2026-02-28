// pages/profile.js
import { useEffect, useMemo, useRef, useState } from "react";
import TopNav from "../components/Nav";
import { supabase } from "../lib/supabaseClient";
import { addDays, isoDate } from "../lib/weekTemplate";

function mondayStart(d) {
  const x = new Date(d);
  const day = x.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
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
    const { error: insErr } = await supabase.from("user_profiles").insert({ user_id: userId, display_name: "" });
    if (insErr) throw insErr;
  }
}

export default function Profile() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);

  const [weekPoints, setWeekPoints] = useState(0);
  const [weekDoneCount, setWeekDoneCount] = useState(0);

  const [weightStatus, setWeightStatus] = useState(null);
  const [targetProgress, setTargetProgress] = useState(null);

  const [err, setErr] = useState("");

  const now = useMemo(() => new Date(), []);
  const weekStart = useMemo(() => mondayStart(now), [now]);
  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);
  const lastWeekStart = useMemo(() => addDays(weekStart, -7), [weekStart]);
  const lastWeekEnd = useMemo(() => addDays(lastWeekStart, 6), [lastWeekStart]);

  const startStr = isoDate(weekStart);
  const endStr = isoDate(weekEnd);

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
  }, []);

  async function refresh(userId) {
    // settings (target weight)
    let targetWeight = null;
    {
      const { data: st, error: stErr } = await supabase
        .from("user_settings")
        .select("target_weight_kg")
        .eq("user_id", userId)
        .maybeSingle();
      if (stErr) throw stErr;
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

    // ✅ weekly points: activity_events primary, points_events fallback
    {
      let total = 0;

      const { data: aData, error: aErr } = await supabase
        .from("activity_events")
        .select("points,event_date")
        .eq("user_id", userId)
        .gte("event_date", startStr)
        .lte("event_date", endStr);

      if (aErr) {
        console.warn("profile activity_events error:", aErr);
      } else if ((aData || []).length) {
        total = (aData || []).reduce((acc, r) => acc + Number(r.points || 0), 0);
      }

      if (!total) {
        const { data: pData, error: pErr } = await supabase
          .from("points_events")
          .select("points,date")
          .eq("user_id", userId)
          .gte("date", startStr)
          .lte("date", endStr);

        if (pErr) {
          console.warn("profile points_events fallback error:", pErr);
        } else {
          total = (pData || []).reduce((acc, r) => acc + Number(r.points || 0), 0);
        }
      }

      setWeekPoints(total);
    }

    // workouts done count this week from plans (truth for “completed”)
    {
      const endExclusive = isoDate(addDays(weekEnd, 1));
      const { data: doneRows, error: dErr } = await supabase
        .from("plans")
        .select("id")
        .eq("user_id", userId)
        .eq("status", "DONE")
        .gte("plan_date", startStr)
        .lt("plan_date", endExclusive);

      if (dErr) throw dErr;
      setWeekDoneCount((doneRows || []).length);
    }

    // weight trend
    {
      const endExclusive = isoDate(addDays(weekEnd, 1));
      const lastEndExclusive = isoDate(addDays(lastWeekEnd, 1));

      const { data: thisWeekRows, error: twErr } = await supabase
        .from("weigh_ins")
        .select("weight_kg,weigh_date")
        .eq("user_id", userId)
        .gte("weigh_date", startStr)
        .lt("weigh_date", endExclusive)
        .order("weigh_date", { ascending: false })
        .limit(1);
      if (twErr) throw twErr;

      const { data: lastWeekRows, error: lwErr } = await supabase
        .from("weigh_ins")
        .select("weight_kg,weigh_date")
        .eq("user_id", userId)
        .gte("weigh_date", isoDate(lastWeekStart))
        .lt("weigh_date", lastEndExclusive)
        .order("weigh_date", { ascending: false })
        .limit(1);
      if (lwErr) throw lwErr;

      const tw = thisWeekRows?.[0] || null;
      const lw = lastWeekRows?.[0] || null;

      const thisWeight = safeNum(tw?.weight_kg);
      const lastWeight = safeNum(lw?.weight_kg);

      if (thisWeight == null && lastWeight == null) {
        setWeightStatus(null);
      } else {
        const delta = thisWeight != null && lastWeight != null ? thisWeight - lastWeight : null;
        setWeightStatus({ thisWeek: thisWeight, lastWeek: lastWeight, delta });
      }

      if (targetWeight != null && thisWeight != null) {
        const toGo = thisWeight - targetWeight;
        setTargetProgress({ current: thisWeight, target: targetWeight, toGo });
      } else {
        setTargetProgress(null);
      }
    }

    setErr("");
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
                  <b>
                    {Math.abs(targetProgress.toGo).toFixed(1)}kg {targetProgress.toGo > 0 ? "↓" : "✓"}
                  </b>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 6, opacity: 0.7 }}>Set a target weight in Settings to see progress.</div>
            )}
          </div>

          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
            Week: {startStr} → {endStr}
          </div>
        </div>
      </div>
    </div>
  );
}
