// pages/week-plan.js
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { addDays, isoDate } from "../lib/weekTemplate";

const ALL_TYPES = [
  { value: "REST", label: "Rest day" },
  { value: "WALK", label: "Walk" },
  { value: "RUN", label: "Run" },
  { value: "SPIN", label: "Spin" },
  { value: "HIIT", label: "HIIT" },
  { value: "SWIM", label: "Swim" },
  { value: "HILLWALK", label: "Hillwalk" },
  { value: "WEIGHTS", label: "Weights" },
  { value: "YOGA", label: "Yoga" },
  { value: "PILATES", label: "Pilates" },
  { value: "MOBILITY", label: "Mobility" },
  { value: "OTHER", label: "Other" },
];

function startOfWeekMonday(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay(); // 0=Sun
  const diff = (day === 0 ? -6 : 1) - day;
  x.setDate(x.getDate() + diff);
  return x;
}

function clampTime(t) {
  if (!t) return "";
  const m = /^([0-9]{1,2}):([0-9]{2})$/.exec(String(t).trim());
  if (!m) return "";
  const hh = String(Math.max(0, Math.min(23, Number(m[1])))).padStart(2, "0");
  const mm = String(Math.max(0, Math.min(59, Number(m[2])))).padStart(2, "0");
  return `${hh}:${mm}`;
}

function TopNav({ active, onLogout }) {
  const linkStyle = (isActive) => ({
    padding: "6px 10px",
    border: "1px solid #ddd",
    borderRadius: 10,
    textDecoration: "none",
    opacity: isActive ? 1 : 0.8,
    fontWeight: isActive ? 800 : 600,
  });

  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
      <h2 style={{ margin: 0 }}>Pact</h2>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <a href="/dashboard" style={linkStyle(active === "dashboard")}>Dashboard</a>
        <a href="/team" style={linkStyle(active === "pact")}>Pact</a>
        <a href="/profile" style={linkStyle(active === "profile")}>Profile</a>
        <a href="/settings" style={linkStyle(active === "settings")}>Settings</a>
        <button onClick={onLogout}>Logout</button>
      </div>
    </div>
  );
}

export default function WeekPlan() {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(null);
  const [role, setRole] = useState(null);
  const [plans, setPlans] = useState([]);
  const [err, setErr] = useState("");

  const now = useMemo(() => new Date(), []);
  const todayStr = useMemo(() => isoDate(now), [now]);
  const weekStart = useMemo(() => startOfWeekMonday(now), [now]);
  const weekDates = useMemo(
    () => Array.from({ length: 7 }).map((_, i) => isoDate(addDays(weekStart, i))),
    [weekStart]
  );

  const allowedTypes = useMemo(() => {
    const inc = Array.isArray(settings?.included_activities) ? settings.included_activities : [];
    const set = new Set(inc);
    // Always allow REST + OTHER
    return ALL_TYPES.filter((t) => t.value === "REST" || t.value === "OTHER" || set.has(t.value));
  }, [settings?.included_activities]);

  const canEditTeam = useMemo(() => {
    if (!settings) return false;
    if (settings.mode === "solo") return true;
    if (settings.mode === "team") return role === "owner";
    return true;
  }, [settings, role]);

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

        const { data: st, error: stErr } = await supabase
          .from("user_settings")
          .select("*")
          .eq("user_id", data.user.id)
          .maybeSingle();
        if (stErr) throw stErr;
        setSettings(st || null);

        if (st?.mode === "team" && st?.team_id) {
          const { data: tm, error: tmErr } = await supabase
            .from("team_members")
            .select("role")
            .eq("team_id", st.team_id)
            .eq("user_id", data.user.id)
            .maybeSingle();
          if (!tmErr) setRole(tm?.role || "member");
        } else {
          setRole(null);
        }

        await ensureRows(data.user.id);
        await refresh(data.user.id);
      } catch (e) {
        setErr(e?.message || String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ensureRows(userId) {
    // Create rows for the whole current week if missing.
    // IMPORTANT: ignore duplicates so we never overwrite existing rows (prevents "reset to REST").
    for (const d of weekDates) {
      await supabase.from("plans").upsert(
        { user_id: userId, plan_date: d, plan_type: "REST", status: "PLANNED" },
        { onConflict: "user_id,plan_date", ignoreDuplicates: true }
      );
    }
  }

  async function refresh(userId) {
    const { data, error } = await supabase
      .from("plans")
      .select("*")
      .eq("user_id", userId)
      .in("plan_date", weekDates)
      .order("plan_date");
    if (error) throw error;
    setPlans(data || []);
  }

  async function setPlan(planId, patch) {
    if (!user) return;
    const { error } = await supabase
      .from("plans")
      .update({ ...patch })
      .eq("id", planId);
    if (error) alert(error.message);
    await refresh(user.id);
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  if (err) {
    return (
      <div style={{ padding: 18, fontFamily: "system-ui", maxWidth: 520, margin: "0 auto" }}>
        <h2>Week plan</h2>
        <div><b>Error:</b> {err}</div>
        <button style={{ marginTop: 12 }} onClick={logout}>Logout</button>
      </div>
    );
  }

  if (!settings) return <div style={{ padding: 18, fontFamily: "system-ui" }}>Loading…</div>;

  return (
    <div style={{ padding: 18, fontFamily: "system-ui", maxWidth: 520, margin: "0 auto" }}>
      <TopNav active="dashboard" onLogout={logout} />

      <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div>
          <div style={{ fontSize: 14, opacity: 0.75 }}>Workout planning</div>
          <div style={{ fontSize: 22, fontWeight: 900 }}>Edit week plan</div>
          <div style={{ marginTop: 4, fontSize: 13, opacity: 0.7 }}>
            Week: {weekDates[0]} → {weekDates[6]}
          </div>
        </div>
        <a href="/dashboard" style={{ padding: "10px 12px", border: "1px solid #ddd", borderRadius: 12, textDecoration: "none", fontWeight: 800 }}>
          Back
        </a>
      </div>

      {settings.mode === "team" && (
        <div style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>
          Team mode: {canEditTeam ? "You can edit (leader)." : "Read-only (only leader can edit)."}
        </div>
      )}

      <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
        {plans.map((p) => {
          const isPast = p.plan_date < todayStr;
          const canEditRow = canEditTeam && !isPast;

          return (
            <div key={p.id} style={{ padding: 14, border: "1px solid #ddd", borderRadius: 12, opacity: isPast ? 0.75 : 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontSize: 13, opacity: 0.85 }}>{p.plan_date}</div>
                {isPast && <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 800 }}>Locked</div>}
              </div>

              <div style={{ marginTop: 10, fontWeight: 900, fontSize: 14, opacity: 0.8 }}>Workout</div>
              <select
                value={p.plan_type}
                disabled={!canEditRow}
                onChange={(e) => {
                  const nextType = e.target.value;
                  const patch = { plan_type: nextType };
                  if (nextType === "REST") patch.planned_time = null;
                  setPlan(p.id, patch);
                }}
                style={{ width: "100%", padding: 12, fontSize: 16, marginTop: 8 }}
              >
                {allowedTypes.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>

              <div style={{ marginTop: 12, fontWeight: 900, fontSize: 14, opacity: 0.8 }}>Time</div>
              {p.plan_type === "REST" ? (
                <div style={{ marginTop: 8, opacity: 0.75 }}>Rest day. No time required.</div>
              ) : (
                <input
                  type="time"
                  value={p.planned_time || ""}
                  disabled={!canEditRow}
                  onChange={(e) => setPlan(p.id, { planned_time: clampTime(e.target.value) })}
                  style={{ width: "100%", padding: 12, fontSize: 16, marginTop: 8 }}
                />
              )}

              {!canEditTeam && (
                <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
                  Only the team leader can edit.
                </div>
              )}
              {canEditTeam && isPast && (
                <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
                  Past days are locked.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
