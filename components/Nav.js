// components/Nav.js — fixed bottom navigation bar
import React from "react";

const PRIMARY = "#5B4FE9";
const INACTIVE = "#8e8e93";

const NAV_ITEMS = [
  {
    key: "dashboard",
    label: "Dashboard",
    href: "/dashboard",
    paths: [
      "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
      "M9 22V12h6v10",
    ],
  },
  {
    key: "pact",
    label: "Pact",
    href: "/team",
    paths: [
      "M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z",
    ],
  },
  {
    key: "plan",
    label: "Plan",
    href: "/week-plan",
    paths: [
      "M8 2v4M16 2v4M3 10h18M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z",
    ],
  },
  {
    key: "profile",
    label: "Profile",
    href: "/profile",
    paths: [
      "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2",
      "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
    ],
  },
  {
    key: "settings",
    label: "Settings",
    href: "/settings",
    paths: [
      "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
      "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
    ],
  },
];

/**
 * Bottom navigation bar used across all pages.
 * active: "dashboard" | "pact" | "plan" | "profile" | "settings"
 * onLogout: optional logout handler (not shown in nav, available per-page)
 */
export default function BottomNav({ active, onLogout }) {
  return (
    <nav
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        height: 72,
        background: "rgba(255,255,255,0.96)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderTop: "1px solid rgba(0,0,0,0.09)",
        display: "flex",
        justifyContent: "space-around",
        alignItems: "center",
        zIndex: 100,
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
      }}
    >
      {NAV_ITEMS.map((item) => {
        const isActive = active === item.key;
        return (
          <a
            key={item.key}
            href={item.href}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 3,
              textDecoration: "none",
              color: isActive ? PRIMARY : INACTIVE,
              flex: 1,
              padding: "6px 0",
              minHeight: 48,
            }}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={isActive ? 2.5 : 1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {item.paths.map((d, i) => (
                <path key={i} d={d} />
              ))}
            </svg>
            <span style={{ fontSize: 10, fontWeight: isActive ? 700 : 500, letterSpacing: 0 }}>
              {item.label}
            </span>
          </a>
        );
      })}
    </nav>
  );
}
