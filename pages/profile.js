// pages/profile.js
import { useEffect, useMemo, useRef, useState } from "react";
import BottomNav from "../components/Nav";
import { supabase } from "../lib/supabaseClient";
import { addDays, isoDate } from "../lib/weekTemplate";
import { logActivityEvent } from "../lib/activityEvents";

const PRIMARY = "#5B4FE9";
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

const pageStyle = {
  background: "#f2f2f7",
  minHeight: "100vh",
  fontFamily: FONT,
  paddingBottom: 88,
};

const card = {
  background: "#fff",
  borderRadius: 18,
  padding: 18,
  marginBottom: 12,
  boxShadow: "0 1px 3px rgba(0,0,0,0.07)",
};

const inputStyle = {
  width: "100%",
  padding: "11px 13px",
  fontSize: 15,
  borderRadius: 11,
  border: "1.5px solid #e5e5ea",
  background: "#f9f9f9",
  boxSizing: "border-box",
  fontFamily: FONT,
  marginTop: 8,
};

function mondayStart(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  x.setDate(x.getDate() + (day === 0 ? -6 : 1 - day));
  return x;
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function ensureProfileRow(userId) {
  const { data: existing, error } = await supabase
    .from("user_profiles").select("user_id").eq("user_id", userId).maybeSingle();
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
  const endExclusive = isoDate(addDays(weekEnd, 1));

  const nameSaveTimer = useRef(null);
  const [nameDraft, setNameDraft] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;
        if (!data?.user) { window.location.href = "/"; return; }
        setUser(data.user);
        await ensureProfileRow(data.user.id);
        await refresh(data.user.id);
      } catch (e) {
        setErr(e?.message || String(e));
      }
    })();
    return () => { if (nameSaveTimer.current) clearTimeout(nameSaveTimer.current); };
  }, []);

  async function ensureWorkoutDoneEvents(userId, donePlans) {
    if (!donePlans?.length) return;
    for (const p of donePlans) {
      try {
        await logActivityEvent({
          userId, teamId: null, planId: p.id, eventType: "workout_done",
          points: 10, eventDate: p.plan_date, meta: { source: "profile_sync" },
        });
      } catch (e) {
        console.warn("ensureWorkoutDoneEvents: failed for plan", p.id, e);
      }
    }
  }

  async function refresh(userId) {
    let targetWeight = null;
    {
      const { data: st, error: stErr } = await supabase
        .from("user_settings").select("target_weight_kg").eq("user_id", userId).maybeSingle();
      if (stErr) throw stErr;
      targetWeight = st?.target_weight_kg ?? null;
    }

    {
      const { data: p, error: pErr } = await supabase
        .from("user_profiles").select("*").eq("user_id", userId).maybeSingle();
      if (pErr) throw pErr;
      setProfile(p || null);
      setNameDraft(p?.display_name || "");
    }

    let donePlans = [];
    {
      const { data: doneRows, error: dErr } = await supabase
        .from("plans").select("id,plan_date").eq("user_id", userId).eq("status", "DONE")
        .gte("plan_date", startStr).lt("plan_date", endExclusive);
      if (dErr) throw dErr;
      donePlans = doneRows || [];
      setWeekDoneCount(donePlans.length);
    }

    await ensureWorkoutDoneEvents(userId, donePlans);

    {
      let total = 0;
      const { data: aData, error: aErr } = await supabase
        .from("activity_events").select("points")
        .eq("user_id", userId).gte("event_date", startStr).lte("event_date", endStr);

      if (!aErr && (aData || []).length) {
        total = aData.reduce((acc, r) => acc + Number(r.points || 0), 0);
      } else {
        const { data: pData } = await supabase
          .from("points_events").select("points")
          .eq("user_id", userId).gte("date", startStr).lte("date", endStr);
        total = (pData || []).reduce((acc, r) => acc + Number(r.points || 0), 0);
      }
      setWeekPoints(total);
    }

    {
      const lastEndExclusive = isoDate(addDays(lastWeekEnd, 1));

      const { data: thisWeekRows } = await supabase
        .from("weigh_ins").select("weight_kg,weigh_date").eq("user_id", userId)
        .gte("weigh_date", startStr).lt("weigh_date", endExclusive)
        .order("weigh_date", { ascending: false }).limit(1);

      const { data: lastWeekRows } = await supabase
        .from("weigh_ins").select("weight_kg,weigh_date").eq("user_id", userId)
        .gte("weigh_date", isoDate(lastWeekStart)).lt("weigh_date", lastEndExclusive)
        .order("weigh_date", { ascending: false }).limit(1);

      const thisWeight = safeNum(thisWeekRows?.[0]?.weight_kg);
      const lastWeight = safeNum(lastWeekRows?.[0]?.weight_kg);

      if (thisWeight == null && lastWeight == null) {
        setWeightStatus(null);
      } else {
        const delta = thisWeight != null && lastWeight != null ? thisWeight - lastWeight : null;
        setWeightStatus({ thisWeek: thisWeight, lastWeek: lastWeight, delta });
      }

      let latestWeight = thisWeight;
      if (latestWeight == null) {
        const { data: latestRows, error: latestErr } = await supabase
          .from("weigh_ins").select("weight_kg").eq("user_id", userId)
          .order("weigh_date", { ascending: false }).limit(1);
        if (!latestErr && latestRows?.[0]) latestWeight = safeNum(latestRows[0].weight_kg);
      }

      if (targetWeight != null && latestWeight != null) {
        setTargetProgress({ current: latestWeight, target: targetWeight, toGo: latestWeight - targetWeight });
      } else {
        setTargetProgress(null);
      }
    }

    setErr("");
  }

  async function saveDisplayName(name) {
    if (!user) return;
    const { error } = await supabase.from("user_profiles")
      .upsert({ user_id: user.id, display_name: (name || "").trim() }, { onConflict: "user_id" });
    if (error) { alert(error.message); return; }
    await refresh(user.id);
  }

  function onNameChange(next) {
    setNameDraft(next);
    if (nameSaveTimer.current) clearTimeout(nameSaveTimer.current);
    nameSaveTimer.current = setTimeout(() => saveDisplayName(next), 500);
  }

  if (err) {
    return (
      <div style={pageStyle}>
        <div style={{ padding: 18 }}><b>Error:</b> {err}</div>
        <BottomNav active="profile" />
      </div>
    );
  }

  if (!user || !profile) {
    return (
      <div style={pageStyle}>
        <div style={{ padding: "40px 18px", textAlign: "center", color: "#8e8e93" }}>Loading…</div>
        <BottomNav active="profile" />
      </div>
    );
  }

  const delta = weightStatus?.delta;
  const deltaLabel =
    delta == null ? null
    : delta === 0 ? "↔ Same"
    : delta < 0 ? `↓ ${Math.abs(delta).toFixed(1)} kg`
    : `↑ ${Math.abs(delta).toFixed(1)} kg`;

  return (
    <div style={pageStyle}>
      {/* Header */}
      <div style={{ padding: "24px 18px 4px" }}>
        <div style={{ fontSize: 13, color: "#8e8e93", marginBottom: 2 }}>{user.email}</div>
        <div style={{ fontSize: 28, fontWeight: 800, color: "#111", letterSpacing: -0.5 }}>
          {nameDraft || "Profile"}
        </div>
      </div>

      <div style={{ padding: "8px 18px 0" }}>
        {/* Display name */}
        <div style={card}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#8e8e93", letterSpacing: 1 }}>DISPLAY NAME</div>
          <input
            value={nameDraft}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Your name"
            style={inputStyle}
          />
        </div>

        {/* This week — dark card */}
        <div style={{ background: "#1e1b4b", borderRadius: 18, padding: 18, marginBottom: 12, color: "#fff" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.5)", letterSpacing: 1, marginBottom: 10 }}>
            THIS WEEK · {startStr} → {endStr}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontSize: 48, fontWeight: 900, letterSpacing: -2 }}>{weekPoints}</span>
            <span style={{ fontSize: 16, color: "rgba(255,255,255,0.6)" }}>points</span>
          </div>
          <div style={{ marginTop: 12, fontSize: 14, color: "rgba(255,255,255,0.7)" }}>
            🏋️ {weekDoneCount} workout{weekDoneCount !== 1 ? "s" : ""} completed
          </div>
        </div>

        {/* Weight trend */}
        <div style={card}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#8e8e93", letterSpacing: 1, marginBottom: 12 }}>
            WEIGHT TREND
          </div>
          {weightStatus ? (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {[
                { label: "This week", val: weightStatus.thisWeek != null ? `${weightStatus.thisWeek} kg` : "—" },
                { label: "Last week", val: weightStatus.lastWeek != null ? `${weightStatus.lastWeek} kg` : "—" },
                deltaLabel ? { label: "Change", val: deltaLabel, highlight: true } : null,
              ].filter(Boolean).map((s) => (
                <div
                  key={s.label}
                  style={{
                    flex: "1 1 80px", padding: "12px 14px", borderRadius: 13,
                    background: s.highlight ? "rgba(91,79,233,0.08)" : "#f9f9f9",
                  }}
                >
                  <div style={{ fontSize: 11, color: "#8e8e93", marginBottom: 4 }}>{s.label}</div>
                  <div style={{ fontWeight: 800, fontSize: 16, color: s.highlight ? PRIMARY : "#111" }}>{s.val}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: "#8e8e93", fontSize: 14 }}>No weigh-ins yet.</div>
          )}
        </div>

        {/* Target progress */}
        <div style={card}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#8e8e93", letterSpacing: 1, marginBottom: 12 }}>
            TARGET WEIGHT
          </div>
          {targetProgress ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
                <div>
                  <span style={{ fontSize: 32, fontWeight: 900 }}>{targetProgress.current.toFixed(1)}</span>
                  <span style={{ fontSize: 14, color: "#8e8e93", marginLeft: 4 }}>kg now</span>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 11, color: "#8e8e93" }}>Target</div>
                  <div style={{ fontWeight: 800, fontSize: 18, color: PRIMARY }}>{Number(targetProgress.target).toFixed(1)} kg</div>
                </div>
              </div>
              <div style={{ height: 8, borderRadius: 4, background: "#f2f2f7", overflow: "hidden", marginBottom: 8 }}>
                <div style={{
                  height: "100%",
                  width: targetProgress.toGo <= 0 ? "100%" : `${Math.max(4, Math.min(96, (1 - Math.abs(targetProgress.toGo) / Math.max(1, Math.abs(targetProgress.current - targetProgress.target + targetProgress.toGo))) * 100))}%`,
                  background: targetProgress.toGo <= 0 ? "#34c759" : PRIMARY,
                  borderRadius: 4, transition: "width 0.5s ease",
                }} />
              </div>
              <div style={{ fontSize: 13, color: "#8e8e93" }}>
                {targetProgress.toGo <= 0 ? "Target reached!" : `${Math.abs(targetProgress.toGo).toFixed(1)} kg to go`}
              </div>
            </>
          ) : (
            <div style={{ color: "#8e8e93", fontSize: 14 }}>
              Set a target weight in Settings to track progress.
            </div>
          )}
        </div>
      </div>

      <BottomNav active="profile" />
    </div>
  );
}
