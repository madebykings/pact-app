// pages/leaderboard.js
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

function mondayStart(d) {
  const x = new Date(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

function shortId(uid) {
  return String(uid || "").slice(0, 6);
}

function prettyName(displayName, userId) {
  const dn = (displayName || "").trim();
  return dn || `Member (${shortId(userId)})`;
}

function rankBadge(idx) {
  if (idx === 0) return { icon: "🥇", top: true };
  if (idx === 1) return { icon: "🥈", top: true };
  if (idx === 2) return { icon: "🥉", top: true };
  return { icon: `${idx + 1}`, top: false };
}

const DONE_TYPES = new Set(["workout_done", "undo_workout_done"]);
const CANCEL_TYPES = new Set(["workout_cancel", "undo_workout_cancel"]);
const PLAN_TYPES = new Set(["set_tomorrow_time"]);
const WATER_TYPES = new Set(["water_hit_target"]);
const SLEEP_TYPES = new Set(["sleep_hit_target"]);

function addBucket(agg, type, pts) {
  if (DONE_TYPES.has(type)) agg.done += pts;
  else if (PLAN_TYPES.has(type)) agg.plan_time += pts;
  else if (WATER_TYPES.has(type)) agg.water += pts;
  else if (SLEEP_TYPES.has(type)) agg.sleep += pts;
  else if (CANCEL_TYPES.has(type)) agg.cancel += pts;
}

export default function Leaderboard() {
  const [user, setUser] = useState(null);
  const [teamId, setTeamId] = useState(null);
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const today = useMemo(() => new Date(), []);
  const weekStart = useMemo(() => mondayStart(today), [today]);
  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);
  const startStr = isoDate(weekStart);
  const endStr = isoDate(weekEnd);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;
        if (!data?.user) { window.location.href = "/"; return; }
        setUser(data.user);

        const { data: st, error: stErr } = await supabase
          .from("user_settings").select("team_id").eq("user_id", data.user.id).maybeSingle();
        if (stErr) throw stErr;

        const tid = st?.team_id || null;
        setTeamId(tid);
        if (!tid) { setRows([]); setLoading(false); return; }

        const { data: tm, error: tmErr } = await supabase
          .from("team_members").select("user_id").eq("team_id", tid);
        if (tmErr) throw tmErr;

        const userIds = (tm || []).map((x) => x.user_id).filter(Boolean);
        if (!userIds.length) { setRows([]); setLoading(false); return; }

        let profiles = [];
        try {
          const resp = await fetch("/api/team/member-profiles", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userIds }),
          });
          const json = await resp.json();
          if (json.profiles) profiles = json.profiles;
        } catch (e) {
          console.warn("leaderboard member-profiles error:", e);
        }

        const members = userIds.map((uid) => ({
          user_id: uid,
          display_name: profiles.find((p) => p.user_id === uid)?.display_name || "",
        }));

        let evs = [];
        const { data: aData, error: aErr } = await supabase
          .from("activity_events").select("user_id,event_type,points,event_date")
          .in("user_id", userIds).gte("event_date", startStr).lte("event_date", endStr);
        if (!aErr) evs = aData || [];

        let pev = [];
        if (!evs.length) {
          const { data: pData, error: pErr } = await supabase
            .from("points_events").select("user_id,type,points,date")
            .in("user_id", userIds).gte("date", startStr).lte("date", endStr);
          if (!pErr) pev = pData || [];
        }

        const byUser = new Map();
        const ensure = (uid) => {
          if (!byUser.has(uid)) byUser.set(uid, { total: 0, done: 0, plan_time: 0, water: 0, sleep: 0, cancel: 0 });
          return byUser.get(uid);
        };

        evs.forEach((e) => {
          if (!e.user_id) return;
          const agg = ensure(e.user_id);
          const pts = Number(e.points || 0);
          agg.total += pts;
          addBucket(agg, e.event_type, pts);
        });
        pev.forEach((e) => {
          if (!e.user_id) return;
          const agg = ensure(e.user_id);
          const pts = Number(e.points || 0);
          agg.total += pts;
          addBucket(agg, e.type, pts);
        });

        const merged = members.map((m) => {
          const agg = byUser.get(m.user_id) || { total: 0, done: 0, plan_time: 0, water: 0, sleep: 0, cancel: 0 };
          return { ...m, ...agg, points: agg.total };
        });

        merged.sort((a, b) => {
          if (b.points !== a.points) return b.points - a.points;
          return prettyName(a.display_name, a.user_id).localeCompare(prettyName(b.display_name, b.user_id));
        });

        setRows(merged);
        setErr("");
        setLoading(false);
      } catch (e) {
        setErr(e?.message || String(e));
        setLoading(false);
      }
    })();
  }, []);

  const meId = user?.id;
  const maxPts = rows[0]?.points || 1;

  return (
    <div style={pageStyle}>
      <div style={{ padding: "24px 18px 4px" }}>
        <div style={{ fontSize: 13, color: "#8e8e93", marginBottom: 2 }}>{startStr} → {endStr}</div>
        <div style={{ fontSize: 28, fontWeight: 800, color: "#111", letterSpacing: -0.5 }}>Leaderboard</div>
      </div>

      <div style={{ padding: "8px 18px 0" }}>
        {err && (
          <div style={{ padding: 14, background: "#fff0f0", borderRadius: 14, color: "#c00", fontSize: 13, marginBottom: 12 }}>
            {err}
          </div>
        )}

        {loading && (
          <div style={{ padding: "40px 0", textAlign: "center", color: "#8e8e93", fontSize: 15 }}>Loading…</div>
        )}

        {!loading && !teamId && (
          <div style={card}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>No team yet</div>
            <div style={{ color: "#8e8e93", fontSize: 14, marginBottom: 14 }}>
              Join or create a team to see the leaderboard.
            </div>
            <a
              href="/team"
              style={{
                display: "block", textAlign: "center", padding: "12px 0",
                background: PRIMARY, color: "#fff", borderRadius: 13,
                fontWeight: 800, textDecoration: "none", fontSize: 15,
              }}
            >
              Go to Pact
            </a>
          </div>
        )}

        {!loading && teamId && rows.map((r, idx) => {
          const isMe = r.user_id === meId;
          const name = prettyName(r.display_name, r.user_id);
          const badge = rankBadge(idx);
          const pct = maxPts > 0 ? Math.max(4, (r.points / maxPts) * 100) : 4;

          return (
            <div
              key={r.user_id}
              style={{
                ...card,
                border: isMe ? `2px solid ${PRIMARY}` : "2px solid transparent",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <div style={{
                  width: 38, height: 38, borderRadius: 12, flexShrink: 0,
                  background: badge.top ? "rgba(91,79,233,0.08)" : "#f2f2f7",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: badge.top ? 22 : 14, fontWeight: 800, color: badge.top ? PRIMARY : "#8e8e93",
                }}>
                  {badge.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 15, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {name}{isMe ? " · you" : ""}
                  </div>
                </div>
                <div style={{ fontWeight: 900, fontSize: 22, color: idx === 0 ? PRIMARY : "#111" }}>
                  {r.points}
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#8e8e93", marginLeft: 3 }}>pts</span>
                </div>
              </div>

              <div style={{ height: 6, borderRadius: 3, background: "#f2f2f7", overflow: "hidden", marginBottom: 10 }}>
                <div style={{
                  height: "100%", width: `${pct}%`,
                  background: idx === 0 ? PRIMARY : "#a78bfa",
                  borderRadius: 3, transition: "width 0.5s ease",
                }} />
              </div>

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[
                  { label: "Workout", val: r.done },
                  { label: "Plan", val: r.plan_time },
                  { label: "Water", val: r.water },
                  { label: "Sleep", val: r.sleep },
                  r.cancel ? { label: "Cancel", val: r.cancel, red: true } : null,
                ].filter(Boolean).map((pill) => (
                  <span
                    key={pill.label}
                    style={{
                      fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 20,
                      background: pill.red ? "rgba(255,69,58,0.1)" : "rgba(91,79,233,0.08)",
                      color: pill.red ? "#ff453a" : PRIMARY,
                    }}
                  >
                    {pill.label} {pill.val > 0 && !pill.red ? `+${pill.val}` : pill.val}
                  </span>
                ))}
              </div>
            </div>
          );
        })}

        {!loading && teamId && (
          <div style={{ ...card, marginTop: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#8e8e93", letterSpacing: 1, marginBottom: 12 }}>
              POINTS GUIDE
            </div>
            {[
              { label: "Workout done", pts: "+10" },
              { label: "Set tomorrow's time", pts: "+3" },
              { label: "Hit water target", pts: "+2" },
              { label: "Hit sleep target", pts: "+2" },
              { label: "Cancel workout", pts: "−5" },
            ].map((g, i, arr) => (
              <div
                key={g.label}
                style={{
                  display: "flex", justifyContent: "space-between",
                  paddingBottom: i < arr.length - 1 ? 10 : 0,
                  marginBottom: i < arr.length - 1 ? 10 : 0,
                  borderBottom: i < arr.length - 1 ? "1px solid #f2f2f7" : "none",
                }}
              >
                <span style={{ fontSize: 14, color: "#555" }}>{g.label}</span>
                <span style={{ fontWeight: 800, fontSize: 14, color: g.pts.startsWith("−") ? "#ff453a" : PRIMARY }}>
                  {g.pts}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <BottomNav active="pact" />
    </div>
  );
}
