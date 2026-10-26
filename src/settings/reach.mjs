// ═══════════════════════════════════════════════════════════════════════════════════════════════
// TASK 11.23 (CT-F44) — THE CONSEQUENCE ENGINE. A change to a `hasReach` key cannot land until its
// consequences have been computed and the caller has confirmed them, and "tell everyone" sends one
// explained notice.
//
// ★★★ WHOLE MODULE, BUILT HERE RATHER THAN LEFT TO STAGE 17's 17.2 — RULED 25 Sep 2026. `POST
//     /api/settings` (this stage's `11.23`, `src/routes/settings.mjs`) calls `assertReachConfirmed`
//     from this file. Splitting the module from the handler produces either a handler importing a
//     module that does not exist (fails at LOAD) or four stages of booking-policy saves silently
//     skipping the consequence check — the seven `REACH_KEYS` members are all `booking.*`, and
//     Stage 13's booking-settings screens are their only writers. See `STAGE-11-PLAN.md`'s `11.23`
//     field 4(e) for the full argument.
//
// ★★★ THE PER-KEY SPECIFICATION (the seven keys, their `booking_policy` override columns, the four
//     row kinds' verbatim frame wording and each key's `count` sentence) IS STAGE 17's `17.2` FIELD
//     4, TAKEN AS INPUT HERE — NOT RE-DERIVED. `STAGE-17-PLAN.md:500-694`.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { getSetting } from "./writes.mjs";
import { REACH_KEYS, SETTING_KEYS } from "./keys.mjs";
import { emit, userActor } from "../events/outbox.mjs";
import { createNotification } from "../notifications/writes.mjs";
import { invalid, conflict } from "../http/errors.mjs";
// ★ DOCUSTAY WALL FIX — routed through the front door (now exported there); pure relocation, zero
//   logic change. Found by db/gates/documents_wall.mjs.
import { VARIABLES } from "../documents/frontDoor.mjs";
import { executedSubjectsMatchingSnapshotText } from "../documents/api.mjs";
// ★ One-way import — attendance.mjs does not import this module, so no cycle. `keys.mjs` spells the
//   no-show setting key rather than importing it FROM attendance.mjs for exactly the reason this
//   file's own comment gives (a cycle through the settings layer); this direction is safe.
import { RULED_NO_SHOW_CHARGE_PERCENT } from "../booking/attendance.mjs";

/**
 * ★★★ THE THREE STATES OF A BOOKING THAT HAS NOT HAPPENED AND HAS NOT BEEN CANCELLED. MEASURED
 *     from the constraint, not remembered: `booking_state_check` is `CHECK (state IN
 *     ('pending_payment','pending_consent','confirmed','cancelled','completed','no_show'))`
 *     (`db/migrations/0309_booking_state_pending_consent.sql:25-26`). `pending_consent` is in the
 *     list because a booking awaiting a guardian's consent is still a future booking the new policy
 *     will govern — leaving it out under-reports the reach, and under-reporting is exactly the
 *     failure the modal exists to prevent.
 */
const FUTURE_LIVE_STATES = Object.freeze(["pending_payment", "pending_consent", "confirmed"]);

// ★ The `booking_policy` per-service override column for each of the seven `REACH_KEYS` members —
//   the frozen map's own literal, never a request value, so it is the allow-list for the SQL below.
//   `booking.no_show_charge_percent` has no column: 0355 adds ten columns and this is not one of
//   them (MEASURED); `resolveNoShowCharge` reads the practice value only.
const OVERRIDE_COLUMN = Object.freeze({
  "booking.client_may_reschedule": "client_may_reschedule",
  "booking.client_may_cancel": "client_may_cancel",
  "booking.reschedule_notice_minutes": "reschedule_notice_minutes",
  "booking.late_cancel_behaviour": "late_cancel_behaviour",
  "booking.late_cancel_charge_percent": "late_cancel_charge_percent",
  "booking.cancel_requires_contact": "cancel_requires_contact",
  "booking.no_show_charge_percent": null,
});

/**
 * Future bookings whose service does NOT override this key, so the practice default actually
 * governs them. `overrideColumn` is interpolated from `OVERRIDE_COLUMN`'s own literal only — never
 * from a request value. No explicit `tenant_id` predicate: FORCE ROW LEVEL SECURITY already confines
 * this to the caller's own tenant (same discipline `routes/settings.mjs`'s `lastChangedBy` states for
 * the same reason) — `tenantId` is accepted for call-site symmetry, not used in the query itself.
 * When `overrideColumn` is `null` the `LEFT JOIN`/`IS NULL` test is omitted and every future live
 * booking counts, because nothing can override the practice value.
 */
export async function governedBookings(db, { tenantId, overrideColumn }) {
  void tenantId;
  if (overrideColumn !== null && overrideColumn !== undefined &&
      !Object.values(OVERRIDE_COLUMN).includes(overrideColumn)) {
    throw new Error(`governedBookings: "${overrideColumn}" is not a recognised booking_policy override column`);
  }
  const sql = overrideColumn
    ? `SELECT b.id
         FROM keystone.booking b
         LEFT JOIN keystone.booking_policy bp
                ON bp.tenant_id = b.tenant_id AND bp.service_id = b.service_id
        WHERE b.starts_at > now()
          AND b.archived_at IS NULL
          AND b.state = ANY($1)
          AND bp.${overrideColumn} IS NULL`
    : `SELECT b.id
         FROM keystone.booking b
        WHERE b.starts_at > now()
          AND b.archived_at IS NULL
          AND b.state = ANY($1)`;
  const { rows } = await db.query(sql, [FUTURE_LIVE_STATES]);
  return { n: rows.length, bookingIds: rows.map((r) => r.id) };
}

/**
 * Who gets told. Booking participants with an account, plus any signer ids the caller supplies
 * (the `mismatch` row's signers) — each filtered to an active person with an email, unioned so the
 * same person is never counted twice.
 */
export async function tellAudienceFor(db, { tenantId, bookingIds = [], signerUserIds = [] }) {
  const { rows } = await db.query(
    `SELECT DISTINCT bp.app_user_id AS id
       FROM keystone.booking_participant bp
       JOIN keystone.app_user u ON u.id = bp.app_user_id
      WHERE bp.tenant_id = $1 AND bp.booking_id = ANY($2) AND bp.app_user_id IS NOT NULL
        AND u.archived_at IS NULL AND u.email IS NOT NULL
      UNION
     SELECT DISTINCT u.id AS id
       FROM keystone.app_user u
      WHERE u.tenant_id = $1 AND u.id = ANY($3) AND u.archived_at IS NULL AND u.email IS NOT NULL`,
    [tenantId, bookingIds, signerUserIds]);
  const userIds = rows.map((r) => r.id);
  return { n: userIds.length, userIds };
}

// ★ `mismatch` fires only when a document-template variable binds this key AND an instance has been
//   signed. `VARIABLES` (src/documents/variableCatalogue.mjs) carries no `settingKey` field today —
//   Stage 14's work — so `boundVars` is always empty and this always returns `[]`. That is a true
//   statement about this practice's documents today, never invented and never stubbed.
async function mismatchSigners(db, { tenantId, key }) {
  const boundVars = VARIABLES.filter((v) => v.settingKey === key);
  if (boundVars.length === 0) return [];
  const patterns = boundVars.map((v) => `%{{${v.name}}}%`);
  // ★ DOCUSTAY WALL FIX — routed through documents/api.mjs; same query, relocated verbatim.
  return executedSubjectsMatchingSnapshotText(db, { tenantId, patterns });
}

// ★ Only produced when a key has an override column AND at least one service actually overrides it
//   (never for key 7, which has none).
async function overridesRow(db, { tenantId, key }) {
  const column = OVERRIDE_COLUMN[key];
  if (!column) return null;
  const { rows } = await db.query(
    `SELECT s.name AS name, bp.${column} AS value
       FROM keystone.booking_policy bp
       JOIN keystone.service s ON s.id = bp.service_id
      WHERE bp.tenant_id = $1 AND bp.${column} IS NOT NULL AND s.archived_at IS NULL`,
    [tenantId]);
  if (rows.length === 0) return null;
  const n = rows.length;
  const detail = rows.map((r) => `${r.name} (${JSON.stringify(r.value)})`).join(", ");
  const tail = n === 1 ? "That one doesn't change." : n === 2 ? "Neither changes." : "None of them change.";
  return { kind: "overrides", n, headline: `${n} services override this`, sentence: `${detail}. ${tail}` };
}

// ★ The ONE line per key that differs — it has to say what actually changes for those bookings.
//   Verbatim from `STAGE-17-PLAN.md:606-614`.
const COUNT_SENTENCE = Object.freeze({
  "booking.client_may_reschedule": (from, to) => (to === true
    ? "Whoever holds one of these can move it themselves from the moment you save. Nothing already booked is cancelled or charged differently."
    : "From the moment you save, none of these can be moved by the person who booked it — they have to ask you. Nothing is cancelled and nobody is charged differently."),
  "booking.client_may_cancel": (from, to) => (to === true
    ? "Whoever holds one of these can cancel it themselves from the moment you save. Nobody is charged differently for something already booked."
    : "From the moment you save, none of these can be cancelled by the person who booked it — they have to ask you. Nobody is charged differently for something already booked."),
  "booking.reschedule_notice_minutes": () =>
    "They all get the new window. Nobody is charged differently for something already booked.",
  "booking.late_cancel_behaviour": () =>
    "A late cancellation on any of these is handled the new way from the moment you save. Nothing already cancelled is re-charged or refunded.",
  "booking.late_cancel_charge_percent": (from, to) =>
    `A late cancellation on any of these is charged ${to}% from the moment you save, instead of ${from}%. Nothing already cancelled is re-charged or refunded.`,
  "booking.cancel_requires_contact": (from, to) => (to === true
    ? "From the moment you save, cancelling any of these means contacting you first. Nothing already booked is cancelled."
    : "From the moment you save, any of these can be cancelled without contacting you. Nothing already booked is cancelled."),
  "booking.no_show_charge_percent": (from, to) => (from === null || from === undefined
    ? `It has never been set, so it has been ${RULED_NO_SHOW_CHARGE_PERCENT}%, and from the moment you save it will be ${to}%. Nothing already recorded as a no-show is re-charged or refunded.`
    : `A no-show on any of these is charged ${to}% from the moment you save, instead of ${from}%. Nothing already recorded as a no-show is re-charged or refunded.`),
});

async function reachRows(db, { tenantId, key, from, to }) {
  const column = OVERRIDE_COLUMN[key];
  const governed = await governedBookings(db, { tenantId, overrideColumn: column });
  const rows = [{
    kind: "count", n: governed.n,
    headline: `${governed.n} future bookings`,
    sentence: COUNT_SENTENCE[key](from, to),
  }];

  // ★ 17.2 field 4, key 4's special case: charge_percent chosen with no percentage set yet.
  if (key === "booking.late_cancel_behaviour" && to === "charge_percent") {
    const pct = await getSetting(db, "booking.late_cancel_charge_percent",
      SETTING_KEYS["booking.late_cancel_charge_percent"]?.ruledDefault);
    if (pct === null || pct === undefined) {
      rows.push({
        kind: "count", n: 0,
        headline: "No late-cancellation charge is set",
        sentence: "Late cancellations would be charged 0%. Set the percentage in the same save.",
      });
    }
  }

  const signerIds = await mismatchSigners(db, { tenantId, key });
  if (signerIds.length > 0) {
    rows.push({
      kind: "mismatch", n: signerIds.length,
      headline: `Your agreement still says ${from}`,
      sentence: `${signerIds.length} people have signed that. Update the document or the two won't match.`,
    });
  }

  const overrides = await overridesRow(db, { tenantId, key });
  if (overrides) rows.push(overrides);

  const tell = await tellAudienceFor(db, { tenantId, bookingIds: governed.bookingIds, signerUserIds: signerIds });
  rows.push({
    kind: "tell", n: tell.n,
    headline: "Everyone is told",
    sentence: `If you want them to be. ${tell.n} people, one short email.`,
  });

  return rows;
}

/**
 * ★★★ ALL SEVEN `REACH_KEYS` MEMBERS HAVE AN ENTRY HERE, AND NO OTHER KEY DOES (CC-8, both
 *     directions). Each computer is `async (db, {tenantId, from, to}) => rows[]`, every row exactly
 *     `{kind: 'count'|'mismatch'|'overrides'|'tell', n, headline, sentence}`.
 */
export const REACH_COMPUTERS = Object.freeze(Object.fromEntries(
  Object.keys(OVERRIDE_COLUMN).map((key) => [
    key,
    (db, { tenantId, from, to }) => reachRows(db, { tenantId, key, from, to }),
  ])
));

/**
 * `{key, from, to, rows, tellAudience}`. A key not in `REACH_KEYS` → `rows: []` (asking about a key
 * with no reach is a legitimate question whose answer is "none"). `from === to` → `rows: []` — a
 * save that changes nothing reaches nothing.
 */
export async function computeReach(db, { tenantId, key, from, to }) {
  if (!(key in REACH_COMPUTERS) || from === to) {
    return { key, from, to, rows: [], tellAudience: 0 };
  }
  const rows = await REACH_COMPUTERS[key](db, { tenantId, from, to });
  const tellRow = rows.find((r) => r.kind === "tell");
  return { key, from, to, rows, tellAudience: tellRow ? tellRow.n : 0 };
}

/**
 * The gate. Runs BEFORE any write. For each change whose key ∈ `REACH_KEYS` and whose value differs
 * from the stored one (`from` read with `getSetting(db, key, SETTING_KEYS[key].ruledDefault)` —
 * 11.6's `ruledDefault` is the fallback, so the default is written once): if `confirm?.reach !==
 * true`, throws `conflict(..., {reach:[computeReach output, …]})` (409, CT-F44's frozen shape).
 * Returns the list of `{key, from, to}` for the reach keys that actually differ (possibly empty) so
 * the caller can announce exactly those, and only those, after a successful save.
 */
export async function assertReachConfirmed(db, { tenantId, changes, confirm }) {
  const differing = [];
  for (const { key, value } of changes) {
    if (!REACH_KEYS.includes(key)) continue;
    const stored = await getSetting(db, key, SETTING_KEYS[key]?.ruledDefault);
    if (stored === value) continue;
    differing.push({ key, from: stored, to: value });
  }
  if (differing.length === 0) return differing;
  if (confirm?.reach === true) return differing;
  const reach = [];
  for (const { key, from, to } of differing) {
    reach.push(await computeReach(db, { tenantId, key, from, to }));
  }
  throw conflict("This change reaches existing things — see what it affects first.", { reach });
}

/**
 * Emits ONE event `settings.policy.announced` (payload `{key}` only — never the message, never the
 * values, the same privacy rule `src/settings/writes.mjs:93-97` already states), then for each id in
 * `tellAudienceFor`'s answer calls `createNotification`. `message` is required and 1–500 characters.
 */
export async function announceChange(db, { tenantId, key, from, to, message, actorUserId }) {
  void to;
  if (typeof message !== "string" || message.length < 1 || message.length > 500) {
    throw invalid("a message is required to tell everyone — 1 to 500 characters");
  }
  const event = await emit(db, {
    tenantId, topic: "settings.policy.announced", emittedBy: "settings",
    actor: userActor(actorUserId ?? null),
    payload: { key },
  });
  const column = OVERRIDE_COLUMN[key] ?? null;
  const governed = await governedBookings(db, { tenantId, overrideColumn: column });
  const signerIds = await mismatchSigners(db, { tenantId, key });
  const audience = await tellAudienceFor(db, {
    tenantId, bookingIds: governed.bookingIds, signerUserIds: signerIds,
  });
  // ★★ THE TITLE IS RESOLVED, NOT SENT WITH ITS PLACEHOLDER IN IT (corrected 25 Sep 2026).
  //   `STAGE-11-PLAN.md:2718` and `STAGE-17-PLAN.md:630` both spell this title with a literal
  //   `{practice}` and neither says to substitute it, so the first build sent it verbatim — every
  //   recipient would have read "A change to how {practice} works". That is a client-facing
  //   string, so it is resolved here.
  //   Terminology rule: a tenant may rename what they are called, so the `practice.name` SETTING
  //   wins over `tenant.name` — the same precedence `src/routes/index.mjs:835` already applies
  //   (`get("practice.name") ?? tenant.name`). Resolved at SEND time, which is correct: the title
  //   is live before send and frozen into the notification row after it, so renaming the practice
  //   tomorrow never rewrites an announcement somebody already read.
  //   `getSetting` and the `tenant` read are both RLS-scoped to this practice.
  const named = await getSetting(db, "practice.name", null);
  const fallback = (await db.query(`SELECT name FROM keystone.tenant LIMIT 1`)).rows[0]?.name ?? null;
  const practiceName = (typeof named === "string" && named.trim()) || fallback || "this practice";
  const title = `A change to how ${practiceName} works`;
  for (const recipientId of audience.userIds) {
    await createNotification(db, {
      tenantId, recipientId, eventId: event.id, topic: "settings.policy.announced",
      title, body: message,
    });
  }
  return { announced: true, audience: audience.n };
}
