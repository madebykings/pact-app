"use client";
import { useMemo, useState } from "react";

function isoTomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export default function ImInCard({ teamId }: { teamId: string }) {
  const dateISO = useMemo(() => isoTomorrow(), []);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function commit() {
    setLoading(true);
    setStatus(null);
    const res = await fetch("/api/team/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId, dateISO }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) return setStatus(data.error || "Error");
    setStatus(`Locked in (${data.commit_status}) +${data.points}`);
  }

  return (
    <div className="rounded-2xl border p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Tomorrow</h3>
        <span className="text-sm opacity-70">{dateISO}</span>
      </div>

      <p className="mt-2 text-sm opacity-80">
        Press <b>I’m in</b> before cutoff to earn commitment points.
      </p>

      <button
        onClick={commit}
        disabled={loading}
        className="mt-4 w-full rounded-2xl bg-black text-white px-4 py-3 font-semibold disabled:opacity-60"
      >
        {loading ? "Saving..." : "I’m in"}
      </button>

      {status && <div className="mt-3 text-sm opacity-80">{status}</div>}
    </div>
  );
}
