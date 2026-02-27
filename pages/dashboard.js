// pages/dashboard.js
import { useEffect, useMemo, useState } from "react";
import TopNav from "../components/Nav";
import { supabase } from "../lib/supabaseClient";
import { addDays, isoDate, planTypeForDate } from "../lib/weekTemplate";

const ALL_ACTIVITIES = [
  { value: "REST", label: "Rest" },
  { value: "WALK", label: "Walk" },
  { value: "RUN", label: "Run" },
  { value: "SPIN", label: "Spin" },
  { value: "STRENGTH", label: "Strength" },
  { value: "MOBILITY", label: "Mobility" },
];

const TIME_PRESETS = ["08:00", "12:00", "18:00"];

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

async function logEvent({ event_type, points = 0, meta = null, plan_id = null }) {
  try {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) return;

    await supabase.from("events").insert({
      user_id: userId,
      event_type,
      points,
      meta,
      plan_id,
    });
  } catch (e) {
    console.warn("logEvent failed:", e);
  }
}

async function bootstrapDefaults(userId) {
  const today = startOfDay(new Date());
  const tomorrow = startOfDay(addDays(today, 1));

  const todayStr = isoDate(today);
  const tomorrowStr = isoDate(tomorrow);

  // profile
  {
    const { error } = await supabase
      .from("user_profiles")
      .upsert({ user_id: userId, display_name: "" }, { onConflict: "user_id" });
    if (error) throw error;
  }

// water (today)
    {
      // Create row if missing, do NOT reset if it already exists
      const { data: existing, error: selErr } = await supabase
        .from("water_logs")
        .select("user_id")
        .eq("user_id", userId)
        .eq("log_date", todayStr)
        .maybeSingle();

      if (selErr) throw selErr;

      if (!existing) {
        // Some schemas use ml_total, some use ml.
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

  // plans (today + tomorrow) must exist
  await ensurePlan(userId, today);
  await ensurePlan(userId, tomorrow);

  // default supplements if none exist
  {
    const { data, error } = await supabase
      .from("supplements")
      .select("id")
      .eq("user_id", userId)
      .limit(1);

    if (error) throw error;

    if (!data || data.length === 0) {
      const defaults = [
        { user_id: userId, name: "Creatine", points: 1 },
        { user_id: userId, name: "Omega-3", points: 1 },
        { user_id: userId, name: "Vitamin D", points: 1 },
      ];
      const { error: insErr } = await supabase.from("supplements").insert(defaults);
      if (insErr) throw insErr;
    }
  }

  // default sleep row (today)
  {
    const { data, error } = await supabase
      .from("sleep_logs")
      .select("id")
      .eq("user_id", userId)
      .eq("log_date", todayStr)
      .maybeSingle();

    if (error) throw error;

    if (!data?.id) {
      const { error: insErr } = await supabase.from("sleep_logs").insert({
        user_id: userId,
        log_date: todayStr,
        hours: 0,
        quality: 0,
      });
      if (insErr) throw insErr;
    }
  }

  // default weigh-in (latest)
  {
    const { data, error } = await supabase
      .from("weigh_ins")
      .select("id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) throw error;

    if (!data || data.length === 0) {
      // optional: do nothing
    }
  }

  return { todayStr, tomorrowStr };
}

async function ensurePlan(userId, d) {
    const dateStr = isoDate(d);

    // If the plan already exists, do nothing (don't overwrite DONE/CANCELLED etc.)
    const { data: existing, error: selErr } = await supabase
      .from("plans")
      .select("id")
      .eq("user_id", userId)
      .eq("plan_date", dateStr)
      .maybeSingle();

    if (selErr) throw selErr;
    if (existing?.id) return;

    // Insert only when missing
    const { error: insErr } = await supabase.from("plans").insert({
      user_id: userId,
      plan_date: dateStr,
      plan_type: planTypeForDate(d),
      status: "PLANNED",
    });

    if (insErr) throw insErr;
  }

export default function Dashboard() {
  const [user, setUser] = useState(null);

  const [todayPlan, setTodayPlan] = useState(null);
  const [tomorrowPlan, setTomorrowPlan] = useState(null);
  const [weekPlans, setWeekPlans] = useState([]);

  const [water, setWater] = useState(null);

  const [supps, setSupps] = useState([]);
  const [takenMap, setTakenMap] = useState({});

  const [sleep, setSleep] = useState(null);

  const [weighIn, setWeighIn] = useState(null);

  const today = useMemo(() => startOfDay(new Date()), []);
  const tomorrow = useMemo(() => startOfDay(addDays(new Date(), 1)), []);

  async function refreshAll(userId) {
    const todayStr = isoDate(today);
    const tomorrowStr = isoDate(tomorrow);

    // fetch plans
    {
      const { data, error } = await supabase
        .from("plans")
        .select("*")
        .eq("user_id", userId)
        .in("plan_date", [todayStr, tomorrowStr]);

      if (error) {
        console.warn(error);
      } else {
        const t = data?.find((p) => p.plan_date === todayStr) || null;
        const tm = data?.find((p) => p.plan_date === tomorrowStr) || null;
        setTodayPlan(t);
        setTomorrowPlan(tm);
      }
    }

    // fetch week plans
    {
      const start = isoDate(today);
      const end = isoDate(addDays(today, 6));
      const { data, error } = await supabase
        .from("plans")
        .select("*")
        .eq("user_id", userId)
        .gte("plan_date", start)
        .lte("plan_date", end)
        .order("plan_date", { ascending: true });

      if (error) console.warn(error);
      else setWeekPlans(data || []);
    }

    // water
    {
      const { data, error } = await supabase
        .from("water_logs")
        .select("*")
        .eq("user_id", userId)
        .eq("log_date", todayStr)
        .maybeSingle();

      if (error) console.warn(error);
      else setWater(data || null);
    }

    // supplements
    {
      const { data, error } = await supabase
        .from("supplements")
        .select("*")
        .eq("user_id", userId)
        .order("name", { ascending: true });

      if (error) console.warn(error);
      else setSupps(data || []);
    }

    // supplement taken map (today)
    {
      const { data, error } = await supabase
        .from("supplement_logs")
        .select("*")
        .eq("user_id", userId)
        .eq("log_date", todayStr);

      if (error) console.warn(error);
      else {
        const map = {};
        (data || []).forEach((row) => {
          map[row.supplement_id] = true;
        });
        setTakenMap(map);
      }
    }

    // sleep
    {
      const { data, error } = await supabase
        .from("sleep_logs")
        .select("*")
        .eq("user_id", userId)
        .eq("log_date", todayStr)
        .maybeSingle();

      if (error) console.warn(error);
      else setSleep(data || null);
    }

    // weigh-in (latest)
    {
      const { data, error } = await supabase
        .from("weigh_ins")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) console.warn(error);
      else setWeighIn(data || null);
    }
  }

  useEffect(() => {
    let mounted = true;

    (async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error) console.warn(error);

      const u = data?.user || null;
      if (!mounted) return;
      setUser(u);

      if (u?.id) {
        try {
          await bootstrapDefaults(u.id);
        } catch (e) {
          console.warn("bootstrapDefaults failed:", e);
        }
        await refreshAll(u.id);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [today, tomorrow]);

  async function setPlanStatus(plan, status) {
    if (!user || !plan) return;

    const { error } = await supabase
      .from("plans")
      .update({ status })
      .eq("id", plan.id);

    if (error) {
      alert(error.message);
      return;
    }

    await refreshAll(user.id);
  }

  async function markDone(plan) {
    if (!user || !plan) return;

    const { error } = await supabase
      .from("plans")
      .update({ status: "DONE" })
      .eq("id", plan.id);
    if (error) {
      alert(error.message);
      return;
    }

    {
      const { error: wlErr } = await supabase.from("workout_logs").insert({ plan_id: plan.id });
      if (wlErr) console.warn("workout_logs insert failed:", wlErr.message);
    }
    await logEvent({ event_type: "workout_done", points: 10, plan_id: plan.id });

    await refreshAll(user.id);
  }

  async function cancel(plan) {
    if (!user || !plan) return;
    const reason = prompt("Reason (illness/work/family/couldn't be bothered)?") || "unspecified";

    const { error } = await supabase
      .from("plans")
      .update({ status: "CANCELLED", cancel_reason: reason })
      .eq("id", plan.id);

    if (error) {
      alert(error.message);
      return;
    }

    await logEvent({ event_type: "workout_cancelled", points: -5, meta: { reason }, plan_id: plan.id });

    await refreshAll(user.id);
  }

  async function updateWater(newMl) {
    if (!user) return;
    const todayStr = isoDate(today);

    // try ml_total first; fallback to ml
    let err = null;
    {
      const { error } = await supabase.from("water_logs").upsert(
        {
          user_id: user.id,
          log_date: todayStr,
          ml_total: newMl,
        },
        { onConflict: "user_id,log_date" }
      );
      err = error;
    }

    if (err && String(err.message || "").toLowerCase().includes("ml_total")) {
      const { error } = await supabase.from("water_logs").upsert(
        {
          user_id: user.id,
          log_date: todayStr,
          ml: newMl,
        },
        { onConflict: "user_id,log_date" }
      );
      err = error;
    }

    if (err) {
      alert(err.message);
      return;
    }

    await refreshAll(user.id);
  }

  async function toggleSupplement(supplementId) {
    if (!user) return;

    const todayStr = isoDate(today);
    const taken = !!takenMap[supplementId];

    if (taken) {
      const { error } = await supabase
        .from("supplement_logs")
        .delete()
        .eq("user_id", user.id)
        .eq("supplement_id", supplementId)
        .eq("log_date", todayStr);

      if (error) {
        alert(error.message);
        return;
      }

      await logEvent({ event_type: "supplement_untake", points: -1, meta: { supplement_id: supplementId } });
    } else {
      const { error } = await supabase.from("supplement_logs").insert({
        user_id: user.id,
        supplement_id: supplementId,
        log_date: todayStr,
      });

      if (error) {
        alert(error.message);
        return;
      }

      await logEvent({ event_type: "supplement_take", points: 1, meta: { supplement_id: supplementId } });
    }

    await refreshAll(user.id);
  }

  async function updateSleep(patch) {
    if (!user) return;
    const todayStr = isoDate(today);

    const { error } = await supabase
      .from("sleep_logs")
      .update(patch)
      .eq("user_id", user.id)
      .eq("log_date", todayStr);

    if (error) {
      alert(error.message);
      return;
    }

    await refreshAll(user.id);
  }

  if (!user) {
    return (
      <div>
        <TopNav />
        <div style={{ padding: 18 }}>Loading…</div>
      </div>
    );
  }

  const waterMl = water?.ml_total ?? water?.ml ?? 0;

  return (
    <div>
      <TopNav />

      <div style={{ padding: 18, maxWidth: 980, margin: "0 auto" }}>
        <h1 style={{ margin: "0 0 14px" }}>Dashboard</h1>

        {/* TODAY */}
        <div style={{ padding: 14, border: "1px solid rgba(0,0,0,.08)", borderRadius: 12, marginBottom: 16 }}>
          <h2 style={{ margin: "0 0 10px" }}>Today</h2>

          {todayPlan ? (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 700 }}>{todayPlan.plan_type}</div>
                <div style={{ opacity: 0.75, fontSize: 13 }}>
                  Status: <b>{todayPlan.status}</b>
                </div>
              </div>

              <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={() => markDone(todayPlan)}>Done</button>
                <button onClick={() => cancel(todayPlan)}>Cancel</button>
                <button onClick={() => setPlanStatus(todayPlan, "PLANNED")}>Reset</button>
              </div>
            </div>
          ) : (
            <div style={{ opacity: 0.7 }}>No plan found.</div>
          )}
        </div>

        {/* TOMORROW */}
        <div style={{ padding: 14, border: "1px solid rgba(0,0,0,.08)", borderRadius: 12, marginBottom: 16 }}>
          <h2 style={{ margin: "0 0 10px" }}>Tomorrow</h2>

          {tomorrowPlan ? (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 700 }}>{tomorrowPlan.plan_type}</div>
                <div style={{ opacity: 0.75, fontSize: 13 }}>
                  Status: <b>{tomorrowPlan.status}</b>
                </div>
              </div>

              <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={() => setPlanStatus(tomorrowPlan, "DONE")}>Done</button>
                <button onClick={() => setPlanStatus(tomorrowPlan, "CANCELLED")}>Cancel</button>
                <button onClick={() => setPlanStatus(tomorrowPlan, "PLANNED")}>Reset</button>
              </div>
            </div>
          ) : (
            <div style={{ opacity: 0.7 }}>No plan found.</div>
          )}
        </div>

        {/* WATER */}
        <div style={{ padding: 14, border: "1px solid rgba(0,0,0,.08)", borderRadius: 12, marginBottom: 16 }}>
          <h2 style={{ margin: "0 0 10px" }}>Water</h2>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 700 }}>{waterMl} ml</div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => updateWater(Math.max(0, waterMl - 250))}>-250</button>
              <button onClick={() => updateWater(waterMl + 250)}>+250</button>
              <button onClick={() => updateWater(waterMl + 500)}>+500</button>
              <button onClick={() => updateWater(0)}>Reset</button>
            </div>
          </div>
        </div>

        {/* SUPPLEMENTS */}
        <div style={{ padding: 14, border: "1px solid rgba(0,0,0,.08)", borderRadius: 12, marginBottom: 16 }}>
          <h2 style={{ margin: "0 0 10px" }}>Supplements</h2>

          <div style={{ display: "grid", gap: 8 }}>
            {supps.map((s) => {
              const taken = !!takenMap[s.id];
              return (
                <div
                  key={s.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: 10,
                    borderRadius: 10,
                    border: "1px solid rgba(0,0,0,.08)",
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700 }}>{s.name}</div>
                    <div style={{ opacity: 0.7, fontSize: 13 }}>{s.points || 0} pts</div>
                  </div>

                  <button onClick={() => toggleSupplement(s.id)}>{taken ? "Undo" : "Done"}</button>
                </div>
              );
            })}
          </div>
        </div>

        {/* SLEEP */}
        <div style={{ padding: 14, border: "1px solid rgba(0,0,0,.08)", borderRadius: 12, marginBottom: 16 }}>
          <h2 style={{ margin: "0 0 10px" }}>Sleep</h2>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              Hours:
              <input
                type="number"
                min="0"
                step="0.25"
                value={sleep?.hours ?? 0}
                onChange={(e) => updateSleep({ hours: Number(e.target.value || 0) })}
                style={{ width: 90 }}
              />
            </label>

            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              Quality (0-10):
              <input
                type="number"
                min="0"
                max="10"
                step="1"
                value={sleep?.quality ?? 0}
                onChange={(e) => updateSleep({ quality: Number(e.target.value || 0) })}
                style={{ width: 90 }}
              />
            </label>
          </div>
        </div>

        {/* WEIGH-IN */}
        <div style={{ padding: 14, border: "1px solid rgba(0,0,0,.08)", borderRadius: 12, marginBottom: 16 }}>
          <h2 style={{ margin: "0 0 10px" }}>Weigh-in</h2>
          {weighIn ? (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
              <div style={{ fontWeight: 700 }}>{weighIn.weight ?? weighIn.kg ?? "—"}</div>
              <div style={{ opacity: 0.7, fontSize: 13 }}>
                {weighIn.created_at ? new Date(weighIn.created_at).toLocaleString() : ""}
              </div>
            </div>
          ) : (
            <div style={{ opacity: 0.7 }}>No weigh-in yet.</div>
          )}
        </div>

        {/* WEEK */}
        <div style={{ padding: 14, border: "1px solid rgba(0,0,0,.08)", borderRadius: 12 }}>
          <h2 style={{ margin: "0 0 10px" }}>This week</h2>

          <div style={{ display: "grid", gap: 8 }}>
            {weekPlans.map((p) => (
              <div
                key={p.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: 10,
                  borderRadius: 10,
                  border: "1px solid rgba(0,0,0,.08)",
                }}
              >
                <div style={{ width: 110, fontFamily: "monospace", fontSize: 13 }}>{p.plan_date}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700 }}>{p.plan_type}</div>
                  <div style={{ opacity: 0.7, fontSize: 13 }}>
                    Status: <b>{p.status}</b>
                    {p.cancel_reason ? ` · ${p.cancel_reason}` : ""}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <select
                    value={p.plan_type}
                    onChange={async (e) => {
                      const newType = e.target.value;
                      const { error } = await supabase
                        .from("plans")
                        .update({ plan_type: newType })
                        .eq("id", p.id);

                      if (error) alert(error.message);
                      else refreshAll(user.id);
                    }}
                  >
                    {ALL_ACTIVITIES.map((a) => (
                      <option key={a.value} value={a.value}>
                        {a.label}
                      </option>
                    ))}
                  </select>

                  <select
                    value={p.time || ""}
                    onChange={async (e) => {
                      const t = e.target.value || null;
                      const { error } = await supabase.from("plans").update({ time: t }).eq("id", p.id);
                      if (error) alert(error.message);
                      else refreshAll(user.id);
                    }}
                  >
                    <option value="">Time</option>
                    {TIME_PRESETS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
