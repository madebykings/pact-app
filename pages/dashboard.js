// pages/dashboard.js
import { useEffect, useMemo, useState } from "react";
import TopNav from "../components/Nav";
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

function mondayStart(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay(); // 0=Sun
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

    // settings (create if missing, don't overwrite if exists)
    {
      const { error } = await supabase.from("user_settings").upsert(
        {
          user_id: userId,
          mode: "solo",
          timezone: "Europe/London",
          water_target_ml: 3000,
          sleep_target_hours: 8,
          included_activities: [
            "WALK",
            "RUN",
            "SPIN",
            "SWIM",
            "HILLWALK",
            "WEIGHTS",
            "HIIT",
            "YOGA",
            "PILATES",
            "MOBILITY",
            "OTHER",
          ],
        },
        { onConflict: "user_id", ignoreDuplicates: true }
      );
      if (error) throw error;
    }

    // water (today) - create only if missing
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

        const { error: e1 } = await supabase.from("water_logs").insert({
          user_id: userId,
          log_date: todayStr,
          ml_total: 0,
        });
        wErr = e1;

        if (wErr && String(wErr.message || "").toLowerCase().includes("ml_total")) {
          const { error: e2 } = await supabase.from("water_logs").insert({
            user_id: userId,
            log_date: todayStr,
            ml: 0,
          });
          wErr = e2;
        }

        if (wErr) throw wErr;
      }
    }

    await ensurePlan(userId, today);
    await ensurePlan(userId, tomorrow);

    // supplements defaults
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

          // FIX: "ANYTIME" violates supplements_rule_type_check. Use an allowed window.
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

    // sleep today row
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
          user_id: userId,
          log_date: todayStr,
          bed_time: null,
          wake_time: null,
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
    // settings
    {
      const { data: st, error: stErr } = await supabase.from("user_settings").select("*").eq("user_id", userId).maybeSingle();
      if (stErr) throw stErr;
      setSettings(st || null);
    }

    setTodayPlan(await fetchPlan(userId, todayStr));
    setTomorrowPlan(await fetchPlan(userId, tomorrowStr));

    // week plans (current week)
    {
      const { data: wp, error: wpErr } = await supabase
        .from("plans")
        .select("*")
        .eq("user_id", userId)
        .gte("plan_date", weekStartStr)
        .lte("plan_date", weekEndStr)
        .order("plan_date");
      if (wpErr) throw wpErr;
      setWeekPlans(wp || []);
    }

    // water
    {
      const { data: w, error: wErr } = await supabase.from("water_logs").select("*").eq("user_id", userId).eq("log_date", todayStr).maybeSingle();
      if (wErr) throw wErr;
      setWater(w || null);
    }

    // supplements (active only)
    let mySupps = [];
    {
      const { data: s, error: sErr } = await supabase.from("supplements").select("*").eq("user_id", userId).eq("active", true).order("name");
      if (sErr) throw sErr;
      mySupps = s || [];
      setSupps(mySupps);
    }

    // supplement logs (today)
    {
      const { data: logs, error: lErr } = await supabase.from("supplement_logs").select("*").eq("log_date", todayStr);
      if (lErr) throw lErr;

      const myIds = new Set(mySupps.map((s) => s.id));
      const map = {};
      (logs || []).forEach((r) => {
        if (myIds.has(r.supplement_id)) map[r.supplement_id] = true;
      });
      setTakenMap(map);
    }

    // sleep
    {
      const { data: sl, error: slErr } = await supabase.from("sleep_logs").select("*").eq("user_id", userId).eq("log_date", todayStr).maybeSingle();
      if (slErr) throw slErr;
      setSleep(sl || null);
    }

    // weigh-in
    {
      const { data: w, error: wErr } = await supabase
        .from("weigh_ins")
        .select("id,user_id,weigh_date,weight_kg")
        .eq("user_id", userId)
        .order("weigh_date", { ascending: false })
        .limit(1);

      if (wErr) throw wErr;
      setWeighIn(w?.[0] || null);
    }
  }

  async function markDone(plan) {
    try {
      const { error } = await supabase.from("plans").update({ status: "DONE" }).eq("id", plan.id);
      if (error) throw error;

      await logActivityEvent({
        userId: user.id,
        teamId: settings?.team_id || null,
        planId: plan.id, // important for upsert
        eventType: "workout_done",
        points: 10,
        eventDate: plan.plan_date,
        meta: { plan_id: plan.id, plan_type: plan.plan_type },
      });

      await refreshAll(user.id);
    } catch (e) {
      console.warn(e);
      setErrMsg(e?.message || "Failed to mark done.");
    }
  }

  async function cancel(plan) {
    try {
      const reason = prompt("Reason (illness/work/family/couldn't be bothered)?") || "unspecified";
      const { error } = await supabase.from("plans").update({ status: "CANCELLED", cancel_reason: reason }).eq("id", plan.id);
      if (error) throw error;

      await logActivityEvent({
        userId: user.id,
        teamId: settings?.team_id || null,
        planId: plan.id, // important for upsert
        eventType: "workout_cancel",
        points: -5,
        eventDate: plan.plan_date,
        meta: { plan_id: plan.id, plan_type: plan.plan_type, reason },
      });

      await refreshAll(user.id);
    } catch (e) {
      console.warn(e);
      setErrMsg(e?.message || "Failed to cancel.");
    }
  }

  async function undoDone(plan) {
    try {
      const { error } = await supabase.from("plans").update({ status: "PLANNED" }).eq("id", plan.id);
      if (error) throw error;

      await logActivityEvent({
        userId: user.id,
        teamId: settings?.team_id || null,
        planId: plan.id, // important for upsert
        eventType: "undo_workout_done",
        points: -10,
        eventDate: plan.plan_date,
        meta: { plan_id: plan.id },
      });

      await refreshAll(user.id);
    } catch (e) {
      console.warn(e);
      setErrMsg(e?.message || "Failed to undo.");
    }
  }

  async function undoCancel(plan) {
    try {
      const { error } = await supabase.from("plans").update({ status: "PLANNED", cancel_reason: null }).eq("id", plan.id);
      if (error) throw error;

      await logActivityEvent({
        userId: user.id,
        teamId: settings?.team_id || null,
        planId: plan.id, // important for upsert
        eventType: "undo_workout_cancel",
        points: 5,
        eventDate: plan.plan_date,
        meta: { plan_id: plan.id },
      });

      await refreshAll(user.id);
    } catch (e) {
      console.warn(e);
      setErrMsg(e?.message || "Failed to undo.");
    }
  }

  async function moveTodayTime(t) {
    try {
      const { error } = await supabase.from("plans").update({ planned_time: t || null }).eq("id", todayPlan.id);
      if (error) throw error;
      await refreshAll(user.id);
    } catch (e) {
      console.warn(e);
      setErrMsg(e?.message || "Failed to update time.");
    }
  }

  async function setTomorrowTime(t) {
    try {
      const { error } = await supabase.from("plans").update({ planned_time: t || null }).eq("id", tomorrowPlan.id);
      if (error) throw error;

      await logActivityEvent({
        userId: user.id,
        teamId: settings?.team_id || null,
        planId: tomorrowPlan.id,
        eventType: "set_tomorrow_time",
        points: t ? 3 : -3,
        eventDate: tomorrowPlan.plan_date,
        meta: { plan_id: tomorrowPlan.id, planned_time: t || null },
      });

      await refreshAll(user.id);
    } catch (e) {
      console.warn(e);
      setErrMsg(e?.message || "Failed to update time.");
    }
  }

  async function addWater(delta) {
    try {
      const current = water?.ml_total ?? water?.ml ?? 0;
      const next = Math.max(0, current + delta);

      let err = null;
      {
        const { error } = await supabase.from("water_logs").upsert(
          { user_id: user.id, log_date: todayStr, ml_total: next },
          { onConflict: "user_id,log_date" }
        );
        err = error;
      }
      if (err && String(err.message || "").toLowerCase().includes("ml_total")) {
        const { error } = await supabase.from("water_logs").upsert(
          { user_id: user.id, log_date: todayStr, ml: next },
          { onConflict: "user_id,log_date" }
        );
        err = error;
      }
      if (err) throw err;

      const waterTargetMl = settings?.water_target_ml || 3000;
      if (next >= waterTargetMl) {
        await logActivityEvent({
          userId: user.id,
          teamId: settings?.team_id || null,
          eventType: "water_hit_target",
          points: 2,
          eventDate: todayStr,
          meta: { ml: next, target_ml: waterTargetMl },
        });
      }

      await refreshAll(user.id);
    } catch (e) {
      console.warn(e);
      setErrMsg(e?.message || "Failed to update water.");
    }
  }

  function suppWhenLabel(s, plannedTime) {
    const rt = s.rule_type;

    // NOTE: "ANYTIME" is not allowed by supplements_rule_type_check, so no branch for it.

    if (rt === "MORNING_WINDOW") return `${s.window_start || "06:00"}–${s.window_end || "10:00"}`;
    if (rt === "MIDDAY_WINDOW") return `${s.window_start || "10:00"}–${s.window_end || "16:00"}`;
    if (rt === "EVENING_WINDOW") return `${s.window_start || "18:00"}–${s.window_end || "23:59"}`;
    if (rt === "BED_WINDOW") return `${s.window_start || "21:00"}–${s.window_end || "23:59"}`;
    if (rt === "PRE_WORKOUT") {
      if (!plannedTime) return "Before workout";
      const off = Number(s.offset_minutes || 0);
      return `${Math.abs(off)}m before`;
    }
    if (rt === "POST_WORKOUT") return "After workout";
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
    } catch (e) {
      console.warn(e);
      setErrMsg(e?.message || "Failed to toggle supplement.");
    }
  }

  async function updateSleepField(field, value) {
    try {
      const { error } = await supabase.from("sleep_logs").update({ [field]: value }).eq("user_id", user.id).eq("log_date", todayStr);
      if (error) throw error;

      const nextSleep = { ...(sleep || {}), [field]: value };
      const hrs = calcSleepHours(nextSleep.bed_time, nextSleep.wake_time);
      if (hrs != null && hrs >= (settings?.sleep_target_hours ?? 8)) {
        await logActivityEvent({
          userId: user.id,
          teamId: settings?.team_id || null,
          eventType: "sleep_hit_target",
          points: 2,
          eventDate: todayStr,
          meta: { hours: hrs, target_hours: settings?.sleep_target_hours ?? 8 },
        });
      }
      await refreshAll(user.id);
    } catch (e) {
      console.warn(e);
      setErrMsg(e?.message || "Failed to update sleep.");
    }
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
    } catch (e) {
      console.warn(e);
      setErrMsg(e?.message || "Failed to add weigh-in.");
    }
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

  if (todayPlan === null || tomorrowPlan === null) {
    return <div style={{ padding: 20, fontFamily: "system-ui" }}>Loading…</div>;
  }

  const waterTargetMl = settings?.water_target_ml || 3000;
  const sleepTargetHours = settings?.sleep_target_hours ?? 8;
  const slept = calcSleepHours(sleep?.bed_time, sleep?.wake_time);

  return (
    <div style={{ padding: 18, fontFamily: "system-ui", maxWidth: 520, margin: "0 auto" }}>
      <TopNav active="dashboard" onLogout={logout} />

      {/* TODAY */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Today</div>
        <div style={{ fontSize: 26, fontWeight: 800 }}>
          {todayPlan.plan_type} {todayPlan.planned_time ? `— ${todayPlan.planned_time}` : ""}
        </div>

        {todayPlan.plan_type !== "REST" && todayPlan.status === "PLANNED" && (
          <>
            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <button style={{ flex: 1, padding: 14, fontSize: 16, fontWeight: 800 }} onClick={() => markDone(todayPlan)}>
                DONE
              </button>
              <button style={{ flex: 1, padding: 14, fontSize: 16, fontWeight: 800 }} onClick={() => cancel(todayPlan)}>
                CANCEL
              </button>
            </div>

            <div style={{ marginTop: 12, fontSize: 14, opacity: 0.8 }}>Move time (same day)</div>
            <input
              type="time"
              value={todayPlan.planned_time || ""}
              onChange={(e) => moveTodayTime(e.target.value)}
              style={{ width: "100%", padding: 12, fontSize: 16, marginTop: 8 }}
            />
          </>
        )}

        {todayPlan.status !== "PLANNED" && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 800 }}>
              Status: {todayPlan.status}
                    {todayPlan.cancel_reason ? ` (${todayPlan.cancel_reason})` : ""}
            </div>

            {todayPlan.status === "DONE" && (
              <button style={{ width: "100%", padding: 12, marginTop: 10 }} onClick={() => undoDone(todayPlan)}>
                I LIED — UNDO DONE
              </button>
            )}

            {todayPlan.status === "CANCELLED" && (
              <button style={{ width: "100%", padding: 12, marginTop: 10 }} onClick={() => undoCancel(todayPlan)}>
                UNDO CANCEL
              </button>
            )}
          </div>
        )}
      </div>

      {/* TOMORROW */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Tomorrow (set by 23:59)</div>
        <div style={{ fontSize: 22, fontWeight: 800 }}>
          {tomorrowPlan.plan_type} {tomorrowPlan.planned_time ? `— ${tomorrowPlan.planned_time}` : "— not set"}
        </div>

        {tomorrowPlan.plan_type !== "REST" ? (
          <input
            type="time"
            value={tomorrowPlan.planned_time || ""}
            onChange={(e) => setTomorrowTime(e.target.value)}
            style={{ width: "100%", padding: 12, fontSize: 16, marginTop: 10 }}
          />
        ) : (
          <div style={{ marginTop: 10, opacity: 0.8 }}>Rest day. No time required.</div>
        )}
      </div>

      {/* UPCOMING vs COMPLETED */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            style={{ flex: 1, padding: 10, fontWeight: 800, opacity: weekTab === "upcoming" ? 1 : 0.5 }}
            onClick={() => setWeekTab("upcoming")}
          >
            Upcoming
          </button>
          <button
            style={{ flex: 1, padding: 10, fontWeight: 800, opacity: weekTab === "completed" ? 1 : 0.5 }}
            onClick={() => setWeekTab("completed")}
          >
            Completed
          </button>
        </div>

        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          {weekPlans
            .filter((p) => {
              if (weekTab === "completed") return p.status === "DONE";
              return p.status !== "DONE" && p.plan_date >= todayStr;
            })
            .map((p) => (
              <div key={p.id} style={{ padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
                <div style={{ fontWeight: 800 }}>
                  {p.plan_date} — {p.plan_type} {p.planned_time ? `(${p.planned_time})` : ""}
                </div>
                <div>Status: {p.status}</div>
              </div>
            ))}

          {weekPlans.length === 0 && <div style={{ opacity: 0.7 }}>No plans found for this week.</div>}
        </div>
      </div>

      {/* WATER */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Water (target {(waterTargetMl / 1000).toFixed(1)}L)</div>
        <div style={{ fontSize: 22, fontWeight: 800 }}>{water?.ml_total ?? water?.ml ?? 0} ml</div>
        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <button style={{ flex: 1, padding: 12, fontSize: 16 }} onClick={() => addWater(250)}>
            +250
          </button>
          <button style={{ flex: 1, padding: 12, fontSize: 16 }} onClick={() => addWater(500)}>
            +500
          </button>
        </div>
      </div>

      {/* SUPPS */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Supplements (tap to toggle)</div>
        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          {supps.map((s) => (
            <button
              key={s.id}
              style={{ padding: 12, textAlign: "left", fontSize: 16, opacity: takenMap[s.id] ? 0.45 : 1 }}
              onClick={() => tickSupplement(s.id)}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontWeight: 800 }}>
                  {takenMap[s.id] ? "✅" : "⬜"} {s.name}
                </div>
                <div style={{ opacity: 0.7, fontSize: 13 }}>{suppWhenLabel(s, todayPlan?.planned_time)}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* SLEEP */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Sleep (last night) — target {sleepTargetHours}h</div>

        {slept != null && <div style={{ marginTop: 10, fontSize: 22, fontWeight: 800 }}>{slept.toFixed(1)}h</div>}

        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <div>
            <div style={{ fontSize: 14, opacity: 0.8 }}>Bed time</div>
            <input
              type="time"
              value={sleep?.bed_time || ""}
              onChange={(e) => updateSleepField("bed_time", e.target.value || null)}
              style={{ width: "100%", padding: 12, fontSize: 16, marginTop: 8 }}
            />
          </div>

          <div>
            <div style={{ fontSize: 14, opacity: 0.8 }}>Wake time</div>
            <input
              type="time"
              value={sleep?.wake_time || ""}
              onChange={(e) => updateSleepField("wake_time", e.target.value || null)}
              style={{ width: "100%", padding: 12, fontSize: 16, marginTop: 8 }}
            />
          </div>
        </div>
      </div>

      {/* WEIGH-IN */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Weigh-in</div>
        <div style={{ marginTop: 8 }}>
          {weighIn ? (
            <div style={{ fontWeight: 800 }}>
              {weighIn.weight_kg}kg{" "}
              <span style={{ opacity: 0.7, fontWeight: 500, fontSize: 13 }}>{weighIn.weigh_date}</span>
            </div>
          ) : (
            <div style={{ opacity: 0.7 }}>No weigh-in yet — add your starting point.</div>
          )}
        </div>

        {!weighIn && (
          <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
            <input
              id="pact_weighin_input"
              type="number"
              step="0.1"
              placeholder="Weight (kg)"
              onKeyDown={(e) => {
                if (e.key === "Enter") addWeighIn(e.currentTarget.value);
              }}
              style={{ flex: "1 1 200px", padding: 12, fontSize: 16 }}
            />
            <button
              style={{ padding: "12px 14px", fontWeight: 800 }}
              onClick={() => {
                const el = document.getElementById("pact_weighin_input");
                if (el) addWeighIn(el.value);
              }}
            >
              Save
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
