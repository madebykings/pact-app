// pages/debug.js
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { addDays, isoDate, planTypeForDate } from "../lib/weekTemplate";

export default function Debug() {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);

  function log(step, ok, msg = "", extra = null) {
    setRows((r) => [
      ...r,
      {
        ts: new Date().toISOString(),
        step,
        ok,
        msg,
        extra,
      },
    ]);
  }

  async function run() {
    setRows([]);
    setBusy(true);

    try {
      // 1) Auth
      const { data: u, error: uErr } = await supabase.auth.getUser();
      if (uErr) throw uErr;
      if (!u?.user) throw new Error("No user session. Login first.");
      const userId = u.user.id;
      log("1) auth.getUser()", true, `user=${userId}`);

      const today = new Date();
      const todayStr = isoDate(today);
      const tomorrow = addDays(today, 1);
      const tomorrowStr = isoDate(tomorrow);

      // 2) upsert profile
      {
        const payload = { user_id: userId, display_name: "" };
        const { error } = await supabase
          .from("user_profiles")
          .upsert(payload, { onConflict: "user_id" });
        if (error) throw error;
        log("2) upsert user_profiles", true, JSON.stringify(payload));
      }

      // 3) ensure settings row exists (DO NOT overwrite mode/team_id)
      {
        const { data: existing, error: selErr } = await supabase
          .from("user_settings")
          .select("user_id")
          .eq("user_id", userId)
          .maybeSingle();
        if (selErr) throw selErr;

        if (!existing) {
          const payload = {
            user_id: userId,
            mode: "solo",
            tone_mode: "normal",
            water_target_ml: 3000,
            sleep_target_hours: 8,
            reminder_times: ["08:00", "12:00", "18:00"],
            included_activities: ["WALK", "RUN", "SPIN", "SWIM", "WEIGHTS"],
            timezone: "Europe/London",
          };
          const { error } = await supabase.from("user_settings").insert(payload);
          if (error) throw error;
          log("3) insert user_settings", true, "created");
        } else {
          log("3) user_settings exists", true, "skipped");
        }
      }

      // 4) upsert plans (today) - MUST match real app plan types
      {
        const payload = {
          user_id: userId,
          plan_date: todayStr,
          plan_type: planTypeForDate(today),
          // NOTE: no status on purpose (same as dashboard ensurePlan)
        };

        const { error } = await supabase
          .from("plans")
          .upsert(payload, {
            onConflict: "user_id,plan_date",
            ignoreDuplicates: true,
          });

        if (error) throw error;
        log("4) upsert plans (today)", true, JSON.stringify(payload));
      }

      // 5) upsert plans (tomorrow)
      {
        const payload = {
          user_id: userId,
          plan_date: tomorrowStr,
          plan_type: planTypeForDate(tomorrow),
        };

        const { error } = await supabase
          .from("plans")
          .upsert(payload, {
            onConflict: "user_id,plan_date",
            ignoreDuplicates: true,
          });

        if (error) throw error;
        log("5) upsert plans (tomorrow)", true, JSON.stringify(payload));
      }

      // 6) read back today plan
      {
        const { data, error } = await supabase
          .from("plans")
          .select("*")
          .eq("user_id", userId)
          .eq("plan_date", todayStr)
          .maybeSingle();

        if (error) throw error;
        log("6) select plans (today)", true, JSON.stringify(data || null));
      }

      log("DONE", true, "All checks passed ✅");
    } catch (e) {
      // This is the exact error you need to paste back if it still fails.
      log("FAILED", false, e?.message || String(e), e);
      console.error("DEBUG FAILED:", e);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    // auto-run on load
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ padding: 20, fontFamily: "system-ui", maxWidth: 900, margin: "0 auto" }}>
      <h2 style={{ marginTop: 0 }}>PACT Debug</h2>

      <button onClick={run} disabled={busy} style={{ padding: "10px 14px", fontWeight: 800 }}>
        {busy ? "Running…" : "Run Debug"}
      </button>

      <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
        {rows.map((r, i) => (
          <div
            key={i}
            style={{
              padding: 12,
              border: "1px solid #ddd",
              borderRadius: 12,
              background: r.ok ? "#f6ffed" : "#fff1f0",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div style={{ fontWeight: 900 }}>
                {r.ok ? "✅" : "❌"} {r.step}
              </div>
              <div style={{ opacity: 0.7, fontSize: 12 }}>{r.ts}</div>
            </div>

            {r.msg ? <div style={{ marginTop: 6 }}>{r.msg}</div> : null}

            {r.extra ? (
              <pre style={{ marginTop: 10, whiteSpace: "pre-wrap", fontSize: 12, opacity: 0.85 }}>
                {typeof r.extra === "string" ? r.extra : JSON.stringify(r.extra, null, 2)}
              </pre>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
