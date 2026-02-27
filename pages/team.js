// pages/team.js
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

function randomToken(len = 24) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export default function Team() {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(null);

  const [myTeam, setMyTeam] = useState(null);
  const [members, setMembers] = useState([]); // { user_id, display_name, role, created_at? }

  const [inviteEmail, setInviteEmail] = useState("");
  const [pendingInvites, setPendingInvites] = useState([]);
  const [outgoingInvites, setOutgoingInvites] = useState([]);

  const [teamName, setTeamName] = useState("");
  const [joinToken, setJoinToken] = useState("");

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

        // Ensure settings row exists (do not overwrite anything important)
        await supabase.from("user_settings").upsert(
          {
            user_id: data.user.id,
            mode: "solo",
            timezone: "Europe/London",
          },
          { onConflict: "user_id" }
        );

        await refresh(data.user.id, data.user.email);
      } catch (e) {
        setErrMsg(e?.message || String(e));
      }
    })();
  }, []);

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

      // Members (prefer view)
      let mem = [];
      try {
        const { data: vmem, error: vErr } = await supabase
          .from("v_team_members_with_profiles")
          .select("user_id,display_name,role,created_at")
          .eq("team_id", tid)
          .order("created_at", { ascending: true });
        if (vErr) throw vErr;
        mem = (vmem || []).map((m) => ({
          user_id: m.user_id,
          display_name: m.display_name || "",
          role: m.role || "member",
          created_at: m.created_at || null,
        }));
      } catch {
        // Fallback: team_members + user_profiles
        const { data: tm, error: tmErr } = await supabase
          .from("team_members")
          .select("user_id,role")
          .eq("team_id", tid);
        if (tmErr) throw tmErr;

        const userIds = (tm || []).map((x) => x.user_id);
        let profiles = [];
        if (userIds.length) {
          const { data: ups, error: upErr } = await supabase
            .from("user_profiles")
            .select("user_id,display_name")
            .in("user_id", userIds);
          if (!upErr) profiles = ups || [];
        }

        mem = (tm || []).map((m) => ({
          user_id: m.user_id,
          role: m.role || "member",
          display_name: profiles.find((p) => p.user_id === m.user_id)?.display_name || "",
        }));
      }

      setMembers(mem);

      // Outgoing invites for this team (owner/admin can see)
      const { data: outInv, error: outErr } = await supabase
        .from("team_invites")
        .select("*")
        .eq("team_id", tid)
        .order("created_at", { ascending: false });
      if (!outErr) setOutgoingInvites(outInv || []);
    } else {
      setMyTeam(null);
      setMembers([]);
      setOutgoingInvites([]);
    }

    // Invites addressed to my email
    if (email) {
      const { data: inv, error: iErr } = await supabase
        .from("team_invites")
        .select("*")
        .eq("invitee_email", email.toLowerCase())
        .eq("status", "PENDING")
        .order("created_at", { ascending: false });
      if (!iErr) setPendingInvites(inv || []);
      else setPendingInvites([]);
    }
  }

  async function setMode(mode) {
    if (!user) return;
    const next = mode === "team" && !settings?.team_id ? "solo" : mode;
    const { error } = await supabase.from("user_settings").update({ mode: next }).eq("user_id", user.id);
    if (error) alert(error.message);
    await refresh(user.id, user.email);
  }

  async function createTeam() {
    if (!user) return;
    const name = teamName.trim();
    if (!name) return alert("Enter a team name");

    // Create team
    const { data: teamRow, error: tErr } = await supabase
      .from("teams")
      .insert({ name, owner_id: user.id })
      .select("*")
      .single();
    if (tErr) return alert(tErr.message);

    // Add owner membership
    const { error: mErr } = await supabase.from("team_members").insert({
      team_id: teamRow.id,
      user_id: user.id,
      role: "owner",
    });
    if (mErr) return alert(mErr.message);

    // Attach team to settings
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

    // Remove membership (if policy allows)
    await supabase.from("team_members").delete().eq("team_id", settings.team_id).eq("user_id", user.id);

    // Clear settings
    const { error } = await supabase
      .from("user_settings")
      .update({ team_id: null, mode: "solo" })
      .eq("user_id", user.id);
    if (error) alert(error.message);

    await refresh(user.id, user.email);
  }

  async function invite() {
    if (!user || !settings?.team_id) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return alert("Enter an email");

    const token = randomToken(28);

    const { error } = await supabase.from("team_invites").insert({
      team_id: settings.team_id,
      inviter_id: user.id,
      invitee_email: email,
      token,
      status: "PENDING",
    });
    if (error) return alert(error.message);

    setInviteEmail("");

    const link = `${process.env.NEXT_PUBLIC_SITE_URL || ""}/team?token=${token}`.replace(/\/team\?/, "/team?");
    alert(`Invite created ✅\n\nShare this token/link:\n${token}\n${link}`);

    await refresh(user.id, user.email);
  }

  async function acceptInvite(invite) {
    if (!user) return;

    // Add membership
    const { error: mErr } = await supabase.from("team_members").insert({
      team_id: invite.team_id,
      user_id: user.id,
      role: "member",
    });
    if (mErr) return alert(mErr.message);

    // Mark invite accepted
    await supabase
      .from("team_invites")
      .update({ status: "ACCEPTED", accepted_at: new Date().toISOString() })
      .eq("id", invite.id);

    // Attach team
    const { error: sErr } = await supabase
      .from("user_settings")
      .update({ team_id: invite.team_id, mode: "team" })
      .eq("user_id", user.id);
    if (sErr) return alert(sErr.message);

    await refresh(user.id, user.email);
  }

  async function joinByToken() {
    if (!user) return;
    const token = joinToken.trim();
    if (!token) return alert("Enter invite token");

    const { data: inv, error: invErr } = await supabase
      .from("team_invites")
      .select("*")
      .eq("token", token)
      .eq("status", "PENDING")
      .maybeSingle();

    if (invErr) return alert(invErr.message);
    if (!inv) return alert("Invite not found / already used");

    await acceptInvite(inv);
    setJoinToken("");
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  if (errMsg) {
    return (
      <div style={{ padding: 20, fontFamily: "system-ui", maxWidth: 520, margin: "0 auto" }}>
        <h2>Team</h2>
        <p><b>Error:</b> {errMsg}</p>
        <button onClick={logout}>Logout</button>
      </div>
    );
  }

  if (!settings) {
    return <div style={{ padding: 20, fontFamily: "system-ui" }}>Loading…</div>;
  }

  const isInTeam = !!settings.team_id;
  const isTeamMode = settings.mode === "team";

  return (
    <div style={{ padding: 18, fontFamily: "system-ui", maxWidth: 520, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <h2 style={{ margin: 0 }}>Team / Solo</h2>
        <a href="/dashboard" style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 10, textDecoration: "none" }}>
          Back
        </a>
      </div>

      {/* QUICK LINKS */}
      <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
        <a
          href="/leaderboard"
          style={{
            flex: 1,
            padding: 12,
            border: "1px solid #ddd",
            borderRadius: 12,
            textAlign: "center",
            textDecoration: "none",
          }}
        >
          Leaderboard
        </a>
        <a
          href="/profile"
          style={{
            flex: 1,
            padding: 12,
            border: "1px solid #ddd",
            borderRadius: 12,
            textAlign: "center",
            textDecoration: "none",
          }}
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
            style={{ flex: 1, padding: 12, fontWeight: 800, opacity: isTeamMode ? 1 : 0.5 }}
            onClick={() => setMode("team")}
            disabled={!isInTeam}
          >
            Team
          </button>
        </div>
        {!isInTeam && (
          <div style={{ marginTop: 10, fontSize: 13, opacity: 0.7 }}>
            You need to create or join a team to enable Team mode.
          </div>
        )}
      </div>

      {/* PENDING INVITES */}
      {pendingInvites.length > 0 && (
        <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
          <div style={{ fontSize: 14, opacity: 0.8 }}>Invites for {user?.email}</div>
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            {pendingInvites.map((inv) => (
              <div key={inv.id} style={{ padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
                <div style={{ fontWeight: 800 }}>You’ve been invited</div>
                <div style={{ fontSize: 13, opacity: 0.7, marginTop: 6 }}>Team ID: {inv.team_id}</div>
                <button style={{ width: "100%", padding: 12, marginTop: 10 }} onClick={() => acceptInvite(inv)}>
                  Accept invite
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* JOIN BY TOKEN */}
      {!isInTeam && (
        <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
          <div style={{ fontSize: 14, opacity: 0.8 }}>Join with invite token</div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <input
              value={joinToken}
              onChange={(e) => setJoinToken(e.target.value)}
              placeholder="Paste invite token"
              style={{ flex: 1, padding: 12, fontSize: 16 }}
            />
            <button onClick={joinByToken} style={{ padding: "12px 14px" }}>
              Join
            </button>
          </div>
          <div style={{ marginTop: 10, fontSize: 13, opacity: 0.7 }}>
            This is the fastest fallback if email-based invites are awkward.
          </div>
        </div>
      )}

      {/* CREATE / VIEW TEAM */}
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
        </div>
      ) : (
        <>
          <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
            <div style={{ fontSize: 14, opacity: 0.8 }}>Your team</div>
            <div style={{ fontSize: 20, fontWeight: 800, marginTop: 6 }}>{myTeam?.name || "Team"}</div>
            <div style={{ marginTop: 6, fontSize: 13, opacity: 0.7 }}>
              Team ID: {settings.team_id}
            </div>

            <button style={{ width: "100%", padding: 12, marginTop: 12 }} onClick={leaveTeam}>
              Leave team
            </button>
          </div>

          {/* INVITE */}
          <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
            <div style={{ fontSize: 14, opacity: 0.8 }}>Invite member</div>
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
              They can accept in-app (pending invites) or join via token.
            </div>
          </div>

          {/* OUTGOING INVITES */}
          {outgoingInvites.length > 0 && (
            <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
              <div style={{ fontSize: 14, opacity: 0.8 }}>Invites</div>
              <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                {outgoingInvites.map((inv) => (
                  <div key={inv.id} style={{ padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
                    <div style={{ fontWeight: 800 }}>{inv.invitee_email}</div>
                    <div style={{ fontSize: 13, opacity: 0.7, marginTop: 6 }}>
                      Status: {inv.status} · Token: <b>{inv.token}</b>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* MEMBERS */}
          <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
            <div style={{ fontSize: 14, opacity: 0.8 }}>Members</div>
            <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
              {members.map((m) => (
                <div key={m.user_id} style={{ padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
                  <div style={{ fontWeight: 900 }}>
                    {m.display_name ? m.display_name : m.user_id === user?.id ? "You" : "Member"}
                  </div>
                  <div style={{ opacity: 0.7, marginTop: 4 }}>
                    Role: {m.role || "member"}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.6, marginTop: 6 }}>
                    {m.user_id}
                  </div>
                </div>
              ))}
              {members.length === 0 && (
                <div style={{ opacity: 0.7 }}>
                  No members loaded (RLS/policies may be blocking select).
                </div>
              )}
            </div>
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
