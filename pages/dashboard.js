// pages/dashboard.js
import { useEffect, useMemo, useRef, useState } from "react";
import BottomNav from "../components/Nav";
import { supabase } from "../lib/supabaseClient";
import { addDays, isoDate, planTypeForDate } from "../lib/weekTemplate";
import { logActivityEvent } from "../lib/activityEvents";

const ALL_ACTIVITIES = [
  { value: "REST", label: "Rest" },
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

const PLAN_EMOJI = {
  HIIT: "🔥", SPIN: "🚴", WEIGHTS: "🏋️", REST: "😴",
  RUN: "🏃", WALK: "🚶", SWIM: "🏊", HILLWALK: "🏔️",
  YOGA: "🧘", PILATES: "🤸", MOBILITY: "🦵", OTHER: "⭐",
};

const PRIMARY = "#5B4FE9";
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

function mondayStart(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}

function calcSleepHours(bedTime, wakeTime) {
  if (!bedTime || !wakeTime) return null;
  const [bh, bm] = bedTime.split(":").map(Number);
  const [wh, wm] = wakeTime.split(":").map(Number);
  if (![bh, bm, wh, wm].every((n) => Number.isFinite(n))) return null;
  const bed = bh * 60 + bm;
  let wake = wh * 60 + wm;
  if (wake <= bed) wake += 24 * 60;
  return (wake - bed) / 60;
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

export default function Dashboard() {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(null);

  const [todayPlan, setTodayPlan] = useState(null);
  const [tomorrowPlan, setTomorrowPlan] = useState(null);
  const [weekPlans, setWeekPlans] = useState([]);
  const [weekTab, setWeekTab] = useState("upcoming");

  const [water, setWater] = useState(null);

  const [supps, setSupps] = useState([]);
  const [takenMap, setTakenMap] = useState({});

  const [sleep, setSleep] = useState(null);
  const [weighIn, setWeighIn] = useState(null);

  const [errMsg, setErrMsg] = useState("");

  const tomorrowTimeTimer = useRef(null);

  const today = useMemo(() => new Date(), []);
  const tomorrow = useMemo(() => addDays(today, 1), [today]);
  const todayStr = isoDate(today);
  const tomorrowStr = isoDate(tomorrow);

  const weekStart = useMemo(() => mondayStart(today), [today]);
  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);
  const weekStartStr = isoDate(weekStart);
  const weekEndStr = isoDate(weekEnd);

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;
        const u = data?.user || null;
        setUser(u);
        if (!u?.id) return;
        await bootstrapDefaults(u.id);
        await refreshAll(u.id);
      } catch (e) {
        console.warn(e);
        setErrMsg(e?.message || "Failed to load.");
      }
    })();
    return () => {
      if (tomorrowTimeTimer.current) clearTimeout(tomorrowTimeTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  async function ensurePlan(userId, d) {
    const dateStr = isoDate(d);
    const { data: existing, error: selErr } = await supabase
      .from("plans")
      .select("id")
      .eq("user_id", userId)
      .eq("plan_date", dateStr)
      .maybeSingle();
    if (selErr) throw selErr;
    if (existing?.id) return;
    const { error: insErr } = await supabase.from("plans").insert({
      user_id: userId,
      plan_date: dateStr,
      plan_type: planTypeForDate(d),
      status: "PLANNED",
    });
    if (insErr) throw insErr;
  }

  async function bootstrapDefaults(userId) {
    await ensureProfileRow(userId);

    {
      const { error } = await supabase.from("user_settings").upsert(
        {
          user_id: userId,
          mode: "solo",
          tone: "normal",
          timezone: "Europe/London",
          water_target_ml: 3000,
          sleep_target_hours: 8,
          included_activities: [
            "WALK", "RUN", "SPIN", "SWIM", "HILLWALK",
            "WEIGHTS", "HIIT", "YOGA", "PILATES", "MOBILITY", "OTHER",
          ],
        },
        { onConflict: "user_id", ignoreDuplicates: true }
      );
      if (error) throw error;
    }

    {
      const { data: existing, error: selErr } = await supabase
        .from("water_logs")
        .select("user_id")
        .eq("user_id", userId)
        .eq("log_date", todayStr)
        .maybeSingle();
      if (selErr) throw selErr;
      if (!existing) {
        let wErr = null;
        const { error: e1 } = await supabase.from("water_logs").insert({ user_id: userId, log_date: todayStr, ml_total: 0 });
        wErr = e1;
        if (wErr && String(wErr.message || "").toLowerCase().includes("ml_total")) {
          const { error: e2 } = await supabase.from("water_logs").insert({ user_id: userId, log_date: todayStr, ml: 0 });
          wErr = e2;
        }
        if (wErr) throw wErr;
      }
    }

    await ensurePlan(userId, today);
    await ensurePlan(userId, tomorrow);

    {
      const { data: existing, error: exErr } = await supabase.from("supplements").select("id").eq("user_id", userId).limit(1);
      if (exErr) throw exErr;
      if (!existing || existing.length === 0) {
        const defaults = [
          { name: "Creatine", rule_type: "PRE_WORKOUT", offset_minutes: -45 },
          { name: "L-Carnitine", rule_type: "PRE_WORKOUT", offset_minutes: -30 },
          { name: "Cod Liver Oil", rule_type: "MORNING_WINDOW", window_start: "06:00", window_end: "10:00" },
          { name: "Tongkat Ali", rule_type: "MORNING_WINDOW", window_start: "06:00", window_end: "10:00" },
          { name: "Shilajit", rule_type: "MORNING_WINDOW", window_start: "06:00", window_end: "10:00" },
          { name: "Collagen", rule_type: "MIDDAY_WINDOW", window_start: "10:00", window_end: "16:00" },
          { name: "Ashwagandha", rule_type: "EVENING_WINDOW", window_start: "18:00", window_end: "23:59" },
          { name: "Magnesium", rule_type: "EVENING_WINDOW", window_start: "18:00", window_end: "23:59" },
          { name: "ZMA", rule_type: "EVENING_WINDOW", window_start: "18:00", window_end: "23:59" },
          { name: "B12 Coffee", rule_type: "MORNING_WINDOW", window_start: "06:00", window_end: "10:00" },
        ].map((s) => ({ ...s, user_id: userId, active: true }));
        const { error: insErr } = await supabase.from("supplements").insert(defaults);
        if (insErr) throw insErr;
      }
    }

    {
      const { data: sl, error: slErr } = await supabase
        .from("sleep_logs")
        .select("id")
        .eq("user_id", userId)
        .eq("log_date", todayStr)
        .maybeSingle();
      if (slErr) throw slErr;
      if (!sl?.id) {
        const { error: insErr } = await supabase.from("sleep_logs").insert({
          user_id: userId, log_date: todayStr, bed_time: null, wake_time: null,
        });
        if (insErr) throw insErr;
      }
    }
  }

  async function fetchPlan(userId, dateStr) {
    const { data, error } = await supabase.from("plans").select("*").eq("user_id", userId).eq("plan_date", dateStr).maybeSingle();
    if (error) throw error;
    return data;
  }

  async function refreshAll(userId) {
    {
      const { data: st, error: stErr } = await supabase.from("user_settings").select("*").eq("user_id", userId).maybeSingle();
      if (stErr) throw stErr;
      setSettings(st || null);
    }

    setTodayPlan(await fetchPlan(userId, todayStr));
    setTomorrowPlan(await fetchPlan(userId, tomorrowStr));

    {
      const { data: wp, error: wpErr } = await supabase
        .from("plans").select("*").eq("user_id", userId)
        .gte("plan_date", weekStartStr).lte("plan_date", weekEndStr).order("plan_date");
      if (wpErr) throw wpErr;
      setWeekPlans(wp || []);
    }

    {
      const { data: w, error: wErr } = await supabase.from("water_logs").select("*").eq("user_id", userId).eq("log_date", todayStr).maybeSingle();
      if (wErr) throw wErr;
      setWater(w || null);
    }

    let mySupps = [];
    {
      const { data: s, error: sErr } = await supabase.from("supplements").select("*").eq("user_id", userId).eq("active", true).order("name");
      if (sErr) throw sErr;
      mySupps = s || [];
      setSupps(mySupps);
    }

    {
      const { data: logs, error: lErr } = await supabase.from("supplement_logs").select("*").eq("log_date", todayStr);
      if (lErr) throw lErr;
      const myIds = new Set(mySupps.map((s) => s.id));
      const map = {};
      (logs || []).forEach((r) => { if (myIds.has(r.supplement_id)) map[r.supplement_id] = true; });
      setTakenMap(map);
    }

    {
      const { data: sl, error: slErr } = await supabase.from("sleep_logs").select("*").eq("user_id", userId).eq("log_date", todayStr).maybeSingle();
      if (slErr) throw slErr;
      setSleep(sl || null);
    }

    {
      const { data: w, error: wErr } = await supabase
        .from("weigh_ins").select("id,user_id,weigh_date,weight_kg")
        .eq("user_id", userId).order("weigh_date", { ascending: false }).limit(1);
      if (wErr) throw wErr;
      setWeighIn(w?.[0] || null);
    }
  }

  async function markDone(plan) {
    try {
      const { error } = await supabase.from("plans").update({ status: "DONE" }).eq("id", plan.id);
      if (error) throw error;
      await logActivityEvent({ userId: user.id, teamId: settings?.team_id || null, planId: plan.id, eventType: "workout_done", points: 10, eventDate: plan.plan_date, meta: { plan_id: plan.id, plan_type: plan.plan_type } });
      await refreshAll(user.id);
    } catch (e) { console.warn(e); setErrMsg(e?.message || "Failed to mark done."); }
  }

  async function cancel(plan) {
    try {
      const reason = prompt("Reason (illness/work/family/couldn't be bothered)?") || "unspecified";
      const { error } = await supabase.from("plans").update({ status: "CANCELLED", cancel_reason: reason }).eq("id", plan.id);
      if (error) throw error;
      await logActivityEvent({ userId: user.id, teamId: settings?.team_id || null, planId: plan.id, eventType: "workout_cancel", points: -5, eventDate: plan.plan_date, meta: { plan_id: plan.id, plan_type: plan.plan_type, reason } });
      await refreshAll(user.id);
    } catch (e) { console.warn(e); setErrMsg(e?.message || "Failed to cancel."); }
  }

  async function undoDone(plan) {
    try {
      const { error } = await supabase.from("plans").update({ status: "PLANNED" }).eq("id", plan.id);
      if (error) throw error;
      await logActivityEvent({ userId: user.id, teamId: settings?.team_id || null, planId: plan.id, eventType: "undo_workout_done", points: -10, eventDate: plan.plan_date, meta: { plan_id: plan.id } });
      await refreshAll(user.id);
    } catch (e) { console.warn(e); setErrMsg(e?.message || "Failed to undo."); }
  }

  async function undoCancel(plan) {
    try {
      const { error } = await supabase.from("plans").update({ status: "PLANNED", cancel_reason: null }).eq("id", plan.id);
      if (error) throw error;
      await logActivityEvent({ userId: user.id, teamId: settings?.team_id || null, planId: plan.id, eventType: "undo_workout_cancel", points: 5, eventDate: plan.plan_date, meta: { plan_id: plan.id } });
      await refreshAll(user.id);
    } catch (e) { console.warn(e); setErrMsg(e?.message || "Failed to undo."); }
  }

  async function moveTodayTime(t) {
    try {
      const { error } = await supabase.from("plans").update({ planned_time: t || null }).eq("id", todayPlan.id);
      if (error) throw error;
      await refreshAll(user.id);
    } catch (e) { console.warn(e); setErrMsg(e?.message || "Failed to update time."); }
  }

  async function setTomorrowTime(t) {
    try {
      const { error } = await supabase.from("plans").update({ planned_time: t || null }).eq("id", tomorrowPlan.id);
      if (error) throw error;
      await logActivityEvent({ userId: user.id, teamId: settings?.team_id || null, planId: tomorrowPlan.id, eventType: "set_tomorrow_time", points: t ? 3 : -3, eventDate: tomorrowPlan.plan_date, meta: { plan_id: tomorrowPlan.id, planned_time: t || null } });
      await refreshAll(user.id);
    } catch (e) { console.warn(e); setErrMsg(e?.message || "Failed to update time."); }
  }

  async function addWater(delta) {
    try {
      const current = water?.ml_total ?? water?.ml ?? 0;
      const next = Math.max(0, current + delta);
      let err = null;
      { const { error } = await supabase.from("water_logs").upsert({ user_id: user.id, log_date: todayStr, ml_total: next }, { onConflict: "user_id,log_date" }); err = error; }
      if (err && String(err.message || "").toLowerCase().includes("ml_total")) {
        const { error } = await supabase.from("water_logs").upsert({ user_id: user.id, log_date: todayStr, ml: next }, { onConflict: "user_id,log_date" }); err = error;
      }
      if (err) throw err;
      const waterTargetMl = settings?.water_target_ml || 3000;
      if (next >= waterTargetMl) {
        await logActivityEvent({ userId: user.id, teamId: settings?.team_id || null, eventType: "water_hit_target", points: 2, eventDate: todayStr, meta: { ml: next, target_ml: waterTargetMl } });
      }
      await refreshAll(user.id);
    } catch (e) { console.warn(e); setErrMsg(e?.message || "Failed to update water."); }
  }

  function suppWhenLabel(s, plannedTime) {
    const rt = s.rule_type;
    if (rt === "MORNING_WINDOW") return `Morning (${s.window_start || "06:00"}–${s.window_end || "10:00"})`;
    if (rt === "MIDDAY_WINDOW") return `Midday (${s.window_start || "10:00"}–${s.window_end || "16:00"})`;
    if (rt === "EVENING_WINDOW") return `Evening (${s.window_start || "18:00"}–${s.window_end || "23:59"})`;
    if (rt === "BED_WINDOW") return `Before bed (${s.window_start || "21:00"}–${s.window_end || "23:59"})`;
    if (rt === "PRE_WORKOUT") {
      if (!plannedTime) return "Pre-workout";
      return `${Math.abs(Number(s.offset_minutes || 0))}m before workout`;
    }
    if (rt === "POST_WORKOUT") return "Post-workout";
    return "";
  }

  async function tickSupplement(supplementId) {
    try {
      const taken = !!takenMap[supplementId];
      if (taken) {
        const { error } = await supabase.from("supplement_logs").delete().eq("supplement_id", supplementId).eq("log_date", todayStr);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("supplement_logs").insert({ supplement_id: supplementId, log_date: todayStr });
        if (error) throw error;
      }
      await refreshAll(user.id);
    } catch (e) { console.warn(e); setErrMsg(e?.message || "Failed to toggle supplement."); }
  }

  async function updateSleepField(field, value) {
    try {
      const { error } = await supabase.from("sleep_logs").update({ [field]: value }).eq("user_id", user.id).eq("log_date", todayStr);
      if (error) throw error;
      const nextSleep = { ...(sleep || {}), [field]: value };
      const hrs = calcSleepHours(nextSleep.bed_time, nextSleep.wake_time);
      if (hrs != null && hrs >= (settings?.sleep_target_hours ?? 8)) {
        await logActivityEvent({ userId: user.id, teamId: settings?.team_id || null, eventType: "sleep_hit_target", points: 2, eventDate: todayStr, meta: { hours: hrs, target_hours: settings?.sleep_target_hours ?? 8 } });
      }
      await refreshAll(user.id);
    } catch (e) { console.warn(e); setErrMsg(e?.message || "Failed to update sleep."); }
  }

  async function addWeighIn(kgVal) {
    try {
      const kg = Number(kgVal);
      if (!Number.isFinite(kg) || kg <= 0) return alert("Enter a valid weight in kg");
      const { error } = await supabase.from("weigh_ins").upsert(
        { user_id: user.id, weigh_date: todayStr, weight_kg: kg },
        { onConflict: "user_id,weigh_date" }
      );
      if (error) throw error;
      await refreshAll(user.id);
    } catch (e) { console.warn(e); setErrMsg(e?.message || "Failed to add weigh-in."); }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dateLabel = `${dayNames[today.getDay()]}, ${today.getDate()} ${monthNames[today.getMonth()]}`;

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
  };

  if (errMsg && todayPlan === null) {
    return (
      <div style={pageStyle}>
        <div style={{ padding: "24px 18px 0" }}>
          <div style={{ fontSize: 26, fontWeight: 800 }}>Dashboard</div>
        </div>
        <div style={{ margin: 18, padding: 16, background: "#fff0f0", borderRadius: 14, color: "#c00", fontSize: 14 }}>
          {errMsg}
        </div>
        <BottomNav active="dashboard" onLogout={logout} />
      </div>
    );
  }

  if (todayPlan === null || tomorrowPlan === null) {
    return (
      <div style={pageStyle}>
        <div style={{ padding: "24px 18px 0" }}>
          <div style={{ fontSize: 26, fontWeight: 800 }}>Dashboard</div>
        </div>
        <div style={{ padding: "40px 18px", textAlign: "center", color: "#8e8e93", fontSize: 15 }}>
          Loading…
        </div>
        <BottomNav active="dashboard" onLogout={logout} />
      </div>
    );
  }

  const waterTargetMl = settings?.water_target_ml || 3000;
  const sleepTargetHours = settings?.sleep_target_hours ?? 8;
  const slept = calcSleepHours(sleep?.bed_time, sleep?.wake_time);
  const waterVal = water?.ml_total ?? water?.ml ?? 0;
  const waterPct = Math.min(100, (waterVal / waterTargetMl) * 100);
  const suppTaken = Object.keys(takenMap).length;

  const upcomingPlans = weekPlans.filter(
    (p) => p.status !== "DONE" && p.status !== "CANCELLED" && p.plan_date >= todayStr
  );
  const completedPlans = weekPlans.filter((p) => p.status === "DONE");

  return (
    <div style={pageStyle}>
      {/* Header */}
      <div style={{ padding: "24px 18px 4px" }}>
        <div style={{ fontSize: 13, color: "#8e8e93", marginBottom: 2 }}>{dateLabel}</div>
        <div style={{ fontSize: 28, fontWeight: 800, color: "#111", letterSpacing: -0.5 }}>Dashboard</div>
      </div>

      <div style={{ padding: "8px 18px 0" }}>
        {errMsg && (
          <div style={{ padding: 14, background: "#fff0f0", borderRadius: 14, color: "#c00", fontSize: 13, marginBottom: 12 }}>
            {errMsg}
          </div>
        )}

        {/* TODAY'S WORKOUT */}
        <div style={{
          ...card,
          borderWidth: 2,
          borderStyle: "solid",
          borderColor: todayPlan.status === "DONE" ? "#34c759" : todayPlan.status === "CANCELLED" ? "#ff453a" : PRIMARY,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#8e8e93", letterSpacing: 1, marginBottom: 4 }}>TODAY</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "#111", letterSpacing: -0.5 }}>
                {todayPlan.plan_type}
                {todayPlan.planned_time && (
                  <span style={{ fontSize: 15, fontWeight: 500, color: "#8e8e93", marginLeft: 10 }}>
                    {todayPlan.planned_time}
                  </span>
                )}
              </div>
            </div>
            <span style={{ fontSize: 32 }}>{PLAN_EMOJI[todayPlan.plan_type] || "🏃"}</span>
          </div>

          {todayPlan.plan_type !== "REST" && todayPlan.status === "PLANNED" && (
            <>
              <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                <button
                  onClick={() => markDone(todayPlan)}
                  style={{ flex: 1, padding: "14px 0", fontWeight: 800, fontSize: 15, background: PRIMARY, color: "#fff", border: "none", borderRadius: 13, cursor: "pointer", fontFamily: FONT }}
                >
                  ✓ Done
                </button>
                <button
                  onClick={() => cancel(todayPlan)}
                  style={{ flex: 1, padding: "14px 0", fontWeight: 800, fontSize: 15, background: "rgba(255,69,58,0.1)", color: "#ff453a", border: "none", borderRadius: 13, cursor: "pointer", fontFamily: FONT }}
                >
                  ✕ Cancel
                </button>
              </div>
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, color: "#8e8e93", marginBottom: 6 }}>Move time</div>
                <input
                  type="time"
                  value={todayPlan.planned_time || ""}
                  onChange={(e) => moveTodayTime(e.target.value)}
                  style={inputStyle}
                />
              </div>
            </>
          )}

          {todayPlan.plan_type === "REST" && (
            <div style={{ marginTop: 6, color: "#8e8e93", fontSize: 14 }}>Rest day — recover well 🛋️</div>
          )}

          {todayPlan.status === "DONE" && (
            <div style={{ marginTop: 10 }}>
              <div style={{ color: "#34c759", fontWeight: 700, fontSize: 15 }}>✓ Completed</div>
              <button
                onClick={() => undoDone(todayPlan)}
                style={{ marginTop: 10, width: "100%", padding: "10px 0", fontWeight: 600, fontSize: 13, background: "transparent", color: "#8e8e93", border: "1.5px solid #e5e5ea", borderRadius: 11, cursor: "pointer", fontFamily: FONT }}
              >
                Undo
              </button>
            </div>
          )}

          {todayPlan.status === "CANCELLED" && (
            <div style={{ marginTop: 10 }}>
              <div style={{ color: "#ff453a", fontWeight: 700, fontSize: 15 }}>
                ✕ Cancelled{todayPlan.cancel_reason ? ` — ${todayPlan.cancel_reason}` : ""}
              </div>
              <button
                onClick={() => undoCancel(todayPlan)}
                style={{ marginTop: 10, width: "100%", padding: "10px 0", fontWeight: 600, fontSize: 13, background: "transparent", color: "#8e8e93", border: "1.5px solid #e5e5ea", borderRadius: 11, cursor: "pointer", fontFamily: FONT }}
              >
                Undo
              </button>
            </div>
          )}
        </div>

        {/* TOMORROW'S WORKOUT */}
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#8e8e93", letterSpacing: 1, marginBottom: 4 }}>TOMORROW · +3 pts if set</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#111", letterSpacing: -0.5 }}>{tomorrowPlan.plan_type}</div>
            </div>
            <span style={{ fontSize: 28 }}>{PLAN_EMOJI[tomorrowPlan.plan_type] || "🏃"}</span>
          </div>

          {tomorrowPlan.plan_type !== "REST" ? (
            <div>
              <div style={{ fontSize: 12, color: "#8e8e93", marginBottom: 6 }}>Set workout time</div>
              <input
                type="time"
                value={tomorrowPlan.planned_time || ""}
                onChange={(e) => {
                  const val = e.target.value;
                  if (tomorrowTimeTimer.current) clearTimeout(tomorrowTimeTimer.current);
                  tomorrowTimeTimer.current = setTimeout(() => setTomorrowTime(val), 400);
                }}
                style={inputStyle}
              />
              {tomorrowPlan.planned_time && (
                <div style={{ marginTop: 8, fontSize: 13, color: "#34c759", fontWeight: 600 }}>
                  ✓ Set for {tomorrowPlan.planned_time}
                </div>
              )}
            </div>
          ) : (
            <div style={{ color: "#8e8e93", fontSize: 14 }}>Rest day — no time needed</div>
          )}
        </div>

        {/* DAILY PROGRESS */}
        <div style={{ background: "#1e1b4b", borderRadius: 18, padding: 18, marginBottom: 12, color: "#fff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
            <div style={{ fontSize: 17, fontWeight: 800 }}>Daily Progress</div>
            <a href="/profile" style={{ color: "rgba(255,255,255,0.4)", fontSize: 22, textDecoration: "none", lineHeight: 1 }}>›</a>
          </div>

          {/* Workout */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 18 }}>🔥</span>
                <span style={{ fontWeight: 600, fontSize: 15 }}>Workout</span>
              </div>
              <span style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", fontWeight: 600 }}>
                {todayPlan.status === "DONE" ? "100%" : todayPlan.status === "CANCELLED" ? "—" : "0%"}
              </span>
            </div>
            <div style={{ height: 7, borderRadius: 4, background: "rgba(255,255,255,0.12)", overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: todayPlan.status === "DONE" ? "100%" : "0%",
                background: todayPlan.status === "DONE" ? "#34c759" : "transparent",
                borderRadius: 4,
                transition: "width 0.5s ease",
              }} />
            </div>
          </div>

          {/* Supplements */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 18 }}>💊</span>
                <span style={{ fontWeight: 600, fontSize: 15 }}>Supplements</span>
              </div>
              <span style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", fontWeight: 600 }}>
                {suppTaken} / {supps.length}
              </span>
            </div>
            <div style={{ height: 7, borderRadius: 4, background: "rgba(255,255,255,0.12)", overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: supps.length > 0 ? `${(suppTaken / supps.length) * 100}%` : "0%",
                background: suppTaken === supps.length && supps.length > 0 ? "#34c759" : "#a78bfa",
                borderRadius: 4,
                transition: "width 0.5s ease",
              }} />
            </div>
          </div>
        </div>

        {/* UPCOMING / COMPLETED */}
        <div style={card}>
          <div style={{ display: "flex", gap: 0, marginBottom: 14, background: "#f2f2f7", borderRadius: 12, padding: 3 }}>
            <button
              onClick={() => setWeekTab("upcoming")}
              style={{
                flex: 1, padding: "8px 0", fontWeight: 700, fontSize: 13,
                border: "none", borderRadius: 10, cursor: "pointer", fontFamily: FONT,
                background: weekTab === "upcoming" ? "#fff" : "transparent",
                color: weekTab === "upcoming" ? "#111" : "#8e8e93",
                boxShadow: weekTab === "upcoming" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              }}
            >
              Upcoming
            </button>
            <button
              onClick={() => setWeekTab("completed")}
              style={{
                flex: 1, padding: "8px 0", fontWeight: 700, fontSize: 13,
                border: "none", borderRadius: 10, cursor: "pointer", fontFamily: FONT,
                background: weekTab === "completed" ? "#fff" : "transparent",
                color: weekTab === "completed" ? "#111" : "#8e8e93",
                boxShadow: weekTab === "completed" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              }}
            >
              Completed
            </button>
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            {(weekTab === "upcoming" ? upcomingPlans : completedPlans).map((p) => (
              <div
                key={p.id}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "10px 12px", background: "#f9f9f9", borderRadius: 12,
                }}
              >
                <span style={{ fontSize: 22 }}>{PLAN_EMOJI[p.plan_type] || "🏃"}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "#111" }}>{p.plan_type}</div>
                  <div style={{ fontSize: 12, color: "#8e8e93" }}>
                    {p.plan_date}{p.planned_time ? ` · ${p.planned_time}` : ""}
                  </div>
                </div>
                {weekTab === "completed" && <span style={{ color: "#34c759", fontWeight: 800, fontSize: 16 }}>✓</span>}
              </div>
            ))}
            {(weekTab === "upcoming" ? upcomingPlans : completedPlans).length === 0 && (
              <div style={{ color: "#8e8e93", fontSize: 14, textAlign: "center", padding: "14px 0" }}>
                {weekTab === "completed" ? "No completed workouts yet." : "No upcoming workouts."}
              </div>
            )}
          </div>
        </div>

        {/* WATER */}
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: "#111" }}>💧 Water</div>
            <div style={{ fontSize: 13, color: "#8e8e93" }}>Target {(waterTargetMl / 1000).toFixed(1)}L</div>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 12 }}>
            <span style={{ fontSize: 28, fontWeight: 800, color: "#111" }}>{waterVal.toLocaleString()}</span>
            <span style={{ fontSize: 15, color: "#8e8e93" }}>ml</span>
            <span style={{ fontSize: 13, color: "#8e8e93", marginLeft: 4 }}>/ {waterTargetMl.toLocaleString()}ml</span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: "#e5e5ea", overflow: "hidden", marginBottom: 14 }}>
            <div style={{
              height: "100%",
              width: `${waterPct}%`,
              background: waterPct >= 100 ? "#34c759" : "#3b82f6",
              borderRadius: 4,
              transition: "width 0.4s ease",
            }} />
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => addWater(250)}
              style={{ flex: 1, padding: "12px 0", fontWeight: 700, fontSize: 14, border: "2px solid #e5e5ea", borderRadius: 13, background: "#fff", cursor: "pointer", color: "#3b82f6", fontFamily: FONT }}
            >
              +250ml
            </button>
            <button
              onClick={() => addWater(500)}
              style={{ flex: 1, padding: "12px 0", fontWeight: 700, fontSize: 14, border: "none", borderRadius: 13, background: "#3b82f6", cursor: "pointer", color: "#fff", fontFamily: FONT }}
            >
              +500ml
            </button>
          </div>
        </div>

        {/* SUPPLEMENTS */}
        <div style={card}>
          <div style={{ fontSize: 17, fontWeight: 800, color: "#111", marginBottom: 14 }}>💊 Supplements</div>
          <div style={{ display: "grid", gap: 8 }}>
            {supps.map((s) => (
              <button
                key={s.id}
                onClick={() => tickSupplement(s.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "12px 14px", borderRadius: 13, border: "none",
                  cursor: "pointer", textAlign: "left", fontFamily: FONT,
                  background: takenMap[s.id] ? "rgba(91,79,233,0.07)" : "#f9f9f9",
                }}
              >
                <div style={{
                  width: 24, height: 24, borderRadius: 7, flexShrink: 0,
                  background: takenMap[s.id] ? PRIMARY : "#e5e5ea",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {takenMap[s.id] && <span style={{ color: "#fff", fontSize: 12, fontWeight: 900 }}>✓</span>}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: takenMap[s.id] ? "#8e8e93" : "#111" }}>
                    {s.name}
                  </div>
                  <div style={{ fontSize: 12, color: "#8e8e93", marginTop: 1 }}>
                    {suppWhenLabel(s, todayPlan?.planned_time)}
                  </div>
                </div>
              </button>
            ))}
            {supps.length === 0 && (
              <div style={{ color: "#8e8e93", fontSize: 14, padding: "6px 0" }}>No supplements configured.</div>
            )}
          </div>
        </div>

        {/* SLEEP */}
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: "#111" }}>🌙 Sleep</div>
            <div style={{ fontSize: 13, color: "#8e8e93" }}>Target {sleepTargetHours}h</div>
          </div>

          {slept != null && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 8 }}>
                <span style={{ fontSize: 28, fontWeight: 800, color: slept >= sleepTargetHours ? "#34c759" : "#111" }}>
                  {slept.toFixed(1)}
                </span>
                <span style={{ fontSize: 15, color: "#8e8e93" }}>h slept</span>
              </div>
              <div style={{ height: 7, borderRadius: 4, background: "#e5e5ea", overflow: "hidden" }}>
                <div style={{
                  height: "100%",
                  width: `${Math.min(100, (slept / sleepTargetHours) * 100)}%`,
                  background: slept >= sleepTargetHours ? "#34c759" : "#ff9500",
                  borderRadius: 4,
                }} />
              </div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <div style={{ fontSize: 12, color: "#8e8e93", marginBottom: 6 }}>Bed time</div>
              <input
                type="time"
                value={sleep?.bed_time || ""}
                onChange={(e) => updateSleepField("bed_time", e.target.value || null)}
                style={inputStyle}
              />
            </div>
            <div>
              <div style={{ fontSize: 12, color: "#8e8e93", marginBottom: 6 }}>Wake time</div>
              <input
                type="time"
                value={sleep?.wake_time || ""}
                onChange={(e) => updateSleepField("wake_time", e.target.value || null)}
                style={inputStyle}
              />
            </div>
          </div>
        </div>

        {/* WEIGH-IN */}
        <div style={card}>
          <div style={{ fontSize: 17, fontWeight: 800, color: "#111", marginBottom: 14 }}>⚖️ Weigh-in</div>
          {weighIn ? (
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: "#111" }}>{weighIn.weight_kg}</span>
              <span style={{ fontSize: 16, color: "#8e8e93" }}>kg</span>
              <span style={{ fontSize: 13, color: "#8e8e93", marginLeft: 4 }}>{weighIn.weigh_date}</span>
            </div>
          ) : (
            <>
              <div style={{ color: "#8e8e93", fontSize: 14, marginBottom: 12 }}>No weigh-in yet today.</div>
              <div style={{ display: "flex", gap: 10 }}>
                <input
                  id="pact_weighin_input"
                  type="number"
                  step="0.1"
                  placeholder="Weight (kg)"
                  onKeyDown={(e) => { if (e.key === "Enter") addWeighIn(e.currentTarget.value); }}
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button
                  onClick={() => { const el = document.getElementById("pact_weighin_input"); if (el) addWeighIn(el.value); }}
                  style={{ padding: "11px 18px", fontWeight: 800, fontSize: 14, background: PRIMARY, color: "#fff", border: "none", borderRadius: 11, cursor: "pointer", fontFamily: FONT }}
                >
                  Save
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <BottomNav active="dashboard" onLogout={logout} />
    </div>
  );
}
