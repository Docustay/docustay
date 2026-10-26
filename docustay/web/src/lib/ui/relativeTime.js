// "3 minutes ago", "in 2 days": Intl.RelativeTimeFormat, no library. Pure so it is tested.
export function relativeTime(date, { now = Date.now(), locale = "en" } = {}) {
  const t = date instanceof Date ? date.getTime() : new Date(date).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Math.round((t - now) / 1000), abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (abs < 45) return rtf.format(0, "second");   // "now", "jetzt", "maintenant" — the language's own word (numeric: "auto")
  const steps = [[60, 60, "minute"], [3600, 24, "hour"], [86400, 30, "day"], [2592000, 12, "month"], [31536000, Infinity, "year"]];
  let unitSecs = 60, name = "minute";
  for (const [secs, , n] of steps) { if (abs >= secs) { unitSecs = secs; name = n; } }
  return rtf.format(Math.round(diff / unitSecs), name);
}
