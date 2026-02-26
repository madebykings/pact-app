import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { addDays, isoDate, planTypeForDate } from "../lib/weekTemplate";
import { initOneSignal } from "../lib/onesignal";

const TIME_PRESETS = ["08:00", "12:00", "18:00"];

export default function Dashboard() {
  const [user, setUser] = useState(null);
  const [todayPlan, setTodayPlan] = useState(null);
  const [tomorrowPlan, setTomorrowPlan] = useState(null);
  const [weekPlans, setWeekPlans] = useState([]);
  const [water, setWater] = useState(null);
  const [supps, setSupps] = useState([]);
  const [takenMap, setTakenMap] = useState({});
  const [weighIn, setWeighIn] = useState(null);
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

        // IMPORTANT: don't block app startup on push SDK
        // Fire-and-forget registration (with a timeout safety)
        registerPushDevice(data.user.id);

        await bootstrapDefaults(data.user.id);
        await refreshAll(data.user.id);
      } catch (e) {
        setErrMsg(e?.message || String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function registerPushDevice(userId) {
    try {
      const withTimeout = (p, ms = 7000) =>
        Promise.race([
          p,
          new Promise((_, rej) => setTimeout(() => rej(new Error("Push init timeout")), ms)),
        ]);

      const playerId = await withTimeout(initOneSignal(), 7000);
      if (playerId) {
        await supabase.from("push_devices").upsert({
          user_id: userId,
          onesignal_player_id: playerId,
        });
      }
    } catch {
      // ignore push errors; app should still work
    }
  }

  async function bootstrapDefaults(userId) {
    const { error: pErr } = await supabase
      .from("user_profiles")
      .upsert({ user_id: userId, display_name: "" });
    if (pErr) throw pErr;

    const { error: wErr } = await supabase
      .from("water_logs")
      .upsert({ user_id: userId, log_date: todayStr, ml_total: 0 });
    if (wErr) throw wErr;

    await ensurePlan(userId, today);
    await ensurePlan(userId, tomorrow);

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
      ].map((s) => ({ ...s, user_id: userId }));

      const { error: insErr } = await supabase.from("supplements").insert(defaults);
      if (insErr) throw insErr;
    }
  }

  async function ensurePlan(userId, d) {
    const { error } = await supabase.from("plans").upsert({
      user_id: userId,
      plan_date: isoDate(d),
      plan_type: planTypeForDate(d),
      status: "PLANNED",
    });
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
    const tp = await fetchPlan(userId, todayStr);
    const tomp = await fetchPlan(userId, tomorrowStr);

    setTodayPlan(tp);
    setTomorrowPlan(tomp);

    const end = isoDate(addDays(today, 6));
    const { data: wp, error: wpErr } = await supabase
      .from("plans")
      .select("*")
      .eq("user_id", userId)
      .gte("plan_date", todayStr)
      .lte("plan_date", end)
      .order("plan_date");
    if (wpErr) throw wpErr;
    setWeekPlans(wp || []);

    const { data: waterRow, error: wErr } = await supabase
      .from("water_logs")
      .select("*")
      .eq("user_id", userId)
      .eq("log_date", todayStr)
      .maybeSingle();
    if (wErr) throw wErr;
    setWater(waterRow);

    const { data: suppRows, error: sErr } = await supabase
      .from("supplements")
      .select("*")
      .eq("user_id", userId)
      .eq("active", true)
      .order("name");
    if (sErr) throw sErr;
    setSupps(suppRows || []);

    const ids = (suppRows || []).map((s) => s.id);
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

    if (new Date().getDay() === 0) {
      const { data: w, error: wiErr } = await supabase
        .from("weigh_ins")
        .select("*")
        .eq("user_id", userId)
        .eq("weigh_date", todayStr)
        .maybeSingle();
      if (wiErr) throw wiErr;
      setWeighIn(w || null);
    } else {
      setWeighIn(null);
    }
  }

  async function setTomorrowTime(timeStr) {
    if (!user || !tomorrowPlan) return;
    const { error } = await supabase
      .from("plans")
      .update({ planned_time: timeStr, updated_at: new Date().toISOString() })
      .eq("id", tomorrowPlan.id);
    if (error) alert(error.message);
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
    if (!error) await supabase.from("workout_logs").insert({ plan_id: plan.id });
    if (error) alert(error.message);
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
    await refreshAll(user.id);
  }

  async function addWater(ml) {
    if (!user || !water) return;
    const next = (water.ml_total || 0) + ml;
    const { error } = await supabase
      .from("water_logs")
      .update({ ml_total: next, updated_at: new Date().toISOString() })
      .eq("id", water.id);
    if (error) alert(error.message);
    await refreshAll(user.id);
  }

  async function tickSupplement(suppId) {
    if (!user) return;
    if (takenMap[suppId]) return;
    const { error } = await supabase
      .from("supplement_logs")
      .insert({ supplement_id: suppId, log_date: todayStr });
    if (error) alert(error.message);
    await refreshAll(user.id);
  }

  async function submitWeighIn() {
    if (!user) return;
    const w = prompt("Weight (kg)?");
    if (!w) return;
    const val = Number(w);
    if (!Number.isFinite(val) || val <= 0) return alert("Invalid number");
    const { error } = await supabase
      .from("weigh_ins")
      .upsert({ user_id: user.id, weigh_date: todayStr, weight_kg: val });
    if (error) alert(error.message);
    await refreshAll(user.id);
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

  if (!todayPlan || !tomorrowPlan) {
    return <div style={{ padding: 20, fontFamily: "system-ui" }}>Loading…</div>;
  }

  const isTrainingToday = todayPlan.plan_type !== "REST";
  const isTrainingTomorrow = tomorrowPlan.plan_type !== "REST";

  return (
    <div style={{ padding: 18, fontFamily: "system-ui", maxWidth: 520, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Pact</h2>
        <button onClick={logout}>Logout</button>
      </div>

      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Today</div>
        <div style={{ fontSize: 26, fontWeight: 800 }}>
          {todayPlan.plan_type} {todayPlan.planned_time ? `— ${todayPlan.planned_time}` : ""}
        </div>

        {isTrainingToday && todayPlan.status === "PLANNED" && (
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
            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              {TIME_PRESETS.map((t) => (
                <button key={t} style={{ flex: 1, padding: 12, fontSize: 16 }} onClick={() => moveTodayTime(t)}>
                  {t}
                </button>
              ))}
            </div>
          </>
        )}

        {todayPlan.status !== "PLANNED" && (
          <div style={{ marginTop: 10, fontWeight: 700 }}>
            Status: {todayPlan.status}{todayPlan.cancel_reason ? ` (${todayPlan.cancel_reason})` : ""}
          </div>
        )}
      </div>

      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Tomorrow time (must be set by 23:59)</div>
        <div style={{ fontSize: 22, fontWeight: 800 }}>
          {tomorrowPlan.plan_type} {tomorrowPlan.planned_time ? `— ${tomorrowPlan.planned_time}` : "— not set"}
        </div>

        {isTrainingTomorrow ? (
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            {TIME_PRESETS.map((t) => (
              <button key={t} style={{ flex: 1, padding: 12, fontSize: 16 }} onClick={() => setTomorrowTime(t)}>
                {t}
              </button>
            ))}
          </div>
        ) : (
          <div style={{ marginTop: 10, opacity: 0.8 }}>Rest day. No time required.</div>
        )}
      </div>

      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Next 7 days</div>
        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          {weekPlans.map((p) => (
            <div key={p.id} style={{ padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
              <div style={{ fontWeight: 800 }}>
                {p.plan_date} — {p.plan_type} {p.planned_time ? `(${p.planned_time})` : ""}
              </div>
              <div>Status: {p.status}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Water (target 3L)</div>
        <div style={{ fontSize: 22, fontWeight: 800 }}>{water?.ml_total || 0} ml</div>
        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <button style={{ flex: 1, padding: 12, fontSize: 16 }} onClick={() => addWater(250)}>+250</button>
          <button style={{ flex: 1, padding: 12, fontSize: 16 }} onClick={() => addWater(500)}>+500</button>
        </div>
      </div>

      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Supplements (one tap)</div>
        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          {supps.map((s) => (
            <button
              key={s.id}
              style={{ padding: 12, textAlign: "left", fontSize: 16, opacity: takenMap[s.id] ? 0.4 : 1 }}
              onClick={() => tickSupplement(s.id)}
            >
              {takenMap[s.id] ? "✅" : "⬜"} {s.name}
            </button>
          ))}
        </div>
      </div>

      {new Date().getDay() === 0 && (
        <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
          <div style={{ fontSize: 14, opacity: 0.8 }}>Sunday weigh-in (hard cutoff 23:59)</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>
            {weighIn ? `${weighIn.weight_kg} kg logged` : "Not logged"}
          </div>
          <button style={{ width: "100%", padding: 12, marginTop: 10, fontSize: 16 }} onClick={submitWeighIn} disabled={!!weighIn}>
            LOG WEIGHT
          </button>
        </div>
      )}
    </div>
  );
}
