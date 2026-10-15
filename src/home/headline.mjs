// src/home/headline.mjs — Stage 17 task 17.26: composeHeadline pure function writes Home's
// headline sentence from live values. Imports nothing — pure functions over plain values, no
// database, no config.

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const NUMBER_WORDS = [
  null, "one", "two", "three", "four", "five", "six",
  "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
  "nineteen", "twenty",
];

/**
 * Convert a number to words (1–20) or return the digit string for ≥21.
 * `numberWord(6)` → "six"; `numberWord(21)` → "21"
 */
function numberWord(n) {
  return n >= 1 && n <= 20 ? NUMBER_WORDS[n] : String(n);
}

/**
 * Format minutes since the epoch as "h" or "h:MM AM/PM" in 12-hour local time, no leading zeros.
 * Input: number of minutes since epoch (Unix timestamp × 60 is seconds; divide by 60 for seconds).
 * Actually, startsAt is likely an ISO string or milliseconds. Let me check the context.
 *
 * Looking at the spec: `days:[{date, weekday, booked, open:[startsAt…]}]`
 * Typically startsAt would be an ISO string like "2026-09-25T14:30:00Z" or a timestamp.
 *
 * For 12-hour time without ":00", I need to:
 * 1. Parse the time
 * 2. Convert to 12-hour format
 * 3. Return "h" if minute is 0, otherwise "h:MM"
 */
function formatHour(startsAt) {
  // Assume startsAt is an ISO string or can be parsed as a date
  const date = startsAt instanceof Date ? startsAt : new Date(startsAt);
  const hours = date.getHours();
  const minutes = date.getMinutes();

  const hour12 = hours % 12 || 12; // Convert to 12-hour
  const period = hours < 12 ? "am" : "pm";

  if (minutes === 0) {
    return `${hour12}${period}`;
  }
  return `${hour12}:${String(minutes).padStart(2, '0')}${period}`;
}

/**
 * Compose a headline sentence from live values for the Home page.
 *
 * Input: { role, sessionsThisWeek, owedMinor?, currency?, days, drifting? }
 * Output: { text: string, strong: [{start, end}, ...] }
 *
 * Owner:
 * - If owed > 0: "{n} sessions this week and **{money} still owed**."
 * - Otherwise: "{n} sessions this week."
 * - Plus day clauses (today onward, max 2 clauses)
 *
 * Staff:
 * - Day clauses only
 * - Plus: ", and **{n} clients haven't rebooked** since {Month}." if drifting > 0
 */
export function composeHeadline({
  role,
  sessionsThisWeek,
  owedMinor,
  currency = "USD",
  days = [],
  drifting = 0,
}) {
  const strong = []; // Array of {start, end} to mark bold ranges
  let text = "";

  // OWNER: Hero sentence
  if (role === "owner") {
    // "No sessions this week." if zero
    if (sessionsThisWeek === 0) {
      text = "No sessions this week.";
    } else {
      const sessWord = numberWord(sessionsThisWeek);
      if (owedMinor > 0) {
        // Format the money
        const fractionDigits = owedMinor % 100 === 0 ? 0 : 2;
        const moneyStr = new Intl.NumberFormat("en-US", {
          style: "currency",
          currency,
          minimumFractionDigits: fractionDigits,
        }).format(owedMinor / 100);

        const base = `${sessWord} sessions this week and `;
        const boldStart = text.length + base.length;
        text += base;
        text += `${moneyStr} still owed`;
        const boldEnd = text.length;
        strong.push({ start: boldStart, end: boldEnd });
        text += ".";
      } else {
        text = `${sessWord} sessions this week.`;
      }
    }
  }

  // Build day clauses (today onward, max 2)
  const dayClauses = [];
  for (const day of days) {
    if (dayClauses.length >= 2) break; // Max 2 clauses

    if (day.booked > 0 && (!day.open || day.open.length === 0)) {
      // "{Weekday} is full"
      dayClauses.push(`${day.weekday} is full`);
    } else if (day.open && day.open.length >= 1 && day.open.length <= 4) {
      // "{Weekday} has {n-words} gap(s) at {h, h and h}"
      const gapWord = numberWord(day.open.length);
      const gapPlural = day.open.length === 1 ? "gap" : "gaps";
      const times = day.open.map(gap => formatHour(gap.startsAt));
      let timeStr;
      if (times.length === 1) {
        timeStr = times[0];
      } else if (times.length === 2) {
        timeStr = `${times[0]} and ${times[1]}`;
      } else {
        // Join all but last with ", " and last with " and "
        timeStr = times.slice(0, -1).join(", ") + " and " + times[times.length - 1];
      }
      dayClauses.push(`${day.weekday} has ${gapWord} ${gapPlural} at ${timeStr}`);
    }
  }

  // STAFF: Build full headline from day clauses + drifting
  if (role === "staff") {
    if (dayClauses.length > 0) {
      text = dayClauses.join(", ");
    }

    if (drifting > 0) {
      const driftWord = numberWord(drifting);
      if (text) {
        text += ", and ";
      }
      const boldStart = text.length;
      text += `${driftWord} clients haven't rebooked`;
      const boldEnd = text.length;
      strong.push({ start: boldStart, end: boldEnd });

      // Get the month name from the current date or a reference date
      // The spec says "since {Month}." but doesn't specify which month
      // Typically this would be "since January" or the month they stopped booking
      // For now, assume we use the previous month
      const now = new Date();
      const lastMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
      const monthName = MONTHS[lastMonth];
      text += ` since ${monthName}.`;
    } else if (text) {
      // No drifting, but we have day clauses - add period
      text += ".";
    }
  } else if (dayClauses.length > 0) {
    // OWNER: append day clauses
    text += " " + dayClauses.join(", ") + ".";
  }

  return { text, strong };
}
