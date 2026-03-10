import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const PRIMARY = "#5B4FE9";
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

export default function ResetPassword() {
  const [ready, setReady] = useState(false); // true once recovery session is established
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Supabase fires PASSWORD_RECOVERY when the user arrives via the reset link
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleReset(e) {
    e.preventDefault();
    if (password.length < 6) { setErr("Password must be at least 6 characters."); return; }
    if (password !== confirm) { setErr("Passwords don't match."); return; }
    setErr(""); setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) { setErr(error.message); return; }
    setDone(true);
    setTimeout(() => { window.location.href = "/dashboard"; }, 2000);
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
      </div>

      <div style={{
        width: "100%",
        maxWidth: 400,
        background: "#fff",
        borderRadius: 20,
        padding: 24,
        boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
      }}>
        <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 6 }}>Set new password</div>

        {done ? (
          <div style={{
            padding: "11px 14px", background: "rgba(91,79,233,0.08)", borderRadius: 11,
            color: PRIMARY, fontSize: 15, fontWeight: 500,
          }}>
            Password updated! Taking you to the app…
          </div>
        ) : !ready ? (
          <p style={{ color: "#8e8e93", fontSize: 15, margin: 0 }}>
            Waiting for reset link verification… If you arrived here by mistake,{" "}
            <a href="/" style={{ color: PRIMARY }}>go back to sign in</a>.
          </p>
        ) : (
          <form onSubmit={handleReset} style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
            {err && (
              <div style={{
                padding: "11px 14px", background: "rgba(255,69,58,0.08)", borderRadius: 11,
                color: "#ff453a", fontSize: 14, fontWeight: 500,
              }}>
                {err}
              </div>
            )}
            <input
              type="password"
              placeholder="New password (min 6 chars)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={inputStyle}
            />
            <input
              type="password"
              placeholder="Confirm new password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              style={inputStyle}
            />
            <button
              type="submit"
              disabled={loading}
              style={{
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
              }}
            >
              {loading ? "Saving…" : "Set password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
