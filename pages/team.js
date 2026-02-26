import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function Team() {
  const [user, setUser] = useState(null);
  const [team, setTeam] = useState(null);
  const [members, setMembers] = useState([]);
  const [email, setEmail] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data?.user) return (window.location.href = "/");
      setUser(data.user);

      await refresh(data.user.id);
    })();
  }, []);

  async function refresh(userId) {
    const { data: tm } = await supabase
      .from("team_members")
      .select("team_id, role, teams:team_id(id,name,owner_id)")
      .eq("user_id", userId)
      .maybeSingle();

    if (!tm?.teams) {
      setTeam(null);
      setMembers([]);
      return;
    }
    setTeam({ ...tm.teams, role: tm.role });

    const { data: ms, error: msErr } = await supabase
      .from("team_members")
      .select("user_id, role")
      .eq("team_id", tm.team_id);

    if (msErr) setErr(msErr.message);
    setMembers(ms || []);
  }

  async function createTeam() {
    const name = prompt("Team name?") || "My Pact Team";
    const { error } = await supabase.from("teams").insert({ name, owner_id: user.id });
    if (error) return alert(error.message);

    await supabase.from("team_members").insert({ team_id: (await supabase.from("teams").select("id").eq("owner_id", user.id).single()).data.id, user_id: user.id, role: "owner" });
    await supabase.from("user_settings").upsert({ user_id: user.id, mode: "team" }, { onConflict: "user_id" });
    await refresh(user.id);
  }

  async function sendInvite() {
    setInviteLink("");
    if (!team) return;

    const res = await fetch("/api/team/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId: team.id, email, createdBy: user.id }),
    });
    const json = await res.json();
    if (!res.ok) return alert(json.error || "Invite failed");
    setInviteLink(json.link);
  }

  return (
    <div style={{ padding: 18, fontFamily: "system-ui", maxWidth: 560, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Team</h2>
        <a href="/dashboard" style={{ textDecoration: "none", border: "1px solid #ddd", padding: "6px 10px", borderRadius: 10 }}>
          Back
        </a>
      </div>

      {err && <div style={{ marginTop: 10, color: "crimson" }}>{err}</div>}

      {!team ? (
        <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
          <div style={{ fontSize: 14, opacity: 0.8 }}>You’re not in a team yet.</div>
          <button style={{ width: "100%", padding: 12, marginTop: 10, fontSize: 16, fontWeight: 800 }} onClick={createTeam}>
            Create team
          </button>
        </div>
      ) : (
        <>
          <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
            <div style={{ fontSize: 14, opacity: 0.8 }}>Team</div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{team.name}</div>
            <div style={{ marginTop: 6, opacity: 0.8 }}>Role: {team.role}</div>
          </div>

          {team.owner_id === user?.id && (
            <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
              <div style={{ fontSize: 14, opacity: 0.8 }}>Invite member</div>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@example.com"
                style={{ width: "100%", padding: 12, fontSize: 16, marginTop: 8 }}
              />
              <button style={{ width: "100%", padding: 12, marginTop: 10, fontSize: 16, fontWeight: 800 }} onClick={sendInvite}>
                Create invite link
              </button>
              {inviteLink && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 13, opacity: 0.7 }}>Invite link:</div>
                  <div style={{ wordBreak: "break-all", padding: 10, border: "1px solid #eee", borderRadius: 10, marginTop: 6 }}>
                    {inviteLink}
                  </div>
                </div>
              )}
            </div>
          )}

          <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
            <div style={{ fontSize: 14, opacity: 0.8 }}>Members</div>
            <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
              {members.map((m) => (
                <div key={m.user_id} style={{ padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
                  <div style={{ fontWeight: 800 }}>{m.user_id}</div>
                  <div style={{ opacity: 0.8 }}>Role: {m.role}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
