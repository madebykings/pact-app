// pages/leaderboard.js
import { useEffect, useMemo, useState } from "react";
import TopNav from "../components/Nav";
import { supabase } from "../lib/supabaseClient";
import { addDays, isoDate } from "../lib/weekTemplate";

function mondayStart(d) {
  const x = new Date(d);
  const day = x.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

function shortId(uid) {
  if (!uid) return "";
  return String(uid).slice(0, 6);
}

function prettyName(displayName, userId) {
  const dn = (displayName || "").trim();
  if (dn) return dn;
  return `Member (${shortId(userId)})`;
}

function badgeForRank(idx) {
  if (idx === 0) return "🥇";
  if (idx === 1) return "🥈";
  if (idx === 2) return "🥉";
  return "•";
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
        if (!data?.user) {
          window.location.href = "/";
          return;
        }
        setUser(data.user);

        const { data: st, error: stErr } = await supabase
          .from("user_settings")
          .select("team_id")
          .eq("user_id", data.user.id)
          .maybeSingle();
        if (stErr) throw stErr;

        const tid = st?.team_id || null;
        setTeamId(tid);

        if (!tid) {
          setRows([]);
          setLoading(false);
          return;
        }

        // Members
        const { data: tm, error: tmErr } = await supabase
          .from("team_members")
          .select("user_id")
          .eq("team_id", tid);
        if (tmErr) throw tmErr;

        const userIds = (tm || []).map((x) => x.user_id).filter(Boolean);
        if (!userIds.length) {
          setRows([]);
          setLoading(false);
          return;
        }

        let profiles = [];
        const { data: ups, error: upErr } = await supabase
          .from("user_profiles")
          .select("user_id,display_name")
          .in("user_id", userIds);
        if (!upErr) profiles = ups || [];

        const members = userIds.map((uid) => ({
          user_id: uid,
          display_name: profiles.find((p) => p.user_id === uid)?.display_name || "",
        }));

        // PRIMARY: activity_events
        let evs = [];
        {
          const { data: aData, error: aErr } = await supabase
            .from("activity_events")
            .select("user_id,event_type,points,event_date")
            .in("user_id", userIds)
            .gte("event_date", startStr)
            .lte("event_date", endStr);

          if (aErr) {
            // don't fail immediately; try fallback
            console.warn("leaderboard activity_events error:", aErr);
          } else {
            evs = aData || [];
          }
        }

        // FALLBACK: points_events if activity_events empty (or blocked)
        // (helps when older code only wrote points_events)
        let pev = [];
        if (!evs.length) {
          const { data: pData, error: pErr } = await supabase
            .from("points_events")
            .select("user_id,type,points,date")
            .in("user_id", userIds)
            .gte("date", startStr)
            .lte("date", endStr);

          if (pErr) {
            console.warn("leaderboard points_events fallback error:", pErr);
          } else {
            pev = pData || [];
          }
        }

        const byUser = new Map();
        const ensure = (uid) => {
          if (!byUser.has(uid)) {
            byUser.set(uid, { total: 0, done: 0, plan_time: 0, water: 0, sleep: 0, cancel: 0 });
          }
          return byUser.get(uid);
        };

        (evs || []).forEach((e) => {
          const uid = e.user_id;
          if (!uid) return;
          const agg = ensure(uid);
          const pts = Number(e.points || 0);
          const t = e.event_type;
          agg.total += pts;
          addBucket(agg, t, pts);
        });

        (pev || []).forEach((e) => {
          const uid = e.user_id;
          if (!uid) return;
          const agg = ensure(uid);
          const pts = Number(e.points || 0);
          const t = e.type;
          agg.total += pts;
          addBucket(agg, t, pts);
        });

        const merged = members.map((m) => {
          const agg = byUser.get(m.user_id) || { total: 0, done: 0, plan_time: 0, water: 0, sleep: 0, cancel: 0 };
          return {
            user_id: m.user_id,
            display_name: m.display_name || "",
            done: agg.done,
            plan_time: agg.plan_time,
            water: agg.water,
            sleep: agg.sleep,
            cancel: agg.cancel,
            points: agg.total, // ✅ weekly total points
          };
        });

        merged.sort((a, b) => {
          if (b.points !== a.points) return b.points - a.points;
          const nameA = prettyName(a.display_name, a.user_id);
          const nameB = prettyName(b.display_name, b.user_id);
          const byName = nameA.localeCompare(nameB);
          if (byName !== 0) return byName;
          return String(a.user_id).localeCompare(String(b.user_id));
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

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  const meId = user?.id;

  return (
    <div style={{ padding: 18, maxWidth: 980, margin: "0 auto", fontFamily: "system-ui" }}>
      <TopNav active="pact" onLogout={logout} />

      <h1 style={{ margin: "0 0 14px" }}>Leaderboard</h1>

      {err && (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #f2c", borderRadius: 12 }}>
          <b>Error:</b> {err}
        </div>
      )}

      <div style={{ marginTop: 12, opacity: 0.75 }}>
        Week: <b>{startStr}</b> → <b>{endStr}</b>
      </div>

      {loading && (
        <div style={{ marginTop: 14, padding: 14, border: "1px solid rgba(0,0,0,.08)", borderRadius: 12 }}>
          Loading…
        </div>
      )}

      {!loading && !teamId && (
        <div style={{ marginTop: 14, padding: 14, border: "1px solid rgba(0,0,0,.08)", borderRadius: 12 }}>
          You’re not in a team yet. Create/join a team first.
          <div style={{ marginTop: 10 }}>
            <a href="/team" style={{ textDecoration: "none" }}>
              Go to Team
            </a>
          </div>
        </div>
      )}

      {!loading && teamId && (
        <>
          <div style={{ marginTop: 14, padding: 14, border: "1px solid rgba(0,0,0,.08)", borderRadius: 12 }}>
            <div style={{ fontSize: 14, opacity: 0.8 }}>This week ranking</div>

            <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
              {rows.map((r, idx) => {
                const isMe = r.user_id === meId;
                const name = prettyName(r.display_name, r.user_id);

                return (
                  <div
                    key={r.user_id}
                    style={{
                      padding: 12,
                      border: "1px solid rgba(0,0,0,.08)",
                      borderRadius: 12,
                      background: isMe ? "rgba(0,0,0,0.03)" : "transparent",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <div style={{ fontWeight: 900 }}>
                        {badgeForRank(idx)} {name} {isMe ? "(you)" : ""}
                      </div>
                      <div style={{ fontWeight: 900, fontSize: 18 }}>{r.points} pts</div>
                    </div>

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10, fontSize: 13, opacity: 0.85 }}>
                      <span>DONE: <b>{r.done}</b></span>
                      <span>PLAN: <b>{r.plan_time}</b></span>
                      <span>WATER: <b>{r.water}</b></span>
                      <span>SLEEP: <b>{r.sleep}</b></span>
                      <span>CANCEL: <b>{r.cancel}</b></span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ marginTop: 14, padding: 14, border: "1px solid rgba(0,0,0,.08)", borderRadius: 12 }}>
            <div style={{ fontSize: 14, opacity: 0.8 }}>What counts</div>
            <div style={{ marginTop: 8, lineHeight: 1.5 }}>
              • Workout done: <b>+10</b><br />
              • Set tomorrow time (first time): <b>+3</b><br />
              • Hit water target: <b>+3</b><br />
              • Hit sleep target: <b>+3</b><br />
              • Cancel: <b>-5</b>
            </div>
          </div>
        </>
      )}
    </div>
  );
                        }
