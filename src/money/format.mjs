// src/money/format.mjs — Stage 11 task 11.3: the money/date formatting helpers the prompt catalogue
// (and later callers, 11.4/11.10) reuse rather than re-implementing per kind. Imports nothing — pure
// functions over plain values, no database, no config.

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const NUMBER_WORDS = [
  null, "one", "two", "three", "four", "five", "six",
  "seven", "eight", "nine", "ten", "eleven", "twelve",
];

/** `formatMinor(150000)` → "$1,500" · `formatMinor(12550)` → "$125.50". Whole-dollar amounts drop
 *  the cents (`minimumFractionDigits: 0`); anything with cents gets exactly two. */
export function formatMinor(amountMinor, currency = "USD") {
  const fractionDigits = amountMinor % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: fractionDigits,
  }).format(amountMinor / 100);
}

/** `formatDayMonth(new Date("2026-10-02"))` → "2 October". Appends " <year>" only when `date`'s
 *  year differs from `now`'s (default: today). */
export function formatDayMonth(date, now = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** `numberWord(6)` → "six" (1–12); anything else falls back to its digits, e.g. `numberWord(13)` →
 *  "13". */
export function numberWord(n) {
  return n >= 1 && n <= 12 ? NUMBER_WORDS[n] : String(n);
}
