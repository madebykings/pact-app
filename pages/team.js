// pages/team.js
import { useEffect, useMemo, useState } from "react";
import TopNav from "../components/Nav";
import { supabase } from "../lib/supabaseClient";

// Use lowercase tokens to avoid copy/paste + route weirdness
function randomToken(len = 24) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

async function copyToClipboard(text) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) {}
  return false;
}

export default function Team() {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(null);

  const [myTeam, setMyTeam] = useState(null);
  const [members, setMembers] = useState([]);

  const [inviteEmail, setInviteEmail] = useState("");
  const [outgoingInvites, setOutgoingInvites] = useState([]);

  const [teamName, setTeamName] = useState("");
  const [joinToken, setJoinToken] = useState("");

  const [errMsg, setErrMsg] = useState("");

  const siteUrl = useMemo(() => (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, ""), []);

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

        // Ensure settings row exists (do NOT overwrite)
        const { data: existing, error: selErr } = await supabase
          .from("user_settings")
          .select("user_id")
          .eq("user_id", data.user.id)
          .maybeSingle();
        if (selErr) throw selErr;

        if (!existing) {
          const { error: insErr } = await supabase.from("user_settings").insert({
            user_id: data.user.id,
            mode: "solo",
            timezone: "Europe/London",
          });
          if (insErr) throw insErr;
        }

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

    setSettings(st || null);

    const tid = st?.team_id || null;

    if (!tid) {
      setMyTeam(null);
      setMembers([]);
      setOutgoingInvites([]);
      return;
    }

    const { data: teamRow, error: tErr } = await supabase.from("teams").select("*").eq("id", tid).maybeSingle();
    if (tErr) throw tErr;
    setMyTeam(teamRow || null);

    // Members
    const { data: tm, error: tmErr } = await supabase.from("team_members").select("user_id,role").eq("team_id", tid);
    if (tmErr) throw tmErr;

    const userIds = (tm || []).map((x) => x.user_id);
    let profiles = [];
    if (userIds.length) {
      try {
        const resp = await fetch("/api/team/member-profiles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userIds }),
        });
        const json = await resp.json();
        if (json.profiles) profiles = json.profiles;
      } catch (_) {}
    }

    const mem = (tm || [])
      .map((m) => ({
        user_id: m.user_id,
        role: m.role || "member",
        display_name: profiles.find((p) => p.user_id === m.user_id)?.display_name || "",
      }))
      .sort((a, b) => (a.role === "owner" ? -1 : 1));
    setMembers(mem);

    // Invites
    const { data: outInv, error: outErr } = await supabase
      .from("team_invites")
      .select("*")
      .eq("team_id", tid)
      .order("created_at", { ascending: false });

    if (!outErr) setOutgoingInvites(outInv || []);
    else setOutgoingInvites([]);
  }

  async function setMode(mode) {
    if (!user) return;

    // Re-read team_id to avoid stale state
    const { data: st, error: stErr } = await supabase
      .from("user_settings")
      .select("team_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (stErr) return alert(stErr.message);

    const hasTeam = !!st?.team_id;

    // ✅ Rule: cannot select solo while in a team (must leave first)
    if (mode === "solo" && hasTeam) {
      alert("You can’t switch to Solo while you’re in a team. Leave the team first.");
      return;
    }

    const { error } = await supabase.from("user_settings").update({ mode }).eq("user_id", user.id);
    if (error) return alert(error.message);

    await refresh(user.id);
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
    await refresh(user.id);
  }

  async function leaveTeam() {
    if (!user || !settings?.team_id) return;

    await supabase.from("team_members").delete().eq("team_id", settings.team_id).eq("user_id", user.id);

    const { error } = await supabase.from("user_settings").update({ team_id: null, mode: "solo" }).eq("user_id", user.id);
    if (error) alert(error.message);

    await refresh(user.id);
  }

  async function invite() {
    if (!user || !settings?.team_id) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return alert("Enter an email");

    const token = randomToken(28);

    // ✅ must be one of: pending/accepted/expired/revoked
    const { error } = await supabase.from("team_invites").insert({
      team_id: settings.team_id,
      email,
      token,
      status: "pending",
      created_by: user.id,
      inviter_id: user.id,
    });

    if (error) return alert(error.message);

    setInviteEmail("");

    const link = siteUrl ? `${siteUrl}/invite/${token}` : `/invite/${token}`;
    const ok = await copyToClipboard(link);
    if (ok) alert("Invite link copied to clipboard ✅");
    else prompt("Copy this invite link:", link);

    await refresh(user.id);
  }

  async function removeInvite(inviteId) {
    if (!user || !settings?.team_id) return;
    const ok = confirm("Delete this invite?");
    if (!ok) return;

    const { error } = await supabase.from("team_invites").delete().eq("id", inviteId).eq("team_id", settings.team_id);
    if (error) return alert(error.message);

    await refresh(user.id);
  }

  async function acceptInvite(invite) {
    if (!user) return;

    // ✅ idempotent (no double-click / refresh issues)
    const { error: mErr } = await supabase.from("team_members").upsert(
      {
        team_id: invite.team_id,
        user_id: user.id,
        role: "member",
      },
      { onConflict: "team_id,user_id" }
    );
    if (mErr) return alert(mErr.message);

    const { error: iErr } = await supabase
      .from("team_invites")
      .update({ status: "accepted", accepted_at: new Date().toISOString() })
      .eq("id", invite.id);
    if (iErr) return alert(iErr.message);

    const { error: sErr } = await supabase
      .from("user_settings")
      .update({ team_id: invite.team_id, mode: "team" })
      .eq("user_id", user.id);
    if (sErr) return alert(sErr.message);

    await refresh(user.id);
  }

  async function joinByToken() {
    if (!user) return;
    const token = joinToken.trim();
    if (!token) return alert("Enter invite token");

    const { data: inv, error: invErr } = await supabase
      .from("team_invites")
      .select("*")
      .eq("token", token)
      .eq("status", "pending")
      .maybeSingle();

    if (invErr) return alert(invErr.message);
    if (!inv) return alert("Invite not found / already used");

    if (inv.email && user.email && inv.email.toLowerCase() !== user.email.toLowerCase()) {
      const ok = confirm(`This invite was created for ${inv.email}.\nYou're logged in as ${user.email}.\n\nJoin anyway?`);
      if (!ok) return;
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
      <div>
        <TopNav active="pact" onLogout={logout} />
        <div style={{ padding: 18, maxWidth: 980, margin: "0 auto" }}>
          <h1 style={{ margin: "0 0 14px" }}>Pact</h1>
          <p><b>Error:</b> {errMsg}</p>
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div>
        <TopNav active="pact" onLogout={logout} />
        <div style={{ padding: 18, maxWidth: 980, margin: "0 auto" }}>Loading…</div>
      </div>
    );
  }

  const isInTeam = !!settings.team_id;
  const isTeamMode = settings.mode === "team";

  return (
    <div>
      <TopNav active="pact" onLogout={logout} />

      <div style={{ padding: 18, maxWidth: 980, margin: "0 auto" }}>
        <h1 style={{ margin: "0 0 14px" }}>Pact</h1>

        <div style={{ marginBottom: 16 }}>
          <a
            href="/leaderboard"
            style={{
              display: "block",
              padding: 12,
              border: "1px solid rgba(0,0,0,.08)",
              borderRadius: 12,
              textAlign: "center",
              textDecoration: "none",
              fontWeight: 800,
            }}
          >
            Leaderboard
          </a>
        </div>

        {/* MODE */}
        <div style={{ padding: 14, border: "1px solid rgba(0,0,0,.08)", borderRadius: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 14, opacity: 0.8 }}>Mode</div>
          <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
            <button
              style={{
                flex: "1 1 160px",
                padding: 12,
                fontWeight: 800,
                opacity: settings.mode === "solo" ? 1 : 0.5,
              }}
              onClick={() => setMode("solo")}
              disabled={isInTeam}
              title={isInTeam ? "Leave the team to switch to Solo" : ""}
            >
              Solo
            </button>

            <button
              style={{ flex: "1 1 160px", padding: 12, fontWeight: 800, opacity: isTeamMode ? 1 : 0.5 }}
              onClick={() => setMode("team")}
              disabled={!isInTeam}
              title={!isInTeam ? "Create or join a team first" : ""}
            >
              Team
            </button>
          </div>

          {isInTeam && (
            <div style={{ marginTop: 10, fontSize: 13, opacity: 0.7 }}>
              To go Solo, you must leave the team first.
            </div>
          )}
          {!isInTeam && (
            <div style={{ marginTop: 10, fontSize: 13, opacity: 0.7 }}>
              Create or join a team to enable Team mode.
            </div>
          )}
        </div>

        {/* JOIN */}
        {!isInTeam && (
          <div style={{ padding: 14, border: "1px solid rgba(0,0,0,.08)", borderRadius: 12, marginBottom: 16 }}>
            <div style={{ fontSize: 14, opacity: 0.8 }}>Join with invite token</div>
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <input
                value={joinToken}
                onChange={(e) => setJoinToken(e.target.value)}
                placeholder="Paste invite token"
                style={{ flex: "1 1 280px", padding: 12, fontSize: 16 }}
              />
              <button onClick={joinByToken} style={{ padding: "12px 14px" }}>
                Join
              </button>
            </div>
          </div>
        )}

        {/* CREATE / VIEW TEAM */}
        {!isInTeam ? (
          <div style={{ padding: 14, border: "1px solid rgba(0,0,0,.08)", borderRadius: 12 }}>
            <div style={{ fontSize: 14, opacity: 0.8 }}>Create a team</div>
            <input
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="Team name"
              style={{ width: "100%", padding: 12, fontSize: 16, marginTop: 10 }}
            />
            <button style={{ width: "100%", padding: 12, marginTop: 10, fontWeight: 800 }} onClick={createTeam}>
              Create team
            </button>
            <div style={{ marginTop: 10, fontSize: 13, opacity: 0.7 }}>
              After creation you can invite people by email.
            </div>
          </div>
        ) : (
          <>
            <div style={{ padding: 14, border: "1px solid rgba(0,0,0,.08)", borderRadius: 12, marginBottom: 16 }}>
              <div style={{ fontSize: 14, opacity: 0.8 }}>Your team</div>
              <div style={{ fontSize: 22, fontWeight: 800, marginTop: 6 }}>{myTeam?.name || "Team"}</div>
              <div style={{ marginTop: 6, fontSize: 13, opacity: 0.7 }}>Team ID: {settings.team_id}</div>

              <button style={{ width: "100%", padding: 12, marginTop: 12 }} onClick={leaveTeam}>
                Leave team
              </button>
            </div>

            {/* INVITE */}
            <div style={{ padding: 14, border: "1px solid rgba(0,0,0,.08)", borderRadius: 12, marginBottom: 16 }}>
              <div style={{ fontSize: 14, opacity: 0.8 }}>Invite member (email)</div>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <input
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="name@example.com"
                  style={{ flex: "1 1 280px", padding: 12, fontSize: 16 }}
                />
                <button onClick={invite} style={{ padding: "12px 14px" }}>
                  Invite
                </button>
              </div>
              <div style={{ marginTop: 10, fontSize: 13, opacity: 0.7 }}>Invite link copies to clipboard.</div>
            </div>

            {/* MEMBERS */}
            <div style={{ padding: 14, border: "1px solid rgba(0,0,0,.08)", borderRadius: 12, marginBottom: 16 }}>
              <div style={{ fontSize: 14, opacity: 0.8 }}>Members</div>
              <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                {members.map((m) => (
                  <div key={m.user_id} style={{ padding: 12, border: "1px solid rgba(0,0,0,.08)", borderRadius: 12 }}>
                    <div style={{ fontWeight: 800 }}>{m.display_name || m.user_id}</div>
                    <div style={{ opacity: 0.7 }}>Role: {m.role || "member"}</div>
                  </div>
                ))}
                {members.length === 0 && <div style={{ opacity: 0.7 }}>No members loaded.</div>}
              </div>
            </div>

            {/* OUTGOING INVITES */}
            <div style={{ padding: 14, border: "1px solid rgba(0,0,0,.08)", borderRadius: 12 }}>
              <div style={{ fontSize: 14, opacity: 0.8 }}>Pending invites</div>
              <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                {outgoingInvites
                  .filter((i) => String(i.status || "").toLowerCase() === "pending")
                  .map((i) => (
                    <div
                      key={i.id}
                      style={{
                        padding: 12,
                        border: "1px solid rgba(0,0,0,.08)",
                        borderRadius: 12,
                        display: "flex",
                        gap: 10,
                        alignItems: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      <div style={{ flex: "1 1 240px" }}>
                        <div style={{ fontWeight: 800 }}>{i.email || "Invite"}</div>
                        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                          Token:{" "}
                          <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                            {i.token}
                          </span>
                        </div>
                      </div>

                      <button onClick={() => removeInvite(i.id)} style={{ padding: "10px 12px" }}>
                        Remove
                      </button>
                    </div>
                  ))}

                {outgoingInvites.filter((i) => String(i.status || "").toLowerCase() === "pending").length === 0 && (
                  <div style={{ opacity: 0.7 }}>No pending invites.</div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
                }
