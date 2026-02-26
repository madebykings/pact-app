type Intensity = "easy" | "moderate" | "hard";

export type DayPlan =
  | { type: "rest" }
  | { type: string; minutes?: number; intensity?: Intensity; note?: string };

export type WeeklyPlan = {
  weekStart: string; // YYYY-MM-DD
  days: Record<string, DayPlan>; // date => plan
  rules: { minRestDays: number };
};

const DEFAULT_ROTATION: Array<DayPlan> = [
  { type: "spin", minutes: 45, intensity: "moderate" },
  { type: "weights", minutes: 40, intensity: "hard" },
  { type: "walk", minutes: 45, intensity: "easy" },
  { type: "run", minutes: 30, intensity: "moderate" },
  { type: "rest" },
  { type: "hillwalk", minutes: 60, intensity: "moderate" },
  { type: "stretch", minutes: 20, intensity: "easy" },
];

function addDaysISO(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function generateWeeklyPlan(weekStartISO: string, opts?: {
  allowedTypes?: string[]; // if you want to constrain
  minRestDays?: number;
}): WeeklyPlan {
  const minRestDays = opts?.minRestDays ?? 1;

  // Build 7 days
  const days: Record<string, DayPlan> = {};
  let restCount = 0;

  for (let i = 0; i < 7; i++) {
    const date = addDaysISO(weekStartISO, i);
    let pick = DEFAULT_ROTATION[i % DEFAULT_ROTATION.length];

    // Optional filter by allowed types
    if (opts?.allowedTypes?.length) {
      if (pick.type !== "rest" && !opts.allowedTypes.includes(pick.type)) {
        pick = { type: "walk", minutes: 45, intensity: "easy" };
      }
    }

    days[date] = pick;
    if (pick.type === "rest") restCount++;
  }

  // Enforce minimum rest days by converting easiest day(s) to rest
  if (restCount < minRestDays) {
    const dates = Object.keys(days);
    for (const date of dates) {
      if (restCount >= minRestDays) break;
      const p = days[date];
      if (p.type !== "rest") {
        days[date] = { type: "rest" };
        restCount++;
      }
    }
  }

  return { weekStart: weekStartISO, days, rules: { minRestDays } };
}
