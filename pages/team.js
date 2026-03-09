// pages/team.js
import { useEffect, useMemo, useState } from "react";
import BottomNav from "../components/Nav";
import { supabase } from "../lib/supabaseClient";

const PRIMARY = "#5B4FE9";
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

const pageStyle = {
  background: "#f2f2f7",
  minHeight: "100vh",
  fontFamily: FONT,
  paddingBottom: 88,
};

const card = {
  background: "#fff",
  borderRadius: 18,
  padding: 18,
  marginBottom: 12,
  boxShadow: "0 1px 3px rgba(0,0,0,0.07)",
};

const inputStyle = {
  width: "100%",
  padding: "11px 13px",
  fontSize: 15,
  borderRadius: 11,
  border: "1.5px solid #e5e5ea",
  background: "#f9f9f9",
  boxSizing: "border-box",
  fontFamily: FONT,
};

const primaryBtn = {
  width: "100%",
  padding: "13px 0",
  fontWeight: 800,
  fontSize: 15,
  background: PRIMARY,
  color: "#fff",
  border: "none",
  borderRadius: 13,
  cursor: "pointer",
  fontFamily: FONT,
};

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
        if (!data?.user) { window.location.href = "/"; return; }
        setUser(data.user);

        const { data: existing, error: selErr } = await supabase
          .from("user_settings").select("user_id").eq("user_id", data.user.id).maybeSingle();
        if (selErr) throw selErr;

        if (!existing) {
          const { error: insErr } = await supabase.from("user_settings").insert({
            user_id: data.user.id, mode: "solo", timezone: "Europe/London",
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
      .from("user_settings").select("*").eq("user_id", userId).maybeSingle();
    if (stErr) throw stErr;
    setSettings(st || null);

    const tid = st?.team_id || null;
    if (!tid) { setMyTeam(null); setMembers([]); setOutgoingInvites([]); return; }

    const { data: teamRow, error: tErr } = await supabase
      .from("teams").select("*").eq("id", tid).maybeSingle();
    if (tErr) throw tErr;
    setMyTeam(teamRow || null);

    const { data: tm, error: tmErr } = await supabase
      .from("team_members").select("user_id,role").eq("team_id", tid);
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

    const { data: outInv, error: outErr } = await supabase
      .from("team_invites").select("*").eq("team_id", tid).order("created_at", { ascending: false });
    if (!outErr) setOutgoingInvites(outInv || []);
    else setOutgoingInvites([]);
  }

  async function setMode(mode) {
    if (!user) return;
    const { data: st, error: stErr } = await supabase
      .from("user_settings").select("team_id").eq("user_id", user.id).maybeSingle();
    if (stErr) return alert(stErr.message);
    if (mode === "solo" && !!st?.team_id) {
      alert("You can't switch to Solo while you're in a team. Leave the team first.");
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
      .from("teams").insert({ name, owner_id: user.id }).select("*").single();
    if (tErr) return alert(tErr.message);

    const { error: mErr } = await supabase.from("team_members")
      .insert({ team_id: teamRow.id, user_id: user.id, role: "owner" });
    if (mErr) return alert(mErr.message);

    const { error: sErr } = await supabase.from("user_settings")
      .update({ team_id: teamRow.id, mode: "team" }).eq("user_id", user.id);
    if (sErr) return alert(sErr.message);

    setTeamName("");
    await refresh(user.id);
  }

  async function leaveTeam() {
    if (!user || !settings?.team_id) return;
    await supabase.from("team_members").delete().eq("team_id", settings.team_id).eq("user_id", user.id);
    const { error } = await supabase.from("user_settings")
      .update({ team_id: null, mode: "solo" }).eq("user_id", user.id);
    if (error) alert(error.message);
    await refresh(user.id);
  }

  async function invite() {
    if (!user || !settings?.team_id) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return alert("Enter an email");

    const token = randomToken(28);
    const { error } = await supabase.from("team_invites").insert({
      team_id: settings.team_id, email, token, status: "pending",
      created_by: user.id, inviter_id: user.id,
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
    if (!confirm("Delete this invite?")) return;
    const { error } = await supabase.from("team_invites").delete()
      .eq("id", inviteId).eq("team_id", settings.team_id);
    if (error) return alert(error.message);
    await refresh(user.id);
  }

  async function acceptInvite(inv) {
    if (!user) return;
    const { error: mErr } = await supabase.from("team_members").upsert(
      { team_id: inv.team_id, user_id: user.id, role: "member" },
      { onConflict: "team_id,user_id" }
    );
    if (mErr) return alert(mErr.message);

    const { error: iErr } = await supabase.from("team_invites")
      .update({ status: "accepted", accepted_at: new Date().toISOString() }).eq("id", inv.id);
    if (iErr) return alert(iErr.message);

    const { error: sErr } = await supabase.from("user_settings")
      .update({ team_id: inv.team_id, mode: "team" }).eq("user_id", user.id);
    if (sErr) return alert(sErr.message);
    await refresh(user.id);
  }

  async function joinByToken() {
    if (!user) return;
    const token = joinToken.trim();
    if (!token) return alert("Enter invite token");

    const { data: inv, error: invErr } = await supabase
      .from("team_invites").select("*").eq("token", token).eq("status", "pending").maybeSingle();
    if (invErr) return alert(invErr.message);
    if (!inv) return alert("Invite not found / already used");

    if (inv.email && user.email && inv.email.toLowerCase() !== user.email.toLowerCase()) {
      if (!confirm(`This invite was created for ${inv.email}.\nYou're logged in as ${user.email}.\n\nJoin anyway?`)) return;
    }

    await acceptInvite(inv);
    setJoinToken("");
  }

  if (errMsg) {
    return (
      <div style={pageStyle}>
        <div style={{ padding: 18, color: "#c00" }}><b>Error:</b> {errMsg}</div>
        <BottomNav active="pact" />
      </div>
    );
  }

  if (!settings) {
    return (
      <div style={pageStyle}>
        <div style={{ padding: "40px 18px", textAlign: "center", color: "#8e8e93" }}>Loading…</div>
        <BottomNav active="pact" />
      </div>
    );
  }

  const isInTeam = !!settings.team_id;
  const isTeamMode = settings.mode === "team";
  const pendingInvites = outgoingInvites.filter((i) => String(i.status || "").toLowerCase() === "pending");

  return (
    <div style={pageStyle}>
      {/* Header */}
      <div style={{ padding: "24px 18px 4px" }}>
        {isInTeam ? (
          <>
            <div style={{ fontSize: 13, color: "#8e8e93", marginBottom: 2 }}>Your team</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: "#111", letterSpacing: -0.5 }}>
              {myTeam?.name || "Team"}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 28, fontWeight: 800, color: "#111", letterSpacing: -0.5 }}>Pact</div>
        )}
      </div>

      <div style={{ padding: "8px 18px 0" }}>
        {/* Leaderboard link */}
        <a
          href="/leaderboard"
          style={{
            ...card,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            textDecoration: "none",
            color: "#111",
          }}
        >
          <div>
            <div style={{ fontWeight: 800, fontSize: 15 }}>Leaderboard</div>
            <div style={{ fontSize: 13, color: "#8e8e93", marginTop: 2 }}>Weekly ranking</div>
          </div>
          <span style={{ fontSize: 20, color: "#8e8e93" }}>›</span>
        </a>

        {/* Mode toggle */}
        <div style={card}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#8e8e93", letterSpacing: 1, marginBottom: 12 }}>MODE</div>
          <div style={{ display: "flex", gap: 8, background: "#f2f2f7", borderRadius: 13, padding: 4 }}>
            {["solo", "team"].map((m) => {
              const active = settings.mode === m;
              const disabled = m === "team" ? !isInTeam : isInTeam;
              return (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  disabled={disabled}
                  style={{
                    flex: 1, padding: "10px 0", fontWeight: 700, fontSize: 14,
                    border: "none", borderRadius: 10, cursor: disabled ? "default" : "pointer",
                    fontFamily: FONT,
                    background: active ? "#fff" : "transparent",
                    color: active ? PRIMARY : "#8e8e93",
                    boxShadow: active ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                    textTransform: "capitalize",
                  }}
                >
                  {m}
                </button>
              );
            })}
          </div>
          <div style={{ marginTop: 10, fontSize: 13, color: "#8e8e93" }}>
            {isInTeam ? "Leave the team to switch to Solo." : "Create or join a team to enable Team mode."}
          </div>
        </div>

        {/* Join with token */}
        {!isInTeam && (
          <div style={card}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#8e8e93", letterSpacing: 1, marginBottom: 12 }}>
              JOIN WITH INVITE TOKEN
            </div>
            <input
              value={joinToken}
              onChange={(e) => setJoinToken(e.target.value)}
              placeholder="Paste invite token"
              style={{ ...inputStyle, marginBottom: 10 }}
            />
            <button onClick={joinByToken} style={primaryBtn}>Join team</button>
          </div>
        )}

        {/* Create team */}
        {!isInTeam && (
          <div style={card}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#8e8e93", letterSpacing: 1, marginBottom: 12 }}>
              CREATE A TEAM
            </div>
            <input
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="Team name"
              style={{ ...inputStyle, marginBottom: 10 }}
            />
            <button onClick={createTeam} style={primaryBtn}>Create team</button>
          </div>
        )}

        {/* Team info + members */}
        {isInTeam && (
          <>
            {/* Members */}
            <div style={card}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#8e8e93", letterSpacing: 1, marginBottom: 12 }}>
                MEMBERS
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {members.map((m) => (
                  <div
                    key={m.user_id}
                    style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "10px 12px", background: "#f9f9f9", borderRadius: 13,
                    }}
                  >
                    <div style={{
                      width: 36, height: 36, borderRadius: 10, background: PRIMARY,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: "#fff", fontWeight: 800, fontSize: 15, flexShrink: 0,
                    }}>
                      {(m.display_name || "?")[0].toUpperCase()}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: "#111" }}>
                        {m.display_name || "Unnamed"}
                      </div>
                      <div style={{ fontSize: 12, color: "#8e8e93", marginTop: 1 }}>{m.role}</div>
                    </div>
                    {m.role === "owner" && (
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 20,
                        background: "rgba(91,79,233,0.08)", color: PRIMARY,
                      }}>
                        Owner
                      </span>
                    )}
                  </div>
                ))}
                {members.length === 0 && (
                  <div style={{ color: "#8e8e93", fontSize: 14 }}>No members loaded.</div>
                )}
              </div>
            </div>

            {/* Invite */}
            <div style={card}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#8e8e93", letterSpacing: 1, marginBottom: 12 }}>
                INVITE MEMBER
              </div>
              <input
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="name@example.com"
                style={{ ...inputStyle, marginBottom: 10 }}
              />
              <button onClick={invite} style={primaryBtn}>Send invite</button>
              <div style={{ marginTop: 8, fontSize: 12, color: "#8e8e93" }}>Invite link copies to clipboard.</div>
            </div>

            {/* Pending invites */}
            {pendingInvites.length > 0 && (
              <div style={card}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#8e8e93", letterSpacing: 1, marginBottom: 12 }}>
                  PENDING INVITES
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  {pendingInvites.map((inv) => (
                    <div
                      key={inv.id}
                      style={{
                        display: "flex", alignItems: "center", gap: 12,
                        padding: "10px 12px", background: "#f9f9f9", borderRadius: 13,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: "#111" }}>{inv.email || "Invite"}</div>
                        <div style={{ fontSize: 11, color: "#8e8e93", marginTop: 2, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {inv.token}
                        </div>
                      </div>
                      <button
                        onClick={() => removeInvite(inv.id)}
                        style={{
                          padding: "8px 12px", fontWeight: 700, fontSize: 13,
                          background: "rgba(255,69,58,0.1)", color: "#ff453a",
                          border: "none", borderRadius: 10, cursor: "pointer", fontFamily: FONT, flexShrink: 0,
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Leave team */}
            <div style={card}>
              <button
                onClick={leaveTeam}
                style={{
                  width: "100%", padding: 13, fontWeight: 800, fontSize: 15,
                  background: "rgba(255,69,58,0.1)", color: "#ff453a",
                  border: "none", borderRadius: 13, cursor: "pointer", fontFamily: FONT,
                }}
              >
                Leave team
              </button>
            </div>
          </>
        )}
      </div>

      <BottomNav active="pact" />
    </div>
  );
}
