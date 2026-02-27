// pages/team.js
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

function TopNav({ active, onLogout }) {
  const linkStyle = (isActive) => ({
    padding: "6px 10px",
    border: "1px solid #ddd",
    borderRadius: 10,
    textDecoration: "none",
    opacity: isActive ? 1 : 0.8,
    fontWeight: isActive ? 800 : 600,
  });

  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
      <h2 style={{ margin: 0 }}>Pact</h2>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <a href="/dashboard" style={linkStyle(active === "dashboard")}>Dashboard</a>
        <a href="/team" style={linkStyle(active === "pact")}>Pact</a>
        <a href="/profile" style={linkStyle(active === "profile")}>Profile</a>
        <a href="/settings" style={linkStyle(active === "settings")}>Settings</a>
        <button onClick={onLogout}>Logout</button>
      </div>
    </div>
  );
}

function randomToken(len = 28) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export default function Team() {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(null);

  const [myTeam, setMyTeam] = useState(null);
  const [role, setRole] = useState(null);
  const [members, setMembers] = useState([]);

  const [teamName, setTeamName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [joinToken, setJoinToken] = useState("");

  const [pendingInvites, setPendingInvites] = useState([]);
  const [outgoingInvites, setOutgoingInvites] = useState([]);

  const [errMsg, setErrMsg] = useState("");

  const siteUrl = useMemo(() => (process.env.NEXT_PUBLIC_SITE_URL || window.location.origin).replace(/\/$/, ""), []);

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

        // Ensure settings row exists
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh(userId, email) {
    // settings
    const { data: st, error: stErr } = await supabase
      .from("user_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (stErr) throw stErr;
    setSettings(st || null);

    const tid = st?.team_id || null;

    // If we have a team but mode didn't flip, do it automatically (keeps the highlight correct)
    if (tid && st?.mode !== "team") {
      await supabase.from("user_settings").update({ mode: "team" }).eq("user_id", userId);
    }

    if (tid) {
      const { data: teamRow, error: tErr } = await supabase.from("teams").select("*").eq("id", tid).maybeSingle();
      if (tErr) throw tErr;
      setMyTeam(teamRow || null);

      const { data: mem, error: mErr } = await supabase
        .from("team_members")
        .select("id,user_id,role,created_at")
        .eq("team_id", tid)
        .order("created_at", { ascending: true });
      if (mErr) throw mErr;
      setMembers(mem || []);

      const mine = (mem || []).find((m) => m.user_id === userId);
      setRole(mine?.role || null);

      // outgoing invites (created by me)
      const { data: outInv, error: outErr } = await supabase
        .from("team_invites")
        .select("*")
        .eq("team_id", tid)
        .eq("created_by", userId)
        .in("status", ["pending", "PENDING"])
        .order("created_at", { ascending: false });
      if (!outErr) setOutgoingInvites(outInv || []);
    } else {
      setMyTeam(null);
      setMembers([]);
      setRole(null);
      setOutgoingInvites([]);
    }

    // pending invites for my email (works even before joining a team)
    if (email) {
      const { data: inv, error: iErr } = await supabase
        .from("team_invites")
        .select("*")
        .eq("email", email.toLowerCase())
        .in("status", ["pending", "PENDING"])
        .order("created_at", { ascending: false });
      if (!iErr) setPendingInvites(inv || []);
    }
  }

  async function setMode(mode) {
    if (!user) return;
    const isInTeam = !!settings?.team_id;
    if (mode === "team" && !isInTeam) return;

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

    const { error: sErr } = await supabase.from("user_settings").update({ team_id: teamRow.id, mode: "team" }).eq("user_id", user.id);
    if (sErr) return alert(sErr.message);

    setTeamName("");
    await refresh(user.id, user.email);
  }

  async function leaveTeam() {
    if (!user || !settings?.team_id) return;

    // Remove membership
    await supabase.from("team_members").delete().eq("team_id", settings.team_id).eq("user_id", user.id);

    // Clear settings
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
      email,
      token,
      status: "pending",
      created_by: user.id,
      inviter_id: user.id,
      // expires_at optional (DB default recommended)
    });

    if (error) return alert(error.message);

    setInviteEmail("");
    // Let user copy the link easily on mobile
    prompt("Invite link (copy this):", `${siteUrl}/?invite=${token}`);
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

    await supabase.from("team_invites").update({ status: "accepted", accepted_at: new Date().toISOString() }).eq("id", invite.id);

    const { error: sErr } = await supabase.from("user_settings").update({ team_id: invite.team_id, mode: "team" }).eq("user_id", user.id);
    if (sErr) return alert(sErr.message);

    await refresh(user.id, user.email);
  }

  async function joinByToken() {
    if (!user) return;
    const t = joinToken.trim();
    if (!t) return;

    // Find invite by token (and ideally by email too)
    const { data: inv, error } = await supabase
      .from("team_invites")
      .select("*")
      .eq("token", t)
      .in("status", ["pending", "PENDING"])
      .maybeSingle();
    if (error) return alert(error.message);
    if (!inv) return alert("Invite not found (or already used).");

    // Optional: enforce email match (recommended)
    if (inv.email && user.email && inv.email.toLowerCase() !== user.email.toLowerCase()) {
      return alert(`This invite is for ${inv.email}. You are logged in as ${user.email}.`);
    }

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
        <h2>Pact</h2>
        <p><b>Error:</b> {errMsg}</p>
        <button onClick={logout}>Logout</button>
      </div>
    );
  }

  if (!settings) return <div style={{ padding: 20, fontFamily: "system-ui" }}>Loading…</div>;

  const isInTeam = !!settings.team_id;

  return (
    <div style={{ padding: 18, fontFamily: "system-ui", maxWidth: 520, margin: "0 auto" }}>
      <TopNav active="pact" onLogout={logout} />

      <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
        <a href="/leaderboard" style={{ flex: 1, padding: 12, border: "1px solid #ddd", borderRadius: 12, textAlign: "center", textDecoration: "none", fontWeight: 900 }}>
          Leaderboard
        </a>
      </div>

      {/* MODE */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Mode</div>
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <button
            style={{ flex: 1, padding: 12, fontWeight: 900, opacity: settings.mode === "solo" ? 1 : 0.45 }}
            onClick={() => setMode("solo")}
          >
            Solo
          </button>
          <button
            style={{ flex: 1, padding: 12, fontWeight: 900, opacity: settings.mode === "team" ? 1 : 0.45 }}
            onClick={() => setMode("team")}
            disabled={!isInTeam}
          >
            Team
          </button>
        </div>
        {!isInTeam && (
          <div style={{ marginTop: 10, fontSize: 13, opacity: 0.7 }}>
            Create or join a team to enable Team mode.
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
                <div style={{ fontWeight: 900 }}>Team ID: {inv.team_id}</div>
                <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>Token: {inv.token}</div>
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
              placeholder="Paste token"
              style={{ flex: 1, padding: 12, fontSize: 16 }}
            />
            <button onClick={joinByToken} style={{ padding: "12px 14px" }}>
              Join
            </button>
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
            <div style={{ fontSize: 20, fontWeight: 900, marginTop: 6 }}>{myTeam?.name || "Team"}</div>
            <div style={{ marginTop: 6, fontSize: 13, opacity: 0.7 }}>Role: {role || "member"}</div>
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
              No emails are sent yet — copy the link and send it manually.
            </div>
          </div>

          {/* OUTGOING INVITES */}
          {outgoingInvites.length > 0 && (
            <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
              <div style={{ fontSize: 14, opacity: 0.8 }}>Your pending invites</div>
              <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                {outgoingInvites.map((inv) => (
                  <div key={inv.id} style={{ padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
                    <div style={{ fontWeight: 900 }}>{inv.email}</div>
                    <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>Token: {inv.token}</div>
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
                <div key={m.id} style={{ padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
                  <div style={{ fontWeight: 900 }}>{m.user_id}</div>
                  <div style={{ opacity: 0.7 }}>Role: {m.role || "member"}</div>
                </div>
              ))}
              {members.length === 0 && <div style={{ opacity: 0.7 }}>No members loaded (RLS/policies may be blocking select).</div>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
