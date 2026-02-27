// pages/team.js
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

function randomToken(len = 24) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

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
        <a href="/profile" style={linkStyle(active === "profile")}>Profile</a>
        <a href="/settings" style={linkStyle(active === "settings")}>Settings</a>
        <button onClick={onLogout}>Logout</button>
      </div>
    </div>
  );
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

  const isInTeam = useMemo(() => !!settings?.team_id, [settings]);

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

        await supabase.from("user_settings").upsert(
          { user_id: data.user.id, mode: "solo", timezone: "Europe/London" },
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

    // If you have a team, default mode to team (so UI highlights properly)
    if (st?.team_id && st.mode !== "team") {
      await supabase.from("user_settings").update({ mode: "team" }).eq("user_id", userId);
      st.mode = "team";
    }

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

      // Some schemas do not have team_members.created_at, so order by role then user_id
      const { data: mem, error: mErr } = await supabase
        .from("team_members")
        .select("*")
        .eq("team_id", tid)
        .order("role", { ascending: false })
        .order("user_id", { ascending: true });
      if (mErr) throw mErr;
      setMembers(mem || []);
    } else {
      setMyTeam(null);
      setMembers([]);
    }

    // Invites addressed to my email (column is "email" in your schema)
    if (email) {
      const { data: inv, error: iErr } = await supabase
        .from("team_invites")
        .select("*")
        .eq("email", email.toLowerCase())
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (!iErr) setPendingInvites(inv || []);
    }
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
    if (!email) return;

    const token = randomToken(28);

    const { error } = await supabase.from("team_invites").insert({
      team_id: settings.team_id,
      inviter_id: user.id,
      email,
      token,
      status: "pending",
      created_by: user.id,
    });
    if (error) return alert(error.message);

    const inviteUrl = `${window.location.origin}/team?invite=${encodeURIComponent(token)}`;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      alert("Invite created ✅ Link copied to clipboard");
    } catch {
      alert(`Invite created ✅\n\nCopy this link:\n${inviteUrl}`);
    }

    setInviteEmail("");
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
        <h2>Pact</h2>
        <p><b>Error:</b> {errMsg}</p>
        <button onClick={logout}>Logout</button>
      </div>
    );
  }

  if (!settings) {
    return <div style={{ padding: 20, fontFamily: "system-ui" }}>Loading…</div>;
  }

  return (
    <div style={{ padding: 18, fontFamily: "system-ui", maxWidth: 520, margin: "0 auto" }}>
      <TopNav active="pact" onLogout={logout} />

      {/* HEADER ACTIONS */}
      <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div>
          <div style={{ fontSize: 14, opacity: 0.75 }}>Mode</div>
          <div style={{ fontSize: 20, fontWeight: 900 }}>
            {isInTeam ? "Team" : "Solo"}
          </div>
        </div>
        <a href="/leaderboard" style={{ padding: "10px 12px", border: "1px solid #ddd", borderRadius: 12, textDecoration: "none", fontWeight: 800 }}>
          Leaderboard
        </a>
      </div>

      {/* PENDING INVITES */}
      {pendingInvites.length > 0 && (
        <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
          <div style={{ fontSize: 14, opacity: 0.8 }}>Invites for {user?.email}</div>
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            {pendingInvites.map((inv) => (
              <div key={inv.id} style={{ padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
                <div style={{ fontWeight: 800 }}>Team ID: {inv.team_id}</div>
                <button style={{ width: "100%", padding: 12, marginTop: 10 }} onClick={() => acceptInvite(inv)}>
                  Accept invite
                </button>
              </div>
            ))}
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
          <div style={{ marginTop: 10, fontSize: 13, opacity: 0.7 }}>
            After creation you can invite people by email.
          </div>
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
            <div style={{ fontSize: 14, opacity: 0.8 }}>Invite member (email)</div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <input
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="name@example.com"
                style={{ flex: 1, padding: 12, fontSize: 16 }}
              />
              <button onClick={invite} style={{ padding: "12px 14px", fontWeight: 800 }}>
                Invite
              </button>
            </div>
            <div style={{ marginTop: 10, fontSize: 13, opacity: 0.7 }}>
              No email is sent automatically (yet). It creates an in-app invite + a shareable link.
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
        </>
      )}
    </div>
  );
}
