import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function Home() {
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, sess) => setSession(sess));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session) {
    window.location.href = "/dashboard";
    return null;
  }

  async function sendLink(e) {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/dashboard` },
    });
    if (error) alert(error.message);
    else setSent(true);
  }

  return (
    <div style={{ maxWidth: 420, margin: "40px auto", fontFamily: "system-ui" }}>
      <h1>Pact</h1>
      <p>Magic link login.</p>
      <form onSubmit={sendLink}>
        <input
          placeholder="you@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ width: "100%", padding: 12, fontSize: 16 }}
        />
        <button style={{ width: "100%", padding: 12, marginTop: 10, fontSize: 16 }}>
          Send link
        </button>
      </form>
      {sent && <p>Check your email for the link.</p>}
    </div>
  );
}