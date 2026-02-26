import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function Settings() {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(null);
  const [activities, setActivities] = useState([]);
  const [supps, setSupps] = useState([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data?.user) return (window.location.href = "/");
      setUser(data.user);

      const { data: st, error: stErr } = await supabase
        .from("user_settings")
        .select("*")
        .eq("user_id", data.user.id)
        .maybeSingle();
      if (stErr) return setErr(stErr.message);
      setSettings(st);

      const { data: at, error: atErr } = await supabase
        .from("activity_types")
        .select("*")
        .order("sort");
      if (atErr) return setErr(atErr.message);
      setActivities(at || []);

      const { data: s, error: sErr } = await supabase
        .from("supplements")
        .select("*")
        .eq("user_id", data.user.id)
        .order("name");
      if (sErr) return setErr(sErr.message);
      setSupps(s || []);
    })();
  }, []);

  async function save(partial) {
    const next = { ...(settings || {}), ...partial, user_id: user.id };
    setSettings(next);

    const { error } = await supabase.from("user_settings").upsert(next, { onConflict: "user_id" });
    if (error) alert(error.message);
  }

  if (err) return <div style={{ padding: 18, fontFamily: "system-ui" }}>Error: {err}</div>;
  if (!settings) return <div style={{ padding: 18, fontFamily: "system-ui" }}>Loading…</div>;

  const brutal = settings.brutal_copy || {};
  const times = settings.reminder_times || ["08:00", "12:00", "18:00"];
  const included = new Set(settings.included_activities || []);

  return (
    <div style={{ padding: 18, fontFamily: "system-ui", maxWidth: 560, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Settings</h2>
        <a href="/dashboard" style={{ textDecoration: "none", border: "1px solid #ddd", padding: "6px 10px", borderRadius: 10 }}>
          Back
        </a>
      </div>

      {/* MODE */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Mode</div>
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <button
            style={{ flex: 1, padding: 12, fontWeight: 800, opacity: settings.mode === "solo" ? 1 : 0.5 }}
            onClick={() => save({ mode: "solo" })}
          >
            Solo
          </button>
          <button
            style={{ flex: 1, padding: 12, fontWeight: 800, opacity: settings.mode === "team" ? 1 : 0.5 }}
            onClick={() => save({ mode: "team" })}
          >
            Team
          </button>
        </div>
        {settings.mode === "team" && (
          <div style={{ marginTop: 10 }}>
            <a href="/team" style={{ display: "inline-block", marginTop: 6 }}>
              Manage team / invite
            </a>
          </div>
        )}
      </div>

      {/* WATER */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Water target (ml)</div>
        <input
          type="number"
          value={settings.water_target_ml || 3000}
          onChange={(e) => save({ water_target_ml: Number(e.target.value || 0) })}
          style={{ width: "100%", padding: 12, fontSize: 16, marginTop: 8 }}
        />
      </div>

      {/* REMINDERS */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Reminder times</div>
        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          {times.map((t, idx) => (
            <div key={idx} style={{ display: "flex", gap: 10 }}>
              <input
                type="time"
                value={t}
                onChange={(e) => {
                  const next = [...times];
                  next[idx] = e.target.value;
                  save({ reminder_times: next });
                }}
                style={{ flex: 1, padding: 12, fontSize: 16 }}
              />
              <button
                onClick={() => {
                  const next = times.filter((_, i) => i !== idx);
                  save({ reminder_times: next.length ? next : ["08:00"] });
                }}
              >
                Remove
              </button>
            </div>
          ))}
          <button onClick={() => save({ reminder_times: [...times, "18:00"] })}>+ Add time</button>
        </div>
      </div>

      {/* INCLUDED ACTIVITIES */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Included activities (used in plan generation)</div>
        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          {activities
            .filter((a) => a.key !== "rest")
            .map((a) => {
              const on = included.has(a.key);
              return (
                <button
                  key={a.id}
                  style={{ padding: 12, textAlign: "left", opacity: on ? 1 : 0.45 }}
                  onClick={() => {
                    const next = new Set(included);
                    if (on) next.delete(a.key);
                    else next.add(a.key);
                    save({ included_activities: Array.from(next) });
                  }}
                >
                  <b>{on ? "✅" : "⬜"} {a.label}</b>
                </button>
              );
            })}
        </div>
        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
          Rest days are always suggested automatically.
        </div>
      </div>

      {/* SUPPLEMENTS INCLUDED */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Included supplements</div>
        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          {supps.map((s) => (
            <button
              key={s.id}
              style={{ padding: 12, textAlign: "left", opacity: s.active ? 1 : 0.45 }}
              onClick={async () => {
                const { error } = await supabase
                  .from("supplements")
                  .update({ active: !s.active })
                  .eq("id", s.id);
                if (error) alert(error.message);

                const { data: s2 } = await supabase
                  .from("supplements")
                  .select("*")
                  .eq("user_id", user.id)
                  .order("name");
                setSupps(s2 || []);
              }}
            >
              <b>{s.active ? "✅" : "⬜"} {s.name}</b>
            </button>
          ))}
        </div>
      </div>

      {/* BRUTAL COPY */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Brutal messages</div>

        {["missed_workout", "missed_supps", "missed_sleep", "missed_water"].map((k) => (
          <label key={k} style={{ display: "grid", gap: 6, marginTop: 10 }}>
            <div style={{ fontSize: 13, opacity: 0.7 }}>{k}</div>
            <input
              value={brutal[k] || ""}
              onChange={(e) => {
                const next = { ...brutal, [k]: e.target.value };
                save({ brutal_copy: next });
              }}
              style={{ width: "100%", padding: 12, fontSize: 16 }}
              placeholder="Write your message..."
            />
          </label>
        ))}
      </div>
    </div>
  );
}
