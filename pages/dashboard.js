// pages/dashboard.js
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { addDays, isoDate, planTypeForDate } from "../lib/weekTemplate";

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
  { value: "OTHER", label: "Other" },
];

function calcSleepHours(bedTime, wakeTime) {
  if (!bedTime || !wakeTime) return null;
  const [bh, bm] = bedTime.split(":").map(Number);
  const [wh, wm] = wakeTime.split(":").map(Number);
  if (![bh, bm, wh, wm].every((n) => Number.isFinite(n))) return null;

  // Treat as "last night": if wake is "earlier" than bed, it wraps over midnight
  const bed = bh * 60 + bm;
  let wake = wh * 60 + wm;
  if (wake <= bed) wake += 24 * 60;

  const mins = wake - bed;
  return mins / 60;
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

  const [errMsg, setErrMsg] = useState("");

  const today = useMemo(() => new Date(), []);
  const tomorrow = useMemo(() => addDays(today, 1), [today]);
  const todayStr = isoDate(today);
  const tomorrowStr = isoDate(tomorrow);

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

        await bootstrapDefaults(data.user.id);
        await refreshAll(data.user.id);
      } catch (e) {
        setErrMsg(e?.message || String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function bootstrapDefaults(userId) {
    // profile
    {
      const { error } = await supabase
        .from("user_profiles")
        .upsert({ user_id: userId, display_name: "" }, { onConflict: "user_id" });
      if (error) throw error;
    }

    // settings
    {
      // Keep defaults lightweight — settings page can change everything
      const { error } = await supabase.from("user_settings").upsert(
        {
          user_id: userId,
          mode: "solo",
          timezone: "Europe/London",
          water_target_ml: 3000,
          sleep_target_hours: 8,
          // activities the user wants to be accountable for
          included_activities: ["WALK", "RUN", "SPIN", "SWIM", "HILLWALK", "WEIGHTS", "HIIT", "YOGA", "PILATES", "OTHER"],
        },
        { onConflict: "user_id" }
      );
      if (error) throw error;
    }

    // water (today)
    {
      const { error } = await supabase.from("water_logs").upsert(
        { user_id: userId, log_date: todayStr, ml_total: 0 },
        { onConflict: "user_id,log_date" }
      );
      if (error) throw error;
    }

    // plans (today + tomorrow) must exist
    await ensurePlan(userId, today);
    await ensurePlan(userId, tomorrow);

    // default supplements if none exist
    const { data: existing, error: exErr } = await supabase
      .from("supplements")
      .select("id")
      .eq("user_id", userId)
      .limit(1);
    if (exErr) throw exErr;

    if (!existing || existing.length === 0) {
      const defaults = [
        { name: "Creatine", rule_type: "PRE_WORKOUT", offset_minutes: -45 },
        { name: "L-Carnitine", rule_type: "PRE_WORKOUT", offset_minutes: -30 },
        { name: "Cod Liver Oil", rule_type: "MORNING_WINDOW", window_start: "06:00", window_end: "10:00" },
        { name: "Tongkat Ali", rule_type: "MORNING_WINDOW", window_start: "06:00", window_end: "10:00" },
        { name: "Shilajit", rule_type: "MORNING_WINDOW", window_start: "06:00", window_end: "10:00" },
        { name: "Collagen", rule_type: "MORNING_WINDOW", window_start: "06:00", window_end: "10:00" },
        { name: "B12 Coffee", rule_type: "MORNING_WINDOW", window_start: "06:00", window_end: "10:00" },
        { name: "Ashwagandha", rule_type: "EVENING_WINDOW", window_start: "17:00", window_end: "21:00" },
        { name: "ZMA", rule_type: "BED_WINDOW", window_start: "21:00", window_end: "23:59" },
      ].map((s) => ({ ...s, user_id: userId, active: true }));

      const { error } = await supabase.from("supplements").insert(defaults);
      if (error) throw error;
    }

    // sleep row for today (today = "last night" log)
    {
      const { error } = await supabase.from("sleep_logs").upsert(
        { user_id: userId, log_date: todayStr },
        { onConflict: "user_id,log_date" }
      );
      if (error) {
        // sleep is optional; don't block dashboard if schema differs
      }
    }
  }

  async function ensurePlan(userId, d) {
    const { error } = await supabase.from("plans").upsert(
      {
        user_id: userId,
        plan_date: isoDate(d),
        plan_type: planTypeForDate(d),
        status: "PLANNED",
      },
      { onConflict: "user_id,plan_date" }
    );
    if (error) throw error;
  }

  async function fetchPlan(userId, dateStr) {
    const { data, error } = await supabase
      .from("plans")
      .select("*")
      .eq("user_id", userId)
      .eq("plan_date", dateStr)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function refreshAll(userId) {
    // settings
    {
      const { data: st, error: stErr } = await supabase
        .from("user_settings")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (stErr) throw stErr;
      setSettings(st || null);
    }

    // today + tomorrow
    const tp = await fetchPlan(userId, todayStr);
    const tomp = await fetchPlan(userId, tomorrowStr);
    setTodayPlan(tp);
    setTomorrowPlan(tomp);

    // plans (7 days)
    const end = isoDate(addDays(today, 6));
    {
      const { data: wp, error: wpErr } = await supabase
        .from("plans")
        .select("*")
        .eq("user_id", userId)
        .gte("plan_date", todayStr)
        .lte("plan_date", end)
        .order("plan_date");
      if (wpErr) throw wpErr;
      setWeekPlans(wp || []);
    }

    // water
    {
      const { data: w, error: wErr } = await supabase
        .from("water_logs")
        .select("*")
        .eq("user_id", userId)
        .eq("log_date", todayStr)
        .maybeSingle();
      if (wErr) throw wErr;
      setWater(w || null);
    }

    // supplements
    {
      const { data: s, error: sErr } = await supabase
        .from("supplements")
        .select("*")
        .eq("user_id", userId)
        .eq("active", true)
        .order("name");
      if (sErr) throw sErr;
      setSupps(s || []);

      const ids = (s || []).map((x) => x.id);
      if (ids.length) {
        const { data: logs, error: lErr } = await supabase
          .from("supplement_logs")
          .select("supplement_id")
          .eq("log_date", todayStr)
          .in("supplement_id", ids);
        if (lErr) throw lErr;

        const map = {};
        (logs || []).forEach((r) => (map[r.supplement_id] = true));
        setTakenMap(map);
      } else {
        setTakenMap({});
      }
    }

    // sleep (today = "last night")
    {
      const { data: sl, error: slErr } = await supabase
        .from("sleep_logs")
        .select("*")
        .eq("user_id", userId)
        .eq("log_date", todayStr)
        .maybeSingle();
      if (!slErr) setSleep(sl || null);
    }
  }

  // -----------------
  // Points event logger (idempotent via unique indexes)
  // -----------------
  async function logEvent({ event_type, points, plan_id = null, meta = {} }) {
    if (!user) return;
    const team_id = settings?.team_id || null;

    const payload = {
      user_id: user.id,
      team_id,
      plan_id,
      event_type,
      points,
      meta,
      // event_date default at DB
    };

    const conflict = plan_id
      ? "user_id,plan_id,event_type,event_date"
      : "user_id,event_type,event_date";

    await supabase.from("activity_events").upsert(payload, { onConflict: conflict });
  }

  function suppWhenLabel(s, planTime) {
    const pt = planTime || "??:??";
    if (s.rule_type === "PRE_WORKOUT") {
      const off = Number(s.offset_minutes || 0);
      const sign = off < 0 ? "" : "+";
      return `${sign}${off}m vs workout (${pt})`;
    }
    if (s.rule_type === "MORNING_WINDOW") return `${s.window_start || "06:00"}–${s.window_end || "10:00"}`;
    if (s.rule_type === "EVENING_WINDOW") return `${s.window_start || "17:00"}–${s.window_end || "21:00"}`;
    if (s.rule_type === "BED_WINDOW") return `before bed (${s.window_start || "21:00"}–${s.window_end || "23:59"})`;
    return "anytime";
  }

  // -----------------
  // Actions
  // -----------------
  async function setTomorrowTime(timeStr) {
    if (!user || !tomorrowPlan) return;

    const wasUnset = !tomorrowPlan.planned_time;

    const { error } = await supabase
      .from("plans")
      .update({ planned_time: timeStr, updated_at: new Date().toISOString() })
      .eq("id", tomorrowPlan.id);
    if (error) alert(error.message);

    if (wasUnset && timeStr) {
      await logEvent({ event_type: "set_tomorrow_time", points: 3, plan_id: tomorrowPlan.id });
    }

    await refreshAll(user.id);
  }

  async function moveTodayTime(timeStr) {
    if (!user || !todayPlan) return;
    const { error } = await supabase
      .from("plans")
      .update({ planned_time: timeStr, updated_at: new Date().toISOString() })
      .eq("id", todayPlan.id);
    if (error) alert(error.message);
    await refreshAll(user.id);
  }

  async function markDone(plan) {
    if (!user || !plan) return;

    const { error } = await supabase
      .from("plans")
      .update({ status: "DONE", updated_at: new Date().toISOString() })
      .eq("id", plan.id);
    if (error) {
      alert(error.message);
      return;
    }

    await supabase.from("workout_logs").insert({ plan_id: plan.id });
    await logEvent({ event_type: "workout_done", points: 10, plan_id: plan.id });

    await refreshAll(user.id);
  }

  async function cancel(plan) {
    if (!user || !plan) return;
    const reason = prompt("Reason (illness/work/family/couldn't be bothered)?") || "unspecified";

    const { error } = await supabase
      .from("plans")
      .update({ status: "CANCELLED", cancel_reason: reason, updated_at: new Date().toISOString() })
      .eq("id", plan.id);
    if (error) alert(error.message);

    await logEvent({ event_type: "workout_cancel", points: -5, plan_id: plan.id, meta: { reason } });

    await refreshAll(user.id);
  }

  async function undoDone(plan) {
    if (!user || !plan) return;

    const { error } = await supabase
      .from("plans")
      .update({ status: "PLANNED", updated_at: new Date().toISOString() })
      .eq("id", plan.id);
    if (error) return alert(error.message);

    await supabase.from("workout_logs").delete().eq("plan_id", plan.id);
    await logEvent({ event_type: "undo_done", points: -10, plan_id: plan.id });

    await refreshAll(user.id);
  }

  async function undoCancel(plan) {
    if (!user || !plan) return;

    const { error } = await supabase
      .from("plans")
      .update({ status: "PLANNED", cancel_reason: null, updated_at: new Date().toISOString() })
      .eq("id", plan.id);
    if (error) return alert(error.message);

    await logEvent({ event_type: "undo_cancel", points: 5, plan_id: plan.id });

    await refreshAll(user.id);
  }

  async function addWater(ml) {
    if (!user) return;

    const current = water?.ml_total || 0;
    const next = current + ml;

    const { error } = await supabase.from("water_logs").upsert(
      { user_id: user.id, log_date: todayStr, ml_total: next, updated_at: new Date().toISOString() },
      { onConflict: "user_id,log_date" }
    );
    if (error) alert(error.message);

    const target = settings?.water_target_ml || 3000;
    if (current < target && next >= target) {
      await logEvent({ event_type: "water_hit_target", points: 3 });
    }

    await refreshAll(user.id);
  }

  async function tickSupplement(suppId) {
    if (!user) return;

    if (takenMap[suppId]) {
      const { error } = await supabase
        .from("supplement_logs")
        .delete()
        .eq("supplement_id", suppId)
        .eq("log_date", todayStr);
      if (error) alert(error.message);
    } else {
      const { error } = await supabase
        .from("supplement_logs")
        .insert({ supplement_id: suppId, log_date: todayStr });
      if (error) alert(error.message);
    }

    await refreshAll(user.id);
  }

  async function upsertSleep(patch) {
    if (!user) return;

    const { error } = await supabase.from("sleep_logs").upsert(
      { user_id: user.id, log_date: todayStr, ...patch, updated_at: new Date().toISOString() },
      { onConflict: "user_id,log_date" }
    );
    if (error) alert(error.message);

    const nextSleep = { ...(sleep || {}), ...(patch || {}) };
    const hours = calcSleepHours(nextSleep.bed_time, nextSleep.wake_time);
    const targetH = settings?.sleep_target_hours ?? 8;

    if (hours != null && hours >= targetH) {
      await logEvent({ event_type: "sleep_hit_target", points: 3 });
    }

    await refreshAll(user.id);
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  // -----------------
  // Render
  // -----------------
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

  if (!todayPlan || !tomorrowPlan) {
    return (
      <div style={{ padding: 20, fontFamily: "system-ui", maxWidth: 520, margin: "0 auto" }}>
        <h2>Pact</h2>
        <p>Couldn’t load today/tomorrow plans.</p>
        <button style={{ width: "100%", padding: 12 }} onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }

  const waterTargetMl = settings?.water_target_ml || 3000;
  const sleepTargetHours = settings?.sleep_target_hours ?? 8;
  const slept = calcSleepHours(sleep?.bed_time, sleep?.wake_time);

  return (
    <div style={{ padding: 18, fontFamily: "system-ui", maxWidth: 520, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <h2 style={{ margin: 0 }}>Pact</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <a
            href="/team"
            style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 10, textDecoration: "none" }}
          >
            Pact
          </a>
          <a
            href="/profile"
            style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 10, textDecoration: "none" }}
          >
            Profile
          </a>
          <a
            href="/settings"
            style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 10, textDecoration: "none" }}
          >
            Settings
          </a>
          <button onClick={logout}>Logout</button>
        </div>
      </div>

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
              Status: {todayPlan.status}{todayPlan.cancel_reason ? ` (${todayPlan.cancel_reason})` : ""}
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

      {/* WEEK PLAN CTA */}
      <div style={{ marginTop: 14 }}>
        <a
          href="/week-plan"
          style={{
            display: "block",
            padding: 12,
            border: "1px solid #ddd",
            borderRadius: 12,
            textAlign: "center",
            textDecoration: "none",
            fontWeight: 800,
          }}
        >
          Edit week plan
        </a>
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
            .filter((p) => (weekTab === "completed" ? p.status === "DONE" : p.status !== "DONE"))
            .map((p) => (
              <div key={p.id} style={{ padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
                <div style={{ fontWeight: 800 }}>
                  {p.plan_date} — {p.plan_type} {p.planned_time ? `(${p.planned_time})` : ""}
                </div>
                <div>Status: {p.status}</div>
              </div>
            ))}
        </div>
      </div>

      {/* WATER */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Water (target {(waterTargetMl / 1000).toFixed(1)}L)</div>
        <div style={{ fontSize: 22, fontWeight: 800 }}>{water?.ml_total || 0} ml</div>
        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <button style={{ flex: 1, padding: 12, fontSize: 16 }} onClick={() => addWater(250)}>+250</button>
          <button style={{ flex: 1, padding: 12, fontSize: 16 }} onClick={() => addWater(500)}>+500</button>
        </div>
      </div>

      {/* SUPPS (separate box) */}
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
                <div style={{ opacity: 0.7, fontSize: 13 }}>
                  {suppWhenLabel(s, todayPlan?.planned_time)}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* SLEEP (separate box) */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>
          Sleep (last night) — target {sleepTargetHours}h
        </div>

        {slept != null && (
          <div style={{ marginTop: 6, fontSize: 18, fontWeight: 800 }}>
            {slept.toFixed(1)}h
          </div>
        )}

        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: 13, opacity: 0.7 }}>Bed time</div>
            <input
              type="time"
              value={sleep?.bed_time || ""}
              onChange={(e) => upsertSleep({ bed_time: e.target.value })}
              style={{ width: "100%", padding: 12, fontSize: 16 }}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: 13, opacity: 0.7 }}>Wake time</div>
            <input
              type="time"
              value={sleep?.wake_time || ""}
              onChange={(e) => upsertSleep({ wake_time: e.target.value })}
              style={{ width: "100%", padding: 12, fontSize: 16 }}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
