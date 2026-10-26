// PLATFORM'S OWN PUBLIC BOOKING PAGES — small pure helpers for days, times, zones and wording (plan frames 9 to 14).
// ★ Slots arrive as UTC instants; the Day dropdown groups them by the PRACTICE's calendar day (the server's `days` do the
//   same), the Time dropdown shows them in the VISITOR's zone and, when that differs, the practice's time in brackets.

export const visitorZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } };

/** "Pacific Time" for America/Los_Angeles. Falls back to the zone id. */
export function zoneName(tz) {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longGeneric" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName");
    return part?.value || tz;
  } catch { return tz; }
}
/** "Pacific" for America/Los_Angeles. */
export const zoneShort = (tz) => zoneName(tz).replace(/\s+Time$/, "");

/** YYYY-MM-DD of an instant on the calendar of `tz`. */
export function dateInZone(iso, tz) {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso)); }
  catch { return new Date(iso).toISOString().slice(0, 10); }
}
/** YYYY-MM-DD plus n days (calendar arithmetic, no zone). */
export function addDays(date, n) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
/** "Fri, Oct 23" for a YYYY-MM-DD, and "12 times". */
export function dayLabel(date, count) {
  const label = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  return count == null ? label : `${label}, ${count} ${count === 1 ? "time" : "times"}`;
}
const timeIn = (iso, tz) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
/** "10:30 AM", or "1:30 PM (10:30 AM Pacific)" when the visitor is in another zone. */
export function timeLabel(iso, visitorTz, practiceTz) {
  const mine = timeIn(iso, visitorTz);
  if (!practiceTz || practiceTz === visitorTz) return mine;
  if (timeIn(iso, practiceTz) === mine) return mine;
  return `${mine} (${timeIn(iso, practiceTz)} ${zoneShort(practiceTz)})`;
}
/** "Friday, October 23 at 10:30 AM" in the visitor's zone. */
export function whenLong(iso, tz) {
  const d = new Date(iso).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: tz });
  return `${d} at ${timeIn(iso, tz)}`;
}
/** The line under the form: "Times are in Pacific Time." or, away from the practice, "Times are in your time zone (Eastern Time)." */
export function zoneLine(visitorTz, practiceTz) {
  return !practiceTz || practiceTz === visitorTz || zoneName(practiceTz) === zoneName(visitorTz)
    ? `Times are in ${zoneName(visitorTz)}.`
    : `Times are in your time zone (${zoneName(visitorTz)}).`;
}
/** 120 -> "2 hours", 60 -> "1 hour", 30 -> "30 minutes", 2880 -> "2 days". */
export function noticeText(minutes) {
  const m = Number(minutes);
  if (!Number.isFinite(m) || m <= 0) return null;
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"}`;
  if (m < 2880) { const h = Math.round(m / 60); return `${h} hour${h === 1 ? "" : "s"}`; }
  const d = Math.round(m / 1440); return `${d} day${d === 1 ? "" : "s"}`;
}

export const MODALITY_LABEL = { phone: "Phone, we call you", video: "Video, from your phone or computer", in_person: "In person" };
const MODALITY_SHORT = { phone: "Phone", video: "Video", in_person: "In person" };
export const modalityLabel = (m) => MODALITY_LABEL[m] ?? (m ? String(m).replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : "");
/** "Phone or video" for a service row. */
export function modalitiesText(list) {
  const names = (list ?? []).map((m) => MODALITY_SHORT[m] ?? String(m));
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  const lower = names.slice(1).map((n) => n.toLowerCase());
  return `${names[0]}${lower.length > 1 ? ", " + lower.slice(0, -1).join(", ") : ""} or ${lower[lower.length - 1]}`;
}

/** Tracking fields the visit arrived with, sent so the lead carries its source. Empty values are left out. */
export function attributionFromLocation() {
  const q = new URLSearchParams(window.location.search);
  const out = {};
  for (const k of ["gclid", "gbraid", "wbraid", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) { const v = q.get(k); if (v) out[k] = v.slice(0, 200); }
  out.landing_page = `${window.location.origin}${window.location.pathname}`;
  if (document.referrer) out.referrer = document.referrer.slice(0, 500);
  return out;
}
