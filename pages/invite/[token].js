import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

export default function InviteAccept() {
  const router = useRouter();
  const { token } = router.query;

  const [status, setStatus] = useState("Loading...");

  useEffect(() => {
    (async () => {
      if (!token) return;

      const { data } = await supabase.auth.getUser();
      if (!data?.user) {
        setStatus("Please log in first, then revisit this link.");
        return;
      }

      const res = await fetch("/api/team/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, userId: data.user.id }),
      });
      const json = await res.json();
      if (!res.ok) return setStatus(json.error || "Failed");

      setStatus("Accepted! Redirecting...");
      setTimeout(() => (window.location.href = "/dashboard"), 800);
    })();
  }, [token]);

  return (
    <div style={{ padding: 18, fontFamily: "system-ui", maxWidth: 520, margin: "0 auto" }}>
      <h2>Pact</h2>
      <p>{status}</p>
    </div>
  );
}
