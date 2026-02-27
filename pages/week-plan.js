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

  const start = useMemo(() => new Date(), []);
  const dates = useMemo(() => Array.from({ length: 7 }).map((_, i) => isoDate(addDays(start, i))), [start]);

  const allowedTypes = useMemo(() => {
    const inc = Array.isArray(settings?.included_activities) ? settings.included_activities : [];
    const set = new Set(inc);
    // Always allow REST + OTHER
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
    // Create rows if missing (relies on unique user_id+plan_date)
    // IMPORTANT: do NOT overwrite existing plan rows (otherwise it looks like your plan "resets to REST").
    for (const d of dates) {
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
      .in("plan_date", dates)
      .order("plan_date");
    if (error) throw error;
    setPlans(data || []);
  }

  async function setPlan(planId, patch) {
    if (!user) return;
    if (!canEdit) return alert("Only the team leader can edit the plan.");
    // Avoid touching columns that may not exist in your schema (e.g. updated_at)
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Week plan</h2>
        <a href="/dashboard" style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 10, textDecoration: "none" }}>
          Back
        </a>
      </div>

      {settings.mode === "team" && (
        <div style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>
          Team mode: {canEdit ? "You can edit (leader)." : "Read-only (only leader can edit)."}
        </div>
      )}

      <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
        {plans.map((p) => (
          <div key={p.id} style={{ padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
            <div style={{ fontSize: 13, opacity: 0.8 }}>{p.plan_date}</div>

            <div style={{ marginTop: 10, fontWeight: 900, fontSize: 14, opacity: 0.8 }}>Workout</div>
            <select
              value={p.plan_type}
              disabled={!canEdit}
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
                disabled={!canEdit}
                onChange={(e) => setPlan(p.id, { planned_time: clampTime(e.target.value) })}
                style={{ width: "100%", padding: 12, fontSize: 16, marginTop: 8 }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
