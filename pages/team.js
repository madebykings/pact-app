// pages/team.js
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

function randomToken(len = 28) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function plusDaysISO(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

export default function Team() {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(null);

  const [myTeam, setMyTeam] = useState(null);
  const [members, setMembers] = useState([]);

  const [inviteEmail, setInviteEmail] = useState("");
  const [pendingInvites, setPendingInvites] = useState([]);

  const [teamName, setTeamName] = useState("");
  const [errMsg, setErrMsg] = useState("");

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

        // IMPORTANT: don't upsert defaults here (it overwrites mode/team_id)
        await ensureUserSettings(data.user.id);

        await refresh(data.user.id, data.user.email);
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
        reminder_times: ["08:00", "12:00", "18:00"],
        included_activities: ["WALK", "RUN", "SPIN", "HIIT", "SWIM", "WEIGHTS"],
      });
      if (error) throw error;
    }
  }

  async function refresh(userId, email) {
    const { data: st, error: stErr } = await supabase
      .from("user_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (stErr) throw stErr;
    setSettings(st || null);

    const tid = st?.team_id || null;

    if (tid) {
      const { data: teamRow, error: tErr } = await supabase
        .from("teams")
        .select("*")
        .eq("id", tid)
        .maybeSingle();
      if (tErr) throw tErr;
      setMyTeam(teamRow || null);

      const { data: mem, error: mErr } = await supabase
        .from("team_members")
        .select("*")
        .eq("team_id", tid)
        .order("created_at", { ascending: true });
      if (mErr) throw mErr;
      setMembers(mem || []);
    } else {
      setMyTeam(null);
      setMembers([]);
    }

    // pending invites addressed to my email
    if (email) {
      const { data: inv, error: iErr } = await supabase
        .from("team_invites")
        .select("*")
        .eq("email", email.toLowerCase())
        .eq("status", "PENDING")
        .order("created_at", { ascending: false });
      if (!iErr) setPendingInvites(inv || []);
    }
  }

  async function setMode(mode) {
    if (!user) return;
    const { error } = await supabase.from("user_settings").update({ mode }).eq("user_id", user.id);
    if (error) alert(error.message);
    await refresh(user.id, user.email);
  }

  async function createTeam() {
    if (!user) return;
    const name = teamName.trim();
    if (!name) return alert("Enter a team name");

    const { data: teamRow, error: tErr } = await supabase
      .from("teams")
      .insert({ name, owner_id: user.id })
      .select("*")
      .single();
    if (tErr) return alert(tErr.message);

    const { error: mErr } = await supabase.from("team_members").insert({
      team_id: teamRow.id,
      user_id: user.id,
      role: "owner",
    });
    if (mErr) return alert(mErr.message);

    const { error: sErr } = await supabase
      .from("user_settings")
      .update({ team_id: teamRow.id, mode: "team" })
      .eq("user_id", user.id);
    if (sErr) return alert(sErr.message);

    setTeamName("");
    await refresh(user.id, user.email);
  }

  async function leaveTeam() {
    if (!user || !settings?.team_id) return;

    await supabase.from("team_members").delete().eq("team_id", settings.team_id).eq("user_id", user.id);

    const { error } = await supabase.from("user_settings").update({ team_id: null, mode: "solo" }).eq("user_id", user.id);
    if (error) alert(error.message);

    await refresh(user.id, user.email);
  }

  async function invite() {
    if (!user || !settings?.team_id) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return;

    const token = randomToken(28);

    const { error } = await supabase.from("team_invites").insert({
      team_id: settings.team_id,
      inviter_id: user.id,
      created_by: user.id,
      email,
      token,
      status: "PENDING",
      expires_at: plusDaysISO(7),
    });
    if (error) return alert(error.message);

    setInviteEmail("");
    alert("Invite created ✅ (they must accept inside the app for now)");
    await refresh(user.id, user.email);
  }

  async function acceptInvite(invite) {
    if (!user) return;

    const { error: mErr } = await supabase.from("team_members").insert({
      team_id: invite.team_id,
      user_id: user.id,
      role: "member",
    });
    if (mErr) return alert(mErr.message);

    await supabase
      .from("team_invites")
      .update({ status: "ACCEPTED", accepted_at: new Date().toISOString() })
      .eq("id", invite.id);

    const { error: sErr } = await supabase
      .from("user_settings")
      .update({ team_id: invite.team_id, mode: "team" })
      .eq("user_id", user.id);
    if (sErr) return alert(sErr.message);

    await refresh(user.id, user.email);
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  if (errMsg) {
    return (
      <div style={{ padding: 20, fontFamily: "system-ui", maxWidth: 520, margin: "0 auto" }}>
        <h2>Team</h2>
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

  const isInTeam = !!settings.team_id;

  return (
    <div style={{ padding: 18, fontFamily: "system-ui", maxWidth: 520, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <h2 style={{ margin: 0 }}>Team / Solo</h2>
        <a
          href="/dashboard"
          style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 10, textDecoration: "none" }}
        >
          Back
        </a>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
        <a
          href="/leaderboard"
          style={{ flex: 1, padding: 12, border: "1px solid #ddd", borderRadius: 12, textAlign: "center", textDecoration: "none" }}
        >
          Leaderboard
        </a>
        <a
          href="/profile"
          style={{ flex: 1, padding: 12, border: "1px solid #ddd", borderRadius: 12, textAlign: "center", textDecoration: "none" }}
        >
          Profile
        </a>
      </div>

      {/* MODE */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Mode</div>
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <button
            style={{ flex: 1, padding: 12, fontWeight: 800, opacity: settings.mode === "solo" ? 1 : 0.5 }}
            onClick={() => setMode("solo")}
          >
            Solo
          </button>
          <button
            style={{ flex: 1, padding: 12, fontWeight: 800, opacity: settings.mode === "team" ? 1 : 0.5 }}
            onClick={() => setMode("team")}
            disabled={!isInTeam}
          >
            Team
          </button>
        </div>
        {!isInTeam && (
          <div style={{ marginTop: 10, fontSize: 13, opacity: 0.7 }}>You need to create or join a team to enable Team mode.</div>
        )}
      </div>

      {/* PENDING INVITES */}
      {pendingInvites.length > 0 && (
        <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
          <div style={{ fontSize: 14, opacity: 0.8 }}>Invites for {user?.email}</div>
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            {pendingInvites.map((inv) => (
              <div key={inv.id} style={{ padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
                <div style={{ fontWeight: 800 }}>Team ID: {inv.team_id}</div>
                <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>Expires: {String(inv.expires_at).slice(0, 16).replace("T", " ")}</div>
                <button style={{ width: "100%", padding: 12, marginTop: 10 }} onClick={() => acceptInvite(inv)}>
                  Accept invite
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {!isInTeam ? (
        <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
          <div style={{ fontSize: 14, opacity: 0.8 }}>Create a team</div>
          <input
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="Team name"
            style={{ width: "100%", padding: 12, fontSize: 16, marginTop: 10 }}
          />
          <button style={{ width: "100%", padding: 12, marginTop: 10 }} onClick={createTeam}>
            Create team
          </button>
          <div style={{ marginTop: 10, fontSize: 13, opacity: 0.7 }}>After creation you can invite people by email.</div>
        </div>
      ) : (
        <>
          <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
            <div style={{ fontSize: 14, opacity: 0.8 }}>Your team</div>
            <div style={{ fontSize: 20, fontWeight: 800, marginTop: 6 }}>{myTeam?.name || "Team"}</div>
            <div style={{ marginTop: 6, fontSize: 13, opacity: 0.7 }}>Team ID: {settings.team_id}</div>

            <button style={{ width: "100%", padding: 12, marginTop: 12 }} onClick={leaveTeam}>
              Leave team
            </button>
          </div>

          {/* INVITE */}
          <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
            <div style={{ fontSize: 14, opacity: 0.8 }}>Invite member (email)</div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <input
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="name@example.com"
                style={{ flex: 1, padding: 12, fontSize: 16 }}
              />
              <button onClick={invite} style={{ padding: "12px 14px" }}>
                Invite
              </button>
            </div>
            <div style={{ marginTop: 10, fontSize: 13, opacity: 0.7 }}>
              Invites generate a link the person can open after logging in.
            </div>
          </div>

          {/* MEMBERS */}
          <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
            <div style={{ fontSize: 14, opacity: 0.8 }}>Members</div>
            <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
              {members.map((m) => (
                <div key={m.id} style={{ padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
                  <div style={{ fontWeight: 800 }}>{m.user_id}</div>
                  <div style={{ opacity: 0.7 }}>Role: {m.role || "member"}</div>
                </div>
              ))}
              {members.length === 0 && <div style={{ opacity: 0.7 }}>No members loaded (RLS/policies may be blocking select).</div>}
            </div>
          </div>

          <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
            <div style={{ fontSize: 14, opacity: 0.8 }}>Pending invites</div>
            {pendingInvites.length === 0 ? (
              <div style={{ marginTop: 8, opacity: 0.7 }}>No pending invites.</div>
            ) : (
              <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                {pendingInvites.map((inv) => (
                  <div key={inv.id} style={{ padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
                    <div style={{ fontWeight: 800 }}>{inv.email}</div>
                    <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
                      Link: {typeof window !== "undefined" ? `${window.location.origin}/team?token=${inv.token}` : `.../team?token=${inv.token}`}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <div style={{ marginTop: 14 }}>
        <button style={{ width: "100%", padding: 12 }} onClick={logout}>
          Logout
        </button>
      </div>
    </div>
  );
}
