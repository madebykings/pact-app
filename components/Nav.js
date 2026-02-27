export default function Nav({ hideProfile = false }) {
  return (
    <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
      <a href="/dashboard">Dashboard</a>
      <a href="/team">Pact</a>
      {!hideProfile && <a href="/profile">Profile</a>}
      <a href="/settings">Settings</a>
      <a href="/leaderboard">Leaderboard</a>
    </div>
  );
}
