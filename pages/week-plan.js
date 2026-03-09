// pages/week-plan.js
import { useEffect, useMemo, useState } from "react";
import BottomNav from "../components/Nav";
import { supabase } from "../lib/supabaseClient";
import { addDays, isoDate } from "../lib/weekTemplate";

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
};

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

const PLAN_EMOJI = {
  HIIT: "🔥", SPIN: "🚴", WEIGHTS: "🏋️", REST: "😴",
  RUN: "🏃", WALK: "🚶", SWIM: "🏊", HILLWALK: "🏔️",
  YOGA: "🧘", PILATES: "🤸", MOBILITY: "🦵", OTHER: "⭐",
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FULL_DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function getDayName(dateStr, full = false) {
  const d = new Date(dateStr + "T12:00:00");
  return full ? FULL_DAY_NAMES[d.getDay()] : DAY_NAMES[d.getDay()];
}

function clampTime(t) {
  if (!t) return "";
  const m = /^([0-9]{1,2}):([0-9]{2})$/.exec(String(t).trim());
  if (!m) return "";
  const hh = String(Math.max(0, Math.min(23, Number(m[1])))).padStart(2, "0");
  const mm = String(Math.max(0, Math.min(59, Number(m[2])))).padStart(2, "0");
  return `${hh}:${mm}`;
}

export default function WeekPlan() {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(null);
  const [role, setRole] = useState(null);
  const [plans, setPlans] = useState([]);
  const [err, setErr] = useState("");

  const today = useMemo(() => new Date(), []);
  const todayStr = useMemo(() => isoDate(today), [today]);

  const weekStart = useMemo(() => {
    const d = new Date(today);
    const day = d.getDay();
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    d.setHours(0, 0, 0, 0);
    return d;
  }, [today]);

  const dates = useMemo(
    () => Array.from({ length: 7 }).map((_, i) => isoDate(addDays(weekStart, i))),
    [weekStart]
  );

  const allowedTypes = useMemo(() => {
    const inc = Array.isArray(settings?.included_activities) ? settings.included_activities : [];
    const set = new Set(inc);
    return ALL_TYPES.filter((t) => t.value === "REST" || t.value === "OTHER" || set.has(t.value));
  }, [settings?.included_activities]);

  const canEdit = useMemo(() => {
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
        if (!data?.user) { window.location.href = "/"; return; }
        setUser(data.user);

        const { data: st, error: stErr } = await supabase
          .from("user_settings").select("*").eq("user_id", data.user.id).maybeSingle();
        if (stErr) throw stErr;
        setSettings(st || null);

        if (st?.mode === "team" && st?.team_id) {
          const { data: tm, error: tmErr } = await supabase
            .from("team_members").select("role")
            .eq("team_id", st.team_id).eq("user_id", data.user.id).maybeSingle();
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
    for (const d of dates) {
      await supabase.from("plans").upsert(
        { user_id: userId, plan_date: d, plan_type: "REST", status: "PLANNED" },
        { onConflict: "user_id,plan_date", ignoreDuplicates: true }
      );
    }
  }

  async function refresh(userId) {
    const { data, error } = await supabase
      .from("plans").select("*").eq("user_id", userId).in("plan_date", dates).order("plan_date");
    if (error) throw error;
    setPlans(data || []);
  }

  async function setPlan(planId, patch) {
    if (!user) return;
    if (!canEdit) return alert("Only the team leader can edit the plan.");
    const { error } = await supabase.from("plans").update({ ...patch }).eq("id", planId);
    if (error) alert(error.message);
    await refresh(user.id);
  }

  if (err) {
    return (
      <div style={pageStyle}>
        <div style={{ padding: 18, color: "#c00" }}><b>Error:</b> {err}</div>
        <BottomNav active="plan" />
      </div>
    );
  }

  if (!settings) {
    return (
      <div style={pageStyle}>
        <div style={{ padding: "40px 18px", textAlign: "center", color: "#8e8e93" }}>Loading…</div>
        <BottomNav active="plan" />
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      {/* Header */}
      <div style={{ padding: "24px 18px 4px" }}>
        <div style={{ fontSize: 13, color: "#8e8e93", marginBottom: 2 }}>
          {settings.mode === "team"
            ? canEdit ? "Edit this week · Team Leader" : "This week · Read only"
            : "Your week"}
        </div>
        <div style={{ fontSize: 28, fontWeight: 800, color: "#111", letterSpacing: -0.5 }}>Week Plan</div>
      </div>

      <div style={{ padding: "8px 18px 0" }}>
        {!canEdit && settings.mode === "team" && (
          <div style={{ ...card, background: "rgba(91,79,233,0.06)", padding: "12px 16px" }}>
            <div style={{ fontSize: 13, color: PRIMARY, fontWeight: 600 }}>
              Read-only — only the team leader can make changes.
            </div>
          </div>
        )}

        {plans.map((p) => {
          const isToday = p.plan_date === todayStr;
          const dayName = getDayName(p.plan_date, true);
          const emoji = PLAN_EMOJI[p.plan_type] || "⭐";

          return (
            <div
              key={p.id}
              style={{
                ...card,
                border: isToday ? `2px solid ${PRIMARY}` : "2px solid transparent",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <div style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: 1, marginBottom: 4,
                    color: isToday ? PRIMARY : "#8e8e93",
                  }}>
                    {isToday ? "TODAY · " : ""}{dayName.toUpperCase()} · {p.plan_date}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "#111" }}>
                    {p.plan_type}
                    {p.planned_time && (
                      <span style={{ fontSize: 14, fontWeight: 500, color: "#8e8e93", marginLeft: 8 }}>
                        {p.planned_time}
                      </span>
                    )}
                  </div>
                </div>
                <span style={{ fontSize: 28 }}>{emoji}</span>
              </div>

              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 12, color: "#8e8e93", marginBottom: 6 }}>Workout type</div>
                <select
                  value={p.plan_type}
                  disabled={!canEdit}
                  onChange={(e) => {
                    const nextType = e.target.value;
                    const patch = { plan_type: nextType };
                    if (nextType === "REST") patch.planned_time = null;
                    setPlan(p.id, patch);
                  }}
                  style={{ ...inputStyle, appearance: "none", WebkitAppearance: "none" }}
                >
                  {allowedTypes.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>

              {p.plan_type !== "REST" && (
                <div>
                  <div style={{ fontSize: 12, color: "#8e8e93", marginBottom: 6 }}>Time</div>
                  <input
                    type="time"
                    value={p.planned_time || ""}
                    disabled={!canEdit}
                    onChange={(e) => setPlan(p.id, { planned_time: clampTime(e.target.value) })}
                    style={inputStyle}
                  />
                </div>
              )}

              {p.plan_type === "REST" && (
                <div style={{ fontSize: 13, color: "#8e8e93" }}>Rest day — no time needed.</div>
              )}
            </div>
          );
        })}
      </div>

      <BottomNav active="plan" />
    </div>
  );
}
