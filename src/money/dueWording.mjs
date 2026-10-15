// Plain wording for where an invoice stands against its due date, by calendar day in the practice's time zone. Pure.
// Found live 9 Oct 2026: an email said "An invoice is 0 days overdue" (days counted in 24-hour blocks, so anything under a day read 0) and another said only "Payment is due". Never "0 days overdue".
const dayNumber = (d, tz) => { const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d)); const [y, m, dd] = p.split("-").map(Number); return Math.floor(Date.UTC(y, m - 1, dd) / 86400000); };
/** @returns {{days:number, phrase:string, overdue:boolean}} days > 0 overdue, 0 due today, < 0 not yet due */
export function dueStanding(dueAt, now = new Date(), tz = "UTC") {
  if (!dueAt) return { days: 0, phrase: "due", overdue: false };
  const days = dayNumber(now, tz) - dayNumber(dueAt, tz);
  const phrase = days === 0 ? "due today" : days === 1 ? "1 day overdue" : days > 1 ? `${days} days overdue` : days === -1 ? "due tomorrow" : `due in ${-days} days`;
  return { days, phrase, overdue: days > 0 };
}
