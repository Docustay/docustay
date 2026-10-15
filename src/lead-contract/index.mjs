// @ts-check
// THE LEAD CONTRACT — ONE RULE SET FOR THE PUBLIC LEAD FORM, OWNED BY PLATFORM.
//
// Two hand-written rule sets drifted apart (the website's own validate() and publicLeads.mjs), and a
// the platform change that required a field the site did not always send turned every submission into
// "[object Object]". This file is the single source: the platform's POST /api/public/leads validates with
// `parseLead`, and the website (example-practice-site) imports a byte-identical vendored copy of THIS
// FILE for its Superforms form. Neither repo has a remote, so the website cannot `npm install` it;
// `scripts/sync-lead-contract.mjs` in the site copies it, and both repos run `fixtures.json` through
// `parseLead` on every build (test/lead_contract.test.mjs here, scripts/check-lead-contract.mjs there).
//
// ★ Only imports `zod` (same major on both sides — Zod 4). No Node APIs, no browser APIs: it runs in
//   the platform's Node, in the site's SvelteKit server, and in the browser bundle.
// ★ Messages are plain English and are the ONLY place visitors' error text lives.

import { z } from "zod";

export const DAYS = /** @type {const} */ (["weekdays", "weekends", "any"]);
export const WINDOWS = /** @type {const} */ (["morning", "afternoon", "evening"]);

const MESSAGE_MAX = 5000;

export const MSG = Object.freeze({
  nameRequired: "Tell us your name.",
  nameLong: "That name is too long — please shorten it.",
  emailRequired: "Leave an email so we can reach you.",
  emailBad: "That email doesn't look right — please check it.",
  phoneRequired: "Leave a phone number so we can reach you.",
  phoneBad: "That phone number doesn't look right — please include the area code.",
  daysBad: "Days must be weekdays, weekends or any day.",
  windowBad: "Time of day must be morning, afternoon or evening.",
  messageLong: `That message is a bit long — please keep it under ${MESSAGE_MAX.toLocaleString("en-US")} characters.`,
  serviceBad: "Please pick one of the listed options.",
  tooMany: "You've sent that a few times already — give it a moment, or call or text us instead.",
  fallback: "Something went wrong sending this — please call or text (510) 555-0100.",
});

/**
 * ★ JS mirror of `keystone.normalise_phone_e164` (db migrations 0122 + 0123). The database trigger is
 *   the authority for what is STORED; this mirror exists so the form can refuse, with a friendly
 *   message, exactly what the database would refuse with a constraint error. Returns the E.164
 *   string, or null when the input cannot be confidently canonicalised.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function normalisePhone(raw) {
  if (typeof raw !== "string") return null;
  let v = raw.trim();
  if (!v) return null;
  if (!/^[+()\-.\s0-9]+$/.test(v)) return null; // letters, "ext", prose — never harvest digits
  if (/^00[0-9]/.test(v)) v = "+" + v.slice(2);
  const digits = v.replace(/[^0-9]/g, "");
  if (!digits) return null;
  let out;
  if (v.startsWith("+")) out = "+" + digits;
  else if (digits.length === 10) out = "+1" + digits;
  else if (digits.length === 11 && digits.startsWith("1")) out = "+" + digits;
  else return null;
  return /^\+[1-9][0-9]{7,14}$/.test(out) ? out : null;
}

const emailShape = z.email();

/** @param {string} msg */
const reqString = (msg) => z.string({ error: () => msg }).trim().min(1, msg);

/**
 * Optional free text: absent/blank is "".
 * @param {number} max
 * @param {string} [tooLong]
 */
const optText = (max, tooLong) => z.string().trim().max(max, tooLong ?? `Please keep this under ${max} characters.`).default("");

/**
 * The fields a VISITOR sees or edits. This is the exact set of `name=` attributes the website's form
 * renders (checked by scripts/check-lead-contract.mjs on the site) — add a field here and that check
 * fails until the form renders it.
 */
export const leadFormSchema = z.object({
  name: reqString(MSG.nameRequired).max(120, MSG.nameLong),
  email: reqString(MSG.emailRequired)
    .max(254, MSG.emailBad)
    .refine((v) => emailShape.safeParse(v).success, MSG.emailBad),
  phone: reqString(MSG.phoneRequired).refine((v) => normalisePhone(v) !== null, MSG.phoneBad),
  serviceId: optText(100),
  serviceText: optText(200),
  bestTimeDays: z.string().trim().default("").refine((v) => v === "" || DAYS.includes(/** @type {any} */ (v)), MSG.daysBad),
  bestTimeWindow: z.string().trim().default("").refine((v) => v === "" || WINDOWS.includes(/** @type {any} */ (v)), MSG.windowBad),
  message: optText(MESSAGE_MAX, MSG.messageLong),
  textConsent: z.boolean().default(false),
  website: optText(500), // honeypot — real visitors never fill it
  idempotencyKey: optText(100),
});

export const ATTRIBUTION_KEYS = /** @type {const} */ ([
  "gclid", "gbraid", "wbraid",
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "landing_page", "referrer",
]);

const attributionShape = Object.fromEntries(ATTRIBUTION_KEYS.map((k) => [k, z.string().trim().max(500).default("")]));

/** Everything the platform's POST /api/public/leads accepts: the visitor's fields + attribution + source. */
const leadSchema = leadFormSchema.extend({
  ...attributionShape,
  source: z.string().trim().max(40).default("website"),
});

export const LEAD_FORM_FIELDS = /** @type {string[]} */ (Object.keys(leadFormSchema.shape));
export const LEAD_FIELDS = /** @type {string[]} */ (Object.keys(leadSchema.shape));

/**
 * Turns whatever a caller sent into the flat shape `leadSchema` expects. Tolerant on purpose: this is a
 * public door, and an old cached page or a hand-built client must not 400 for a shape change.
 *  - `null` and non-strings are dropped, so a missing field gets its "Tell us…" message, not Zod's.
 *  - the legacy nested `bestTime: { days, window }` becomes `bestTimeDays` / `bestTimeWindow`.
 *  - `textConsent` accepts true / "true" / "on" (an unchecked HTML checkbox is simply absent).
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
function normaliseLeadInput(raw) {
  /** @type {Record<string, unknown>} */
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? /** @type {any} */ (raw) : {};
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const key of LEAD_FIELDS) {
    if (key === "textConsent") continue;
    const v = src[key];
    if (typeof v === "string") out[key] = v;
  }
  const bt = src.bestTime && typeof src.bestTime === "object" ? /** @type {any} */ (src.bestTime) : null;
  if (bt) {
    if (out.bestTimeDays === undefined && typeof bt.days === "string") out.bestTimeDays = bt.days;
    if (out.bestTimeWindow === undefined && typeof bt.window === "string") out.bestTimeWindow = bt.window;
  }
  const tc = src.textConsent;
  out.textConsent = tc === true || tc === "true" || tc === "on";
  return out;
}

/**
 * @typedef {z.infer<typeof leadSchema>} Lead
 * @param {unknown} raw
 * @returns {{ ok: true, data: Lead } | { ok: false, fields: Record<string, string> }}
 */
export function parseLead(raw) {
  const result = leadSchema.safeParse(normaliseLeadInput(raw));
  if (result.success) return { ok: true, data: result.data };
  /** @type {Record<string, string>} */
  const fields = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!(key in fields)) fields[key] = issue.message;
  }
  return { ok: false, fields };
}
