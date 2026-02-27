// pages/settings.js
import { useEffect, useMemo, useState } from "react";
import TopNav from "../components/Nav";
import { supabase } from "../lib/supabaseClient";
import { enablePush, onesignalHints } from "../lib/onesignal";

const TONE_OPTIONS = [
  { value: "normal", label: "Normal" },
  { value: "brutal", label: "Brutal" },
  { value: "savage", label: "Savage" },
];

const ACTIVITY_OPTIONS = [
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

function normalizeTime(t) {
  if (!t) return "";
  const m = /^([0-9]{1,2}):([0-9]{2})$/.exec(String(t).trim());
  if (!m) return "";
  const hh = String(Math.max(0, Math.min(23, Number(m[1])))).padStart(2, "0");
  const mm = String(Math.max(0, Math.min(59, Number(m[2])))).padStart(2, "0");
  return `${hh}:${mm}`;
}

function ruleLabel(s) {
  if (!s?.rule_type) return "Anytime";
  if (s.rule_type === "PRE_WORKOUT") {
    const off = Number(s.offset_minutes || 0);
    const sign = off < 0 ? "" : "+";
    return `Pre-workout (${sign}${off}m)`;
  }
  if (s.rule_type === "MORNING_WINDOW") return `Morning (${s.window_start || "06:00"}–${s.window_end || "10:00"})`;
  if (s.rule_type === "EVENING_WINDOW") return `Evening (${s.window_start || "17:00"}–${s.window_end || "21:00"})`;
  if (s.rule_type === "BED_WINDOW") return `Before bed (${s.window_start || "21:00"}–${s.window_end || "23:59"})`;
  return "Anytime";
}

async function ensureUserSettingsRow(userId) {
  const { data: existing, error: selErr } = await supabase
    .from("user_settings")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (selErr) throw selErr;

  if (!existing) {
    const { error: insErr } = await supabase.from("user_settings").insert({
      user_id: userId,
      mode: "solo",
      tone_mode: "normal",
      water_target_ml: 3000,
      sleep_target_hours: 8,
      reminder_times: ["08:00", "12:00", "18:00"],
      included_activities: ["WALK", "RUN", "SPIN", "SWIM", "HILLWALK", "WEIGHTS", "HIIT", "YOGA", "PILATES", "MOBILITY", "OTHER"],
      timezone: "Europe/London",
    });
    if (insErr) throw insErr;
  }
}

export default function Settings() {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(null);
  const [profile, setProfile] = useState(null);
  const [supps, setSupps] = useState([]);
  const [err, setErr] = useState("");

  const reminderTimes = useMemo(() => {
    const t = settings?.reminder_times;
    if (!Array.isArray(t) || t.length === 0) return ["08:00", "12:00", "18:00"];
    const norm = t.map(normalizeTime).filter(Boolean);
    return (norm.length ? norm : ["08:00", "12:00", "18:00"]).slice(0, 5);
  }, [settings?.reminder_times]);

  const included = useMemo(() => new Set(settings?.included_activities || []), [settings?.included_activities]);

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

        // ✅ IMPORTANT FIX: do NOT overwrite settings on every page load
        await ensureUserSettingsRow(data.user.id);

        // Ensure profile row exists (for target weight fallback)
        await supabase
          .from("user_profiles")
          .upsert({ user_id: data.user.id, display_name: "" }, { onConflict: "user_id" });

        await refresh(data.user.id);
      } catch (e) {
        setErr(e?.message || String(e));
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
    setSettings(st || null);

    const { data: p, error: pErr } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (!pErr) setProfile(p || null);

    const { data: s, error: sErr } = await supabase
      .from("supplements")
      .select("*")
      .eq("user_id", userId)
      .order("name");
    if (!sErr) setSupps(s || []);
  }

  async function saveSettings(patch) {
    if (!user) return;

    // optimistic UI
    setSettings((prev) => ({ ...(prev || {}), ...patch }));

    const { error } = await supabase.from("user_settings").update(patch).eq("user_id", user.id);
    if (error) {
      alert(error.message);
      await refresh(user.id);
      return;
    }
    await refresh(user.id);
  }

  // ✅ Target weight: try user_settings.target_weight_kg first, fallback to user_profiles.target_weight_kg
  async function saveTargetWeightKg(val) {
    if (!user) return;
    const n = Number(val);
    const next = Number.isFinite(n) ? n : null;

    // try user_settings
    {
      const { error } = await supabase
        .from("user_settings")
        .update({ target_weight_kg: next })
        .eq("user_id", user.id);

      if (!error) {
        await refresh(user.id);
        return;
      }

      // if column doesn't exist, fallback to user_profiles
      const msg = String(error.message || "").toLowerCase();
      if (!msg.includes("target_weight_kg") && !msg.includes("column")) {
        alert(error.message);
        await refresh(user.id);
        return;
      }
    }

    // fallback to user_profiles
    {
      const { error } = await supabase
        .from("user_profiles")
        .update({ target_weight_kg: next })
        .eq("user_id", user.id);

      if (error) {
        alert(error.message);
        await refresh(user.id);
        return;
      }
      await refresh(user.id);
    }
  }

  async function toggleSupplementActive(s) {
    // Some schemas may not have `active` (but yours appears to, given your UI)
    const { error } = await supabase.from("supplements").update({ active: !s.active }).eq("id", s.id);
    if (error) {
      alert(error.message);
      return;
    }
    await refresh(user.id);
  }

  async function subscribePush() {
    if (!user) return;

    const res = await enablePush();

    if (res.ok && res.id) {
      const { error } = await supabase
        .from("push_devices")
        .upsert({ user_id: user.id, onesignal_player_id: res.id }, { onConflict: "user_id" });

      if (error) console.warn("push_devices upsert failed:", error.message);

      alert("Push enabled ✅");
      return;
    }

    const { isIOS, isStandalone } = onesignalHints();
    if (isIOS && !isStandalone) {
      alert("On iPhone/iPad: Add to Home Screen first, then enable push.");
      return;
    }

    // Only show "blocked" copy when the browser is actually denied.
    const perm = typeof Notification !== "undefined" ? Notification.permission : "default";
    if (perm === "denied" || (res.reason || "").toLowerCase().includes("blocked/denied")) {
      alert("Push permission is blocked. Allow notifications for this site in your browser settings, then try again.");
      return;
    }

    alert(res.reason || "Push not enabled (no player id returned)");
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  if (err) {
    return (
      <div>
        <TopNav active="settings" onLogout={logout} />
        <div style={{ padding: 18, maxWidth: 980, margin: "0 auto" }}>
          <h1 style={{ margin: "0 0 14px" }}>Settings</h1>
          <div>
            <b>Error:</b> {err}
          </div>
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div>
        <TopNav active="settings" onLogout={logout} />
        <div style={{ padding: 18, maxWidth: 980, margin: "0 auto" }}>Loading…</div>
      </div>
    );
  }

  const targetWeightFromSettings = settings?.target_weight_kg;
  const targetWeightFromProfile = profile?.target_weight_kg;
  const targetWeightValue = targetWeightFromSettings ?? targetWeightFromProfile ?? "";

  return (
    <div>
      <TopNav active="settings" onLogout={logout} />

      <div style={{ padding: 18, maxWidth: 980, margin: "0 auto" }}>
        <h1 style={{ margin: "0 0 14px" }}>Settings</h1>

        {/* Tone */}
        <div style={{ padding: 14, border: "1px solid rgba(0,0,0,.08)", borderRadius: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 14, opacity: 0.8 }}>Tone</div>
          <select
            value={settings.tone_mode || "normal"}
            onChange={(e) => saveSettings({ tone_mode: e.target.value })}
            style={{ width: "100%", padding: 12, fontSize: 16, marginTop: 10 }}
          >
            {TONE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {/* Reminder Times */}
        <div style={{ padding: 14, border: "1px solid rgba(0,0,0,.08)", borderRadius: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 14, opacity: 0.8 }}>Reminder times</div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
            {reminderTimes.map((t, i) => (
              <input
                key={i}
                type="time"
                value={t}
                onChange={(e) => {
                  const next = [...reminderTimes];
                  next[i] = normalizeTime(e.target.value);
                  saveSettings({ reminder_times: next });
                }}
                style={{ padding: 10, fontSize: 16 }}
              />
            ))}
          </div>

          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>These are used for reminders and nudges.</div>
        </div>

        {/* Targets */}
        <div style={{ padding: 14, border: "1px solid rgba(0,0,0,.08)", borderRadius: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 14, opacity: 0.8 }}>Targets</div>

          <div style={{ display: "grid", gap: 12, marginTop: 10 }}>
            <div>
              <div style={{ fontSize: 13, opacity: 0.75 }}>Water target (ml)</div>
              <input
                type="number"
                value={settings.water_target_ml ?? 3000}
                onChange={(e) => saveSettings({ water_target_ml: Number(e.target.value || 0) })}
                style={{ width: "100%", padding: 12, fontSize: 16, marginTop: 6 }}
              />
            </div>

            <div>
              <div style={{ fontSize: 13, opacity: 0.75 }}>Sleep target (hours)</div>
              <input
                type="number"
                step="0.5"
                value={settings.sleep_target_hours ?? 8}
                onChange={(e) => saveSettings({ sleep_target_hours: Number(e.target.value || 0) })}
                style={{ width: "100%", padding: 12, fontSize: 16, marginTop: 6 }}
              />
            </div>

            <div>
              <div style={{ fontSize: 13, opacity: 0.75 }}>Target weight (kg)</div>
              <input
                type="number"
                step="0.1"
                value={targetWeightValue}
                onChange={(e) => saveTargetWeightKg(e.target.value)}
                style={{ width: "100%", padding: 12, fontSize: 16, marginTop: 6 }}
                placeholder="e.g. 95.0"
              />
              <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
                Used for trend + motivation messaging. (If your DB doesn’t have this column yet, it will need adding.)
              </div>
            </div>
          </div>
        </div>

        {/* Workout Types */}
        <div style={{ padding: 14, border: "1px solid rgba(0,0,0,.08)", borderRadius: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 14, opacity: 0.8 }}>Workout types shown</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
            {ACTIVITY_OPTIONS.map((a) => {
              const on = included.has(a.value);
              return (
                <button
                  key={a.value}
                  onClick={() => {
                    const next = new Set(included);
                    on ? next.delete(a.value) : next.add(a.value);
                    saveSettings({ included_activities: Array.from(next) });
                  }}
                  style={{
                    padding: "10px 12px",
                    border: "1px solid rgba(0,0,0,.08)",
                    borderRadius: 12,
                    opacity: on ? 1 : 0.45,
                    fontWeight: 800,
                  }}
                >
                  {on ? "✅" : "⬜"} {a.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Supplements */}
        <div style={{ padding: 14, border: "1px solid rgba(0,0,0,.08)", borderRadius: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 14, opacity: 0.8 }}>Supplements on dashboard</div>
          <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
            {supps.map((s) => (
              <button
                key={s.id}
                onClick={() => toggleSupplementActive(s)}
                style={{
                  padding: 12,
                  textAlign: "left",
                  border: "1px solid rgba(0,0,0,.08)",
                  borderRadius: 12,
                  opacity: s.active ? 1 : 0.4,
                }}
              >
                <div style={{ fontWeight: 900 }}>
                  {s.active ? "✅" : "⬜"} {s.name}
                </div>
                <div style={{ marginTop: 4, fontSize: 12, opacity: 0.75 }}>{ruleLabel(s)}</div>
              </button>
            ))}
            {supps.length === 0 && <div style={{ opacity: 0.7 }}>No supplements found.</div>}
          </div>

          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
            Dashboard should only show active supplements. (Next: update dashboard query to `.eq("active", true)`.)
          </div>
        </div>

        {/* Push */}
        <div style={{ padding: 14, border: "1px solid rgba(0,0,0,.08)", borderRadius: 12 }}>
          <div style={{ fontSize: 14, opacity: 0.8 }}>Push notifications</div>
          <button style={{ width: "100%", padding: 12, marginTop: 10, fontWeight: 900 }} onClick={subscribePush}>
            Enable push
          </button>
          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
            If you see “no player id returned”, it’s usually because the browser blocked permission or iOS isn’t installed as a PWA.
          </div>
        </div>
      </div>
    </div>
  );
}
