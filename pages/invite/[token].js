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

      const status = String(data.status || "").toUpperCase();
      if (status !== "PENDING") {
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
      const res = await fetch("/api/team/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: invite.token, userId: user.id }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json?.error || "accept_failed");

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
          <a href="/" style={{ display: "inline-block", marginTop: 10 }}>Go to login</a>
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
          disabled={!user || !invite || busy || String(invite.status || "").toUpperCase() !== "PENDING"}
          onClick={accept}
          style={{ width: "100%", padding: 12, marginTop: 12, fontWeight: 900 }}
        >
          Accept invite
        </button>
      </div>
    </div>
  );
}
