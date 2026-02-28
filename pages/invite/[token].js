// pages/invite/[token].js
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../../lib/supabaseClient";

export default function InvitePage() {
  const router = useRouter();
  const { token } = router.query;

  const [user, setUser] = useState(null);
  const [invite, setInvite] = useState(null);
  const [msg, setMsg] = useState("Loading…");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      setUser(data?.user || null);
    })();
  }, []);

  useEffect(() => {
    if (!token) return;

    (async () => {
      setMsg("Loading…");

      const { data, error } = await supabase
        .from("team_invites")
        .select("*")
        .eq("token", token)
        .maybeSingle();

      if (error || !data) {
        setInvite(null);
        setMsg("Invite not found.");
        return;
      }

      setInvite(data);

      const status = String(data.status || "").toLowerCase();
      if (status !== "pending") {
        setMsg(`Invite is already ${status}.`);
        return;
      }

      if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
        setMsg("Invite has expired.");
        return;
      }

      setMsg("Ready.");
    })();
  }, [token]);

  async function accept() {
    if (!user) {
      router.push("/");
      return;
    }
    if (!invite) return;

    setBusy(true);
    try {
      // sanity: pending + not expired
      const status = String(invite.status || "").toLowerCase();
      if (status !== "pending") throw new Error("Invite is not pending.");
      if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) throw new Error("Invite expired.");

      // optional email guard
      if (invite.email && user.email && invite.email.toLowerCase() !== user.email.toLowerCase()) {
        const ok = confirm(
          `This invite was created for ${invite.email}.\nYou're logged in as ${user.email}.\n\nJoin anyway?`
        );
        if (!ok) {
          setBusy(false);
          return;
        }
      }

      // 1) add membership (idempotent)
      const { error: mErr } = await supabase.from("team_members").upsert(
        {
          team_id: invite.team_id,
          user_id: user.id,
          role: "member",
        },
        { onConflict: "team_id,user_id" }
      );
      if (mErr) throw mErr;

      // 2) mark invite accepted
      const { error: iErr } = await supabase
        .from("team_invites")
        .update({ status: "accepted", accepted_at: new Date().toISOString() })
        .eq("id", invite.id);
      if (iErr) throw iErr;

      // 3) set user_settings: team mode
      const { error: sErr } = await supabase
        .from("user_settings")
        .update({ team_id: invite.team_id, mode: "team" })
        .eq("user_id", user.id);
      if (sErr) throw sErr;

      alert("Joined team ✅");
      router.push("/team");
    } catch (e) {
      alert(e?.message || "Failed to accept invite");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 18, fontFamily: "system-ui", maxWidth: 520, margin: "0 auto" }}>
      <h2>Team invite</h2>

      {!user && (
        <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 12 }}>
          <div style={{ fontWeight: 800 }}>You need to log in first.</div>
          <a href="/" style={{ display: "inline-block", marginTop: 10 }}>
            Go to login
          </a>
        </div>
      )}

      <div style={{ marginTop: 14, padding: 12, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ opacity: 0.8 }}>{msg}</div>

        {invite && (
          <div style={{ marginTop: 10, fontSize: 13, opacity: 0.75 }}>
            For: <b>{invite.email || "—"}</b>
          </div>
        )}

        <button
          disabled={!user || !invite || busy || String(invite?.status || "").toLowerCase() !== "pending"}
          onClick={accept}
          style={{ width: "100%", padding: 12, marginTop: 12, fontWeight: 900 }}
        >
          Accept invite
        </button>
      </div>
    </div>
  );
}
