// R13-D468: the audit log's From/To days are days on the READER's clock (the dates on screen are shown in their zone), so the screen sends its zone and the server turns "2026-10-23"
// into that zone's midnight. No zone, or one Intl does not know, keeps the old reading (UTC).
export const zoneOk = (tz) => { if (typeof tz !== "string" || !tz || tz.length > 64) return null; try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz; } catch { return null; } };
const offsetMs = (instantMs, tz) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(instantMs)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(instantMs / 1000) * 1000;
};
/** Midnight at the start of `ymd` (YYYY-MM-DD) in `tz`, as a Date. */
export function dayStartInZone(ymd, tz) {
  const guess = Date.parse(`${ymd}T00:00:00Z`);
  const z = zoneOk(tz);
  if (!z) return new Date(guess);
  const first = guess - offsetMs(guess, z);
  return new Date(guess - offsetMs(first, z));
}
