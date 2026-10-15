// P9.2 / P9.4 — THE OUTBOX, AND THE RULE THAT SECTIONS NEVER CALL EACH OTHER.
//
// ★★★ §X4: "Sections NEVER call each other. Documents does not call Notifications. Documents
// emits `document.signed` and whoever cares subscribes."
//
// ★★ THE WHOLE POINT IS WHAT THIS FILE DOES NOT DO. `emit()` writes a row. It does not send a
// notification, does not call n8n, does not look up subscribers, and does not know that
// notifications exist. ★ A publisher that knows its subscribers is not a publisher — it is a
// function call with extra steps, and the coupling it was meant to prevent is back.

// ★ P15B.2a — the transaction brand lives in the db layer, which is the only thing that can
//   truthfully stamp it. layering-lint ranks db BELOW everything, so this import is legal.
import { assertTenantTx } from "../db/index.mjs";
// ★ FIX ROUND 1, M1 — the webhook half of ACTOR_SHAPE is DERIVED from the same allowlist the
//   webhook route itself refuses against (`routes/webhooks.mjs`), not a private copy: importing
//   `PROVIDERS` means a provider added there is legal here on the same commit, and a provider
//   removed there stops being a legal actor here too, with nothing to keep in sync by hand.
import { PROVIDERS } from "../webhooks/verify.mjs";
// ★ Task 9.5 / CT-095 — the one credential scrubber, called by safeErrorText only (below). Nothing
//   else in this file uses it: emit() and every other function here are untouched by 9.5.
import { scrubSecrets } from "../logging/scrub.mjs";
// ★ Task 9.14 (CT-096, Q9-6) — the n8n sink's own imports. Nothing else in this file uses either:
//   `emit()` (9.4's) and `safeErrorText` (9.5's) are untouched by this task, per BUILD-PROCESS.md:161
//   ("different named parts, same file"). `flagIsOn` reads the kill switch (0218 seeds it OFF);
//   `sendEvent`/`N8nUnavailable` are 9.14's own OTHER named part, in `src/automations/n8n.mjs`.
import { flagIsOn } from "../platform/flags.mjs";
import { sendEvent as n8nSendEvent } from "../automations/n8n.mjs";

/**
 * ★★ THE SIX-PART TOPIC RULE: `section.thing.past_tense`.
 * · PAST TENSE because an event is a statement of fact about something that ALREADY HAPPENED.
 *   `document.signed`, never `document.sign` — the latter reads as a command, and a subscriber
 *   who thinks they have been commanded will refuse, retry, or argue.
 * · The SECTION prefix is what P9.4's guard checks: a section may only emit its own topics.
 */

/**
 * ★ The catalogue of topics each section owns. Adding one is a line here; it needs no change
 * anywhere else, which is the property §X4 is buying.
 * ★★ `SECTIONS` is DERIVED from this object's keys, immediately after `ALL_TOPICS` below — it used
 *    to be a second hand-written list and it diverged the first time this map changed. See there.
 */
// ★★★ THE TOPIC VOCABULARY LIVES IN `topics.mjs` AND IS RE-EXPORTED HERE — A MOVE, NOT A FORK.
//     It was split out at A12.1 so the "Add endpoint" surface can offer the 83 topics in a BROWSER,
//     which cannot import this file: the `../db/index.mjs` import above pulls in `pg`.
//   ★★ RE-EXPORTED rather than relocated-and-updated-everywhere so that `routes/developer.mjs`,
//      `notifications/writes.mjs` and the ten gates that import `TOPICS` / `ALL_TOPICS` /
//      `SECTIONS` from here keep resolving with no edit. Changing ten call sites to tidy an import
//      path is ten chances to change what a gate proves while "just moving a file".
//   ★ The full reasoning for the closed set, for why `ALL_TOPICS` and `SECTIONS` are DERIVED rather
//     than declared, and for what is and is not a migration, travelled WITH the object and is in
//     `topics.mjs`. It is not summarised here, because a summary is a second copy too.
export { TOPICS, ALL_TOPICS, SECTIONS, SUBJECT_TYPES, SUBJECT_TYPE_ALIASES } from "./topics.mjs";
// ★ ALL are imported for THIS file's own use — `emit()` validates a topic against
//   `ALL_TOPICS`, a section against `SECTIONS`, and (Stage 3 Task 2) a subject_type against
//   `SUBJECT_TYPES`. [MEASURED] the first version of this line omitted `ALL_TOPICS` and the
//   catalogue gate's POSITIVE CONTROL caught it immediately: "a valid emit was refused —
//   ALL_TOPICS is not defined". A re-export does not bring a name into the module's own scope, and
//   a gate with only negative assertions would have stayed green while every emit in the product
//   threw.
import { TOPICS, ALL_TOPICS, SECTIONS, SUBJECT_TYPES } from "./topics.mjs";

export class TopicViolation extends Error {
  constructor(message) { super(message); this.name = 'TopicViolation'; }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ STAGE 3 TASK 3 — THE PAYLOAD PRIVACY RULE. 02-event-catalogue.md §2 rule 4, ruled 17 Sep 2026:
//     "events carry IDs and safe facts ONLY — never typed text (no free-text reasons, no titles or
//     names, no URLs)." §12: "a gate fails if any `emit` passes a string fact that isn't an ID, enum
//     or timestamp (positive control: `reason: 'moved away'` is rejected)."
//   ★★ SELF-CONTAINED AND CHECKED HERE, ALONGSIDE THE ACTOR AND SUBJECT-TYPE CHECKS ABOVE, FOR THE
//      SAME REASON: a message naming what is wrong, aimed at the caller, beats a payload that
//      silently reaches every webhook subscriber and then has to be found by an auditor instead.
//   ★★★ TWELVE CALL SITES CARRIED TYPED TEXT BEFORE THIS TASK (recon §2) — reasons, titles, names,
//       a webhook URL — and task-chain title-builders (`src/tasks/chains.mjs`) and one notification
//       email (`src/queue/tasks.mjs`'s `emailFor`) read those exact fields back out of the payload.
//       Both were rewired to read the NAME from the CURRENT RECORD at read/render time instead —
//       see those files' own comments — because dropping a payload key without finding its readers
//       first blanks a task title or an email variable, which is a regression, not a fix.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ★★★ THE CLOSED SET OF KEY NAMES A PAYLOAD MAY NEVER CARRY, AT ANY DEPTH. Exact match, not a
 *     substring test — `email_enabled` and `phone_verified` are booleans about a fact, not the
 *     value itself, and are legal; `email` and `phone` holding the value itself are not.
 * ★ `name` is banned but a field-NAME string ("display_name", "email") is not a value under this
 *   key — §12: "Facts are IDs, enums, counts, amounts, timestamps and field *names* only." A
 *   `fields: ["email"]` array (several writers already do this) describes WHICH column changed and
 *   carries none of its content.
 */
const BANNED_PAYLOAD_KEYS = new Set([
  "note", "message", "body", "content", "text", "checkin_text", "card",
  "title", "name", "url", "email", "phone",
]);

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
// ★ HEX FINGERPRINT is its own named category per the brief even though, as a lowercase run of
//   [0-9a-f], it is already a subset of ENUM_SHAPE below — kept explicit so a reader sees the four
//   categories the spec names, rather than three plus an accident of the enum regex.
const HEX_FINGERPRINT_SHAPE = /^[0-9a-f]{16,64}$/i;
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE DECISION ON CASE, STATED (task-3 brief: "amounts/currency codes — decide and state").
//     The brief's own wording is "lowercase, digits, underscore, dot, colon, hyphen" — but this
//     codebase already stores ISO-4217 currency codes UPPERCASE (`money/charge.mjs:193` validates
//     `^[A-Z]{3}$` and the existing `p18_charge_path.mjs` gate asserts `currency === "USD"`), and
//     `DAY_NAMES` (`booking/writes.mjs:26`) emits capitalised day names ("Monday") into
//     `booking.availability.changed` payloads. Both are closed, bounded vocabularies — the privacy
//     risk of an enum-shaped token is nil regardless of case, and only free text reliably contains a
//     SPACE, which this still refuses either way. Rewriting every currency and day-name call site to
//     lowercase would be a business-logic change wearing a privacy fix's clothes, so the shape is
//     CASE-INSENSITIVE by deliberate choice, recorded here and in the task-3 report.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const ENUM_SHAPE = /^[A-Za-z0-9_.:-]{1,100}$/;
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ A FIFTH, NARROW CATEGORY, FOUND BY RUNNING THE EXISTING SUITE (task-3 brief: "run the
//     existing tests to find payload values your rule would refuse, and fix the payload or the
//     rule deliberately, listing each decision"). [EXECUTED] `test/p15b_same_tx.test.mjs` went red
//     on `invitee_timezone: "America/Los_Angeles"` (`booking/createBooking.mjs:218`) — a real,
//     closed, bounded IANA timezone identifier, not free text, but ENUM_SHAPE has no "/" in it.
//   ★★ DELIBERATELY NOT SOLVED BY ADDING "/" TO ENUM_SHAPE ITSELF: that would also legalise
//      `https://example.com/path` under any key name OTHER than the banned `url` — colon, dot and
//      slash are exactly what a URL is made of, and one banned key name is not the only place a
//      URL could be smuggled in. A NAMED, NARROWER shape for the one legitimate case that needs a
//      slash keeps the general enum rule tight.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const TIMEZONE_SHAPE = /^[A-Za-z0-9_+-]{1,40}(\/[A-Za-z0-9_+-]{1,40}){0,2}$/;
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ FIX ROUND 1, REVIEW I1 — THE TIMEZONE SHAPE WAS ACCEPTED UNDER ANY KEY. [EXECUTED, review]
//     `"moved/away"`, `"Jane/Doe"` and `"+15551234567"` all passed as "timezones" under ordinary keys:
//     a regex for the SHAPE of a zone is not a check that something IS a zone. Now BOTH must hold:
//       1. the KEY names a timezone — `timezone` or `<something>_timezone`;
//       2. the VALUE is a real zone: in `Intl.supportedValuesOf('timeZone')`, or — because that list
//          omits real, current zones [MEASURED, Node 25: `Asia/Kolkata`, `America/Argentina/Buenos_Aires`,
//          `UTC` are all absent from it] — accepted by `Intl.DateTimeFormat` itself AND still of the
//          Area/Location shape above, which is what refuses `+05:00`-style offsets. An unrecognised
//          value throws a RangeError there, so "moved/away" and "Jane/Doe" are refused either way.
//   ★ Refusing a genuine zone here would roll back a real booking (`invitee_timezone` comes straight
//     from the invitee's browser, unvalidated upstream) — so the fallback is Intl's own answer, not a
//     second hand-kept list.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const TIMEZONE_KEY = /(^|_)timezone$/;
const SUPPORTED_ZONES = new Set(
  typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : []);
function isRealTimezone(v) {
  if (SUPPORTED_ZONES.has(v)) return true;
  if (!TIMEZONE_SHAPE.test(v)) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: v }); return true; }
  catch { return false; }
}

/** ★ One string, checked against the four legal shapes (plus a real timezone under a timezone key). */
function isSafePayloadString(v, key) {
  if (UUID_SHAPE.test(v) || ISO_TIMESTAMP_SHAPE.test(v) ||
      HEX_FINGERPRINT_SHAPE.test(v) || ENUM_SHAPE.test(v)) return true;
  return typeof key === "string" && TIMEZONE_KEY.test(key) && isRealTimezone(v);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★ FIX ROUND 1, REVIEW M1 — A KEY THAT NAMES TEXT MAY NOT CARRY TEXT. The exact-match ban let
//    `display_name`, `client_name`, `service_name`, `task_title` through, and a one-word value then
//    passed the enum shape (`client_name: "Alice"` — EXECUTED, review). So a key ENDING in one of these
//    words is refused whenever its value is a string, object or array — anything that could hold the
//    text. A boolean, number or null under such a key is a fact ABOUT the text, not the text
//    (`is_session_note: true`, `documents/writes.mjs`), and stays legal.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const TEXT_NAMING_KEY = /_(name|title|email|phone|url|note|text|message|body)$/;

/**
 * ★★★ THE WALK. Recurses through objects and arrays alike ("nested objects and arrays are checked
 *     the same way" — brief) so a banned key or a free-text value cannot hide one level down from
 *     where a simpler check would have looked.
 * @param {*} value the (sub-)value being checked right now
 * @param {string} path for the thrown message, e.g. `payload.recipients[0].reason`
 */
export function assertSafePayload(value, path = "payload", key = null) {
  if (value === null || value === undefined) return;               // ★ null is legal (§2 rule 3/12)
  if (typeof value === "boolean" || typeof value === "number") return;
  // ★ A `timestamptz`/`date` column read back through `pg` arrives as a JS Date, not a string — most
  //   of the 32 existing call sites pass one straight through (`expires_at: row.expires_at`, …).
  //   Refusing it here would have broken nearly every emitter in `src/`, not just the 12 offenders.
  if (value instanceof Date) return;
  if (typeof value === "string") {
    if (!isSafePayloadString(value, key)) {
      throw new TopicViolation(
        `${path} is ${JSON.stringify(value)} — a payload string must be a uuid, an ISO-8601 ` +
        `timestamp, a hex fingerprint, or an enum-shaped token (letters, digits, underscore, dot, ` +
        `colon or hyphen, no spaces, ${ENUM_SHAPE.source.match(/\{1,(\d+)\}/)[1]} characters or ` +
        `fewer). §2.4/§12: free text — "reason: 'moved away'" is exactly this shape and is refused; ` +
        `"reason: 'expired'" is an enum and is accepted. A listener that needs a name or a title ` +
        `reads it from the CURRENT RECORD, not from the event.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertSafePayload(item, `${path}[${i}]`, key));
    return;
  }
  if (typeof value === "object") {
    for (const [key, v] of Object.entries(value)) {
      if (BANNED_PAYLOAD_KEYS.has(key)) {
        throw new TopicViolation(
          `${path}.${key} is not allowed — an event payload may never carry a key named ` +
          `"${key}" (§2.4: no note, message, body, content, text, checkin_text, card, title, name, ` +
          `url, email or phone). Listeners that need a name or a title read it from the current ` +
          `record at read time, not from the event that pointed at it.`);
      }
      if (TEXT_NAMING_KEY.test(key) && v !== null && v !== undefined &&
          typeof v !== "boolean" && typeof v !== "number") {
        throw new TopicViolation(
          `${path}.${key} is not allowed — a key ending in _name, _title, _email, _phone, _url, _note, ` +
          `_text, _message or _body may not carry a value that could hold text (§2.4). Emit the id and ` +
          `let the listener read the ${key.replace(/^.*_/, "")} from the current record.`);
      }
      assertSafePayload(v, `${path}.${key}`, key);
    }
    return;
  }
  // ★ A function, symbol or bigint is not JSON-safe at all, and would either throw inside
  //   `JSON.stringify` a few lines below with a much less useful message, or (bigint) silently throw
  //   a TypeError. Refused here, by name, before that happens.
  throw new TopicViolation(`${path} has a value of type "${typeof value}", which a JSON payload cannot carry`);
}

/**
 * ★★ FIX ROUND 1, REVIEW M4 — THE SAME RULE, AS A FILTER FOR READERS OF OLD EVENTS. Existing events are
 *    never rewritten (§11), so rows emitted before Task 3 still carry names, titles and free-text
 *    reasons. A read surface that forwards `payload` (the audit API) passes it through this first:
 *    it keeps only the entries `emit()` would accept TODAY and drops the rest, at every depth. The
 *    rule is the validator's own, so the two cannot disagree about what a "fact" is.
 * @returns {*} the payload with every entry the current rule would refuse removed
 */
export function safeFacts(value, key = null) {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "boolean" || typeof value === "number" || value instanceof Date) return value;
  if (typeof value === "string") return isSafePayloadString(value, key) ? value : undefined;
  if (Array.isArray(value)) {
    return value.map((item) => safeFacts(item, key)).filter((item) => item !== undefined);
  }
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (BANNED_PAYLOAD_KEYS.has(k)) continue;
      if (TEXT_NAMING_KEY.test(k) && v !== null && typeof v !== "boolean" && typeof v !== "number") continue;
      const kept = safeFacts(v, k);
      if (kept !== undefined) out[k] = kept;
    }
    return out;
  }
  return undefined;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ STAGE 3 TASK 1 — THE ENVELOPE'S `actor`. 02-event-catalogue.md §2 rule 3: "every event
//     carries … actor (user id / system / n8n / webhook source) …". Migration 0134 adds the column
//     AND the identical CHECK on the database side (belt and suspenders — the same double-proof
//     `event_topic_check`/`event_emitted_by_check` already give topic and section, recon §1).
//     [MEASURED] before this task, "who caused it" was smuggled into `payload` as `sent_by` /
//     `executed_by` at exactly two call sites and simply absent everywhere else.
//   ★★ CHECKED HERE, IN JS, BEFORE THE INSERT — not left to the database CHECK alone — for the same
//      reason `assertTenantTx`/`SECTIONS`/`ALL_TOPICS` are checked here rather than left to a
//      constraint: a message naming the actor and the five legal shapes, aimed at the caller, is
//      better than a bare `23514 event_actor_check` from Postgres.
//   ★ CLOSED, NOT EXTENSIBLE FROM A CALL SITE. A section that could invent its own actor shape is
//     the same defect §X4 already forbids for topics — a private vocabulary is not a vocabulary.
//
// ★★★ FIX ROUND 1, M1/M2 — TIGHTENED, AND THE TRUTH ABOUT WHAT IS CHECKED, STATED PLAINLY.
//   M1: the original pattern accepted `user:` + ANY 36 characters from `[0-9a-f-]` (36 hyphens
//   passed) and `webhook:` + any lower-case word (`webhook:notaprovider` passed). Tightened to a
//   REAL uuid shape (8-4-4-4-12 hex) and to the actual provider allowlist (`PROVIDERS`, imported
//   above) — identically in migration 0135's CHECK, which cannot import this file and carries the
//   same list as a literal, by hand, kept beside this one.
//   M2: THIS IS SHAPE VALIDATION ONLY. `user:<uuid>` is accepted whenever it is well-formed
//   hex-and-hyphens — nothing here, and nothing in either CHECK constraint, looks the uuid up
//   against `keystone.app_user`. Migration 0134's own comment claimed otherwise ("emit() already
//   refuses anything that does not come from keystone.app_user"); that sentence was never true and
//   0134 is not edited to fix it (any byte change breaks its applied checksum) — this comment, and
//   0135's header, are where the correction lives.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ TASK 7.24 — A KEY IS AN ACTOR TOO. A FIFTH ALTERNATIVE, `api_key:<token_id>` — the same
//     26-character Crockford id `keystone_auth.api_token.token_id`'s own CHECK carries
//     (`0045_api_token_and_webhook_source.sql:56`, `'^[0-9A-HJKMNP-TV-Z]{26}$'`), quoted character
//     for character so the two shapes cannot drift. ★ Crockford base32 excludes I, L, O and U
//     (`src/auth/apiToken.mjs:33-35`), which is why the class is not `[A-Z0-9]`. Identically widened
//     in migration `0200_an_api_key_is_an_actor.sql`'s `event_actor_check` — belt and suspenders,
//     the same double-proof the rest of this block already keeps.
//   ★ IT IS THE PUBLIC token_id, NEVER THE SECRET — the id is not a credential, it is a handle a
//     reader can use to look the key up on the developer screen; the secret never leaves the
//     database in a form that can be replayed (`apiToken.mjs`'s digest).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★ EXPORTED (only as of 7.24) so `test/s7_api_key_actor.test.mjs` can assert the JS regex and the
//   database CHECK agree on the SAME probe strings, rather than assuming a hand-kept copy matches —
//   the exact defect `0135:22`'s history exists because of (M1, above).
export const ACTOR_SHAPE = new RegExp(
  `^(system|n8n|worker|user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|` +
  `webhook:(${PROVIDERS.join("|")})|api_key:[0-9A-HJKMNP-TV-Z]{26})$`
);

/**
 * ★ ONE PLACE TO TURN "the id we have in hand, or null" INTO THE ENVELOPE SHAPE — so every write
 *   module that already threads an actorUserId/actorId through to its own `emit()` call writes
 *   `actor: userActor(actorUserId)` rather than fifteen slightly different copies of the same
 *   ternary (one of which would eventually forget the "system" fallback, or the "user:" prefix).
 *   Exported rather than inlined per call site for the same reason ACTOR_SHAPE is not duplicated.
 */
export function userActor(userId) {
  return userId ? `user:${userId}` : "system";
}

/**
 * ★★★ TASK 7.24 — THE SAME ONE-PLACE RULE, FOR A KEY. Never called directly by a write module
 *   (there are no call sites of this outside `emit`'s own substitution below, on purpose — see
 *   Q7-19 and the INSERT's comment): a key's request carries no `actorUserId` to thread through the
 *   59 `userActor(...)` call sites, so `emit()` itself substitutes this shape when the request's
 *   `keystone.actor_api_key` GUC is set (`src/paths/index.mjs`'s `handleApiTokenRequest`, 7.23) and
 *   the caller passed no other actor. It is exported anyway, beside `userActor`, so a reader who
 *   wants the exact string a key would produce has one place to ask — never a second hand-built
 *   `` `api_key:${…}` `` (test (f) asserts this function is the only producer of the string in `src/`).
 */
export function apiKeyActor(tokenId) {
  return `api_key:${tokenId}`;
}

/**
 * ★★★ EMIT. Takes the SAME transaction client as the state change, and that is the entire
 * contract — `tx` is not a convenience, it is the guarantee.
 *
 * ★★ BOTH FAILURE MODES ARE AVOIDED ONLY BY BEING IN THE TRANSACTION:
 *   · emitting AFTER commit loses the event if the process dies in between,
 *   · emitting BEFORE commit fires for a change that then rolls back.
 * ★ There is no third option that gets both right, which is why the outbox exists at all.
 *
 * @param tx      a pg client INSIDE the caller's transaction. Never a pool, never a new client.
 * @param actor   who caused this — "system" (default, meaning nobody's session did) | "n8n" |
 *                "worker" | "user:<uuid>" | "webhook:<provider>". §2 rule 3.
 * @param sample  true for sample-client / test-mode events — stored and shown in History, never
 *                delivered to n8n/email/push/webhooks (§2 rule 9; honoured by the dispatcher's
 *                LISTENER_REACH and the webhook, reminder and email jobs — Stage 3 Task 8).
 *                ★ TASK 9.4: this is a FLOOR, not the only source. Even when the caller passes
 *                `false` (the default), `emit()` still writes `true` if `subjectType === "person"`
 *                and that person's `keystone.app_user.is_sample` is `true` — so a follow-up event
 *                about a sample person inherits sample-ness without the caller having to know. An
 *                explicit `true` always wins; see the derivation block below the actor check.
 *
 * ★ `subjectType`/`subjectId` ARE NOW VALIDATED AGAINST THE CLOSED VOCABULARY (Stage 3 Task 2 — see
 *   the block below, right after the topic-catalogue check). `payload` is still unvalidated on
 *   purpose — that is a later task's payload validator, added to this function later.
 */
export async function emit(tx, { tenantId, topic, emittedBy, subjectType = null,
                                 subjectId = null, payload = {}, actor = "system", sample = false }) {
  // ★★★ U26 / P15B.2a — FIRST, BEFORE ANYTHING ELSE. [MEAS] this function validated `topic` and
  //     `emittedBy` and NOTHING about `tx`, so `emit(pool, {...})` type-checked, ran, and
  //     auto-committed standalone — the exact thing the docstring above forbids. The only thing
  //     that stopped it was the RLS WITH CHECK raising `require_tenant_id()` FORTY LINES LATER,
  //     with a message about insufficient privilege, which names neither the pool nor this
  //     function. ★ It is checked BEFORE the topic so the error is about the handle, not about a
  //     topic that was never the problem.
  assertTenantTx(tx, "emit()");
  if (!SECTIONS.includes(emittedBy)) {
    throw new TopicViolation(`"${emittedBy}" is not a section — one of ${SECTIONS.join(', ')}`);
  }
  // ★★★ A SECTION MAY ONLY EMIT ITS OWN TOPICS. This is §X4's "sections never call each other",
  // enforced rather than intended: Money emitting `documents.document.signed` is Money reaching
  // into Documents by another name, and it would be invisible in review because it is just a
  // string. ★ Caught here, at the moment it is attempted.
  if (!topic.startsWith(`${emittedBy}.`)) {
    throw new TopicViolation(
      `section "${emittedBy}" may not emit "${topic}" — a section emits only its own topics. ` +
      `§X4: sections never call each other.`);
  }
  if (!ALL_TOPICS.includes(topic)) {
    // ★ A closed catalogue. An unknown topic is a typo that would otherwise reach nobody and
    // report success — the worst shape of failure, because it looks like it worked.
    throw new TopicViolation(`"${topic}" is not a known topic. Add it to TOPICS first.`);
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ STAGE 3 TASK 2 — THE SUBJECT-TYPE VOCABULARY (F474).
  //   ★★ FIX ROUND 1, M1 — CORRECTED. This used to say the check is here "rather than left to the
  //      database CHECK alone", which claimed a database CHECK on `subject_type` exists. [MEASURED,
  //      review M1] it does not: unlike `topic`/`emitted_by`/`actor`, `keystone.event.subject_type`
  //      is an unconstrained `text` column (0016) — a direct INSERT accepts anything. This check is
  //      therefore the ONLY enforcement at write time, not a friendlier front end for a 23514. The
  //      gap between a rewrite (0136) and new code serving is closed differently: migration 0137
  //      adds a BEFORE INSERT trigger that NORMALISES the three retired literals on the way in, so a
  //      writer that somehow still emitted one lands on the correct vocabulary rather than a wrong
  //      one — belt (JS refusal here) and suspenders (trigger normalisation at the database), same
  //      two-layer pattern as the actor check, but a corrective trigger instead of a CHECK because
  //      the retired literals must keep being ACCEPTED-AND-FIXED for any straggler writer, not
  //      refused, during the gap 0137's own header describes.
  //     See `topics.mjs` `SUBJECT_TYPES` for the full vocabulary reasoning.
  //
  // ★★ NULL IS LEGAL FOR BOTH `subjectType` AND `subjectId` — some events carry no subject at all
  //    (e.g. `money.payment.failed` when no invoice exists to point at, `src/payments/webhook.mjs`).
  //    What is NOT legal is ONE without the other: a `subjectType` with nothing to point at, or a
  //    `subjectId` with no declared type, are both malformed envelopes. [MEASURED] every existing
  //    production emitter in `src/` already passes both together or neither — this check makes that
  //    an enforced invariant rather than an accident of every call site agreeing so far.
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  if (subjectType !== null && !SUBJECT_TYPES.includes(subjectType)) {
    throw new TopicViolation(
      `"${subjectType}" is not a subject type — one of ${SUBJECT_TYPES.join(', ')}. ` +
      `(app_user/user is now "person", document_instance is now "document" — see topics.mjs ` +
      `SUBJECT_TYPE_ALIASES for the retired names; emit() does not translate them, it refuses them.)`);
  }
  if ((subjectType === null) !== (subjectId === null)) {
    throw new TopicViolation(
      `subjectType and subjectId must both be given or both be omitted — got subjectType=` +
      `${JSON.stringify(subjectType)}, subjectId=${JSON.stringify(subjectId)}`);
  }

  // ★★★ STAGE 3 TASK 1 — the actor check. See ACTOR_SHAPE above.
  if (typeof actor !== "string" || !ACTOR_SHAPE.test(actor)) {
    throw new TopicViolation(
      `"${actor}" is not a valid actor — one of "system", "n8n", "worker", "user:<uuid>", ` +
      `"webhook:<provider>"`);
  }

  // ★★★ STAGE 3 TASK 3 — THE PAYLOAD PRIVACY LINT. Last of the checks, and deliberately so: a typo
  //     in the topic or the actor is a different mistake from a name leaking into the payload, and
  //     this project's own rule (M1/M2 above) is to name the FIRST wrong thing, not the last one
  //     found. See assertSafePayload's own header for the full reasoning and the shapes it allows.
  assertSafePayload(payload);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ TASK 9.4 — `sample` IS DERIVED, NOT JUST PASSED THROUGH. F3 of the Task 8 review: a follow-up
  //     event emitted by a job that never saw the ORIGINAL `sample` flag was written `false`, because
  //     the caller was the only source of truth. Precedence, in order:
  //       1. `sample === true` passed in → `true` (a caller may always mark something sample).
  //       2. `subjectType === "person"` resolves (in THIS transaction) to a `keystone.app_user` row
  //          with `is_sample = true` → `true`.
  //       3. otherwise → `false`.
  //   ★★ ONLY `"person"` IS LOOKED UP. Q9-3: `is_sample` lives on `keystone.app_user` only — every
  //      other subject type (account, booking, invoice, …) has no flag of its own to read, so it
  //      falls through to rule 3 untouched. `SUBJECT_TYPE_ALIASES` (`topics.mjs`) is irrelevant here:
  //      `emit()` already REFUSED `app_user`/`user` above (they are not in `SUBJECT_TYPES`), so by
  //      this point `subjectType` can only ever be the post-alias name, `"person"`.
  //   ★★ A `subjectId` THAT DOES NOT RESOLVE (deleted, or simply not there) MUST NOT RAISE — `emit()`
  //      is on the write path of everything, and a missing row here is not this function's problem
  //      to escalate. The lookup returning zero rows falls through to `false` exactly like "no
  //      subject at all" does.
  //   ★ BELT AND SUSPENDERS: RLS already confines this SELECT to the caller's own tenant (FORCE ROW
  //     LEVEL SECURITY, `0001:151-152`, `tenant_isolation` on `keystone.current_tenant_id()`), and
  //     `assertTenantTx` above already proved the GUC is set on `tx`. The explicit `tenant_id = $1`
  //     predicate below is redundant with that policy on purpose, not a substitute for it.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  let effectiveSample = sample === true;
  if (!effectiveSample && subjectType === "person" && subjectId !== null) {
    const { rows: subjectRows } = await tx.query(
      `SELECT is_sample FROM keystone.app_user WHERE tenant_id = $1 AND id = $2`,
      [tenantId, subjectId]);
    effectiveSample = subjectRows.length > 0 && subjectRows[0].is_sample === true;
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ TASK 7.24 / Q7-19 — THE ACTOR COLUMN IS A `CASE`, NOT A BARE `$7`, AND THIS IS THE ONLY
  //     PLACE A KEY'S REQUEST BECOMES `api_key:<token_id>`. Not a second call site, not a change to
  //     the 59 `userActor(...)` callers: a key request has no `appUserId`, so `userActor(null)`
  //     already produced `'system'` before this task, and every one of those call sites still does —
  //     this substitutes the GUC IN THE SAME STATEMENT, after the actor a caller explicitly chose
  //     has already been validated against ACTOR_SHAPE above.
  //   ★★ ONLY WHEN `actor === 'system'`. A caller that passed `'n8n'`, `'worker'`, `webhook:<x>` or an
  //      explicit `user:<uuid>` is NEVER relabelled — the browser-session path (test (d)) cannot be
  //      overwritten by a stale GUC on a pooled connection, because it never passes `'system'` at all.
  //   ★★ `pg_catalog.current_setting(…, true)` — the `true` means "missing reads as NULL", never an
  //      error, so a browser request (which never sets this GUC) takes the `ELSE` branch every time.
  //      `nullif(…, '')` treats an EMPTY string the same as NULL, because `set_config` with `''` and
  //      no `set_config` at all must answer identically — a `''` token id must never become
  //      `'api_key:'` on its own.
  //   ★ WHO SUPPLIES THE CONDITION: THE APPLICATION. `handleApiTokenRequest`
  //     (`src/paths/index.mjs`, 7.23) is the only place `keystone.actor_api_key` is ever set, and it
  //     sets it `SET LOCAL` (transaction-local) on the key path and nowhere else — nothing in this
  //     file, and no test, sets that GUC to force this branch from outside the real request path.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★ B-1 (Run 6): the same statement NOTIFYs `keystone_outbox` with the practice id. Postgres delivers a NOTIFY only when the
  //    transaction COMMITS (a rolled-back emit wakes nobody), and the worker (src/queue/outboxWake.mjs) LISTENs and runs that
  //    practice's dispatch at once — so a webhook or the signed-copy email goes out in about a second instead of waiting for the
  //    once-a-minute sweep (measured 25-150 s). The sweep stays as the backstop: a NOTIFY is lost if no worker is listening.
  const { rows } = await tx.query(
    `WITH ins AS (
       INSERT INTO keystone.event (tenant_id, topic, emitted_by, subject_type, subject_id, payload, actor, sample)
       VALUES ($1,$2,$3,$4,$5,$6,
               CASE WHEN $7 = 'system'
                     AND nullif(pg_catalog.current_setting('keystone.actor_api_key', true), '') IS NOT NULL
                    THEN 'api_key:' || pg_catalog.current_setting('keystone.actor_api_key', true)
                    ELSE $7 END,
               $8)
       RETURNING id, topic, status)
     SELECT id, topic, status, pg_catalog.pg_notify('keystone_outbox', $1::text) AS _woke FROM ins`,
    [tenantId, topic, emittedBy, subjectType, subjectId, JSON.stringify(payload), actor, effectiveSample]);
  const { _woke, ...row } = rows[0];
  return row;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ STAGE 3 TASK 5 — THE 07 RETRY SCHEDULE (spec 02 §2.8, 07 §3/§4.1a). ONE list, used by the
//     per-listener rows AND by the event-level markFailed, so there is no second opinion about how long
//     a wait should be. It replaces the 2^attempts-seconds backoff that spent all five attempts in ~30 s.
//   ★ Six attempts in all: the first run, then a retry after each of these five waits. The failure that
//     follows the 12 h wait is the one that makes a listener `dead`.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★ Exported (Stage 3 Task 7): outbound webhook attempts (src/webhooks/outbound.mjs) import the SAME list.
export const RETRY_SCHEDULE_SECONDS = Object.freeze([60, 300, 1800, 7200, 43200]);
export const LISTENER_MAX_ATTEMPTS = RETRY_SCHEDULE_SECONDS.length + 1;
// ★★ THE EVENT-LEVEL CLAIM BUDGET (0040 counts CLAIMS, so a worker-killing event cannot loop forever).
//    It must exceed LISTENER_MAX_ATTEMPTS: every retry round is one claim, and if the claim budget ran out
//    first, 0040's reaper would kill the event while its listener still had a scheduled retry — the
//    listener would never reach `dead` and no job.gave_up would be written. +2 leaves room for two
//    crashed/released claims; a dead-by-reaper event's open rows are closed out by closeOutDeadEvents.
export const EVENT_CLAIM_BUDGET = LISTENER_MAX_ATTEMPTS + 2;
// SQL for "the wait after attempt N" (N = the row's attempts AFTER counting this one), from the list above.
const SCHEDULE_SQL = (col) =>
  `make_interval(secs => (ARRAY[${RETRY_SCHEDULE_SECONDS.join(",")}])[least(greatest(${col}, 1), ${RETRY_SCHEDULE_SECONDS.length})])`;

/**
 * ★ Claim a batch for processing. SKIP LOCKED so two workers take different rows.
 * ★ Stage 3 Task 5: the dispatcher passes EVENT_CLAIM_BUDGET as the attempt budget. The claim SQL itself
 *   (0040 — per-practice scoping, ORDER BY created_at, FOR UPDATE SKIP LOCKED, the lease) is unchanged;
 *   this only fills the function's existing third parameter instead of leaving its default of 5.
 */
export async function claimEvents(tx, limit = 100, { maxAttempts = null } = {}) {
  const { rows } = maxAttempts === null
    ? await tx.query(`SELECT * FROM keystone.claim_events($1)`, [limit])
    : await tx.query(`SELECT * FROM keystone.claim_events($1, interval '15 minutes', $2)`, [limit, maxAttempts]);
  return rows;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ STAGE 3 TASK 5 — WHAT A STORED ERROR MAY SAY (no secrets, no client text — spec 02 §2.4, 07 §4.7).
//
//   ★★ A POSTGRES ERROR'S MESSAGE IS NOT STORED AT ALL. It can quote the failing row's own values:
//      `invalid input syntax for type uuid: "<value>"`, a trigger's RAISE text (0099's reference guard
//      names the practice slug), and the DETAIL of a unique/check/not-null violation quotes the whole row.
//      What is stored instead is what identifies the failure without any row data: the SQLSTATE, its
//      condition name for the common ones, and the CATALOGUE IDENTIFIERS pg reports separately —
//      constraint, table, column. Those are schema names, not data.
//   ★ An APPLICATION error (our own `throw new Error(...)`) keeps its message, because that is where the
//     useful diagnosis is ("carries no sent_by") — but only its first line, with anything shaped like an
//     email address or a URL redacted, capped at 300 characters. Our messages interpolate ids and topics;
//     the redaction is for a library error that interpolates a destination.
//   ★ The column is additionally CHECKed at <= 500 characters in 0139.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const SQLSTATE_NAMES = Object.freeze({
  "22012": "division_by_zero", "22P02": "invalid_text_representation", "22001": "string_data_right_truncation",
  "23502": "not_null_violation", "23503": "foreign_key_violation", "23505": "unique_violation",
  "23514": "check_violation", "25P02": "in_failed_sql_transaction", "40001": "serialization_failure",
  "40P01": "deadlock_detected", "42501": "insufficient_privilege", "42P01": "undefined_table",
  "42703": "undefined_column", "42883": "undefined_function", "55P03": "lock_not_available",
  "57014": "query_canceled", "P0001": "raise_exception",
});
const IDENT = /^[A-Za-z_][A-Za-z0-9_$.]{0,62}$/;

export function safeErrorText(err) {
  const cls = (err && typeof err === "object" && err.constructor?.name) || typeof err;
  const code = typeof err?.code === "string" ? err.code : null;
  if (code && /^[0-9A-Z]{5}$/.test(code) && typeof err.severity === "string") {
    const parts = [`pg ${code}`];
    if (SQLSTATE_NAMES[code]) parts.push(SQLSTATE_NAMES[code]);
    for (const k of ["constraint", "table", "column"]) {
      if (typeof err[k] === "string" && IDENT.test(err[k])) parts.push(`${k}=${err[k]}`);
    }
    // ★ Task 9.5 / CT-095 — scrubbed before the length cap, so redaction can never be truncated
    //   back into a partial credential.
    return scrubSecrets(parts.join(" ")).slice(0, 300);
  }
  const raw = String(err?.message ?? err ?? "").split("\n")[0]
    .replace(/[^\s@"'<>]+@[^\s@"'<>]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, "[url]")
    .trim();
  const text = `${cls}${code && /^[A-Z0-9_]{2,40}$/.test(code) ? ` ${code}` : ""}: ${raw || "failed with no message given"}`;
  // ★ Task 9.5 / CT-095 — scrubbed before the length cap, same reasoning as above.
  return scrubSecrets(text).slice(0, 300);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ STAGE 3 TASK 5 — PER-LISTENER DELIVERY ROWS (keystone.event_delivery, 0139).
//     Every function below runs on the dispatcher's tenant transaction (RLS scopes it; the explicit
//     tenant_id predicates say so in the text as well).
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** The event's existing delivery rows, oldest first. Empty on the event's first dispatch. */
export async function deliveryRows(tx, { tenantId, eventId }) {
  const { rows } = await tx.query(
    `SELECT id, listener, status, attempts, next_attempt_at <= now() AS due
       FROM keystone.event_delivery WHERE tenant_id = $1 AND event_id = $2 ORDER BY created_at, listener`,
    [tenantId, eventId]);
  return rows;
}

/**
 * ★ First dispatch of an event: one `pending` row per planned listener. ON CONFLICT DO NOTHING, so a
 *   crashed first attempt that already inserted some rows cannot duplicate them.
 * ★ `skipped` names listeners recorded as not applicable, with `skipReason` in last_error — Task 8 uses it
 *   for sample events' outbound listeners (stored and shown, never delivered — spec 02 §2.9).
 */
export async function planDeliveries(tx, { tenantId, eventId, listeners, skipped = [], skipReason = null }) {
  for (const listener of listeners) {
    await tx.query(
      `INSERT INTO keystone.event_delivery (tenant_id, event_id, listener)
       VALUES ($1, $2, $3) ON CONFLICT (tenant_id, event_id, listener) DO NOTHING`,
      [tenantId, eventId, listener]);
  }
  for (const listener of skipped) {
    await tx.query(
      `INSERT INTO keystone.event_delivery (tenant_id, event_id, listener, status, last_error)
       VALUES ($1, $2, $3, 'skipped', left($4, 500)) ON CONFLICT (tenant_id, event_id, listener) DO NOTHING`,
      [tenantId, eventId, listener, skipReason]);
  }
  return deliveryRows(tx, { tenantId, eventId });
}

export async function recordDelivered(tx, { tenantId, deliveryId, handedOffTo = null }) {
  await tx.query(
    `UPDATE keystone.event_delivery
        SET status = 'delivered', attempts = attempts + 1, delivered_at = now(), last_error = NULL,
            handed_off_to = $3, updated_at = now()
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, deliveryId, handedOffTo]);
}

/** A listener row that no longer names a registered listener (retired in a later deploy). */
export async function recordSkipped(tx, { tenantId, deliveryId, reason }) {
  await tx.query(
    `UPDATE keystone.event_delivery SET status = 'skipped', last_error = $3, updated_at = now()
      WHERE tenant_id = $1 AND id = $2`, [tenantId, deliveryId, reason]);
}

/**
 * ★★ One failed attempt. `failed` with the next attempt on the 07 schedule, or `dead` once this was the
 *    LISTENER_MAX_ATTEMPTS-th attempt. `errorText` must already be `safeErrorText(err)`.
 * @returns {{status: 'failed'|'dead', attempts: number}}
 */
// ★★ Stage 4 Task 6 (Stage 3 carry) — `retryable` comes from the job policy's classifier (src/queue/jobPolicy.mjs):
//    false → `dead` on THIS attempt (07 §4.5: validation / forbidden / internal go straight to gave up). It is
//    REQUIRED, not defaulted, so a caller cannot forget to decide.
export async function recordListenerFailure(tx, { tenantId, deliveryId, errorText, retryable, failureKind = null }) {
  if (typeof retryable !== "boolean") throw new Error("recordListenerFailure: `retryable` (boolean) is required");
  // ★★★ Stage 4 Task 8 fix 1 (I-1) — THE KIND IS KEPT, not only used and thrown away. The dispatcher has already
  //     classified this failure (classifyFailure) to decide whether to retry it; the dead-listener sweep needs the same
  //     judgement later to decide whether a PERSON in the practice can act on the death, and `last_error` is prose, not
  //     a judgement. A NULL kind is read downstream as "ours" — never as "the practice's".
  const { rows } = await tx.query(
    `UPDATE keystone.event_delivery
        SET attempts = attempts + 1,
            status = CASE WHEN attempts + 1 >= $4 OR NOT $5 THEN 'dead' ELSE 'failed' END,
            next_attempt_at = CASE WHEN attempts + 1 >= $4 OR NOT $5 THEN next_attempt_at
                                   ELSE now() + ${SCHEDULE_SQL("attempts + 1")} END,
            last_error = left(coalesce(nullif(btrim($3), ''), 'failed with no message given'), 500),
            failure_kind = $6,
            updated_at = now()
      WHERE tenant_id = $1 AND id = $2
      RETURNING status, attempts, failure_kind`,
    [tenantId, deliveryId, errorText, LISTENER_MAX_ATTEMPTS, retryable, failureKind]);
  return rows[0];
}

/**
 * ★★★ THE EVENT'S STATUS IS DERIVED FROM ITS LISTENERS. `processed` once every row is delivered, dead or
 *     skipped; otherwise `failed`, eligible again at the EARLIEST of its open rows' next attempts (so each
 *     listener keeps its own schedule), with the open rows' reasons as the event's last_error.
 */
export async function settleEvent(tx, { tenantId, eventId }) {
  const { rows } = await tx.query(
    `WITH d AS (
       SELECT count(*) FILTER (WHERE status IN ('pending', 'failed'))            AS open_n,
              min(next_attempt_at) FILTER (WHERE status IN ('pending', 'failed')) AS next_at,
              string_agg(listener || ': ' || last_error, ' | ' ORDER BY listener)
                FILTER (WHERE status = 'failed')                                  AS open_errors,
              -- ★ Stage 4 Task 6: each dead listener WITH its reason — since a fault now gives up on its first
              --   attempt (07 §4.5), the event row is where a reader looks first, and "gave up: <names>" alone
              --   sent them to another table to learn why.
              string_agg(listener || ' (' || coalesce(last_error, 'no reason recorded') || ')', ' | ' ORDER BY listener)
                FILTER (WHERE status = 'dead') AS dead_listeners
         FROM keystone.event_delivery WHERE tenant_id = $1 AND event_id = $2)
     UPDATE keystone.event e
        SET status          = CASE WHEN d.open_n = 0 THEN 'processed' ELSE 'failed' END,
            processed_at    = CASE WHEN d.open_n = 0 THEN now() ELSE NULL END,
            claimed_at      = NULL,
            next_attempt_at = CASE WHEN d.open_n = 0 THEN e.next_attempt_at ELSE d.next_at END,
            last_error      = CASE WHEN d.open_n = 0
                                   THEN CASE WHEN d.dead_listeners IS NULL THEN NULL
                                             ELSE left('gave up: ' || d.dead_listeners, 1000) END
                                   ELSE left(coalesce(d.open_errors, 'listener pending'), 1000) END
       FROM d
      WHERE e.tenant_id = $1 AND e.id = $2
      RETURNING e.status, e.next_attempt_at`,
    [tenantId, eventId]);
  return rows[0];
}

/**
 * ★ An event 0040's reaper made `dead` (its CLAIM budget spent — a crash loop) can still hold open
 *   delivery rows, which nothing would ever run. They are closed out as `dead` too, so the owed-report
 *   sweep below writes their job.gave_up rather than leaving a silent death.
 */
export async function closeOutDeadEvents(tx, { tenantId }) {
  const { rowCount } = await tx.query(
    `UPDATE keystone.event_delivery d
        SET status = 'dead', updated_at = now(),
            -- ★ Task 8 fix 1 (I-1): killed by the EVENT's budget, not by a failure of its own that anyone classified.
            --   That is ours (internal), never something a practice is asked to fix. A kind already recorded stands.
            failure_kind = coalesce(d.failure_kind, 'internal'),
            last_error = left(coalesce(d.last_error || ' | ', '') || 'event claim budget spent', 500)
       FROM keystone.event e
      WHERE d.tenant_id = $1 AND e.tenant_id = $1 AND e.id = d.event_id
        AND e.status = 'dead' AND d.status IN ('pending', 'failed')`,
    [tenantId]);
  return rowCount;
}

// ★★ Fix round 1 (F2b) — A REPORT THAT ALWAYS FAILS IS BOUNDED. After this many failed writes of a dead
//    row's job.gave_up, the row is no longer selected: one loud error is logged at the transition
//    (src/queue/tasks.mjs reportGaveUps) and the row keeps gave_up_reported_at NULL with the count at the
//    bound — a visible "never reported", not a retry every minute forever.
export const GAVE_UP_REPORT_MAX_ATTEMPTS = 5;

/**
 * Dead rows whose job.gave_up platform event has not been written yet, below the report bound.
 * ★ Ordered by FAILED REPORT ATTEMPTS first: a row whose write keeps failing sinks behind rows that have
 *   never been tried, so it cannot hold the front of the window (review F2: `ORDER BY updated_at` never
 *   moved for a failing row, so a stuck 100 starved everything behind them).
 */
export async function unreportedDeadDeliveries(tx, { tenantId, limit = 100 }) {
  const { rows } = await tx.query(
    `SELECT id, event_id, listener, attempts, gave_up_report_attempts, failure_kind, gave_up_owned_at
       FROM keystone.event_delivery
      WHERE tenant_id = $1 AND status = 'dead' AND gave_up_reported_at IS NULL
        AND gave_up_report_attempts < $3
      ORDER BY gave_up_report_attempts, updated_at, id LIMIT $2`,
    [tenantId, limit, GAVE_UP_REPORT_MAX_ATTEMPTS]);
  return rows;
}

/** One more failed job.gave_up write for each row. Returns the rows with their new count. */
export async function recordGaveUpReportFailures(tx, { tenantId, deliveryIds }) {
  if (deliveryIds.length === 0) return [];
  const { rows } = await tx.query(
    `UPDATE keystone.event_delivery SET gave_up_report_attempts = gave_up_report_attempts + 1
      WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND gave_up_reported_at IS NULL
      RETURNING id, event_id, listener, gave_up_report_attempts`,
    [tenantId, deliveryIds]);
  return rows;
}

/**
 * ★★★ Stage 4 Task 8 fix 1 (review M-6) — "THE OWNER LOOP HAS CONSIDERED THIS DEATH", written INSIDE the practice's
 *     transaction, whatever the outcome was. The job.gave_up report runs AFTER that transaction commits, so a crash
 *     between the two leaves gave_up_reported_at NULL and the report is retried next sweep — and the owner loop used to
 *     be retried with it, reopening a task the practice had already dealt with and closed. Marking the death itself
 *     separates the two: the report may be retried as often as it needs; the owner is decided exactly once.
 */
export async function markGiveUpOwned(tx, { tenantId, deliveryIds }) {
  if (deliveryIds.length === 0) return 0;
  const { rowCount } = await tx.query(
    `UPDATE keystone.event_delivery SET gave_up_owned_at = now()
      WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND gave_up_owned_at IS NULL`,
    [tenantId, deliveryIds]);
  return rowCount;
}

export async function markGaveUpReported(tx, { tenantId, deliveryIds }) {
  if (deliveryIds.length === 0) return 0;
  const { rowCount } = await tx.query(
    `UPDATE keystone.event_delivery SET gave_up_reported_at = now(), updated_at = now()
      WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND status = 'dead' AND gave_up_reported_at IS NULL`,
    [tenantId, deliveryIds]);
  return rowCount;
}

export async function markProcessed(tx, eventId) {
  await tx.query(
    `UPDATE keystone.event SET status='processed', processed_at=now(), last_error=NULL
      WHERE id=$1`, [eventId]);
}

/**
 * ★★ A failure returns the event to the queue — until it has been tried enough times, at which
 * point it becomes `dead` rather than retrying forever.
 * ★ An event retried without limit is an outage that never resolves and never alerts: the queue
 * looks busy, the backlog grows, and nothing says why.
 *
 * ★★★ P18.6(a) — AND IT NOW SETS THE BACKOFF, because until migration 0040 there was nowhere to put
 * one. [MEASURED] `claim_events` re-claimed `'failed'` with NO time predicate, so five attempts burned
 * in a tight spin and the row was `dead` in well under a second. **A retry budget spent instantly is
 * not a retry policy** — it is the same outage as no retries at all, reached faster.
 *   ★ The delay is computed from `attempts`, which migration 0040 defines as ATTEMPTS STARTED. See that
 *     file's header for why counting claims rather than failures is the safe choice once a lease exists.
 * ★★ STAGE 3 TASK 5 — this is now the EVENT-LEVEL failure only (the dispatcher could not even plan the
 *    event's listeners). A listener's own failure is recorded on its event_delivery row instead
 *    (`recordListenerFailure`) and the event's status is derived from those rows (`settleEvent`).
 *    Both use the 07 schedule; the event-level budget defaults to LISTENER_MAX_ATTEMPTS to match.
 */
export async function markFailed(tx, eventId, error, { maxAttempts = LISTENER_MAX_ATTEMPTS } = {}) {
  const { rows } = await tx.query(
    `UPDATE keystone.event
        SET status = CASE WHEN attempts >= $3 THEN 'dead' ELSE 'failed' END,
            -- ★★★ NEVER AN EMPTY REASON. Migration 0040 adds event_dead_states_its_reason, so a dead
            --     row with a blank last_error is REFUSED by the database — and String(err).slice(...)
            --     is empty whenever somebody throws a bare Error with no message. Without this
            --     coalesce the guard that exists to stop silent deaths would itself turn a failure
            --     into a constraint violation, which is a worse failure than the one being recorded.
            --   ★ NOTE, no backticks in here: this SQL lives in a JS template literal and a backtick
            --     would end the string. [EXECUTED] that is exactly how this line first failed to parse.
            last_error = coalesce(nullif(btrim($2), ''), 'failed with no message given'),
            -- ★★ THE LEASE IS RELEASED. A failure is a finished attempt, so the row must stop looking
            --    like work in progress — but it must not become claimable in the same instant, which
            --    is what the backoff below is for.
            claimed_at = NULL,
            -- ★★★ STAGE 3 TASK 5 — THE 07 SCHEDULE, NOT 2^attempts SECONDS. [MEASURED, spec 02 §2.8]
            --     the old formula (2s, 4s, 8s … capped at 1 h) spent all five attempts in ~30 s, so a
            --     provider outage of one minute killed the event. Now: 1 min, 5 min, 30 min, 2 h, 12 h,
            --     from the one list in RETRY_SCHEDULE_SECONDS (the per-listener rows use the same list).
            --   ★ Still computed in SQL from the row's own attempts column, so a caller cannot pass a delay.
            next_attempt_at = now() + ${SCHEDULE_SQL("attempts")}
      WHERE id = $1
      RETURNING status, attempts, next_attempt_at`,
    [eventId, String(error).slice(0, 1000), maxAttempts]);
  return rows[0];
}

/**
 * ★★★ P18.6(a) — RELEASE A CLAIM WITHOUT RECORDING A FAILURE. NEW, AND IT IS NOT `markFailed`.
 *
 * ★★ A worker shutting down cleanly (SIGTERM on a deploy) has NOT failed the event — it simply is not
 *    going to finish it. Calling `markFailed` there would burn a retry and write a `last_error` that
 *    describes a deployment rather than a problem with the event, and after five deploys a perfectly
 *    good event would be `dead` with five misleading reasons attached.
 *  ★ So this returns the row to the queue immediately, leaves `attempts` where it is (the attempt DID
 *    happen and is already counted at claim), and records nothing as wrong.
 * ★ Without it the only alternatives are a lie (`markFailed`) or silence (let the lease expire, which
 *   costs up to the full lease for work that could restart now).
 */
export async function releaseClaim(tx, eventId) {
  const { rows } = await tx.query(
    `UPDATE keystone.event
        -- ★★ pending, NOT failed. Nothing went wrong, so the row must not carry a status whose whole
        --    meaning is that something did — failed rows are what an operator greps for when hunting a
        --    problem, and a deploy is not a problem.
        --  ★ No backticks in SQL inside a template literal; see markFailed above for why.
        SET status = 'pending', claimed_at = NULL, next_attempt_at = now()
      WHERE id = $1 AND status = 'claimed'
      RETURNING id, status, attempts`,
    [eventId]);
  return rows[0] ?? null;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ TASK 9.14 (CT-096, Q9-6) — THE OUTBOX → n8n SINK. This is the ONLY part of this file this
//     task touches — `emit()` (9.4's, `:344-481`) and `safeErrorText` (9.5's, `:541-561`) are
//     untouched, exactly as BUILD-PROCESS.md:161 permits for a shared file split by named part.
//
// ★ Q9-6 — "the the platform side only": this function is the CALLABLE machinery, proved here against an
//   injected transport (`test/n8n_send.test.mjs`) and NOT wired into `src/queue/tasks.mjs`'s
//   `LISTENER_REACH` dispatch table in this task — that file is not in 9.14's file list, and its own
//   comment already says so: "n8n is not a listener yet; when it is added it is 'outbound'"
//   (`src/queue/tasks.mjs:1243`). Standing up a real n8n instance to deliver to is a the maintainer/infra
//   dependency (F384: the prior n8n install's data was destroyed 10 July 2026 — nothing to migrate).
//
// ★★★ THREE INDEPENDENT REFUSALS, each of which is silent (no delivery row, no error) — not a
//     retryable failure:
//   1. `n8n_send` OFF for the event's own tenant (`flagIsOn`, CT-072) — 0218 seeds it off, so this
//      is the SHIPPED state. An unknown flag key still raises, same as everywhere `flagIsOn` is used.
//   2. `event.sample === true` — never delivered outside (spec 02 §2.9 / 07 §4.3), the same rule
//      `LISTENER_REACH`'s "outbound" class already applies to every OTHER outside-reaching listener;
//      enforced here directly because this sink sits outside that dispatch table (above).
//   3. `event.created_at` older than `sinceUtc` — NO REPLAY OF HISTORY. MEASURED: `keystone.event`
//      held 68 rows before this task; a freshly connected n8n receiving all 68 would fire 68
//      automations for things that already happened. `sinceUtc` defaults to "now", so a caller that
//      does not override it can never accidentally replay anything.
//
// ★★ ONE ROW PER ATTEMPT (`keystone.n8n_delivery`, migration 0219), written BEFORE the send and then
//    updated with the outcome — copied from `keystone.webhook_delivery`'s own discipline
//    (`db/migrations/0047_outbound_webhooks.sql`, read and mirrored, not invented). A send failure
//    is recorded on that row AND RE-THROWN (`N8nUnavailable`, carrying `kind`/`retryable`/
//    `retryAfterSeconds` — 9.14's other named part, `src/automations/n8n.mjs`) — this function never
//    swallows a dependency failure; a future scheduled retry (not built by this task) decides what
//    to do with it, the same separation `recordListenerFailure`/`deliverEvent` already keep.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * @param tx      a tenant transaction (`assertTenantTx`).
 * @param event   a row shaped like `keystone.event`: `{id, tenant_id, topic, payload, actor,
 *                subject_type, subject_id, sample, created_at}`.
 * @param opts.sendEvent  injected transport — defaults to `n8n.mjs`'s real `sendEvent`. This is how
 *                a test (and, eventually, a real caller) supplies a fake n8n (F384: there is no real
 *                instance to reach today).
 * @param opts.sinceUtc   events created before this are never delivered. Defaults to `new Date()`
 *                (now) so a caller that forgets to set it can never replay history by accident.
 * @returns {Promise<{sent: boolean, reason?: string}>}
 */
export async function sinkEventToN8n(tx, event, { sendEvent = n8nSendEvent, sinceUtc = new Date() } = {}) {
  assertTenantTx(tx, "sinkEventToN8n()");
  if (!event || typeof event !== "object" || !event.id || !event.tenant_id) {
    throw new Error("sinkEventToN8n: event.id and event.tenant_id are required");
  }
  const { id: eventId, tenant_id: tenantId } = event;

  // ── 1. the kill switch (CT-072: an unknown key still raises, it never reads as "off") ──────────
  if (!(await flagIsOn(tx, "n8n_send", tenantId))) return { sent: false, reason: "flag_off" };
  // ── 2. sample events are never delivered outside (spec 02 §2.9 / 07 §4.3) ───────────────────────
  if (event.sample === true) return { sent: false, reason: "sample_event" };
  // ── 3. no replay of history — bounded by the SINK's own creation, never the event table's ──────
  if (new Date(event.created_at).getTime() < new Date(sinceUtc).getTime()) {
    return { sent: false, reason: "before_sink" };
  }

  const { rows: attemptRows } = await tx.query(
    `SELECT coalesce(max(attempt), 0) + 1 AS next_attempt
       FROM keystone.n8n_delivery WHERE tenant_id = $1 AND event_id = $2`,
    [tenantId, eventId]);
  const attempt = attemptRows[0].next_attempt;

  // ★★★ Written BEFORE the send, exactly like webhook_delivery — a crash mid-send leaves evidence
  //     that an attempt was made, rather than silence.
  await tx.query(
    `INSERT INTO keystone.n8n_delivery (tenant_id, event_id, attempt, status)
     VALUES ($1, $2, $3, 'attempted')`,
    [tenantId, eventId, attempt]);

  try {
    await sendEvent(event);
  } catch (err) {
    await tx.query(
      `UPDATE keystone.n8n_delivery
          SET status = 'failed', last_error = $4, completed_at = now()
        WHERE tenant_id = $1 AND event_id = $2 AND attempt = $3`,
      [tenantId, eventId, attempt, safeErrorText(err)]);
    throw err; // ★ never swallowed — see the header block above.
  }

  await tx.query(
    `UPDATE keystone.n8n_delivery
        SET status = 'sent', completed_at = now()
      WHERE tenant_id = $1 AND event_id = $2 AND attempt = $3`,
    [tenantId, eventId, attempt]);
  return { sent: true };
}
