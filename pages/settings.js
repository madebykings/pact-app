// pages/settings.js
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { enablePush, getPushState } from "../lib/onesignal";

const TIME_PRESETS = ["08:00", "12:00", "18:00"];

function labelActivity(a) {
  const map = {
    WALK: "Walk",
    RUN: "Run",
    SPIN: "Spin",
    HIIT: "HIIT",
    SWIM: "Swim",
    WEIGHTS: "Weights",
    REST: "Rest",
    YOGA: "Yoga",
    PILATES: "Pilates",
    OTHER: "Other",
  };
  return map[a] || a;
}

function labelRule(r) {
  const map = {
    MORNING_WINDOW: "Morning",
    PRE_WORKOUT: "Pre-workout",
    EVENING_WINDOW: "Evening",
    BED_WINDOW: "Bedtime",
    ANYTIME: "Any time",
  };
  return map[r] || r;
}

export default function Settings() {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(null);
  const [supps, setSupps] = useState([]);
  const [pushState, setPushState] = useState({ supported: false, permission: "default", subscribed: false });
  const [errMsg, setErrMsg] = useState("");

  const allActivities = useMemo(
    () => ["WALK", "RUN", "SPIN", "HIIT", "SWIM", "WEIGHTS", "REST", "YOGA", "PILATES", "OTHER"],
    []
  );

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

        await ensureUserSettings(data.user.id);
        await refresh(data.user.id);
        await refreshPush();
      } catch (e) {
        setErrMsg(e?.message || String(e));
      }
    })();
  }, []);

  async function ensureUserSettings(userId) {
    const { data: st, error: stErr } = await supabase
      .from("user_settings")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (stErr) throw stErr;

    if (!st) {
      const { error } = await supabase.from("user_settings").insert({
        user_id: userId,
        mode: "solo",
        tone_mode: "normal",
        timezone: "Europe/London",
        water_target_ml: 3000,
        sleep_target_hours: 8,
        reminder_times: TIME_PRESETS,
        included_activities: ["WALK", "RUN", "SPIN", "HIIT", "SWIM", "WEIGHTS"],
      });
      if (error) throw error;
    }
  }

  async function refresh(userId) {
    const { data: st, error: stErr } = await supabase
      .from("user_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (stErr) throw stErr;
    setSettings(st || null);

    const { data: s, error: sErr } = await supabase
      .from("supplements")
      .select("*")
      .order("sort_order", { ascending: true });
    if (!sErr) setSupps(s || []);
  }

  async function refreshPush() {
    try {
      const st = await getPushState();
      setPushState(st);
    } catch {
      setPushState({ supported: false, permission: "default", subscribed: false });
    }
  }

  async function updateSettings(patch) {
    if (!user) return;
    const { error } = await supabase.from("user_settings").update(patch).eq("user_id", user.id);
    if (error) return alert(error.message);
    await refresh(user.id);
  }

  async function toggleReminderTime(t) {
    const current = settings?.reminder_times || [];
    const next = current.includes(t) ? current.filter((x) => x !== t) : [...current, t].sort();
    await updateSettings({ reminder_times: next });
  }

  async function toggleActivity(a) {
    const current = settings?.included_activities || [];
    const next = current.includes(a) ? current.filter((x) => x !== a) : [...current, a].sort();
    await updateSettings({ included_activities: next });
  }

  async function setToneMode(v) {
    await updateSettings({ tone_mode: v });
  }

  async function enablePushNow() {
    const res = await enablePush();
    if (!res.ok) {
      alert(res.reason || "Push not enabled");
      await refreshPush();
      return;
    }
    await refreshPush();
    alert("Push enabled ✅");
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  if (errMsg) {
    return (
      <div style={{ padding: 20, fontFamily: "system-ui", maxWidth: 520, margin: "0 auto" }}>
        <h2>Settings</h2>
        <p>
          <b>Error:</b> {errMsg}
        </p>
        <button onClick={logout}>Logout</button>
      </div>
    );
  }

  if (!settings) {
    return <div style={{ padding: 20, fontFamily: "system-ui" }}>Loading…</div>;
  }

  const reminders = settings.reminder_times || [];
  const incActs = settings.included_activities || [];

  return (
    <div style={{ padding: 18, fontFamily: "system-ui", maxWidth: 520, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <h2 style={{ margin: 0 }}>Settings</h2>
        <a
          href="/dashboard"
          style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 10, textDecoration: "none" }}
        >
          Back
        </a>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
        <a
          href="/team"
          style={{ flex: 1, padding: 12, border: "1px solid #ddd", borderRadius: 12, textAlign: "center", textDecoration: "none" }}
        >
          Pact
        </a>
        <a
          href="/profile"
          style={{ flex: 1, padding: 12, border: "1px solid #ddd", borderRadius: 12, textAlign: "center", textDecoration: "none" }}
        >
          Profile
        </a>
      </div>

      {/* PUSH */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Push notifications</div>
        <div style={{ marginTop: 8, fontWeight: 800 }}>
          {pushState.subscribed ? "Enabled" : pushState.supported ? "Not enabled" : "Not supported"}
        </div>
        <div style={{ marginTop: 6, fontSize: 13, opacity: 0.7 }}>Permission: {pushState.permission}</div>
        <button style={{ width: "100%", padding: 12, marginTop: 10 }} onClick={enablePushNow}>
          Enable push
        </button>
        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.65 }}>
          Android: use Chrome, and ensure notification permission is allowed for this site.
        </div>
      </div>

      {/* MODE / TONE */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Tone mode</div>
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          {[
            ["normal", "Normal"],
            ["brutal", "Brutal"],
            ["kind", "Kind"],
          ].map(([v, label]) => (
            <button
              key={v}
              style={{ flex: 1, padding: 12, fontWeight: 800, opacity: settings.tone_mode === v ? 1 : 0.5 }}
              onClick={() => setToneMode(v)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* TARGETS */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Daily targets</div>

        <div style={{ marginTop: 10, fontSize: 13, opacity: 0.7 }}>Sleep target (hours)</div>
        <input
          type="number"
          min={4}
          max={12}
          value={settings.sleep_target_hours ?? 8}
          onChange={(e) => updateSettings({ sleep_target_hours: Number(e.target.value || 8) })}
          style={{ width: "100%", padding: 12, fontSize: 16, marginTop: 6 }}
        />

        <div style={{ marginTop: 12, fontSize: 13, opacity: 0.7 }}>Water target (ml)</div>
        <input
          type="number"
          min={500}
          step={250}
          value={settings.water_target_ml ?? 3000}
          onChange={(e) => updateSettings({ water_target_ml: Number(e.target.value || 3000) })}
          style={{ width: "100%", padding: 12, fontSize: 16, marginTop: 6 }}
        />
      </div>

      {/* REMINDERS */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Reminder times</div>
        <div style={{ marginTop: 10, fontSize: 13, opacity: 0.7 }}>
          Only used for push notifications (when enabled).
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 10 }}>
          {TIME_PRESETS.map((t) => (
            <button
              key={t}
              style={{ padding: 12, fontWeight: 800, opacity: reminders.includes(t) ? 1 : 0.4 }}
              onClick={() => toggleReminderTime(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* ACTIVITIES */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Activities included</div>
        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          {allActivities.map((a) => (
            <label
              key={a}
              style={{ display: "flex", gap: 10, alignItems: "center", padding: 12, border: "1px solid #eee", borderRadius: 12 }}
            >
              <input type="checkbox" checked={incActs.includes(a)} onChange={() => toggleActivity(a)} />
              <div style={{ fontWeight: 800 }}>{labelActivity(a)}</div>
            </label>
          ))}
        </div>
      </div>

      {/* SUPPLEMENTS (fixed list, no user-added) */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Supplements included</div>
        <div style={{ marginTop: 8, fontSize: 13, opacity: 0.7 }}>This list is managed by the admin (not user-editable).</div>
        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          {supps.map((s) => (
            <label
              key={s.id}
              style={{ display: "flex", gap: 10, alignItems: "center", padding: 12, border: "1px solid #eee", borderRadius: 12 }}
            >
              <input
                type="checkbox"
                checked={!!s.active}
                onChange={async () => {
                  const { error } = await supabase.from("supplements").update({ active: !s.active }).eq("id", s.id);
                  if (error) alert(error.message);
                  await refresh(user.id);
                }}
              />
              <div>
                <div style={{ fontWeight: 800 }}>{s.name}</div>
                <div style={{ fontSize: 12, opacity: 0.65 }}>{labelRule(s.rule)}</div>
              </div>
            </label>
          ))}
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
