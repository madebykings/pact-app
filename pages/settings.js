// pages/settings.js
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const MODE_OPTIONS = [
  { value: "normal", label: "Normal" },
  { value: "brutal", label: "Brutal" },
  { value: "savage", label: "Savage" },
];

const ACTIVITY_OPTIONS = [
  { value: "WALK", label: "Walk" },
  { value: "RUN", label: "Run" },
  { value: "SPIN", label: "Spin" },
  { value: "SWIM", label: "Swim" },
  { value: "HILLWALK", label: "Hillwalk" },
  { value: "WEIGHTS", label: "Weights" },
  { value: "YOGA", label: "Yoga" },
  { value: "PILATES", label: "Pilates" },
  { value: "OTHER", label: "Other" },
];

function normalizeTime(t) {
  if (!t) return "";
  // Ensure HH:MM
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return "";
  const hh = String(Math.max(0, Math.min(23, Number(m[1])))).padStart(2, "0");
  const mm = String(Math.max(0, Math.min(59, Number(m[2])))).padStart(2, "0");
  return `${hh}:${mm}`;
}

export default function Settings() {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(null);
  const [supps, setSupps] = useState([]);
  const [errMsg, setErrMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const [newSuppName, setNewSuppName] = useState("");

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

        // ensure settings row exists
        await supabase.from("user_settings").upsert(
          {
            user_id: data.user.id,
            mode: "normal",
            water_target_ml: 3000,
            sleep_target_hours: 8,
            reminder_times: ["08:00", "12:00", "18:00"],
            included_activities: ["WALK", "RUN", "SPIN", "SWIM", "WEIGHTS"],
            timezone: "Europe/London",
          },
          { onConflict: "user_id" }
        );

        await refresh(data.user.id);
      } catch (e) {
        setErrMsg(e?.message || String(e));
      }
    })();
  }, []);

  async function refresh(userId) {
    const { data: st, error: stErr } = await supabase
      .from("user_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (stErr) throw stErr;
    setSettings(st);

    const { data: s, error: sErr } = await supabase
      .from("supplements")
      .select("*")
      .eq("user_id", userId)
      .order("name");
    if (sErr) throw sErr;
    setSupps(s || []);
  }

  async function saveSettings(patch) {
    if (!user) return;
    setSaving(true);
    try {
      const next = { ...(settings || {}), ...patch };
      const { error } = await supabase
        .from("user_settings")
        .update(next)
        .eq("user_id", user.id);
      if (error) throw error;
      await refresh(user.id);
    } catch (e) {
      alert(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  function toggleActivity(code) {
    const set = new Set(settings?.included_activities || []);
    if (set.has(code)) set.delete(code);
    else set.add(code);
    saveSettings({ included_activities: Array.from(set) });
  }

  async function toggleSupplementActive(supp) {
    if (!user) return;
    const { error } = await supabase
      .from("supplements")
      .update({ active: !supp.active, updated_at: new Date().toISOString() })
      .eq("id", supp.id);
    if (error) alert(error.message);
    await refresh(user.id);
  }

  async function addSupplement() {
    if (!user) return;
    const name = newSuppName.trim();
    if (!name) return;

    const { error } = await supabase.from("supplements").insert({
      user_id: user.id,
      name,
      active: true,
      rule_type: "ANYTIME",
    });
    if (error) alert(error.message);

    setNewSuppName("");
    await refresh(user.id);
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  if (errMsg) {
    return (
      <div style={{ padding: 20, fontFamily: "system-ui", maxWidth: 520, margin: "0 auto" }}>
        <h2>Settings</h2>
        <p><b>Error:</b> {errMsg}</p>
        <button onClick={logout}>Logout</button>
      </div>
    );
  }

  if (!settings) {
    return <div style={{ padding: 20, fontFamily: "system-ui" }}>Loading…</div>;
  }

  const reminderTimes = Array.isArray(settings.reminder_times) ? settings.reminder_times : ["08:00", "12:00", "18:00"];

  return (
    <div style={{ padding: 18, fontFamily: "system-ui", maxWidth: 520, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Settings</h2>
        <a href="/dashboard" style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 10, textDecoration: "none" }}>
          Back
        </a>
      </div>

      {/* MODE */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Tone</div>
        <select
          value={settings.mode || "normal"}
          onChange={(e) => saveSettings({ mode: e.target.value })}
          style={{ width: "100%", padding: 12, fontSize: 16, marginTop: 8 }}
          disabled={saving}
        >
          {MODE_OPTIONS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
        <div style={{ marginTop: 8, fontSize: 13, opacity: 0.7 }}>
          Normal = supportive. Brutal/Savage = harsher reminders + stronger language.
        </div>
      </div>

      {/* WATER TARGET */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Water target (ml)</div>
        <input
          type="number"
          value={settings.water_target_ml ?? 3000}
          onChange={(e) => saveSettings({ water_target_ml: Number(e.target.value || 0) })}
          style={{ width: "100%", padding: 12, fontSize: 16, marginTop: 8 }}
        />
      </div>

      {/* SLEEP TARGET */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Sleep target (hours)</div>
        <input
          type="number"
          min="4"
          max="12"
          value={settings.sleep_target_hours ?? 8}
          onChange={(e) => saveSettings({ sleep_target_hours: Number(e.target.value || 8) })}
          style={{ width: "100%", padding: 12, fontSize: 16, marginTop: 8 }}
        />
      </div>

      {/* REMINDER TIMES */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Reminder times</div>
        <div style={{ fontSize: 13, opacity: 0.7, marginTop: 6 }}>
          These are used for push notifications (water / “set tomorrow time” / “I’m in”).
        </div>

        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          {reminderTimes.map((t, idx) => (
            <input
              key={idx}
              type="time"
              value={normalizeTime(t)}
              onChange={(e) => {
                const next = [...reminderTimes];
                next[idx] = e.target.value;
                saveSettings({ reminder_times: next });
              }}
              style={{ width: "100%", padding: 12, fontSize: 16 }}
            />
          ))}
        </div>

        <button
          style={{ width: "100%", padding: 12, marginTop: 10 }}
          onClick={() => saveSettings({ reminder_times: [...reminderTimes, "18:00"] })}
        >
          + Add reminder time
        </button>
      </div>

      {/* INCLUDED ACTIVITIES */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Allowed workout types</div>
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          {ACTIVITY_OPTIONS.map((a) => {
            const on = (settings.included_activities || []).includes(a.value);
            return (
              <button
                key={a.value}
                onClick={() => toggleActivity(a.value)}
                style={{
                  padding: 12,
                  textAlign: "left",
                  borderRadius: 10,
                  border: "1px solid #eee",
                  opacity: on ? 1 : 0.55,
                }}
              >
                <b>{on ? "✅" : "⬜"} {a.label}</b>
              </button>
            );
          })}
        </div>
      </div>

      {/* SUPPLEMENTS INCLUDED */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Supplements included</div>

        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          {supps.map((s) => (
            <button
              key={s.id}
              onClick={() => toggleSupplementActive(s)}
              style={{
                padding: 12,
                textAlign: "left",
                borderRadius: 10,
                border: "1px solid #eee",
                opacity: s.active ? 1 : 0.5,
              }}
            >
              <b>{s.active ? "✅" : "⬜"} {s.name}</b>
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                {s.rule_type || "ANYTIME"}
              </div>
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input
            value={newSuppName}
            onChange={(e) => setNewSuppName(e.target.value)}
            placeholder="Add supplement (name)"
            style={{ flex: 1, padding: 12, fontSize: 16 }}
          />
          <button onClick={addSupplement} style={{ padding: "12px 14px" }}>
            Add
          </button>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <button style={{ width: "100%", padding: 12 }} onClick={logout}>
          Logout
        </button>
      </div>
    </div>
  );
}
