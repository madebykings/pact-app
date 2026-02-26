export function mondayOfNextWeekISO() {
  const d = new Date();
  const day = d.getUTCDay(); // 0..6
  const daysToNextMonday = ((8 - day) % 7) || 7;
  d.setUTCDate(d.getUTCDate() + daysToNextMonday);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

export function addDaysISO(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Very simple, accountability-first, enforces at least 1 rest day
export function generateWeek(weekStartISO, allowed = ["walk","run","spin","weights","swim","hillwalk","stretch"], minRestDays = 1) {
  const rotation = [
    "spin",
    "weights",
    "walk",
    "run",
    "rest",
    "hillwalk",
    "stretch",
  ].map(k => (k === "rest" ? "REST" : k.toUpperCase()));

  const days = {};
  let restCount = 0;

  for (let i = 0; i < 7; i++) {
    const date = addDaysISO(weekStartISO, i);
    let pick = rotation[i % rotation.length];

    // If not allowed, fallback to WALK
    if (pick !== "REST") {
      const key = pick.toLowerCase();
      if (!allowed.includes(key)) pick = "WALK";
    }

    days[date] = pick;
    if (pick === "REST") restCount++;
  }

  // enforce rest
  if (restCount < minRestDays) {
    const dates = Object.keys(days);
    for (const date of dates) {
      if (restCount >= minRestDays) break;
      if (days[date] !== "REST") {
        days[date] = "REST";
        restCount++;
      }
    }
  }

  return days; // { "YYYY-MM-DD": "SPIN" | "REST" | ... }
}
