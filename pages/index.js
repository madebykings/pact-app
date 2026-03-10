import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const PRIMARY = "#5B4FE9";
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

export default function Home() {
  const [tab, setTab] = useState("signin"); // "signin" | "signup"
  const [forgot, setForgot] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) window.location.href = "/dashboard";
    });
  }, []);

  function reset() {
    setMsg(""); setErr(""); setName(""); setPassword(""); setConfirm(""); setForgot(false);
  }

  async function sendReset(e) {
    e.preventDefault();
    setErr(""); setMsg(""); setLoading(true);
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${siteUrl}/reset-password`,
    });
    setLoading(false);
    if (error) { setErr(error.message); return; }
    setMsg("Check your email for a password reset link.");
    setForgot(false);
  }

  async function signIn(e) {
    e.preventDefault();
    setErr(""); setMsg(""); setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) { setErr(error.message); return; }
    window.location.href = "/dashboard";
  }

  async function signUp(e) {
    e.preventDefault();
    setErr(""); setMsg("");
    const n = name.trim();
    if (!n) { setErr("Please enter your name."); return; }
    if (password.length < 6) { setErr("Password must be at least 6 characters."); return; }
    if (password !== confirm) { setErr("Passwords don't match."); return; }
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: n } },
    });
    if (error) { setLoading(false); setErr(error.message); return; }

    // If email confirmation is disabled, session is returned immediately
    if (data.session) {
      await supabase.from("user_profiles").upsert(
        { user_id: data.user.id, display_name: n },
        { onConflict: "user_id" }
      );
      window.location.href = "/dashboard";
    } else {
      setLoading(false);
      setMsg("Check your email to confirm your account, then sign in.");
      setTab("signin");
    }
  }

  const inputStyle = {
    width: "100%",
    padding: "13px 14px",
    fontSize: 16,
    borderRadius: 12,
    border: "1.5px solid #e5e5ea",
    background: "#f9f9f9",
    boxSizing: "border-box",
    fontFamily: FONT,
    outline: "none",
  };

  const btnStyle = {
    width: "100%",
    padding: "14px 0",
    fontWeight: 800,
    fontSize: 16,
    background: loading ? "#a09ae0" : PRIMARY,
    color: "#fff",
    border: "none",
    borderRadius: 13,
    cursor: loading ? "default" : "pointer",
    fontFamily: FONT,
    marginTop: 4,
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "#f2f2f7",
      fontFamily: FONT,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px 18px",
    }}>
      <div style={{ marginBottom: 32, textAlign: "center" }}>
        <div style={{ fontSize: 40, fontWeight: 900, color: PRIMARY, letterSpacing: -1 }}>Pact</div>
        <div style={{ fontSize: 15, color: "#8e8e93", marginTop: 4 }}>Your daily fitness commitment</div>
      </div>

      <div style={{
        width: "100%",
        maxWidth: 400,
        background: "#fff",
        borderRadius: 20,
        padding: 24,
        boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
      }}>
        {/* Tab toggle */}
        <div style={{ display: "flex", background: "#f2f2f7", borderRadius: 13, padding: 4, marginBottom: 24 }}>
          {[{ key: "signin", label: "Sign in" }, { key: "signup", label: "Create account" }].map((t) => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); reset(); }}
              style={{
                flex: 1,
                padding: "10px 0",
                fontWeight: 700,
                fontSize: 14,
                border: "none",
                borderRadius: 10,
                cursor: "pointer",
                fontFamily: FONT,
                background: tab === t.key ? "#fff" : "transparent",
                color: tab === t.key ? PRIMARY : "#8e8e93",
                boxShadow: tab === t.key ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {err && (
          <div style={{
            padding: "11px 14px", background: "rgba(255,69,58,0.08)", borderRadius: 11,
            color: "#ff453a", fontSize: 14, marginBottom: 16, fontWeight: 500,
          }}>
            {err}
          </div>
        )}
        {msg && (
          <div style={{
            padding: "11px 14px", background: "rgba(91,79,233,0.08)", borderRadius: 11,
            color: PRIMARY, fontSize: 14, marginBottom: 16, fontWeight: 500,
          }}>
            {msg}
          </div>
        )}

        {tab === "signin" && !forgot ? (
          <form onSubmit={signIn} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={inputStyle}
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={inputStyle}
            />
            <button type="submit" disabled={loading} style={btnStyle}>
              {loading ? "Signing in…" : "Sign in"}
            </button>
            <button
              type="button"
              onClick={() => { setErr(""); setMsg(""); setForgot(true); }}
              style={{ background: "none", border: "none", color: "#8e8e93", fontSize: 14, cursor: "pointer", padding: "4px 0", fontFamily: FONT }}
            >
              Forgot password?
            </button>
          </form>
        ) : tab === "signin" && forgot ? (
          <form onSubmit={sendReset} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ margin: "0 0 4px", fontSize: 14, color: "#3c3c43" }}>
              Enter your email and we&apos;ll send a link to reset your password.
            </p>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={inputStyle}
            />
            <button type="submit" disabled={loading} style={btnStyle}>
              {loading ? "Sending…" : "Send reset link"}
            </button>
            <button
              type="button"
              onClick={() => { setErr(""); setMsg(""); setForgot(false); }}
              style={{ background: "none", border: "none", color: "#8e8e93", fontSize: 14, cursor: "pointer", padding: "4px 0", fontFamily: FONT }}
            >
              Back to sign in
            </button>
          </form>
        ) : (
          <form onSubmit={signUp} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input
              type="text"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              style={inputStyle}
            />
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={inputStyle}
            />
            <input
              type="password"
              placeholder="Password (min 6 chars)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={inputStyle}
            />
            <input
              type="password"
              placeholder="Confirm password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              style={inputStyle}
            />
            <button type="submit" disabled={loading} style={btnStyle}>
              {loading ? "Creating account…" : "Create account"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
