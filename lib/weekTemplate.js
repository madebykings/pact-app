export function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

// Fixed plan: Mon RPM, Tue PUMP, Wed REST, Thu RPM, Fri PUMP, Sat HEAVY, Sun REST
export function planTypeForDate(d) {
  const dow = d.getDay(); // 0 Sun .. 6 Sat
  if (dow === 1) return "RPM";
  if (dow === 2) return "PUMP";
  if (dow === 3) return "REST";
  if (dow === 4) return "RPM";
  if (dow === 5) return "PUMP";
  if (dow === 6) return "HEAVY";
  return "REST";
}