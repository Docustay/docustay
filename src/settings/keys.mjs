// P1.1 — THE CLOSED SET OF TENANT SETTING KEYS, AND THE SHAPE OF EACH ONE'S VALUE.
//
import { TERM_KEYS } from '../terminology/keys.mjs';
import { TEMPLATE_KEYS } from '../fields/layers.mjs';
// ★ P6.63 — the shipped client-app surfaces, so `client_app.surfaces_off` is validated against the
//   real rows rather than a second hand-written copy of their keys.
import { SURFACES } from '../app/surfaces.mjs';
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ P6.29 — THE NO-SHOW VALIDATOR, AND **ONLY** THE VALIDATOR. READ THE NEXT PARAGRAPH BEFORE
//     "TIDYING" THIS BY ALSO IMPORTING THE KEY.
//
//   This import closes a CYCLE: keys → attendance → settings/writes → keys. ESM tolerates that for
//   a FUNCTION DECLARATION, which is initialised at LINK time and is therefore already callable
//   when a partially-evaluated module reads it. It does NOT tolerate it for a `const`.
//
//   ★★★ [EXECUTED 2026-09-15] `NO_SHOW_SETTING_KEY` was imported here too, and it worked — right up
//       until something imported `attendance.mjs` FIRST:
//           ReferenceError: Cannot access 'NO_SHOW_SETTING_KEY' before initialization
//       …thrown from this file, at the line that builds the catalogue. The direction of entry
//       decided whether the whole settings layer loaded. It passed every check I ran until I ran
//       the one that entered from the other side, which is the point: **a cycle that works is a
//       cycle that works in the order you happened to test.**
//
//   ★★ SO THE KEY IS A LITERAL HERE, AND THE DUPLICATION IS MADE SAFE BY A GATE RATHER THAN BY
//      MEMORY: `db/gates/p6_settings_section.mjs` asserts this string IS `NO_SHOW_SETTING_KEY` and
//      IS in `ALL_SETTING_KEYS`. A drift is a failing gate, not a setting that silently stops
//      resolving. ★ Two spellings caught by a check beats one spelling that cannot be loaded.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { noShowChargePercent } from '../booking/attendance.mjs';
// ★ A9.1 — the automation flags are DERIVED from the catalogue so the two cannot drift. The
//   catalogue imports nothing, so this adds no cycle.
import { AUTOMATIONS, automationSettingKey } from '../automations/catalogue.mjs';

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE SHAPE/SET SPLIT, AND WHY IT IS THE OPPOSITE WAY ROUND FROM TOPICS.
//     `db/migrations/0065_tenant_setting.sql` enforces the SHAPE of a key in the database
//     (`^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$`) and leaves the SET to this file — exactly the split
//     the topic catalogue uses (0016, restated at 0023/0054/0064).
//   ★★ BUT THE REASON DIFFERS, AND THE DIFFERENCE IS THE POINT. Adding a TOPIC is a migration
//      because a topic is a contract with consumers — `F68` measured 17 topics declared and never
//      emitted, and `P8.4` exists to clean that up. A SETTING has no consumer contract: an unwritten
//      key is simply an unset setting, and a tenant-facing product adds settings constantly.
//      **So a new setting is an edit to this file. A new topic is a migration.** Do not "fix" one
//      to match the other; 0065's COMMENT ON TABLE says the same thing at the database.
//
// ★★★ AND THE SET IS SMALL ON PURPOSE. Every key below is written by a NAMED item in
//     `BUILD-KS2.md`. Nothing speculative. A vocabulary padded with keys nothing writes is the
//     settings-layer version of `F68`, and it would be indistinguishable from one that is complete.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** ★ Thrown by `setSetting()`. Mirrors `TopicViolation` — a refusal with a reason, never a silent
 *  no-op, because a setting that does not store is a promise to the operator that is not kept. */
export class SettingViolation extends Error {
  constructor(message) { super(message); this.name = 'SettingViolation'; }
}

// ── value validators ────────────────────────────────────────────────────────────────────────
// ★ Each returns null when the value is acceptable, or a SENTENCE saying what is wrong. The
//   sentence reaches the operator, so it is written for them and not for a log.
const nonEmptyString = (max) => (v) =>
  typeof v !== 'string' ? 'must be text'
    : v.trim() === '' ? 'must not be blank'
      : v.length > max ? `must be ${max} characters or fewer`
        : null;

// ★★ A COLOUR ENTERS AT LAYER 1 AND NOWHERE ELSE (§D2, U6). This is the one value in the whole
//    store that becomes a CSS custom property, so it is the one place a malformed string would end
//    up in a stylesheet. Accept the two forms tokens.css actually uses and refuse everything else.
const colour = (v) =>
  typeof v !== 'string' ? 'must be text'
    : /^#[0-9a-fA-F]{6}$/.test(v) || /^oklch\([^)]+\)$/.test(v) ? null
      : 'must be a 6-digit hex like #5B3CC4, or an oklch(...) value';

const oneOf = (allowed) => (v) =>
  typeof v !== 'string' ? 'must be text'
    : allowed.includes(v) ? null
      : `must be one of ${allowed.join(', ')}`;

// ★★ TERMINOLOGY IS ONE KEY HOLDING A MAP, NOT ONE KEY PER TERM. `navTree(terms)`
//    (`src/nav/sections.mjs:250`) already takes a single object and resolves `terms[key] || fallback`
//    — so a map is the shape the consumer wants, and a key-per-term would be a second spelling of
//    the same idea. ★ P4's bucket rule is enforced here: values are LABELS, and a label may not
//    look like an identifier, because a renamed label must never become a renamed permission key.
const templateList = (v) => {
  if (!Array.isArray(v)) return 'must be a list of vertical pack keys';
  for (const k of v) {
    if (!TEMPLATE_KEYS.includes(k)) {
      return `"${k}" is not a vertical pack — the shipped ones are ${TEMPLATE_KEYS.join(', ')}`;
    }
  }
  return null;
};

// ★★ P2.5 — minutes, positive, and bounded by a fortnight. The upper bound is not tidiness: a
//    reminder scheduled further out than most bookings are made would simply never fire, and a
//    setting that silently does nothing is worse than one that refuses.
//  ★ NULL is not accepted here. "No reminder" is said per-booking (`reminderMinutesBefore: null`),
//    not by blanking the practice default — a blank default would silently disable reminders for
//    every future booking, which is a much larger decision than the screen would appear to offer.
const reminderMinutes = (v) =>
  typeof v !== 'number' || !Number.isInteger(v) ? 'must be a whole number of minutes'
    : v <= 0 ? 'must be more than zero — to switch a reminder off, set it off on the booking itself'
      : v > 20160 ? 'must be two weeks (20160 minutes) or less, or it would never fire'
        : null;

// ★★★ BOOKING OVERHAUL, 29 Sep 2026 — THE THREE REMINDER OFFSETS, EACH ITS OWN TOGGLE. A closed set
//   of exactly three minute values (48h/24h/1h, matching src/booking/reminders.mjs's own
//   DEFAULT_REMINDER_OFFSETS) — an unrecognised minutes value is refused rather than silently
//   accepted and never scheduled, the same "a setting that silently does nothing is worse than one
//   that refuses" reasoning `reminderMinutes` above states.
const REMINDER_OFFSET_MINUTES = [2880, 1440, 60];
const reminderOffsets = (v) => {
  if (!Array.isArray(v)) return 'must be an array of { minutes, enabled }';
  for (const o of v) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return 'each entry must be an object with minutes and enabled';
    if (!REMINDER_OFFSET_MINUTES.includes(o.minutes)) {
      return `minutes must be one of ${REMINDER_OFFSET_MINUTES.join(', ')} — got ${JSON.stringify(o.minutes)}`;
    }
    if (typeof o.enabled !== 'boolean') return 'enabled must be true or false';
  }
  return null;
};

// ★★ P2.6 — payment terms in days. Zero IS meaningful here and is accepted: "due on receipt" is a
//    real commercial term, unlike a zero-minute reminder which would just be a magic off-switch.
//  ★ The ceiling is a year. Terms longer than that are not terms, they are a mistyped field, and an
//    invoice quietly due in 2029 is not something anybody would notice until it was far too late.
const paymentTerms = (v) =>
  typeof v !== 'number' || !Number.isInteger(v) ? 'must be a whole number of days'
    : v < 0 ? 'must not be negative — an invoice cannot be due before it is issued'
      : v > 365 ? 'must be a year (365 days) or less'
        : null;

// ★★ P8.8 — how many days a sent signature request stays live. ★ `0` is LEGAL and means "never
//    lapses"; refusing it would delete the answer a practice that does not want deadlines needs,
//    and would make the only way to express it "leave the key unset", which is indistinguishable
//    from never having opened the screen.
// ★★ P6.63 — the surfaces this practice has switched OFF in the client app. A closed set, checked
//    against the shipped rows, so a typo is a refusal with a readable sentence rather than a stored
//    value that quietly hides nothing.
const surfaceKeyList = (v) => {
  if (!Array.isArray(v)) return 'must be a list of client-app surface keys';
  const known = SURFACES.map((s) => s.key);
  for (const k of v) {
    if (!known.includes(k)) return `"${k}" is not a client-app surface — the shipped ones are ${known.join(', ')}`;
  }
  return null;
};

// ★ lead-intake brief, 30 Sep 2026 — the practice's own list of "what are you interested in"
//   choices for the public lead form. [MEASURED, recon] no real `keystone.service` row matches
//   the six the marketing site lists (Docustay has exactly one public_bookable service, "Single
//   Session (Life Coaching)") — a lead's interest is not the same fact as a bookable service
//   (no duration, no price), so this is its own small settings-backed list rather than either
//   hard-coding the six in code or inventing five fake bookable services to hold them.
const leadInterestList = (v) => {
  if (!Array.isArray(v) || v.length === 0) return 'must be a non-empty list of {id, name}';
  const ids = new Set();
  for (const row of v) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return 'each entry must be an object {id, name}';
    if (typeof row.id !== 'string' || !row.id.trim()) return 'each entry needs a non-empty "id"';
    if (typeof row.name !== 'string' || !row.name.trim()) return 'each entry needs a non-empty "name"';
    // ★ QUEUE §4 — the enquiry's chosen service sets the lead's PROGRAM: an optional program id on the entry.
    if (row.programId !== undefined && row.programId !== null && (typeof row.programId !== 'string' || !row.programId.trim())) return '"programId" must be a program id, or empty';
    if (ids.has(row.id)) return `"${row.id}" is used more than once — every id must be unique`;
    ids.add(row.id);
  }
  return null;
};

// ★ C1.9 — required fields per record type. Object with record types as keys, arrays of field names as values.
const requiredFieldsMap = (v) => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return 'must be an object of record type → field names';
  const VALID_RECORD_TYPES = ['person', 'account', 'invoice', 'document', 'service', 'booking'];
  for (const [recordType, fields] of Object.entries(v)) {
    if (!VALID_RECORD_TYPES.includes(recordType)) {
      return `"${recordType}" is not a record type — valid ones are ${VALID_RECORD_TYPES.join(', ')}`;
    }
    if (!Array.isArray(fields)) {
      return `fields for "${recordType}" must be an array of field names`;
    }
    if (!fields.every(f => typeof f === 'string')) {
      return `fields for "${recordType}" must all be strings`;
    }
  }
  return null;
};

// ★ PART 4 [TY, RULED 23 Sep 2026] — WORKSTREAM 12's `nav.groups_off` setting and its validator are
//   gone. `shape` is a real `tenant` column (migration 0343), written by its own dedicated route
//   (`POST /api/settings/practice/shape`, `src/routes/settings.mjs`), not through this key/value
//   store.

const terminologyMap = (v) => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return 'must be an object of term → label';
  for (const [k, label] of Object.entries(v)) {
    // ★★★ P1.5 CLOSED THE SET. P1.1 shipped this as a SHAPE check, which accepted any dotted
    //     string — so `userType.clinetPlural` saved happily and renamed nothing, and the operator
    //     would wait forever for a word that was never going to appear. `TERM_KEYS` is DERIVED from
    //     the real nav rows, so it cannot drift from what the product actually renders.
    if (!TERM_KEYS.includes(k)) {
      return `"${k}" is not a term key — the renameable ones are ${TERM_KEYS.join(', ')}`;
    }
    if (typeof label !== 'string' || label.trim() === '') return `the label for "${k}" must not be blank`;
    if (label.length > 60) return `the label for "${k}" must be 60 characters or fewer`;
    // ★★★ THE BUCKET RULE, ENFORCED AT THE STORE. A label containing a dot is an IDENTIFIER
    //     wearing a label's clothes — and the legacy i18n layer was deleted precisely because a
    //     dotted token reached the screen (`~/example-simple-app/CLAUDE.md §2.7`).
    if (label.includes('.')) return `the label for "${k}" must not contain a dot — that is an identifier, not a label`;
  }
  return null;
};

// ── Stage 11 (CT-F02) value validators ──────────────────────────────────────────────────────
// ★ Each returns null when the value is acceptable, or a SENTENCE, matching the pattern above.
const nullableCount = (v) =>
  v === null ? null
    : typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1 ? 'must be null, or a whole number of 1 or more'
      : null;

const nullableCents = (v) =>
  v === null ? null
    : typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 ? 'must be null, or a whole number of cents, 0 or more'
      : null;

const nullableEmail = (v) =>
  v === null ? null
    : typeof v !== 'string' || v.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
      ? 'must be null, or a valid email address, 254 characters or fewer'
      : null;

// ★ Batch A — the website origins allowed to post this organisation's public lead form (CORS and the cross-site guard), one list per organisation instead of a typed-in list.
const originList = (v) => {
  if (!Array.isArray(v)) return 'must be a list of website addresses like https://example.com';
  for (const o of v) { if (typeof o !== 'string' || !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(o)) return `"${o}" is not a website address like https://example.com (https, no path)`; }
  return v.length > 20 ? 'at most 20 addresses' : null;
};
const emailList = (v) => {
  if (!Array.isArray(v)) return 'must be a list of email addresses';
  for (const e of v) { if (typeof e !== 'string' || e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return `"${e}" is not an email address`; }
  return v.length > 20 ? 'at most 20 addresses' : null;
};
const bool = (v) => (typeof v === 'boolean' ? null : 'must be true or false');

const quietHours = (v) => {
  if (v === null) return null;
  if (typeof v !== 'object' || Array.isArray(v)) return 'must be null, or an object with "from" and "to"';
  const objectKeys = Object.keys(v);
  if (objectKeys.length !== 2 || !objectKeys.includes('from') || !objectKeys.includes('to')) {
    return 'must be null, or an object with exactly "from" and "to"';
  }
  const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (typeof v.from !== 'string' || !timeRe.test(v.from)) return '"from" must be a time like "21:00"';
  if (typeof v.to !== 'string' || !timeRe.test(v.to)) return '"to" must be a time like "07:00"';
  if (v.from === v.to) return '"from" and "to" must not be the same time';
  return null;
};

// ── Stage 15 (F08 §6) value validators ──────────────────────────────────────────────────────
// ★ Each returns null when the value is acceptable, or a SENTENCE, matching the pattern above.
const invoicePrefix = (v) =>
  typeof v !== 'string' ? 'must be text'
    : v.length > 8 ? 'must be 8 characters or fewer'
      : /^[A-Za-z0-9-]*$/.test(v) ? null
        : 'must contain only letters, numbers and hyphens';

const reminderDaysList = (v) => {
  if (!Array.isArray(v)) return 'must be a list of whole numbers of days';
  if (v.length > 6) return 'must have 6 values or fewer';
  for (const n of v) {
    if (typeof n !== 'number' || !Number.isInteger(n)) return 'each value must be a whole number';
    if (n < -30 || n > 60) return 'each value must be between -30 and 60';
  }
  if (new Set(v).size !== v.length) return 'must not repeat the same day twice';
  return null;
};

const tipping = (v) => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return 'must be an object with "enabled" and "presets"';
  const objectKeys = Object.keys(v);
  if (objectKeys.length !== 2 || !objectKeys.includes('enabled') || !objectKeys.includes('presets')) {
    return 'must be an object with exactly "enabled" and "presets"';
  }
  if (typeof v.enabled !== 'boolean') return '"enabled" must be true or false';
  if (!Array.isArray(v.presets)) return '"presets" must be a list of percentages';
  if (v.presets.length < 1 || v.presets.length > 4) return '"presets" must have 1 to 4 values';
  for (const p of v.presets) {
    if (typeof p !== 'number' || !Number.isInteger(p) || p < 1 || p > 100) {
      return 'each preset must be a whole number between 1 and 100';
    }
  }
  return null;
};

const dunning = (v) => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    return 'must be an object with "retries", "days" and "pause_after"';
  }
  const objectKeys = Object.keys(v);
  if (objectKeys.length !== 3 || !objectKeys.includes('retries') || !objectKeys.includes('days')
    || !objectKeys.includes('pause_after')) {
    return 'must be an object with exactly "retries", "days" and "pause_after"';
  }
  if (typeof v.retries !== 'number' || !Number.isInteger(v.retries) || v.retries < 1 || v.retries > 6) {
    return '"retries" must be a whole number between 1 and 6';
  }
  if (typeof v.days !== 'number' || !Number.isInteger(v.days) || v.days < 1 || v.days > 30) {
    return '"days" must be a whole number between 1 and 30';
  }
  if (typeof v.pause_after !== 'boolean') return '"pause_after" must be true or false';
  return null;
};

const minorCurrencyAmount = (v) =>
  typeof v !== 'number' || !Number.isInteger(v) ? 'must be a whole number of cents'
    : v < 0 ? 'must be 0 or more'
      : null;

// ★ Stripe's own descriptor rule — the refusal names it rather than inventing a platform opinion,
//   because this is an external constraint, not a Keystone one.
const statementDescriptor = (v) =>
  typeof v !== 'string' ? 'must be text'
    : v.length < 5 || v.length > 22 ? 'must be 5 to 22 characters — Stripe requires a statement descriptor in that range'
      : /^[A-Za-z0-9 .\-]+$/.test(v) ? null
        : 'must contain only letters, numbers, spaces, periods and hyphens — Stripe will reject anything else';

const gtmContainerId = (v) =>
  v === null ? null
    : typeof v !== 'string' ? 'must be null or a GTM container ID like GTM-AB12CD'
      : /^GTM-[A-Z0-9]{4,10}$/.test(v) ? null
        : 'must be null or a GTM container ID like GTM-AB12CD';

// ★ P3.S14 — a Stripe object id, or null before the first one exists. Not format-checked against
//   Stripe's own prefixes (`pmc_…`, `irt_…`) — a stored id came from a Stripe response, never typed
//   in by a person, so the only real refusal here is "not text at all".
const nullableIdString = (v) =>
  v === null ? null
    : typeof v !== 'string' || v.trim() === '' ? 'must be null, or a non-empty string'
      : null;

// ★ P3.S14 — the practice's chosen Stripe payment method types (e.g. "card", "us_bank_account").
//   Not checked against a closed list here: Stripe's own eligible-types list differs by connected
//   account and is what `setPaymentMethodSettings` checks `enabled` against at write time.
const paymentMethodTypeList = (v) => {
  if (!Array.isArray(v)) return 'must be a list of Stripe payment method type strings';
  for (const t of v) {
    if (typeof t !== 'string' || t.trim() === '') return 'each value must be a non-empty payment method type string';
  }
  return null;
};

// ★ Stage 20 task 20.50 — lead scoring weights. Object with fact types as keys, positive integers as values.
const leadScoringWeights = (v) => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return 'must be an object of fact type → weight';
  const FACT_TYPES = ['email_click', 'email_opened', 'funnel_page_view', 'funnel_conversion', 'booking_created', 'consent_marketing', 'document_interaction'];
  for (const [factType, weight] of Object.entries(v)) {
    if (!FACT_TYPES.includes(factType)) {
      return `"${factType}" is not a fact type — valid ones are ${FACT_TYPES.join(', ')}`;
    }
    if (typeof weight !== 'number' || !Number.isInteger(weight) || weight < 0) {
      return `weight for "${factType}" must be a whole number 0 or more`;
    }
  }
  return null;
};

// ★★★ F08 §6 — the ruled defaults for the eight money keys just above, exported so readers call
//     `getSetting(tx, key, MONEY_DEFAULTS[key])` rather than re-typing the ruling at each call site.
//   ★★ `money.statement_descriptor` HAS NO ENTRY HERE, ON PURPOSE. There is no platform-invented
//      descriptor to fall back to — Stripe's own default (the platform/statement name) applies until
//      a practice sets one, and inventing a Keystone default would silently override that. Because
//      `MONEY_DEFAULTS['money.statement_descriptor']` is `undefined`, `getSetting`'s own
//      `fallback = null` parameter default takes over — absent stays `null`, never `''`.
export const MONEY_DEFAULTS = Object.freeze({
  'money.invoice_prefix': '',
  'money.reminder_days': [-7, 0, 1, 3],
  'money.tipping': { enabled: false, presets: [10, 15, 20] },
  'money.part_payments': false,
  'money.dunning': { retries: 3, days: 10, pause_after: true },
  'money.ach_nudge_minimum': 50000,
  'money.bnpl_minimum': 20000,
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE CLOSED SET. Every key names the item that writes it. An entry with no item is a key
//     nothing will ever set, and this file refuses to carry one.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
export const SETTING_KEYS = Object.freeze({
  // ── practice ──────────────────────────────────────────────────────────────────────────────
  'practice.name':            { validate: nonEmptyString(120), item: 'P6.60' },
  // Part 30 item 5 — when true every staff member must have two-step sign-in set up before anything but its setup screens will answer (src/auth/requireTwoStep.mjs)
  'security.require_two_step': { validate: bool, item: 'P30.5' },
  // Run 7 part 6 — sign a person out after this many minutes without activity (0 = never, the default; optional). Read by src/auth/idleSignOut.mjs
  // Launch plan Part 3 (13 Oct 2026) — a Docustay workspace's separate billing email: receipts and billing emails go to it as well as to the owners. Empty = none. Written by src/product/docustayBillingContact.mjs
  'billing.email': { validate: (v) => (v === '' || (typeof v === 'string' && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) ? null : 'must be an email address, or empty to remove it'), item: 'LAUNCH.3' },
  'security.idle_minutes': { validate: (v) => (Number.isInteger(v) && v >= 0 && v <= 1440 ? null : 'a whole number of minutes from 0 to 1440'), item: 'R7.6' },
  // Shared document engine (6 Oct 2026, QUEUE-NOW item 5/7) — when true this practice writes and sends documents through the shared engine's editor and five-step flow; default off, one switch to roll back. Read by the documents screens (webreact) and src/documents/engine.
  'authoring.shared_engine': { validate: bool, item: 'ENGINE' },
  // ★★ P5.7 / OPEN-QUESTION Q2 — HELP. `src/cutover/mobileBridge.mjs:44-51` already makes a
  //    supportPhone MANDATORY on the forced-update gate, because *"a non-dismissable prompt with no
  //    way to reach a human is a locked door."* The CRM applies no such rule to itself. ONE value,
  //    TWO surfaces, read from here — not a second declaration.
  'practice.support_phone':   { validate: nonEmptyString(40), item: 'P5.7' },
  // ★★★ [TY, RULED 1 Oct 2026] SITE-READINESS BRIEF, PART 3 — a practice's OWN privacy policy and
  //   terms of service, shown alongside the platform's own in the client portal footer (PortalProfile.jsx)
  //   and the document-signing page. Unset (the default for every tenant until they set one) means
  //   "this practice has not given its own link" — the portal falls back to the platform's policies
  //   alone, never a broken link. Docustay's own values are seeded by migration 0556, pointing at
  //   example.com/privacy and /terms — the site built and deployed in this same brief.
  'practice.privacy_url':     { validate: nonEmptyString(500), item: 'P-LEGAL-1' },
  'practice.terms_url':       { validate: nonEmptyString(500), item: 'P-LEGAL-1' },

  // ── branding ──────────────────────────────────────────────────────────────────────────────
  // ★ Until a tenant uploads one, the login panel falls back to their NAME in text. KS-5.6:
  //   **never substitute Keystone's mark for a tenant's.**
  'branding.logo_url':        { validate: nonEmptyString(500), item: 'P6.61' },
  // ★ TY, 2026-09-16 — the SIDEBAR mark, separate from the sign-in logo (`branding.logo_url`).
  //   Both hold `ks-object:<key>` pointers written ONLY by POST /api/settings/branding/logo.
  'branding.sidebar_logo':    { validate: nonEmptyString(500), item: 'P6.61' },
  // ★★★ `branding.primary_colour` WAS HERE AND IS GONE. [TY, RULED — S8] The product has two
  //     colours and a tenant does not pick them: #7F7BF5 periwinkle is ACTION, #90A9CB blue-grey is
  //     STRUCTURAL, and every ramp step derives from those two. ★★ It is named here, in a comment,
  //     because it is the one thing a future session is most likely to "restore" on the reasoning
  //     that a branding section obviously ought to have a colour in it. It ought not.
  //     Pinned by `db/gates/s8_branding_colour_removed.mjs`.

  // ── terminology ───────────────────────────────────────────────────────────────────────────
  // ★★★ THE STORE `navTree(terms)` HAS BEEN WAITING FOR. [MEAS] its single call site passes `{}`
  //     (`src/routes/index.mjs:164`) and its own comment calls the result *"a real live defect."*
  'terminology.overrides':    { validate: terminologyMap, item: 'P1.5' },

  // ── field layers (P2.2) ───────────────────────────────────────────────────────────────────
  // ★★ WHICH VERTICAL PACKS THIS PRACTICE USES. A SELECTION, not a schema — the columns exist for
  //    every tenant; the packs decide which PANELS render. ★ Validated against the closed
  //    `TEMPLATE_KEYS`, so selecting a pack nobody implemented is refused at the write rather than
  //    rendering nothing and looking like a broken setting.
  'fields.templates':         { validate: templateList, item: 'P2.2' },

  // ── required fields (C1.9) ─────────────────────────────────────────────────────────────────
  // ★★★ C1.9 — WHICH FIELDS ARE REQUIRED ON EACH RECORD TYPE. A JSON object keyed by record type,
  //     each holding an array of field names that are required for that practice. Defaults: person
  //     needs a name and ONE of email/mobile; account needs a name. A field cannot be made required
  //     if the role creating the record cannot see it, and certain fields (first_name for person,
  //     name for account) can never be turned off because the record is unusable without them.
  'fields.required':          { validate: requiredFieldsMap, item: 'C1.9' },

  // ── engagements ───────────────────────────────────────────────────────────────────────────
  // ★★★ P2.5 — HOW LONG BEFORE A SESSION THE PRACTICE REMINDS PEOPLE. The `booking.reminder`
  //     EMAIL TEMPLATE has existed since P18 and nothing had ever sent it; this value, the
  //     `reminder_minutes_before` column and `src/booking/reminders.mjs` are what make it real.
  //   ★★ IT IS READ ONCE, WHEN A BOOKING IS CREATED, AND STORED ON THE ROW. A booking that asked
  //      this setting at fire time would have its behaviour changed by an edit made afterwards — so
  //      the row would no longer record what the client was promised. ★ That also means changing it
  //      affects FUTURE bookings only, which is the honest behaviour and what P6.29's screen must say.
  'booking.reminder_minutes': { validate: reminderMinutes, item: 'P2.5' },
  // ★ BOOKING OVERHAUL, 29 Sep 2026 — supersedes the single `booking.reminder_minutes` default for
  //   NEW bookings (which still honour an explicit per-booking `null` opt-out unchanged): instead of
  //   one offset, the practice enables any of three fixed ones. See src/booking/reminders.mjs's own
  //   header for the full reasoning and src/queue/tasks.mjs's scheduleReminderFrom for the scheduler.
  'booking.reminder_offsets': { validate: reminderOffsets, item: 'P2.5' },

  // ── booking policy ────────────────────────────────────────────────────────
  // ★★★ BOOKING POLICY KEYS — client booking controls, notice and window enforcement, payment mode
  //     and late-cancellation rules. Each key is practice default with per-service override stored
  //     on booking_policy (migration 0355). policyFor(tx, tenantId, serviceId) returns the merged
  //     practice+service policy, service winning. Enforcement is SERVER-SIDE on the route.
  'booking.client_may_book': { validate: (v) => (typeof v === 'boolean' ? null : 'must be true or false'), item: 'C1.1' },
  'booking.client_may_reschedule': { validate: (v) => (typeof v === 'boolean' ? null : 'must be true or false'), item: 'C1.1', hasReach: true },
  // ★ credits defect 15 — warn when a package is down to this many sessions (level-triggered; see due.mjs entitlement_running_low)
  'credits.running_low_at': { validate: (v) => (typeof v !== 'number' || !Number.isInteger(v) ? 'must be a whole number' : v < 1 || v > 50 ? 'must be between 1 and 50' : null), item: '12.3' },
  'booking.client_may_cancel': { validate: (v) => (typeof v === 'boolean' ? null : 'must be true or false'), item: 'C1.1', hasReach: true },
  'booking.reschedule_notice_minutes': { validate: reminderMinutes, item: 'C1.1', hasReach: true },
  'booking.late_cancel_behaviour': { validate: oneOf(['free', 'credit_back', 'charge_percent']), item: 'C1.1', hasReach: true },
  'booking.late_cancel_charge_percent': {
    validate: (v) => (typeof v !== 'number' || !Number.isInteger(v) ? 'must be a whole number'
      : v < 0 || v > 100 ? 'must be between 0 and 100'
        : null),
    item: 'C1.1',
    hasReach: true,
  },
  'booking.card_required_at_booking': { validate: (v) => (typeof v === 'boolean' ? null : 'must be true or false'), item: 'C1.1' },
  'booking.card_kept_on_file': { validate: (v) => (typeof v === 'boolean' ? null : 'must be true or false'), item: 'C1.1' },
  'booking.cancel_requires_contact': { validate: (v) => (typeof v === 'boolean' ? null : 'must be true or false'), item: 'C1.1', hasReach: true },
  'booking.policy_text': {
    validate: (v) => (typeof v !== 'string' || v.length > 2000
      ? 'must be text, 2000 characters or fewer'
        : null),
    item: 'C1.1',
  },

  // ★★★ P6.29 / Q5 — WHAT A NO-SHOW COSTS. the maintainer ruled charge · PART-CHARGE at 50% · waive, and ruled
  //     it a SETTING rather than a number in an `if`. The key, the ruled default and the validator
  //     all live in `src/booking/attendance.mjs`, beside the logic that reads them — the same shape
  //     as `REMINDER_SETTING_KEY`/`DEFAULT_REMINDER_MINUTES` in `reminders.mjs` — so registering it
  //     here is an IMPORT, never a second opinion about what a legal percentage is.
  //   ★★ UNTIL THIS LINE EXISTED THE FEATURE WORKED AND SAID SO. `getSetting()` THROWS on a key
  //      outside this catalogue rather than returning the fallback, so `resolveNoShowCharge()`
  //      caught that by name and reported `source: "ruling_pending_catalogue_registration"` in the
  //      `booking.booking.completed` payload. With the key registered the provenance becomes
  //      `ruling_default`, and `tenant_setting` once a practice sets its own. ★ A consumer about to
  //      take half of somebody's session fee needs to know which of those three it is.
  //   ★ 0 AND 100 ARE BOTH LEGAL, and that is load-bearing: 0 is "we waive it" and 100 is "we
  //     charge in full". Refusing the endpoints would quietly delete two of the three answers.
  // ★ SPELLED, NOT IMPORTED — see the note on the import above. `NO_SHOW_SETTING_KEY` is a `const`
  //   in a module that is on a cycle with this one, and importing it made the settings layer fail
  //   to load depending on which module the process entered first.
  'booking.no_show_charge_percent': { validate: noShowChargePercent, item: 'P6.29', hasReach: true },

  // ── booking settings — Stage 13 (F05) ────────────────────────────────────────────────────
  // ★★★ F05 — practice-wide booking controls. `policyFor` (src/booking/writes.mjs:387) reads the
  //     first four as practice defaults, under any per-service override on booking_policy — the
  //     same merge idiom as the block above. The other five have a NAMED reader task in this same
  //     stage (13.20/13.21/13.12/13.15); until that task lands, a value stored here is accepted and
  //     kept but read by nothing except this task's own test — said here rather than left silent.
  'booking.window_days': {
    validate: (v) => (typeof v !== 'number' || !Number.isInteger(v) ? 'must be a whole number'
      : v < 1 || v > 365 ? 'must be between 1 and 365'
        : null),
    item: 'F05',
  },
  'booking.notice_minutes': {
    validate: (v) => (typeof v !== 'number' || !Number.isInteger(v) ? 'must be a whole number'
      : v < 0 || v > 43200 ? 'must be between 0 and 43200'
        : null),
    item: 'F05',
  },
  'booking.gap_before_minutes': {
    validate: (v) => (typeof v !== 'number' || !Number.isInteger(v) ? 'must be a whole number'
      : v < 0 || v > 240 ? 'must be between 0 and 240'
        : null),
    item: 'F05',
  },
  'booking.gap_after_minutes': {
    validate: (v) => (typeof v !== 'number' || !Number.isInteger(v) ? 'must be a whole number'
      : v < 0 || v > 240 ? 'must be between 0 and 240'
        : null),
    item: 'F05',
  },
  // ★ reader: task 13.21 (not yet built as of this task).
  'booking.who_can_book': { validate: oneOf(['anyone', 'existing_clients']), item: 'F05' },
  // ★ reader: task 13.20 (not yet built as of this task).
  // ★ Stage 20 (0498) — how often a slot may START, practice-wide; a service may override it
  //   (booking_policy.start_interval_minutes). Default 30 in `policyFor`.
  'booking.start_interval_minutes': {
    validate: (v) => ([5, 10, 15, 20, 30, 45, 60, 90, 120].includes(v) ? null : 'must be one of 5, 10, 15, 20, 30, 45, 60, 90, 120'),
    item: 'S20',
  },
  'booking.show_staff_choice': { validate: (v) => (typeof v === 'boolean' ? null : 'must be true or false'), item: 'F05' },
  // ★ Stage 20 §4 (0496) — the BARE public page's default: which service categories a visitor who
  //   found the practice (not a scoped link) is offered. Unset or [] = every category shows.
  //   Enforced server-side in `readPublicPractice` — never a client-side filter (Group C ruling 1).
  'booking.public_page_categories': {
    validate: (v) => {
      if (!Array.isArray(v)) return 'must be a list of service category ids';
      for (const id of v) {
        if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
          return 'must be a list of service category ids';
        }
      }
      return null;
    },
    item: 'S20',
  },
  // ★ reader: task 13.20, as a booking gate (not yet built as of this task).
  'booking.assignment_rule': { validate: oneOf(['round_robin', 'priority', 'least_booked']), item: 'B10' },
  'booking.api_key_epoch': { validate: (v) => (Number.isInteger(v) && v >= 1 && v <= 1000000 ? null : 'must be a whole number from 1'), item: 'B10' },
  'booking.online_enabled': { validate: (v) => (typeof v === 'boolean' ? null : 'must be true or false'), item: 'F05' },
  // ★ reader: task 13.12 (not yet built as of this task).
  'booking.waitlist_offer_minutes': {
    validate: (v) => (typeof v !== 'number' || !Number.isInteger(v) ? 'must be a whole number'
      : v < 5 || v > 1440 ? 'must be between 5 and 1440'
        : null),
    item: 'F05',
  },
  // ★ reader: task 13.15 (not yet built as of this task).
  'booking.consent_hold_hours': {
    validate: (v) => (typeof v !== 'number' || !Number.isInteger(v) ? 'must be a whole number'
      : v < 1 || v > 168 ? 'must be between 1 and 168'
        : null),
    item: 'F05',
  },

  // ── automations (A9.1) ────────────────────────────────────────────────────────────────────
  // ★★★ ONE FLAG PER AUTOMATION, PER TENANT — AND **n8n READS IT**. There is ONE workflow per
  //     automation for the whole platform; the decision to run it for a given practice is DATA, in
  //     this table. That is what makes turning a notification off *a setting that toggles* rather
  //     than a code change and a deploy. [TY, RULED] Never one workflow per tenant: fifty tenants ×
  //     twelve automations is 600 workflows nobody can maintain.
  //   ★★ REGISTERED FROM THE CATALOGUE, NOT TYPED OUT. `setSetting` refuses an unregistered key
  //      ("is not a known setting"), so a hand-written list here that fell behind the catalogue
  //      would make an automation appear on the settings screen and be REFUSED when toggled — a
  //      control that looks alive and cannot work.
  //   ★ A missing row means the ruling default, exactly like the no-show percentage: the absence of
  //     a decision is not the same fact as a decision to turn something off.
  ...Object.fromEntries(AUTOMATIONS.map((a) => [
    automationSettingKey(a.key),
    { validate: (v) => (typeof v === "boolean" ? null : "must be true or false"), item: "A9.1" },
  ])),

  // ── run + campaigns (Stage 16) ────────────────────────────────────────────────────────────
  'run.gtm_container_id': { validate: gtmContainerId, item: 'Stage 16' },
  // ★ [TY, 2 Oct 2026] 'campaigns.win_back_cooldown_days' REMOVED ENTIRELY — the automation it
  //   configured is gone (automations/sweeps.mjs's own header note on why).

  // ── money ─────────────────────────────────────────────────────────────────────────────────
  // ★★ P2.6 — how many days after issue an invoice is due. Read ONCE, when the invoice is created,
  //    and the resulting DATE is stored on the row: changing this must not move a deadline on an
  //    invoice somebody has already been sent. ★ P6.65's money settings screen must say so.
  'money.payment_terms_days': { validate: paymentTerms, item: 'P2.6' },

  // ── documents ─────────────────────────────────────────────────────────────────────────────
  // ★★★ P8.8 — HOW LONG A SENT SIGNATURE REQUEST STAYS LIVE. Until this existed a document could
  //     not lapse at all: `documents.document.expired` had been in the topic catalogue since P20.3a
  //     with no producer, and `document_instance` had no expiry column and no `expired` state to
  //     move to (migrations 0110). So "chase the Alvarez signature" had no closer and sat on a
  //     screen forever — the half-chain ADD3-1 named.
  //   ★★ READ ONCE, AT SEND, AND THE RESULTING MOMENT IS STORED ON THE ROW — the same rule as
  //      `booking.reminder_minutes` and `money.payment_terms_days`, for the same reason: a document
  //      that re-asked this setting when the sweep ran would have its deadline moved by an edit made
  //      after it went out, and would no longer record what the recipient was told.
  //   ★★★ `0` MEANS NEVER LAPSES, AND IT IS THE DEFAULT WHEN THE KEY IS UNSET. Every document that
  //        exists today has a null `expires_at` and keeps it — this feature cannot reach backwards
  //        and expire something that was sent under no deadline. A practice turns it on by setting a
  //        number, which is the honest direction for a rule that voids things.
  // ★ The five `documents.*` settings MOVED INTO THE DOCUMENTS ISLAND (QUEUE §23.2.2, 3 Oct 2026): src/documents/settings.mjs + keystone.document_setting (migration 0595).
  //   They are no longer host settings — reading or writing `documents.reminder_days` etc. here is refused so nothing can change a value nobody reads.

  // ── money ─────────────────────────────────────────────────────────────────────────────────
  'money.currency':           { validate: (v) => (typeof v === 'string' && /^[A-Z]{3}$/.test(v)
                                  ? null : 'must be a three-letter ISO code like USD'), item: 'P6.65' },

  // ── money — F08 §6 (Stage 15) ────────────────────────────────────────────────────────────
  // ★★★ EIGHT KEYS, DEFAULTS RULED IN `MONEY_DEFAULTS` ABOVE. Readers call
  //     `getSetting(tx, key, MONEY_DEFAULTS[key])`.
  'money.invoice_prefix':      { validate: invoicePrefix, item: 'F08§6' },
  'money.reminder_days':       { validate: reminderDaysList, item: 'F08§6' },
  'money.tipping':             { validate: tipping, item: 'F08§6' },
  'money.part_payments':       { validate: bool, item: 'F08§6' },
  'money.dunning':             { validate: dunning, item: 'F08§6' },
  'money.ach_nudge_minimum':   { validate: minorCurrencyAmount, item: 'F08§6' },
  'money.bnpl_minimum':        { validate: minorCurrencyAmount, item: 'F08§6' },
  // ★ NO DEFAULT — see `MONEY_DEFAULTS`'s own comment above. Absent stays `null`, never `''`.
  'money.statement_descriptor': { validate: statementDescriptor, item: 'F08§6' },

  // ── invoices (Stage 20 Task 20.14) ────────────────────────────────────────────────────────
  // ★★ Invoice template defaults: footer, default memo, and Stripe rendering_options.
  //    Applied when creating an invoice on the connected Stripe account.
  'invoices.templates': {
    validate: (v) => {
      if (v === null) return null;
      if (typeof v !== 'object' || Array.isArray(v)) return 'must be an object with template defaults, or null';
      const keys = Object.keys(v);
      if (!keys.every(k => typeof k === 'string')) return 'all keys must be strings';
      if (!keys.every(k => typeof v[k] === 'string' || v[k] === null)) {
        return 'all values must be strings or null';
      }
      return null;
    },
    item: 'Stage 20 · 20.14',
  },

  // ── invoices (Stage 20 Task 20.63) ────────────────────────────────────────────────────────
  // ★★ Collection method default: send_invoice or charge_automatically. Per-invoice override wins.
  //    When the platform charge flag is off, invoices are created with auto_advance:false.
  'invoices.collection_default': { validate: oneOf(['send_invoice', 'charge_automatically']), item: 'Stage 20 · 20.63', ruledDefault: 'send_invoice' },

  // ── tax identities (Stage 20 Task 20.65) ───────────────────────────────────────────────
  // ★★ The practice's own tax IDs (EIN, VAT) to include in invoice headers. Stored as JSON.
  //    Passed as account_tax_ids param to Stripe when creating an invoice.
  'practice.tax_ids': {
    validate: (v) => {
      if (v === null) return null;
      if (typeof v !== 'object' || Array.isArray(v)) return 'must be null or an object';
      // Basic shape check: object with string keys and values
      for (const [k, val] of Object.entries(v)) {
        if (typeof k !== 'string' || typeof val !== 'string') {
          return 'must contain only string keys and values';
        }
      }
      return null;
    },
    item: 'Stage 20 · 20.65',
  },

  // ── money / invoices — P3.S14 (Ways to pay) ─────────────────────────────────────────────────
  // ★ The practice's chosen Stripe payment method types, and the id of the Stripe
  //   `payment_method_configuration` that carries them — see `src/settings/paymentMethods.mjs`.
  'money.payment_methods': { validate: paymentMethodTypeList, item: 'P3.S14' },
  'money.payment_method_configuration_id': { validate: nullableIdString, item: 'P3.S14' },
  // ★ The Stripe `invoice_rendering_template` id an invoice is created with, or null for Stripe's
  //   own default — CONTRACTS §6. Not yet read anywhere; registered so a future writer can use it.
  'invoices.layout_template_id': { validate: nullableIdString, item: 'P3.S14' },

  // ── items / agreements ────────────────────────────────────────────────────────────────────
  // ★★★ GAP-LIST FINDING 5, resolved 22 Sep 2026 — the maintainer ruled a platform-default refund statement,
  //     tenant-editable, rather than gap-list's option A (silent injection) or option B
  //     (authoring-time validation). `02-items.md §9 point 4` — frozen into
  //     `template_snapshot.terms.refundPolicyText` at execution time, always, via
  //     `getSetting(tx, 'items.refund_policy_text', DEFAULT_REFUND_POLICY_TEXT)` where
  //     `DEFAULT_REFUND_POLICY_TEXT` is the exact ruled wording, co-located beside that reader
  //     (`src/items/agreements.mjs`, per that spec's own "constant lives beside the logic that
  //     reads it" pattern — `booking.reminder_minutes`/`reminders.mjs` and
  //     `booking.no_show_charge_percent`/`attendance.mjs` above already use it).
  //   ★★ No migration and no seed row for new tenants: an unset key resolves to the ruled default
  //      via `getSetting`'s own `fallback` parameter — "absence of a decision is not the same fact
  //      as a decision", exactly like the no-show percentage above.
  'items.refund_policy_text': {
    validate: (v) => (typeof v === 'string' && v.trim().length > 0 && v.length <= 2000
      ? null : 'must be non-empty text, 2000 characters or fewer'),
    item: 'gap-list#9',
  },

  // ── the client app (P6.63) ────────────────────────────────────────────────────────────────
  // ★★★ IT IS THE **OFF** LIST, NOT THE ON LIST, AND THAT IS THE WHOLE DESIGN. An "on" list would
  //     mean an unset key resolves to NO surfaces — a practice that never opened this screen would
  //     ship a client app with nothing in it, and the failure would look like the app being broken.
  //     Storing the exceptions makes "unset" mean "everything", which is the honest default and the
  //     one a new practice wants.
  //   ★★ VALIDATED AGAINST `SURFACES`, so switching off a surface nobody implemented is refused at
  //      the write rather than stored and silently ignored. ★ `src/app/surfaces.mjs` imports
  //      nothing, so this import cannot create a cycle.
  'client_app.surfaces_off': { validate: surfaceKeyList, item: 'P6.63' },

  // ── billing (Keystone's own) ──────────────────────────────────────────────────────────────
  // ★★ KS-10: the mirror holds the TIER and nothing more. Access control reads THIS row, never a
  //    live Stripe call.
  'billing.tier':             { validate: oneOf(['solo', 'practice', 'group', 'enterprise']), item: 'P6.69' },

  // ── email / growth ────────────────────────────────────────────────────────────────────────
  // ★★★ C4.3 — THE SENDING DOMAIN FOR RESEND EMAIL SERVICE. A practice sets their own verified
  //     Resend domain for sending transactional and marketing emails. The provisioning step
  //     `resend_domain` handles registration with Resend; this setting stores the domain value
  //     so the practice can view it and change it in settings without re-running provisioning.
  'email.sending_domain':     { validate: (v) => (typeof v !== 'string' || v.trim() === '' ? 'must be a non-empty domain name' : null), item: 'C4.3' },

  // ── Stage 11 (CT-F02) ─────────────────────────────────────────────────────────────────────
  'items.modifier_stack_limit': {
    validate: nullableCount,
    item: "CT-F02 · F06 G15 (enforced by Stage 14's booking modifier path)",
    ruledDefault: null,
  },
  'giftcards.expiry_months': {
    validate: nullableCount,
    item: 'CT-F02 · F06 G16',
    ruledDefault: null,
    writeLocked: "Locked for now — expiry rules differ by state and several ban it outright. This unlocks when we can check your state's rules for you.",
  },
  'loyalty.tell_channel': {
    validate: oneOf(['person_preference', 'email', 'text']),
    item: 'CT-F02 · F06 G17 (read by Stage 14\'s "Tell them")',
    ruledDefault: 'person_preference',
  },
  'usage.ai_ceiling': {
    validate: nullableCents,
    item: "CT-F02 · F12 §2.11 (enforced by Stage 17's usage engine)",
    ruledDefault: null,
  },
  'reports.weekly_digest': {
    validate: bool,
    item: 'CT-F02 · F11 (Stage 16)',
    ruledDefault: true,
  },
  'notifications.quiet_hours': {
    validate: quietHours,
    item: 'CT-F02 · F12 §2.5 (Stage 17)',
    ruledDefault: null,
  },
  'notifications.weekend': {
    validate: bool,
    item: 'CT-F02 · F12 §2.5 (Stage 17)',
    ruledDefault: false,
  },

  // ★★★ TASK 20.49 — SMS NOTIFICATION MATRIX. Quiet hours block SMS harder than email: inside
  //      quiet hours, SMS does not send and cannot be overridden on a per-channel basis.
  //      SMS consent is INDEPENDENT from email (see 0489). These settings control which notification
  //      topics send as SMS for which roles, at the practice level (notification_preference can
  //      override per person, but sms_marketing consent is the hard requirement upstream).
  'notifications.sms_enabled': {
    validate: (v) => (typeof v === 'boolean' ? null : 'must be true or false'),
    item: 'Task 20.49',
  },

  // ★ Stage 12 (F02 §5, CT-F02 amendment). Enforced in keystone.document_is_visible (0388), never
  //   in n8n.
  'people.team_wide_notes': { validate: (v) => (typeof v === 'boolean' ? null : 'must be true or false'), item: 'F02' },

  // ── Stage 14 (F06 §8, F07 §5) ──────────────────────────────────────────────────────────────
  // ★ F06 §8 — practice-wide defaults applied to a new service/package/plan at creation. Readers:
  //   14.20 (createService seeds these onto a new item) and 14.21 (`GET /api/items/defaults`
  //   returns them to the editor screen). Neither task is built yet.
  'items.default_duration_minutes': {
    validate: (v) => (typeof v !== 'number' || !Number.isInteger(v) ? 'must be a whole number'
      : v < 5 || v > 600 ? 'must be between 5 and 600'
        : null),
    item: 'F06',
  },
  'items.default_price_minor': {
    validate: (v) => (typeof v !== 'number' || !Number.isInteger(v) ? 'must be a whole number'
      : v < 0 ? 'must be 0 or more'
        : null),
    item: 'F06',
  },
  'items.default_unit': { validate: oneOf(['session', 'hour', 'month', 'each', 'day', 'week', 'half_hour']), item: 'F06' },
  // ★ 0496 (§4) widened the vocabulary: `phone` joined it. `video` IS the virtual mode — the
  //   identifier matches 0085's applied booking.location_kind and is never respelled; UI labels
  //   read "Virtual" (ruling, STRIPE-CLEANUP-AND-IMPORT.md, 25 Sep 2026).
  'items.default_delivery': { validate: oneOf(['in_person', 'video', 'at_client', 'phone', 'client_chooses']), item: 'F06' },
  'items.default_bookable_online': { validate: bool, item: 'F06' },
  'items.default_tax_code': { validate: nonEmptyString(40), item: 'F06' },
  'items.default_agreement_template_id': {
    validate: (v) => (typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
      ? null : 'must be a valid UUID'),
    item: 'F06',
  },
  // ★ F06 §8 — warns the operator when remaining package/plan credits reach this count. Reader:
  //   14.21 (not built yet).
  'items.warn_at_remaining': {
    validate: (v) => (typeof v !== 'number' || !Number.isInteger(v) ? 'must be a whole number'
      : v < 0 || v > 20 ? 'must be between 0 and 20'
        : null),
    item: 'F06',
  },
  // ★ F06 §8 — the loyalty programme switch. Reader: 14.24 (not built yet).
  'loyalty.enabled': { validate: bool, item: 'F06' },
  // ★ F06 §8 — the gift-card switch, R-14.9: a practice on gift cards gets one code prefix. Reader:
  //   14.25 (not built yet).
  'giftcards.enabled': { validate: bool, item: 'F06' },
  // ── growth / lead scoring ─────────────────────────────────────────────────────────────────
  // ★★★ Stage 20 task 20.50 — lead scoring weights (email engagement, funnel, booking, consent, documents).
  //     Weighted facts over 90 days compute the lead score. Defaults from `defaultLeadScoringWeights()`.
  'growth.lead_scoring_weights': {
    validate: leadScoringWeights,
    item: 'Stage 20 · 20.50',
    ruledDefault: null,
  },
  // ★ Stage 20 task 20.50 — lead score threshold. Crossing this threshold emits growth.lead_score.crossed.
  'growth.lead_score_threshold': {
    validate: (v) => (typeof v !== 'number' || !Number.isInteger(v) || v < 0 ? 'must be a whole number 0 or more' : null),
    item: 'Stage 20 · 20.50',
    ruledDefault: 30,
  },
  // ★ Stage 20 task 20.51 — who may send campaigns. owner_admin (default) or everyone.
  'growth.who_may_send': {
    validate: oneOf(['owner_admin', 'everyone']),
    item: 'Stage 20 · 20.51',
    ruledDefault: 'owner_admin',
  },

  // ── lead intake (lead-intake brief, 30 Sep 2026) ──────────────────────────────────────────
  // ★ The public lead form's own "what are you interested in" dropdown, edited in Settings —
  //   never hard-coded in the route or the marketing site. Seeded for Docustay by migration 0540.
  'growth.lead_interests': { validate: leadInterestList, item: 'lead-intake brief, 30 Sep 2026' },
  // ★ Where the "new lead" staff-notification email goes. `null` falls back to
  //   the organisation's reply-to address (its sending identity), then its owner's email, at the send site.
  'growth.lead_notification_email': { validate: nullableEmail, item: 'lead-intake brief, 30 Sep 2026' },
  // ★ Batch A — which websites may post this organisation's public lead form. Empty = same-site only.
  // ★ Part 29 step 2 — who may see Docustay customers and their payments. Read only in the PLATFORM organisation; a list of email addresses. the maintainer today; adding Grant later is this one setting.
  'platform.docustay_viewers': { validate: emailList, item: 'Part 29 step 2, 4 Oct 2026' },
  // ★ AI-COST-AND-USAGE-SPEC §4 (the maintainer, 9 Oct 2026) — the Docustay owner's bill: the monthly dollar ceiling on the platform's own AI key (null = the environment default, KEYSTONE_AI_PLATFORM_MONTHLY_USD, 150), and a manual pause. Platform organisation only.
  'platform.ai_monthly_usd': { validate: (v) => (v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1000000) ? null : 'must be a dollar amount from 0 to 1,000,000, or empty'), item: 'AI cost and usage, 9 Oct 2026' },
  'platform.ai_paused': { validate: bool, item: 'AI cost and usage, 9 Oct 2026' },
  // which alert levels (50/80/100 percent of the ceiling) were already sent for which month: { "2026-10": [50, 80] }
  'platform.ai_alerts_sent': { validate: (v) => (v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((a) => Array.isArray(a) && a.every((n) => [50, 80, 100].includes(n))) ? null : 'must be an object of month → alert levels'), item: 'AI cost and usage, 9 Oct 2026' },
  'growth.lead_form_origins': { validate: originList, item: 'Batch A, 3 Oct 2026' },

  // ★★★ Stage 20 task 20.22 — MONEY EMAIL CUTOVER. When OFF (default), the four money queue jobs
  //     (receipt, invoice_reminder, update_card, invoice_issued) send via the queue (existing
  //     behaviour). When ON, the queue jobs skip and record `skipped:cutover`, and n8n's callback
  //     path sends instead. The flag is read server-side on BOTH sides from this single key in the
  //     same transaction pattern: queue sender reads it to decide whether to enqueue; callback
  //     reads it to decide whether to send. NEVER BOTH, NEVER NEITHER.
  'automation_cutover.money_telling': {
    validate: (v) => (typeof v === 'boolean' ? null : 'must be true or false'),
    item: 'Stage 20 · 20.22',
    ruledDefault: false,
  },
});

export const ALL_SETTING_KEYS = Object.freeze(Object.keys(SETTING_KEYS));

// ★★★ CT-F02 — `REACH_KEYS` and `LOCKED_KEYS`. Consumers read `ruledDefault` as their `getSetting`
//     fallback (`src/settings/writes.mjs:131`) so the default is written once; these two are consts
//     read at CALL TIME by importers, never at module top level of a module on the settings cycle
//     (see the note at the top of this file on `keys → attendance → settings/writes → keys`).
export const REACH_KEYS = Object.freeze(ALL_SETTING_KEYS.filter((k) => SETTING_KEYS[k].hasReach === true));
export const LOCKED_KEYS = Object.freeze(Object.fromEntries(
  ALL_SETTING_KEYS
    .filter((k) => typeof SETTING_KEYS[k].writeLocked === 'string')
    .map((k) => [k, SETTING_KEYS[k].writeLocked])
));

/**
 * ★ Validate a key and its value together. Returns null when acceptable, or a SENTENCE.
 *   ★★ The two failures are reported SEPARATELY on purpose: "that is not a setting" and "that is a
 *      setting and the value is wrong" are different facts, and an operator can act on only one of
 *      them without being told which they have.
 */
export function validateSetting(key, value) {
  const spec = SETTING_KEYS[key];
  if (!spec) {
    return `"${key}" is not a known setting. Known: ${ALL_SETTING_KEYS.join(', ')}`;
  }
  const problem = spec.validate(value);
  return problem ? `"${key}" ${problem}` : null;
}
