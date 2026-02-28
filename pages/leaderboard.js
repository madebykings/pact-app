// pages/leaderboard.js
import { useEffect, useMemo, useState } from "react";
import TopNav from "../components/Nav";
import { supabase } from "../lib/supabaseClient";
import { addDays, isoDate } from "../lib/weekTemplate";

function mondayStart(d) {
  const x = new Date(d);
  const day = x.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day; // Monday start
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

// Treat all these as “cancel bucket” so cancel + undo nets to 0
const CANCEL_TYPES = new Set([
  "workout_cancel",
  "workout_uncancel",
  "workout_cancel_undo",
  "workout_undo_cancel",
  "cancel_undo",
]);

export default function Leaderboard() {
  const [user, setUser] = useState(null);
  const [teamId, setTeamId] = useState(null);

  const [members, setMembers] = useState([]); // {user_id, display_name?}
  const [rows, setRows] = useState([]); // ranked
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

        // Pull team_id from user_settings
        const { data: st, error: stErr } = await supabase
          .from("user_settings")
          .select("team_id")
          .eq("user_id", data.user.id)
          .maybeSingle();
        if (stErr) throw stErr;

        const tid = st?.team_id || null;
        setTeamId(tid);

        if (!tid) {
          setMembers([]);
          setRows([]);
          setLoading(false);
          return;
        }

        // Members list (prefer view if available)
        let mem = [];
        try {
          const { data: vm, error: vmErr } = await supabase
            .from("v_team_members_with_profiles")
            .select("user_id, display_name")
            .eq("team_id", tid);
          if (vmErr) throw vmErr;

          mem = (vm || []).map((m) => ({
            user_id: m.user_id,
            display_name: m.display_name || "",
          }));
        } catch {
          const { data: tm, error: tmErr } = await supabase
            .from("team_members")
            .select("user_id")
            .eq("team_id", tid);
          if (tmErr) throw tmErr;

          const userIds = (tm || []).map((x) => x.user_id);
          if (userIds.length) {
            const { data: ups, error: upErr } = await supabase
              .from("user_profiles")
              .select("user_id,display_name")
              .in("user_id", userIds);
            if (upErr) throw upErr;

            mem = userIds.map((uid) => {
              const p = (ups || []).find((u) => u.user_id === uid);
              return { user_id: uid, display_name: p?.display_name || "" };
            });
          }
        }

        setMembers(mem);

        // Events for week (team scoped)
        const { data: evs, error: evErr } = await supabase
          .from("activity_events")
          .select("user_id,event_type,points,event_date")
          .eq("team_id", tid)
          .gte("event_date", startStr)
          .lte("event_date", endStr);

        if (evErr) throw evErr;

        // Aggregate into buckets per user for *the whole week*
        const byUser = new Map();

        (evs || []).forEach((e) => {
          const uid = e.user_id;
          if (!uid) return;

          if (!byUser.has(uid)) {
            byUser.set(uid, {
              user_id: uid,
              done: 0,
              cancel: 0,
              sleep: 0,
              water: 0,
              plan_time: 0,
            });
          }

          const r = byUser.get(uid);
          const pts = Number(e.points || 0);
          const t = e.event_type;

          if (t === "workout_done") r.done += pts;
          else if (t === "set_tomorrow_time") r.plan_time += pts;
          else if (t === "water_hit_target") r.water += pts;
          else if (t === "sleep_hit_target") r.sleep += pts;
          else if (CANCEL_TYPES.has(t)) r.cancel += pts;
        });

        // Ensure all members appear (even if 0 points)
        const merged = (mem || []).map((m) => {
          const agg =
            byUser.get(m.user_id) || {
              user_id: m.user_id,
              done: 0,
              cancel: 0,
              sleep: 0,
              water: 0,
              plan_time: 0,
            };

          const total =
            Number(agg.done || 0) +
            Number(agg.plan_time || 0) +
            Number(agg.water || 0) +
            Number(agg.sleep || 0) +
            Number(agg.cancel || 0);

          return {
            user_id: m.user_id,
            display_name: m.display_name || "",
            done: agg.done,
            cancel: agg.cancel,
            sleep: agg.sleep,
            water: agg.water,
            plan_time: agg.plan_time,
            points: total,
          };
        });

        // Sort: points desc; tie-break: name; then user_id
        merged.sort((a, b) => {
          if (b.points !== a.points) return b.points - a.points;
          const nameA = prettyName(a.display_name, a.user_id);
          const nameB = prettyName(b.display_name, b.user_id);
          const byName = nameA.localeCompare(nameB);
          if (byName !== 0) return byName;
          return String(a.user_id).localeCompare(String(b.user_id));
        });

        setRows(merged);
        setLoading(false);
      } catch (e) {
        setErr(e?.message || String(e));
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

      {!teamId && !loading && (
        <div style={{ marginTop: 14, padding: 14, border: "1px solid rgba(0,0,0,.08)", borderRadius: 12 }}>
          You’re not in a team yet. Create/join a team first.
          <div style={{ marginTop: 10 }}>
            <a href="/team" style={{ textDecoration: "none" }}>
              Go to Team
            </a>
          </div>
        </div>
      )}

      {loading && (
        <div style={{ marginTop: 14, padding: 14, border: "1px solid rgba(0,0,0,.08)", borderRadius: 12 }}>
          Loading…
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
                      <span>
                        DONE: <b>{r.done}</b>
                      </span>
                      <span>
                        PLAN: <b>{r.plan_time}</b>
                      </span>
                      <span>
                        WATER: <b>{r.water}</b>
                      </span>
                      <span>
                        SLEEP: <b>{r.sleep}</b>
                      </span>
                      <span>
                        CANCEL: <b>{r.cancel}</b>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ marginTop: 14, padding: 14, border: "1px solid rgba(0,0,0,.08)", borderRadius: 12 }}>
            <div style={{ fontSize: 14, opacity: 0.8 }}>What counts</div>
            <div style={{ marginTop: 8, lineHeight: 1.5 }}>
              • Workout done: <b>+10</b>
              <br />
              • Set tomorrow time (first time): <b>+3</b>
              <br />
              • Hit water target: <b>+3</b>
              <br />
              • Hit sleep target: <b>+3</b>
              <br />
              • Cancel: <b>-5</b>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
