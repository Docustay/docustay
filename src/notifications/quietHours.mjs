// When may a non-urgent email go? The two practice settings "notifications.quiet_hours" ({from,to} or null) and "notifications.weekend" (true = send on Saturday and Sunday) were validated and saved but nothing read them (EMAIL-AUDIT 9 Oct 2026; the maintainer's two invoice emails arrived at 3:06 am).
// Pure: returns null when sending now is fine, else the UTC time to try again. Only reminders and internal notices wait; sign-in codes, signing requests, receipts, session reminders and anything a person is waiting on never do (DEFERRABLE below).
export const DEFERRABLE_TEMPLATES = new Set(["automation.invoice_chase", "automation.package_low", "automation.review_ask", "money.invoice_reminder", "money.invoice_overdue", "growth.campaign"]);

const parts = (d, tz) => { const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" }).formatToParts(d); const o = {}; for (const p of f) o[p.type] = p.value; return { y: +o.year, m: +o.month, d: +o.day, hh: +o.hour, mm: +o.minute, wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(o.weekday) }; };
/** The UTC instant at which the wall clock in `tz` reads y-m-d hh:mm (two passes settle daylight-saving jumps). */
function zonedToUtc(y, m, d, hh, mm, tz) {
  let t = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 2; i += 1) { const p = parts(new Date(t), tz); t -= Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm) - Date.UTC(y, m - 1, d, hh, mm); }
  return new Date(t);
}
const toMin = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };

/** @param {{now?:Date, tz?:string, quiet?:{from:string,to:string}|null, weekend?:boolean}} a @returns {Date|null} */
export function deferUntil({ now = new Date(), tz = "UTC", quiet = null, weekend = true }) {
  let t = new Date(now);
  for (let guard = 0; guard < 6; guard += 1) {
    const p = parts(t, tz); const mins = p.hh * 60 + p.mm;
    if (quiet) {
      const from = toMin(quiet.from), to = toMin(quiet.to);
      const inside = from < to ? mins >= from && mins < to : mins >= from || mins < to;
      if (inside) {
        const next = new Date(zonedToUtc(p.y, p.m, p.d, Math.floor(to / 60), to % 60, tz));
        t = next.getTime() > t.getTime() ? next : new Date(zonedToUtc(p.y, p.m, p.d + 1, Math.floor(to / 60), to % 60, tz));
        continue;
      }
    }
    if (weekend === false && (p.wd === 0 || p.wd === 6)) {
      const add = p.wd === 6 ? 2 : 1; const open = quiet ? toMin(quiet.to) : 8 * 60;
      t = new Date(zonedToUtc(p.y, p.m, p.d + add, Math.floor(open / 60), open % 60, tz));
      continue;
    }
    return t.getTime() === now.getTime() ? null : t;
  }
  return t.getTime() === now.getTime() ? null : t;
}
