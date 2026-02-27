// components/Nav.js
import React from "react";

/**
 * Top navigation used across pages.
 * active: "dashboard" | "pact" | "plan" | "profile" | "settings"
 */
export default function TopNav({ active, onLogout }) {
  const linkStyle = (isActive) => ({
    padding: "6px 10px",
    border: "1px solid #ddd",
    borderRadius: 10,
    textDecoration: "none",
    opacity: isActive ? 1 : 0.75,
    fontWeight: isActive ? 900 : 700,
    background: isActive ? "#f7f7f7" : "transparent",
  });

  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <a href="/dashboard" style={linkStyle(active === "dashboard")}>Dashboard</a>
        <a href="/team" style={linkStyle(active === "pact")}>Pact</a>
        <a href="/week-plan" style={linkStyle(active === "plan")}>Plan</a>
        <a href="/profile" style={linkStyle(active === "profile")}>Profile</a>
        <a href="/settings" style={linkStyle(active === "settings")}>Settings</a>
      </div>
      <button onClick={onLogout} style={{ padding: "6px 10px" }}>Logout</button>
    </div>
  );
}
