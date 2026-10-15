// P18.7 — THE STRIPE CHARGE PATH. BUILT, FLAGGED, AND LEFT OFF.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ HARD LIMIT 1, AND IT IS THE WHOLE DESIGN OF THIS FILE, NOT A COMMENT ON IT:
//     **NO STRIPE CHARGE, SUBSCRIPTION, INVOICE OR PAYMENT INTENT WITHOUT TY IN-SESSION.**
//     So this module ships with the switch OFF, refuses a live key outright, refuses a charge with no
//     named in-session approval, and has never been executed against Stripe. Every gate around it
//     drives the REFUSALS for real and the SUCCESS path against an injected fake.
//   ★ "Build it, gate it behind a flag, and leave it OFF. Record, do not surface." — P18.7, verbatim.
//
// ★★★ THE FOUR INDEPENDENT LOCKS. A charge happens only if ALL FOUR agree, and each one fails CLOSED.
//     1 · `KEYSTONE_STRIPE_CHARGES_ENABLED` is exactly the string `"true"`. Absent → OFF.
//     2 · the secret key is a **TEST** key (`sk_test_…`). A `sk_live_…` key is refused by default.
//     3 · a live key additionally needs `KEYSTONE_STRIPE_LIVE_CHARGE_APPROVED_BY` to NAME who approved
//         it — because "someone set an env var" is not a person, and hard limit 1 is about a person.
//     4 · the caller must pass an `idempotencyKey`. Stripe deduplicates on it; without one a retry is
//         a SECOND CHARGE. There is no default and no generated fallback — see below.
//   ★★ ONE LOCK WOULD HAVE BEEN ENOUGH TO PASS A TEST. Four exist because the failure being defended
//      against is not a bug, it is **real money leaving a real card**, and the modes are different:
//      a flag flipped by accident, the wrong key in an env, an approval nobody gave, a retry storm.
//
// ★★★ WHY THERE IS NO GENERATED IDEMPOTENCY KEY. A key generated inside this function would be new on
//     every call, so the retry it exists to protect against would carry a DIFFERENT key and Stripe
//     would charge twice — a fallback that looks like the safety feature while removing it. The key
//     must come from the thing that is stable across retries (the request's `Idempotency-Key`, which
//     P15B.13 already threads through every mutating route).
//
// ★★ WHAT THIS MODULE DELIBERATELY DOES NOT DO — and where those facts DO get recorded:
//   · It does not write `keystone.payment`. **§Z2.12: "payment status is tracked by WEBHOOK, not
//     polling."** `src/payments/webhook.mjs` owns that row, and its idempotency is a UNIQUE INDEX
//     rather than a check in JS. Two writers to one row is how an invoice comes to look overpaid.
//   · RULING CHANGED, 29 Sep 2026 — the maintainer: "mount it behind the Held-button confirmation." One route now
//     reaches this: `POST /api/engagements/attendance/settle` → `src/booking/settleBooking.mjs`,
//     behind a staff confirmation that names the amount before it runs (db/gates/p18_charge_path.mjs
//     asserts it is the ONLY caller). All four locks below are unchanged — mounting the route does
//     not enable a real charge; the flag and a test/live key still decide that, separately.
//   · It does not decide WHETHER to bill. A caller decides; this performs one request and reports.
//
// ★★★ AND THE HONEST GAP, STATED RATHER THAN PAPERED OVER. There is **no `charge_attempt` table**. The
//     attempt is recorded as `money.charge.attempted` in the caller's transaction, and the OUTCOME
//     arrives later by webhook. So a crash between the emit and Stripe's reply leaves an event saying
//     "we asked" with no answer next to it. **That is the correct record, not a defect:** the webhook
//     is the source of truth for the outcome, and inventing a second one here would put two writers
//     on the same fact. What must never happen is the reverse — a charge with no record that it was
//     attempted — and the emit-before-call ordering is what prevents that.

import { emit, userActor } from "../events/outbox.mjs";
import { callOutside } from "../http/outside.mjs";
import { metadataFor, paymentDescription } from "./metadata.mjs";
import { encodeForm } from "./stripeConnected.mjs";
// ★★★ Task 9.13 — THE PER-PRACTICE KILL SWITCH, distinct from the four HARD LIMIT 1 locks above
//     (those are global safety locks; this is an operator's per-practice on/off, same as the other
//     seven provider modules). `tx` is already this function's first parameter, already scoped to
//     `tenantId` (the sample-refusal read three lines below already relies on that same fact), so
//     no new transaction is opened here — read fresh every call, no cache (flags.mjs's own rule).
import { flagIsOn } from "../platform/flags.mjs";
// ★★★ BOOKING OVERHAUL, 29 Sep 2026 — [MEASURED, live, mounting the first real caller] every one of
//   these four classes extended plain `Error` with a `statusCode` property the HTTP boundary never
//   reads — the identical defect this file's own header already documents for `SlotTakenError`
//   ("the fix is the SUPERCLASS, not a statusCode property... the boundary reads statusCode on
//   NOTHING"). It was invisible until today because P18.7 shipped this whole module unmounted: no
//   route had ever driven one of these errors through the real HTTP layer before
//   `settleBooking.mjs` did. Clicking "Held" → "Charge the card on file" with the flag off (its
//   shipped, correct, off-by-default state) returned a bare 500 "something went wrong" instead of
//   the clean, named refusal the message already describes — caught by actually clicking the button,
//   not by reading the code.
import { AppError, ErrorKind } from "../http/errors.mjs";

const STRIPE_INTENTS_URL = "https://api.stripe.com/v1/payment_intents";
const SECTION = "money";

/** ★ The flag's name, exported so gates and the health check assert the same string, never a copy. */
export const CHARGE_FLAG = "KEYSTONE_STRIPE_CHARGES_ENABLED";
const LIVE_APPROVAL_VAR = "KEYSTONE_STRIPE_LIVE_CHARGE_APPROVED_BY";
export const SECRET_KEY_VAR = "KEYSTONE_STRIPE_SECRET_KEY";

/** ★★ SHIPPED STATE, asserted by a gate so it cannot drift to `false` unnoticed. */
export const CHARGE_PATH_SHIPS_OFF = true;

// ★ The taxonomy in http/errors.mjs is CLOSED at nine kinds and has no literal 503 — FORBIDDEN (403)
//   is the closest honest fit for "this capability is deliberately off and will not become
//   available without a person turning it on", which is not a transient outage. `instanceof
//   ChargePathDisabled` still holds (db/gates/p18_charge_path.mjs's own assertion) — extending
//   AppError adds the correct HTTP routing without losing the specific class.
export class ChargePathDisabled extends AppError {
  constructor(message) { super(ErrorKind.FORBIDDEN, message); this.name = "ChargePathDisabled"; }
}
export class ChargeRefused extends AppError {
  constructor(message) { super(ErrorKind.VALIDATION, message); this.name = "ChargeRefused"; }
}
// ★ Left as a plain Error, deliberately: the boundary's OWN fallback for an unrecognised error is
//   INTERNAL/500 — exactly what a real misconfiguration (an absent or malformed key) should answer
//   with, and the generic 5xx message it already produces is the right one to show a client.
export class ChargeConfigError extends Error {
  constructor(message) { super(message); this.name = "ChargeConfigError"; this.statusCode = 500; }
}
// ★★★ Task 9.13 — distinct from `ChargePathDisabled` on purpose: that class names HARD LIMIT 1's
//     own `CHARGE_FLAG` being off (the shipped, product-wide state); this one names a platform
//     operator's per-practice `stripe_enabled` switch being off. Two different facts, two names —
//     conflating them would make a `/platform/flags` change read as "the whole charge path
//     shipped off", which is not what happened.
export class ChargeServiceDisabled extends AppError {
  constructor(message) { super(ErrorKind.FORBIDDEN, message); this.name = "ChargeServiceDisabled"; }
}

/**
 * LOCK 1 — is the charge path switched on?
 *
 * ★★★ ONLY THE EXACT STRING `"true"`. A near-miss (`"1"`, `"TRUE"`, `"yes"`, `"on"`) **THROWS** rather
 *     than being treated as either value. Silently reading it as ON would charge a card on a typo;
 *     silently reading it as OFF would leave an operator who believes billing is live staring at a
 *     system that quietly bills nobody, which is the failure shape this project keeps recording.
 *     ★ Absent or empty is OFF, with no noise — that is the shipped state and it is not a mistake.
 */
export function chargesEnabled(env = process.env) {
  const raw = env[CHARGE_FLAG];
  if (raw === undefined || raw === "" ) return false;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new ChargeConfigError(
    `${CHARGE_FLAG} is set to ${JSON.stringify(raw)}, which is neither "true" nor "false". ★ It is ` +
    `NOT guessed in either direction: reading it as ON would charge a card on a typo, and reading it ` +
    `as OFF would leave billing silently dead while looking configured.`);
}

/**
 * ★★★ F478 — THE ONE DEFINITION OF WHAT A STRIPE KEY'S SHAPE MEANS. Exported so any OTHER caller
 *     that needs to tell a live key from a test key (`src/provisioning/advance.mjs`'s F478 step 5
 *     live/test check, at minimum) reuses THIS classification rather than writing a second regex
 *     for "live" — a second copy of that fact is exactly the duplicate-truth defect this whole
 *     project keeps re-discovering. `src/health/index.mjs`'s staging fingerprint scan uses its own
 *     regex (`/^(sk|rk)_live_/`) deliberately (R23 — see that file), because it is answering a
 *     different question ("could a live key be sitting under ANY name"); everything that is
 *     answering THIS question — "is the key this deployment has a test key, a live key, or not a
 *     recognisable Stripe key at all" — calls this function instead.
 * @param {string} key   already known to be non-empty (callers check that first)
 * @returns {"test"|"live"|"malformed"}
 */
export function classifyStripeKeyShape(key) {
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) return "live";
  if (key.startsWith("sk_test_") || key.startsWith("rk_test_")) return "test";
  return "malformed";
}

/**
 * ★ SHARED SHAPE CHECK — LOCK 2 only ("is this even a usable Stripe key"), no approval check.
 *   Split out so both key getters below enforce the SAME absent/malformed rule instead of two
 *   copies drifting apart.
 */
function requirePresentWellFormedKey(env) {
  const key = env[SECRET_KEY_VAR];
  if (typeof key !== "string" || key.trim() === "") {
    throw new ChargeConfigError(
      `${SECRET_KEY_VAR} is not set, so no Stripe call can be made. ★ There is deliberately NO ` +
      `fallback — a hardcoded key would post through somebody else's Stripe account.`);
  }
  const k = key.trim();
  const shape = classifyStripeKeyShape(k);
  if (shape === "malformed") {
    throw new ChargeConfigError(
      `${SECRET_KEY_VAR} does not look like a Stripe secret key (expected sk_test_… / sk_live_…). ★ It ` +
      `is refused rather than sent: a malformed credential posted to Stripe is an authentication ` +
      `failure that reads like an outage.`);
  }
  // ★★★ A LIVE KEY NEVER LEAVES PRODUCTION (QUEUE §12.1, sandbox). Every Stripe path — charges AND configuration
  //     (the mirror, products, customers, draft invoices) — funnels through here, so this one line is what makes
  //     "sandbox can never touch real money" true rather than a convention. `KEYSTONE_ENVIRONMENT` is one of
  //     local|staging|production (health/index.mjs); only `production` may hold a live key.
  if (shape === "live" && env.KEYSTONE_ENVIRONMENT !== "production") {
    throw new ChargeConfigError(
      `${SECRET_KEY_VAR} is a LIVE key but KEYSTONE_ENVIRONMENT is ${JSON.stringify(env.KEYSTONE_ENVIRONMENT ?? null)}, not "production". ` +
      `★ A live Stripe key is refused everywhere except production: sandbox and local use test keys (sk_test_…).`);
  }
  return { key: k, shape };
}

/**
 * LOCKS 2 and 3 — the key, and what kind of key it is allowed to be. ★★★ FOR MONEY-MOVING CALLS
 *   ONLY (a charge, a payment intent, `POST /invoices/{id}/pay`, anything that makes Stripe bill a
 *   card on its own) — this is HARD LIMIT 1's own gate, and it is deliberately the narrow one.
 * ★ Returns the key. NEVER log, echo or store the return value — it is a live credential.
 */
export function stripeSecretKey(env = process.env) {
  const { key: k, shape } = requirePresentWellFormedKey(env);
  if (shape === "live") {
    const approver = env[LIVE_APPROVAL_VAR];
    if (typeof approver !== "string" || approver.trim() === "") {
      throw new ChargeConfigError(
        `${SECRET_KEY_VAR} is a LIVE key and ${LIVE_APPROVAL_VAR} does not name who approved using it. ` +
        `★ HARD LIMIT 1: a live charge is real money on a real card and needs a PERSON's approval in ` +
        `the session it happens in. Verification uses a TEST key (sk_test_…).`);
    }
  }
  return k;
}

/**
 * ★★★ the maintainer's ruling, 29 Sep 2026 — HARD LIMIT 1 was always scoped to the CHARGE PATH
 *     (`specs/00-foundations/08-environments-and-test-mode.md` §2: "Stripe **charge path**...
 *     refuses live keys unless `KEYSTONE_STRIPE_LIVE_CHARGE_APPROVED_BY`..."), not to every Stripe
 *     call. `stripeSecretKey()` above got reused by `stripeConnected.mjs` (whose OWN `movesMoney`
 *     parameter already exists to make exactly this distinction — MEASURED: it correctly gates
 *     `KEYSTONE_STRIPE_CHARGES_ENABLED`, just never reached the key getter) and by
 *     `catalogue.mjs` (which never calls `stripeConnectedRequest` at all), so a config-only call —
 *     reading a balance, creating a Product, a draft invoice, a customer — refused a live key with
 *     no way to configure it, on the exact same message as an actual charge attempt.
 * ★ FOR CONFIGURATION AND RECORDS ONLY: products, prices, coupons, customers, draft invoices,
 *   sending an invoice for the client to pay, voiding, reads. NEVER for anything that makes Stripe
 *   move money on its own — that is `stripeSecretKey()` above, unchanged, still four locks deep.
 * ★ Still refuses an absent or malformed key — LOCK 2 stands. Only LOCK 3 (the live-charge
 *   approval) is skipped, because this path cannot charge anything by construction.
 */
export function stripeSecretKeyForConfig(env = process.env) {
  return requirePresentWellFormedKey(env).key;
}

/** ★ Is the path usable at all? For the health check — reports WITHOUT throwing and WITHOUT the key. */
export function chargePathStatus(env = process.env) {
  let enabled = null, flagError = null;
  try { enabled = chargesEnabled(env); } catch (e) { flagError = e.message; }
  let keyKind = "absent";
  try {
    const k = stripeSecretKey(env);
    keyKind = classifyStripeKeyShape(k); // ★ "live" or "test" — a "malformed" key would have thrown above
  } catch { /* keyKind stays a description, never the value */ }
  return Object.freeze({
    enabled: enabled === true,
    flag: enabled === null ? "misconfigured" : enabled ? "on" : "off",
    flag_error: flagError,
    key: keyKind,                       // ★ "absent" | "test" | "live" — NEVER the key itself
    ships_off: CHARGE_PATH_SHIPS_OFF,
  });
}

const isPositiveInt = (n) => Number.isInteger(n) && n > 0;

/**
 * ★★★ CREATE ONE PAYMENT INTENT — or refuse, loudly, naming which lock said no.
 *
 * Records `money.charge.attempted` in the CALLER'S transaction **before** the request goes out, so a
 * charge can never exist without a record that Keystone asked for it. Returns a description of the
 * outcome; does NOT throw for a provider failure (the caller's job is to record, and a thrown error
 * invites a bare `catch {}` — how "a failure inferred from silence" gets into a system).
 *
 * @param {object} tx   a tenant transaction (NOT a pool — `emit()` refuses one by name)
 * @param {object} args tenantId · invoiceId · payerUserId · amountMinor · currency · idempotencyKey
 *                      · description · approvedBy (the person approving, when a live key is in use)
 *
 * ★★★ FIX ROUND 2, F494 — `approvedBy` HAS NO CALLER IN `src/` TODAY (unlike `archiveRecord`'s
 *     `actorId`, `setStaffRole`'s `changedByUserId`, `createInvoice`'s and `createBooking`'s
 *     `createdBy`, all of which WERE reachable from a request body and are now fixed). Left AS IS
 *     here, deliberately — there is nothing to fix yet, and the live-charge lock below depends on
 *     this exact shape. ★★ THE MOMENT A ROUTE CALLS THIS FUNCTION, `approvedBy` MUST COME ONLY FROM
 *     THE AUTHENTICATED SESSION OF A PERSON HOLDING APPROVAL AUTHORITY — e.g. `principal.appUserId`
 *     after an authorisation check for that authority, stamped by the route AFTER the body is read,
 *     never a value spread in from the body itself. Passing it straight through from a request body
 *     would be the identical defect F494 named for the other four writers, on the one write in this
 *     codebase where getting it wrong moves real money.
 * @param {{fetchImpl?: Function, env?: object}} deps injected so gates drive both directions without
 *                      ever contacting Stripe
 */
export async function createChargeIntent(tx, {
  tenantId, invoiceId = null, payerUserId, amountMinor, currency = "USD",
  idempotencyKey, description = null, approvedBy = null, actorUserId = null,
} = {}, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  // ── shape first: a bad amount must never reach a payment processor ──────────────────────────
  if (!tenantId) throw new ChargeRefused("tenantId is required");
  if (!payerUserId) throw new ChargeRefused("payerUserId is required — a charge is always somebody's");
  if (!isPositiveInt(amountMinor)) {
    throw new ChargeRefused(
      `amountMinor must be a positive integer of MINOR units, got ${JSON.stringify(amountMinor)}. ` +
      `★ 12.5 dollars is 1250, not 12.5 — a float here is a rounding error in someone's bill.`);
  }
  if (!/^[A-Z]{3}$/.test(currency)) throw new ChargeRefused(`currency must be ISO-4217, got "${currency}"`);
  // ★★ LOCK 4. No default, no generated value — see the header for why a generated key is worse than none.
  if (typeof idempotencyKey !== "string" || idempotencyKey.trim().length < 8) {
    throw new ChargeRefused(
      "idempotencyKey is required and must be at least 8 characters. ★ Stripe deduplicates on it, so " +
      "without one a retried request is a SECOND CHARGE. One is NOT generated here: a fresh key per " +
      "call would defeat the retry protection while appearing to provide it.");
  }

  // ── ★★★ TASK 9.9 / CT-067 — THE SAMPLE REFUSAL, THE ENTRY GUARD, AHEAD OF EVERY LOCK. ─────────
  // ★★ A sample payer is refused BEFORE lock 1 even reads the flag — sample-ness is not a
  //    configuration question, it is a fact about the payer, and it must hold whether the charge
  //    path is on or off. Read from `keystone.app_user.is_sample` (task 9.4), inside the CALLER's
  //    transaction (`tx`) — the same canonical source `emit()` reads for a "person" subject; read
  //    directly here because this event's subject is the invoice, not the payer.
  // ★ `ChargeRefused`, NEVER `ChargePathDisabled` — this is a refusal about WHO, not a switch that is
  //   off; reusing `ChargePathDisabled` would blur the two, which is exactly what §5 forbids.
  // ★ Recorded as its own `money.charge.attempted` event, `sample: true` explicit (the event's own
  //   subject is the invoice, so emit()'s automatic person-derivation does not apply here) — so the
  //   refusal shows in History with a reason, never as a silent nothing, and never reaches Stripe.
  const { rows: payerRows } = await tx.query(
    `SELECT is_sample FROM keystone.app_user WHERE tenant_id = $1 AND id = $2`,
    [tenantId, payerUserId]);
  if (payerRows[0]?.is_sample === true) {
    await emit(tx, {
      tenantId, topic: "money.charge.attempted", emittedBy: SECTION,
      subjectType: invoiceId ? "invoice" : null, subjectId: invoiceId,
      actor: userActor(actorUserId),
      sample: true,
      payload: {
        invoice_id: invoiceId, payer_user_id: payerUserId,
        amount_minor: amountMinor, currency,
        approved_by: approvedBy,
        outcome: "refused_sample",
      },
    });
    throw new ChargeRefused(
      "sample subject — never charged. This payer is a sample client, created for exploring the " +
      "product, and sample clients never trigger a real charge. Recorded as a refusal, not a silent " +
      "nothing.");
  }

  // ── ★★★ TASK 9.13 — THE PER-PRACTICE KILL SWITCH, checked BEFORE lock 1's product-wide flag. ──
  // ★ Same "the attempt is recorded even when the path is off" rule as lock 1 below: a refusal here
  //   is a fact about money that was attempted, so it is emitted BEFORE the throw, never after.
  const stripeEnabled = await flagIsOn(tx, "stripe_enabled", tenantId);
  if (!stripeEnabled) {
    await emit(tx, {
      tenantId, topic: "money.charge.attempted", emittedBy: SECTION,
      subjectType: invoiceId ? "invoice" : null, subjectId: invoiceId,
      actor: userActor(actorUserId),
      payload: {
        invoice_id: invoiceId, payer_user_id: payerUserId,
        amount_minor: amountMinor, currency,
        approved_by: approvedBy,
        outcome: "refused_service_disabled",
      },
    });
    throw new ChargeServiceDisabled(
      "stripe_enabled is off for this practice — a platform operator turned it off. No charge can " +
      "be attempted until it is switched back on. The attempt has been recorded as " +
      "money.charge.attempted.");
  }

  // ── LOCK 1 · the flag. Checked BEFORE the key so the refusal names the switch, not the credential ──
  const enabled = chargesEnabled(env);

  // ★★★ THE ATTEMPT IS RECORDED EVEN WHEN THE PATH IS OFF. A refusal is a fact about money that
  //     somebody tried to take, and "we tried to bill them and the system was off" must be answerable
  //     from the data rather than from memory. This is the "record, do not surface" half of P18.7.
  const attemptPayload = {
    invoice_id: invoiceId, payer_user_id: payerUserId,
    amount_minor: amountMinor, currency,
    charges_enabled: enabled,
    // ★★ STAGE 3 TASK 3 FIX 1, REVIEW M3 — the caller's `idempotency_key` is NOT in the payload. It is
    //    a CALLER-CHOSEN string, only length-checked, so it is typed text by §2.4's definition: one with
    //    a space ("retry of invoice 42") made emit() refuse and the attempt went UNRECORDED — the exact
    //    thing this block exists to prevent. Duplicate protection is Stripe's, keyed on the header below.
    approved_by: approvedBy,
    outcome: enabled ? "requested" : "refused_path_disabled",
  };
  await emit(tx, {
    tenantId, topic: "money.charge.attempted", emittedBy: SECTION,
    // ★ FIX 1 — both-or-neither (Stage 3 Task 2's envelope rule): a charge with no invoice has no
    //   subject. [EXECUTED] `subjectType:"invoice", subjectId:null` made emit() refuse every
    //   invoice-less attempt, so it was never recorded.
    subjectType: invoiceId ? "invoice" : null, subjectId: invoiceId,
    // ★ FIX ROUND 1, I1 — from `actorUserId` (session-derived), never from `approvedBy`, which stays
    //   a separate, pre-existing payload field this task does not change the trust model of.
    actor: userActor(actorUserId),
    payload: attemptPayload,
  });

  if (!enabled) {
    throw new ChargePathDisabled(
      `the Stripe charge path is OFF (${CHARGE_FLAG} is not "true"), so no card was charged. ★ This is ` +
      `the SHIPPED state and it is deliberate: HARD LIMIT 1 — no charge without a person approving it ` +
      `in the session it happens in. The attempt has been recorded as money.charge.attempted.`);
  }

  // ── LOCKS 2 and 3 · the credential and its blast radius ───────────────────────────────────────
  const key = stripeSecretKey(env);
  const isLive = key.startsWith("sk_live_") || key.startsWith("rk_live_");
  // ★ FIX ROUND 2, F494 — `approvedBy` IS READ HERE, UNCHANGED. See this function's header: it has
  //   no caller yet, so there is no body to trust or distrust today. Whoever wires the first route
  //   to this function MUST pass the session's own id here (a person with approval authority,
  //   verified by the route BEFORE calling this), never a request-body field of any name — the
  //   same rule F494 already enforces for archiveRecord/setStaffRole/createInvoice/createBooking.
  if (isLive && (typeof approvedBy !== "string" || approvedBy.trim() === "")) {
    throw new ChargeRefused(
      "this is a LIVE Stripe key and no `approvedBy` was passed. ★ HARD LIMIT 1: the approval is a " +
      "PERSON, in this session, and it is recorded on the attempt — an env var is not a person.");
  }

  // ── ★★★ FOUND LIVE, saved-card brief (1 Oct 2026, Part 4) — MEASURED: this call had no
  //     `customer`, no `payment_method`, no `off_session`, no `confirm` — with charges on it would
  //     have created an unconfirmed PaymentIntent (`requires_payment_method`/
  //     `requires_confirmation`) and never actually moved money; `intent_created` would have read
  //     as success while nothing was charged. A charge off a saved card, with no client present to
  //     confirm it, is an OFF-SESSION MERCHANT-INITIATED charge — Stripe's own documented shape
  //     (`customer` + `payment_method` + `off_session: true` + `confirm: true`), not
  //     `automatic_payment_methods`, which is for an on-session checkout with a client actually
  //     present to complete it. The caller (settleBooking.mjs) decides WHETHER to charge — see this
  //     file's own header — but it cannot pass a `payment_method` this function has not first
  //     confirmed exists and is this practice's own default for this payer, so the lookup lives
  //     here, one door, same posture as every other read in this function.
  // ★ STRIPE MIRROR (0574) — "is there a default card on file" is Stripe's word (person_card_effective,
  //   which already excludes detached cards), not the platform's cached payment_method row.
  const { rows: pmRows } = await tx.query(
    `SELECT u.stripe_customer_id, pm.provider_payment_method_id
       FROM keystone.app_user u
       LEFT JOIN keystone.person_card_effective pm
         ON pm.tenant_id = u.tenant_id AND pm.app_user_id = u.id
        AND pm.is_default = true
      WHERE u.tenant_id = $1 AND u.id = $2`,
    [tenantId, payerUserId]);
  const stripeCustomerId = pmRows[0]?.stripe_customer_id ?? null;
  const defaultPaymentMethodId = pmRows[0]?.provider_payment_method_id ?? null;
  if (!stripeCustomerId || !defaultPaymentMethodId) {
    await emit(tx, {
      tenantId, topic: "money.charge.attempted", emittedBy: SECTION,
      subjectType: invoiceId ? "invoice" : null, subjectId: invoiceId,
      actor: userActor(actorUserId),
      payload: { ...attemptPayload, outcome: "refused_no_card_on_file" },
    });
    throw new ChargeRefused(
      "this payer has no saved card on file — there is nothing for an off-session charge to use. " +
      "Send an invoice instead.");
  }

  // ── the one request ───────────────────────────────────────────────────────────────────────────
  // ★ Stripe's API is form-encoded, not JSON. Sending JSON gets a 400 that reads like a bad amount.
  // ★★ The tenant travels on the intent so a webhook can attribute the money WITHOUT trusting the
  //    request that comes back to us — U29's shape, one domain over.
  const formObj = {
    amount: String(amountMinor),
    currency: currency.toLowerCase(),
    customer: stripeCustomerId,
    payment_method: defaultPaymentMethodId,
    off_session: "true",
    confirm: "true",
    metadata: metadataFor("payment_intent", {
      person_id: payerUserId,
      practice_id: tenantId,
      booking_id: invoiceId,
    }),
  };

  if (description) formObj.description = description;

  const form = encodeForm(formObj);

  // ★ Task 9.6 (CT-064) — the transport moved onto `callOutside` (Stripe: 20 000 ms). The never-retry
  //   rule below is unchanged in meaning; only WHERE it reads "no reply happened" moved, from a bare
  //   catch to `callOutside`'s `ambiguous` field.
  const result = await callOutside("stripe", STRIPE_INTENTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
      // ★★★ THE HEADER THAT STOPS A DOUBLE CHARGE. Stripe returns the ORIGINAL result for a repeat.
      "Idempotency-Key": idempotencyKey,
    },
    body: form.toString(),
  }, { fetchImpl, timeoutMs: 20_000 });

  // ★★ A TIMEOUT IS NOT A REFUSAL. The charge may have SUCCEEDED at Stripe and the reply been lost;
  //    the webhook will say. Reporting "failed" here would tell a coach to charge the card again.
  //  ★ `result.status === null` covers both `ambiguous === true` (the request left, no reply read —
  //    the case this outcome exists for) and the rare connect-phase refusal (`ambiguous === false`,
  //    the request never left). This module's outward contract keeps ONE `unknown_no_reply` outcome
  //    — collapsing the rare never-left case into it too, conservatively, rather than adding a second
  //    kind of "no reply" outcome nothing in `src/` reads yet.
  if (result.status === null) {
    return Object.freeze({
      ok: false, status: null, outcome: "unknown_no_reply",
      provider_payment_id: null,
      error: `no reply from Stripe (${result.timedOut ? "timeout" : "network error"}). ★ The charge MAY have ` +
             `succeeded — the webhook is the source of truth. Do NOT retry with a new idempotency key.`,
    });
  }

  const body = result.body;

  if (!result.ok) {
    return Object.freeze({
      ok: false, status: result.status, outcome: "provider_refused",
      provider_payment_id: body?.error?.payment_intent?.id ?? null,
      // ★ Stripe's own message, not a paraphrase — "card declined" and "bad request" are different
      //   conversations with a client and must not be flattened into one.
      error: body?.error?.message ?? `Stripe returned ${result.status}`,
      error_code: body?.error?.code ?? null,
    });
  }

  return Object.freeze({
    ok: true, status: result.status, outcome: "intent_created",
    provider_payment_id: body?.id ?? null,
    client_secret_present: typeof body?.client_secret === "string",   // ★ never the secret itself
    intent_status: body?.status ?? null,
  });
}
