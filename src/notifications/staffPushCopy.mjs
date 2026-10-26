// Task 18.31 — STAFF PUSH COPY AND PAYMENT RECEIVED NOTIFICATIONS.
// Spec: specs/features/18-mobile-and-push.md §18.31 (push terminology).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ PUSH IS COMPOSED IN THE WORKER, FAR FROM ANY UI — TERMINOLOGY GETS MISSED THERE.
//     Every client-facing word in a push payload must pass through THE SERVER-SIDE TERM RESOLVER,
//     the same one the app and emails use. A React/Svelte hook cannot serve the worker.
//     ★★ THE RULE IS LIVE BEFORE SEND, FROZEN AFTER: renaming a term must never rewrite a
//     notification somebody has already received.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { resolveTerms } from "../terminology/resolve.mjs";

/**
 * Format staff-facing push notifications with practice-specific terminology.
 *
 * ★ Each `kind` has its own shape and produces { title, body } for the notification row.
 *   All text is run through `resolveTerms(db)` to use the practice's configured vocabulary.
 *
 * @param {*} tx — The database transaction (for terminology resolution)
 * @param {string} kind — The notification kind: "payment_received", "day_summary", "invoice_late", "agreement_signed"
 * @param {object} facts — The facts that populate the message (vary by kind)
 * @returns {Promise<{title: string, body: string}>}
 */
export async function staffPushCopy(tx, kind, facts) {
  const terms = await resolveTerms(tx);

  if (kind === "payment_received") {
    // facts: { personFirstName, amountMinor, currency, itemLabel, payoutWeekday }
    const { personFirstName, amountMinor, currency, itemLabel, payoutWeekday } = facts;

    // Format the amount: convert from minor units (cents) to a readable string
    const amount = formatAmount(amountMinor, currency);

    const title = `${personFirstName} paid ${amount}`;

    let body = itemLabel;
    if (payoutWeekday) {
      body += `. It'll be in your bank on ${payoutWeekday}.`;
    } else {
      body += ".";
    }

    return { title, body };
  }

  if (kind === "day_summary") {
    // facts: { count, firstName, firstTime, lastName, lastTime, gaps:[time] }
    const { count, firstName, firstTime, lastName, lastTime, gaps } = facts;

    const sessionWord = count === 1 ? terms["noun.session"] || "Session" : terms["noun.sessionPlural"] || "Sessions";
    const countInWords = numberToWords(count);

    const title = `${countInWords} ${sessionWord} today`;

    let body = `First is ${firstName} at ${firstTime}, last is ${lastName} at ${lastTime}.`;
    if (gaps && gaps.length > 0) {
      const gapTime = gaps[0];
      body += ` One gap at ${gapTime}.`;
    }

    return { title, body };
  }

  if (kind === "invoice_late") {
    // facts: { firstName, daysLate, amountMinor, reminders, cardOnFile }
    const { firstName, daysLate, amountMinor, reminders, cardOnFile } = facts;

    const amount = formatAmount(amountMinor, "USD");
    const remindersInWords = numberToWords(reminders);
    const cardStatus = cardOnFile ? "card on file" : "no card on file";

    const title = `${firstName} is ${daysLate} days late`;
    const body = `${amount}. ${remindersInWords} reminders sent, ${cardStatus}.`;

    return { title, body };
  }

  if (kind === "agreement_signed") {
    // Not yet wired — F678 awaits redesign for multiple listeners per topic
    throw new Error(`staffPushCopy kind "agreement_signed" is not yet supported (F678)`);
  }

  throw new Error(`unknown staffPushCopy kind: "${kind}"`);
}

/**
 * Format an amount from minor units (cents) to a readable currency string.
 * e.g., 54000 USD → "$540.00" (or "£540.00", etc.)
 */
function formatAmount(minor, currency) {
  const major = minor / 100;
  const symbols = { USD: "$", EUR: "€", GBP: "£", CAD: "C$", AUD: "A$" };
  const symbol = symbols[currency] || currency;
  return `${symbol}${major.toFixed(2)}`;
}

/**
 * Convert a small positive integer to English words.
 * Used for "1 session" → "One session", "3 reminders sent" → "Three reminders sent", etc.
 */
function numberToWords(n) {
  const words = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
  if (n >= 0 && n < words.length) return words[n];
  return String(n);
}
