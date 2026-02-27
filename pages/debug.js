// pages/debug.js
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function isoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

// If you have your own planTypeForDate, you can import it.
// For debug we keep it simple.
function planTypeForDate(d) {
  // Example: Mon/Wed/Fri/Sat = TRAIN, Tue/Thu = LIGHT, Sun = REST
  const day = d.getDay(); // 0 Sun
  if (day === 0) return "REST";
  if (day === 2 || day === 4) return "LIGHT";
  return "TRAIN";
}

function Card({ title, children }) {
  return (
    <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
      <div style={{ fontSize: 14, opacity: 0.8 }}>{title}</div>
      <div style={{ marginTop: 10 }}>{children}</div>
    </div>
  );
}

function Step({ s }) {
  const bg = s.status === "ok" ? "rgba(0,200,0,0.06)" : s.status === "fail" ? "rgba(200,0,0,0.06)" : "transparent";
  return (
    <div style={{ padding: 10, border: "1px solid #eee", borderRadius: 12, marginBottom: 10, background: bg }}>
      <div style={{ fontWeight: 800 }}>
        {s.status === "ok" ? "✅" : s.status === "fail" ? "❌" : "⏳"} {s.name}
      </div>
      {s.detail && <div style={{ marginTop: 6, fontSize: 13, opacity: 0.85 }}>{s.detail}</div>}
    </div>
  );
}

export default function Debug() {
  const [user, setUser] = useState(null);
  const [steps, setSteps] = useState([]);
  const [basic, setBasic] = useState([]);
  const [err, setErr] = useState("");

  const today = useMemo(() => new Date(), []);
  const todayStr = isoDate(today);
  const tomorrowStr = isoDate(addDays(today, 1));

  useEffect(() => {
    runBasicChecks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pushStep(name, status = "pending", detail = "") {
    setSteps((prev) => [...prev, { name, status, detail }]);
  }
  function updateLast(status, detail = "") {
    setSteps((prev) => {
      const next = [...prev];
      const i = next.length - 1;
      if (i >= 0) next[i] = { ...next[i], status, detail };
      return next;
    });
  }

  async function runBasicChecks() {
    setErr("");
    setBasic([]);

    const out = [];
    const add = (name, ok, detail) => out.push({ name, ok, detail });

    try {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      if (!data?.user) {
        add("auth.getUser", false, "No user session");
        setBasic(out);
        return;
      }
      setUser(data.user);
      add("auth.getUser", true, data.user.email);
    } catch (e) {
      add("auth.getUser", false, e.message);
      setBasic(out);
      return;
    }

    async function sel(table, col = "id") {
      const { error } = await supabase.from(table).select(col).limit(1);
      if (error) throw error;
    }

    const tables = [
      ["user_profiles", "user_id"],
      ["user_settings", "user_id"],
      ["plans", "id"],
      ["water_logs", "user_id"],
      ["supplements", "id"],
      ["supplement_logs", "supplement_id"],
      ["sleep_logs", "user_id"],
      ["workout_logs", "plan_id"],
      ["push_devices", "user_id"],
      ["activity_events", "id"],
      ["teams", "id"],
      ["team_members", "user_id"],
      ["team_invites", "id"],
    ];

    for (const [t, c] of tables) {
      try {
        await sel(t, c);
        add(t, true, "select OK");
      } catch (e) {
        add(t, false, e.message);
      }
    }

    setBasic(out);
  }

  async function runDashboardFlow() {
    setErr("");
    setSteps([]);

    try {
      pushStep("1) auth.getUser");
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      if (!data?.user) throw new Error("No user session");
      setUser(data.user);
      updateLast("ok", data.user.email);

      const userId = data.user.id;

      // --- bootstrapDefaults (writes!) ---
      pushStep("2) upsert user_profiles");
      {
        const { error: e } = await supabase
          .from("user_profiles")
          .upsert({ user_id: userId, display_name: "" }, { onConflict: "user_id" });
        if (e) throw e;
      }
      updateLast("ok");

      pushStep("3) upsert water_logs (today)");
      {
        const { error: e } = await supabase
          .from("water_logs")
          .upsert({ user_id: userId, log_date: todayStr, ml_total: 0 }, { onConflict: "user_id,log_date" });
        if (e) throw e;
      }
      updateLast("ok");

      pushStep("4) upsert plans (today)");
      {
        const { error: e } = await supabase.from("plans").upsert(
          {
            user_id: userId,
            plan_date: todayStr,
            plan_type: planTypeForDate(today),
            status: "PLANNED",
          },
          { onConflict: "user_id,plan_date" }
        );
        if (e) throw e;
      }
      updateLast("ok");

      pushStep("5) upsert plans (tomorrow)");
      {
        const d = addDays(today, 1);
        const { error: e } = await supabase.from("plans").upsert(
          {
            user_id: userId,
            plan_date: tomorrowStr,
            plan_type: planTypeForDate(d),
            status: "PLANNED",
          },
          { onConflict: "user_id,plan_date" }
        );
        if (e) throw e;
      }
      updateLast("ok");

      // --- refreshAll reads that should now return rows ---
      pushStep("6) fetch today plan (should not be null)");
      const { data: tp, error: tpErr } = await supabase
        .from("plans")
        .select("*")
        .eq("user_id", userId)
        .eq("plan_date", todayStr)
        .maybeSingle();
      if (tpErr) throw tpErr;
      if (!tp) throw new Error(`todayPlan is null after upsert (check RLS / onConflict / constraints). date=${todayStr}`);
      updateLast("ok", `id=${tp.id}`);

      pushStep("7) fetch tomorrow plan (should not be null)");
      const { data: tomp, error: tomErr } = await supabase
        .from("plans")
        .select("*")
        .eq("user_id", userId)
        .eq("plan_date", tomorrowStr)
        .maybeSingle();
      if (tomErr) throw tomErr;
      if (!tomp) throw new Error(`tomorrowPlan is null after upsert (check RLS / onConflict / constraints). date=${tomorrowStr}`);
      updateLast("ok", `id=${tomp.id}`);

      pushStep("8) fetch water row (today)");
      const { data: w, error: wErr } = await supabase
        .from("water_logs")
        .select("*")
        .eq("user_id", userId)
        .eq("log_date", todayStr)
        .maybeSingle();
      if (wErr) throw wErr;
      updateLast("ok", w ? `ml_total=${w.ml_total}` : "row missing (unexpected)");

      pushStep("9) fetch supplements (active)");
      const { data: s, error: sErr } = await supabase
        .from("supplements")
        .select("*")
        .eq("user_id", userId)
        .eq("active", true)
        .limit(5);
      if (sErr) throw sErr;
      updateLast("ok", `count=${(s || []).length}`);

      pushStep("✅ Dashboard flow finished");
      updateLast("ok", "If dashboard still shows Loading, the issue is inside dashboard.js UI logic (not DB).");
    } catch (e) {
      const msg = e?.message || String(e);
      updateLast("fail", msg);
      setErr(msg);
    }
  }

  return (
    <div style={{ padding: 18, fontFamily: "system-ui", maxWidth: 520, margin: "0 auto" }}>
      <h2>Debug</h2>
      <div style={{ opacity: 0.75 }}>{user ? `User: ${user.email}` : "No user loaded yet"}</div>

      {err && (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #f2c", borderRadius: 12 }}>
          <b>Error:</b> {err}
        </div>
      )}

      <Card title="Basic schema checks (select only)">
        {basic.length === 0 ? (
          <div>Running…</div>
        ) : (
          basic.map((r) => (
            <div
              key={r.name}
              style={{
                padding: 10,
                border: "1px solid #eee",
                borderRadius: 12,
                marginBottom: 10,
                background: r.ok ? "rgba(0,200,0,0.06)" : "rgba(200,0,0,0.06)",
              }}
            >
              <div style={{ fontWeight: 800 }}>{r.ok ? "✅" : "❌"} {r.name}</div>
              {r.detail && <div style={{ marginTop: 6, fontSize: 13, opacity: 0.85 }}>{r.detail}</div>}
            </div>
          ))
        )}

        <button style={{ width: "100%", padding: 12 }} onClick={runBasicChecks}>
          Re-run basic checks
        </button>
      </Card>

      <Card title="Dashboard flow check (includes writes)">
        <button style={{ width: "100%", padding: 12 }} onClick={runDashboardFlow}>
          Run dashboard flow
        </button>

        <div style={{ marginTop: 12 }}>
          {steps.map((s, i) => (
            <Step key={i} s={s} />
          ))}
        </div>
      </Card>

      <div style={{ marginTop: 16 }}>
        <a href="/dashboard">Back to Dashboard</a>
      </div>
    </div>
  );
}
