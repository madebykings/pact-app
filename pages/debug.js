// pages/debug.js
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

function Status({ label, result }) {
  return (
    <div
      style={{
        padding: 12,
        border: "1px solid #eee",
        borderRadius: 12,
        marginBottom: 10,
        background: result?.ok ? "rgba(0,200,0,0.06)" : "rgba(200,0,0,0.06)",
      }}
    >
      <div style={{ fontWeight: 800 }}>
        {result?.ok ? "✅" : "❌"} {label}
      </div>
      {!result?.ok && result?.error && (
        <div style={{ marginTop: 6, fontSize: 13, opacity: 0.8 }}>
          {result.error}
        </div>
      )}
    </div>
  );
}

export default function Debug() {
  const [results, setResults] = useState({});
  const [user, setUser] = useState(null);

  useEffect(() => {
    runChecks();
  }, []);

  async function runChecks() {
    const out = {};

    try {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      if (!data?.user) {
        out.auth = { ok: false, error: "No authenticated user" };
        setResults(out);
        return;
      }
      setUser(data.user);
      out.auth = { ok: true };
    } catch (e) {
      out.auth = { ok: false, error: e.message };
      setResults(out);
      return;
    }

    async function test(label, fn) {
      try {
        await fn();
        out[label] = { ok: true };
      } catch (e) {
        out[label] = { ok: false, error: e.message };
      }
      setResults({ ...out });
    }

    // USER PROFILES
    await test("user_profiles", async () => {
      const { error } = await supabase
        .from("user_profiles")
        .select("user_id")
        .limit(1);
      if (error) throw error;
    });

    // USER SETTINGS
    await test("user_settings", async () => {
      const { error } = await supabase
        .from("user_settings")
        .select("user_id")
        .limit(1);
      if (error) throw error;
    });

    // PLANS
    await test("plans", async () => {
      const { error } = await supabase
        .from("plans")
        .select("id")
        .limit(1);
      if (error) throw error;
    });

    // WATER LOGS
    await test("water_logs", async () => {
      const { error } = await supabase
        .from("water_logs")
        .select("id")
        .limit(1);
      if (error) throw error;
    });

    // SUPPLEMENTS
    await test("supplements", async () => {
      const { error } = await supabase
        .from("supplements")
        .select("id")
        .limit(1);
      if (error) throw error;
    });

    // SUPPLEMENT LOGS
    await test("supplement_logs", async () => {
      const { error } = await supabase
        .from("supplement_logs")
        .select("id")
        .limit(1);
      if (error) throw error;
    });

    // SLEEP LOGS
    await test("sleep_logs", async () => {
      const { error } = await supabase
        .from("sleep_logs")
        .select("id")
        .limit(1);
      if (error) throw error;
    });

    // WORKOUT LOGS
    await test("workout_logs", async () => {
      const { error } = await supabase
        .from("workout_logs")
        .select("id")
        .limit(1);
      if (error) throw error;
    });

    // PUSH DEVICES
    await test("push_devices", async () => {
      const { error } = await supabase
        .from("push_devices")
        .select("user_id")
        .limit(1);
      if (error) throw error;
    });

    // ACTIVITY EVENTS
    await test("activity_events", async () => {
      const { error } = await supabase
        .from("activity_events")
        .select("id")
        .limit(1);
      if (error) throw error;
    });

    // TEAM TABLES
    await test("teams", async () => {
      const { error } = await supabase
        .from("teams")
        .select("id")
        .limit(1);
      if (error) throw error;
    });

    await test("team_members", async () => {
      const { error } = await supabase
        .from("team_members")
        .select("user_id")
        .limit(1);
      if (error) throw error;
    });

    await test("team_invites", async () => {
      const { error } = await supabase
        .from("team_invites")
        .select("id")
        .limit(1);
      if (error) throw error;
    });
  }

  return (
    <div
      style={{
        padding: 18,
        fontFamily: "system-ui",
        maxWidth: 520,
        margin: "0 auto",
      }}
    >
      <h2>Schema Debug</h2>

      <div style={{ marginBottom: 12, opacity: 0.7 }}>
        {user ? `User: ${user.email}` : "Checking auth..."}
      </div>

      {Object.keys(results).length === 0 && (
        <div>Running checks…</div>
      )}

      {Object.entries(results).map(([key, val]) => (
        <Status key={key} label={key} result={val} />
      ))}

      <button
        style={{ width: "100%", padding: 12, marginTop: 12 }}
        onClick={runChecks}
      >
        Re-run checks
      </button>

      <div style={{ marginTop: 20 }}>
        <a href="/dashboard">Back to Dashboard</a>
      </div>
    </div>
  );
}
