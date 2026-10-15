// @ts-check
// P15B.7 — THE CATALOGUE WRITES. createService · createPackage(+lines) · createPlan · createPrice ·
//          setContractedPrice.
//
// ═════════════════════════════════════════════════════════════════════════════
// ★★★ §Z4 — THE SUPERSEDE LAW, WHICH IS THE WHOLE POINT OF THIS FILE
// ═════════════════════════════════════════════════════════════════════════════
// "The DEFINITION carries no price. A new price row SETS `effective_to` on the old one and INSERTS a
//  new one. THE OLD ROW IS NEVER EDITED (§P7)."
//
// ★★ WHY, IN ONE SENTENCE: an executed instrument freezes the price it was signed at (§M0 LAW 3), so
//    editing a price row in place would retroactively change what a customer agreed to — and there
//    would be no record that it had happened. Prices are a HISTORY, not a value.
// ★ Enforced in the database by `keystone.price_is_append_only()` (migration 0024), which refuses any
//   UPDATE to `amount_minor`, `currency`, `subject_type`, `subject_id` or `effective_from`, and
//   refuses to MOVE an `effective_to` that is already set. Closing a NULL `effective_to` is the one
//   permitted UPDATE, and it is exactly the supersede move.
//
// ═════════════════════════════════════════════════════════════════════════════
// ★★★ B2.1 / P8.7 — THE DEFINITION NO LONGER CARRIES A PRICE. RESOLVED 2026-09-15.
// ═════════════════════════════════════════════════════════════════════════════
// §Z4 says a definition must not carry a price, and the schema contradicted it: `price_minor` was
// NOT NULL on `service`, `package` and `plan`, so this module wrote the caller's amount into the
// definition as a LEGACY MIRROR and never updated it again — meaning after the first re-price, two
// numbers claimed to be the price and differed.
//   ★★★ **THAT ENDED HERE.** Migration 0109 made all three columns nullable;
//       `scripts/retire-price-minor.mjs` emptied them; the three INSERTs below no longer name the
//       column. The caller still states the price once, and it goes to exactly one place: a
//       time-windowed row in `price`, read through `current_price()`.
//   ★★ AND THE OLD REASON FOR DELAY WAS FACTUALLY WRONG, WHICH IS WHY IT SURVIVED SO LONG. This
//      header used to say the column was "read by existing list views", so dropping it needed "a
//      sweep of every reader". [MEASURED 2026-09-15, grep over the whole tree] **there was no
//      reader — not one, anywhere in `src/`.** Every mention was a comment saying "not this
//      column". The sweep that was never attempted would have taken minutes.
//   ★ The column itself still exists, nullable and empty, until no deployed bundle names it; its
//     `DROP COLUMN` is recorded in HANDOFF.md. Nothing may write it again — `db/gates/
//     p8_7_the_definition_carries_no_price.mjs` fails if anything does.
//   ★★★ AND IT IS ASSERTED, NOT REMEMBERED: `test/p15b_items_writes.test.mjs` proves the definition
//        column is NULL after a supersede WHILE `current_price()` still answers correctly, so nobody
//        can later put a second number back without a test going red.

import { emit, userActor } from "../events/outbox.mjs";
import { invalid, notFound, conflict } from "../http/errors.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";
// ★★★ TASK 2.4 — task 2.3's own read helper, imported and CALLED, never redefined. `getAgreementRequirement`
//     is what `attachAgreementRequirement` below asks to learn whether this item already has a required
//     agreement (409 "Detach the current agreement first") before it ever inserts a second row that
//     `item_agreement_requirement`'s own `UNIQUE (tenant_id, item_type, item_id)` would refuse anyway.
import { getAgreementRequirement } from "./agreements.mjs";
import { templateBuilderAndName } from "../documents/api.mjs";
// ★ 11.10 — `tellRegulars` on a price change asks the SAME permission question editing the
//   catalogue's own settings would (`object: "campaign", action: "edit"`, owner/admin hold it,
//   coach none — 0190:157,179,201).
import { assertMay } from "../permissions/assertMay.mjs";
// ★ 11.10 — the audience-and-facts helper; see that module's own header for what this does NOT do.
import { draftPriceChangeCampaign } from "../growth/campaigns.mjs";
// ★★★ 14.20 — F06 §8's practice-wide item defaults (`items.default_duration_minutes`,
//     `items.default_price_minor`, `items.default_bookable_online`), read here so a create that
//     omits a value picks up the PRACTICE's own default rather than a number invented in this file.
import { getSetting } from "../settings/writes.mjs";

const SECTION = "items";

export const PRICE_SUBJECTS = Object.freeze(["service", "package", "plan"]);
export const PLAN_INTERVALS = Object.freeze(["week", "month", "quarter", "year"]);
// ★ TASK 2.5 — 02-items.md §3, migration 0267's `rollover_mode` CHECK.
export const PLAN_ROLLOVER_MODES = Object.freeze(["none", "cap"]);

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";   // ★ TASK 2.5 — createPlan's serviceId reference (0267)
const RAISE_EXCEPTION = "P0001";   // ★ what a PL/pgSQL RAISE arrives as — 0024's trigger

function assertMoney(amountMinor, currency) {
  if (!Number.isInteger(amountMinor) || amountMinor < 0) {
    // ★ MINOR UNITS, INTEGER, NON-NEGATIVE. A float here is the classic money bug; 12.5 dollars
    //   becoming 12 or 13 cents is silent and permanent.
    throw invalid(`amount_minor must be a non-negative integer in minor units — got ${JSON.stringify(amountMinor)}`);
  }
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) {
    throw invalid(`currency must be three upper-case letters — got ${JSON.stringify(currency)}`);
  }
}

/**
 * ★★★ THE SUPERSEDE. Close the open row, insert the new one, both in this transaction.
 * @returns { id, supersededId|null, amount_minor, currency }
 */
export async function createPrice(
  tx, { tenantId, subjectType, subjectId, amountMinor, currency = "USD", effectiveFrom = null,
        actorUserId = null, tellRegulars = false, principal = null,
        // ★ 14.6 — a price row may apply to one location and/or one delivery mode. Both default
        //   NULL (the base row), so every existing caller is unaffected.
        locationId = null, deliveryMode = null }
) {
  if (!PRICE_SUBJECTS.includes(subjectType)) {
    throw invalid(`subject_type must be one of ${PRICE_SUBJECTS.join(", ")} — got ${JSON.stringify(subjectType)}`);
  }
  assertMoney(amountMinor, currency);

  // ★ 11.10 — "tell everyone who books it regularly" only means anything for a SERVICE: a package
  //   or a plan has no `regular_of_service` reading, and §Z4's own subject list is service/package/
  //   plan, not "the thing the caller meant".
  if (tellRegulars === true && subjectType !== "service") {
    throw invalid("only a service's regulars can be told about a price change");
  }

  // ★★ `now()` IS TAKEN FROM THE DATABASE, not from the application clock. The two rows' windows must
  //    abut exactly — the old one's `effective_to` and the new one's `effective_from` — and two
  //    machines disagreeing by milliseconds would leave a gap in which a price lookup finds nothing,
  //    or an overlap in which it finds two.
  let at = effectiveFrom
    ? (await tx.query(`SELECT $1::timestamptz AS t`, [effectiveFrom])).rows[0].t
    : (await tx.query(`SELECT now() AS t`)).rows[0].t;

  // ── 1 · CLOSE THE OPEN ROW, IF THERE IS ONE ──────────────────────────────
  // ★★★ THE ONLY UPDATE §Z4 PERMITS, AND 0024's TRIGGER ALLOWS EXACTLY THIS ONE: setting a NULL
  //     `effective_to`. `amount_minor` is not in the SET list and never will be.
  // ★ `effective_to IS NULL` in the predicate means a second supersede in the same instant cannot
  //   re-close an already-closed row — the trigger would refuse it, but refusing it here keeps the
  //   error about the caller's intent rather than about a constraint.
  let supersededId = null;
  let oldAmountMinor = null;
  {
    // ★ 14.6 — the open row this supersedes is scoped to the SAME (location, mode) combination, not
    //   to the subject alone: a base price, a per-location override and a per-mode override may all
    //   be open on the same subject at once (0413's `price_variation_one_open`), and re-pricing one
    //   must not close another. `IS NOT DISTINCT FROM` because NULL = the base combination.
    // ═══════════════════════════════════════════════════════════════════════════════════════
    // ★★★ the maintainer, 29 Sep 2026 — FOUND LIVE ("create a service, change its price" — the exact ask):
    //     was `effective_from < $4` (exact timestamp, `$4` = the caller's own `at`, unmodified).
    //     `ModalChangePrice.jsx`'s picker only ever collects a DATE, so "effective from today"
    //     always meant that date's midnight — almost always EARLIER than the open row's own
    //     precise `effective_from` (created however-many hours into that same day). A same-day
    //     re-price therefore always failed the close (the row's own start was, in absolute
    //     terms, "later today" than the new row's midnight-anchored start), and the INSERT then
    //     hit `price_variation_one_open` with a bare "unique violation" and no explanation.
    // ★★ THE FIX RUNS ENTIRELY INSIDE THIS ONE UPDATE, NEVER ROUND-TRIPPING A COMPUTED BOUNDARY
    //    THROUGH A SEPARATE QUERY. An earlier version of this fix computed "the later of the
    //    two, plus a tick" in its OWN query, read the result back into JS, and used that for
    //    both this UPDATE and the INSERT below — and that round trip is exactly where it broke:
    //    node-postgres parses `timestamptz` into a JS `Date` (millisecond resolution only), so a
    //    microsecond bump computed in Postgres was silently truncated away on the way back,
    //    leaving the "bumped" value IDENTICAL, to the millisecond, to the row it was meant to
    //    land strictly after — `price_window_ordered` (effective_to > effective_from) then
    //    refused the exact-equal pair. [EXECUTED locally, repeatedly, before landing here.]
    //    Computing `GREATEST(caller's date, this row's own effective_from + 1ms)` PER ROW, INSIDE
    //    the UPDATE, and reading the ACTUAL WRITTEN VALUE back via RETURNING removes the round
    //    trip: the boundary used for the NEW row below is the literal value Postgres just
    //    persisted for the OLD row's close, not a second, separately-computed approximation of it.
    // ═══════════════════════════════════════════════════════════════════════════════════════
    const closed = await tx.query(
      `UPDATE keystone.price
          SET effective_to = GREATEST($4::timestamptz, effective_from + interval '1 millisecond')
        WHERE tenant_id = $1 AND subject_type = $2 AND subject_id = $3
          AND effective_to IS NULL
          AND effective_from::date <= $4::date
          AND location_id IS NOT DISTINCT FROM $5
          AND delivery_mode IS NOT DISTINCT FROM $6
        RETURNING id, amount_minor, effective_to`,
      [tenantId, subjectType, subjectId, at, locationId, deliveryMode]);
    if (closed.rowCount > 1) {
      // ★★ MORE THAN ONE OPEN ROW IS A DATA DEFECT, NOT A CASE TO HANDLE. It means an earlier write
      //    bypassed this function, and continuing would pick a winner arbitrarily. Refuse loudly.
      throw conflict(
        `${closed.rowCount} open prices exist for ${subjectType} ${subjectId} (location ${locationId ?? "any"}, ` +
        `mode ${deliveryMode ?? "any"}) — exactly one row may be open at a time per combination, so this ` +
        `catalogue entry needs repair before it can be re-priced`);
    }
    supersededId = closed.rows[0]?.id ?? null;
    oldAmountMinor = closed.rows[0]?.amount_minor ?? null;
    // ★ The new row's effective_from is EXACTLY what was just written as the old row's
    //   effective_to (when there was one) — never a second, separately-derived value.
    if (closed.rows[0]?.effective_to) at = closed.rows[0].effective_to;
  }

  // ★ 11.10 — a price NOTICE needs an earlier price to compare against; the first price a service
  //   ever gets is not a "change" anybody books regular sessions expecting to stay the same.
  if (tellRegulars === true && supersededId === null) {
    throw invalid("there is no earlier price to tell anyone about");
  }
  if (tellRegulars === true) {
    await assertMay(tx, principal, { object: "campaign", action: "edit" });
  }

  // ── 2 · INSERT THE NEW ROW ───────────────────────────────────────────────
  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  try {
    await run(tx, db
      .insertInto("keystone.price")
      .values({
        id: id ?? null,
        tenant_id: tenantId ?? null,
        subject_type: subjectType ?? null,
        subject_id: subjectId ?? null,
        amount_minor: amountMinor ?? null,
        currency: currency ?? null,
        effective_from: at ?? null,
        location_id: locationId ?? null,
        delivery_mode: deliveryMode ?? null,
      }));
  } catch (e) {
    if (e.code === CHECK_VIOLATION) throw invalid(`the database refused this price: ${e.constraint ?? e.message}`);
    if (e.code === FOREIGN_KEY_VIOLATION) throw invalid(`the database refused this price: ${e.constraint ?? e.message}`);
    // ★ the maintainer, 29 Sep 2026 — the one case the date-grained close above still can't resolve: a date
    //   genuinely earlier than the currently open row's own date (backdating before the current
    //   price started). A named sentence instead of a bare "unique violation".
    if (e.code === UNIQUE_VIOLATION && e.constraint === "price_variation_one_open") {
      throw conflict(
        "That date is before the current price started. Pick today or later.",
        { field: "effectiveFrom" });
    }
    throw e;
  }

  await emit(tx, {
    tenantId,
    topic: "items.price.changed",
    emittedBy: SECTION,
    subjectType,
    subjectId,
    // ★ FIX ROUND 1, I1.
    actor: userActor(actorUserId),
    // ★★ THE AMOUNT *IS* IN THIS PAYLOAD, unlike a person's name in people/writes.mjs — and the
    //    difference is the point. A price change is a fact whose VALUE is the fact; an audit trail
    //    that recorded only "the price changed" would answer none of the questions anybody asks of it.
    payload: {
      amount_minor: amountMinor, currency,
      superseded_price_id: supersededId,
      // ★ `is_first_price` distinguishes "this thing now costs something" from "this thing's price
      //   moved", which are different events to a consumer and are indistinguishable from the amount.
      is_first_price: supersededId === null,
    },
  });

  // ★ 11.10 — computed AFTER the price event, in the SAME transaction: the audience and facts are a
  //   read of who this service's regulars are RIGHT NOW, and belong next to the change they are
  //   about, not ahead of it. `null` when not asked (`tellRegulars` false) or nobody to tell.
  let campaignDraft = null;
  if (tellRegulars === true) {
    campaignDraft = await draftPriceChangeCampaign(tx, {
      tenantId, serviceId: subjectId, oldAmountMinor, newAmountMinor: amountMinor, currency,
      effectiveFrom: at, createdBy: actorUserId,
    });
  }

  return { id, supersededId, amount_minor: amountMinor, currency, campaignDraft };
}

/**
 * Create a service, and its FIRST price row, in one transaction.
 * ★★★ 14.20 — F06 §8: A NEW SERVICE STARTS FROM THE PRACTICE'S ITEM DEFAULTS, SERVER-SIDE.
 *     `durationMinutes`/`amountMinor`/`bookable`/`unitId` left out (`undefined`/`null`) are filled
 *     from `items.default_duration_minutes` / `items.default_price_minor` / `items.default_bookable_online`
 *     (fallbacks 60 / 0 / true when the practice has never set the key) and the tenant's `unit`
 *     row with `is_default = true`. A caller that DOES send a value is never overridden — the
 *     defaults only fill an absence.
 * ★ 14.3 (migration 0410) — the R-14.7 columns (`category_id, image_id, colour, sku,
 *   invoice_wording, addon_only, intake_form_id, description, internal_notes, tax_code,
 *   delivery_modes, capacity, unit_id`) are written in the same INSERT; `hostIds` becomes rows in
 *   `keystone.service_host` (empty/omitted = anyone on the team, F06 §2.2).
 */
export async function createService(
  tx, { tenantId, name, durationMinutes, amountMinor, currency = "USD", bookable,
        categoryId = null, imageId = null, colour = null, sku = null, invoiceWording = null,
        addonOnly = false, intakeFormId = null,
        description = null, internalNotes = null, taxCode = null,
        deliveryModes = ["in_person"], capacity = 1, unitId, hostIds = null,
        programId = null,
        actorUserId = null }
) {
  if (typeof name !== "string" || !name.trim()) throw invalid("a service needs a name");
  const trimmedName = name.trim();
  // ★ Programs follow-up brief (30 Sep 2026, Part 1) — `programId` is OPTIONAL and additive
  //   (migration 0543, pending): omitting it behaves exactly as it did before this field existed.
  //   Validated only as "a string if given at all" — the FK itself (tenant_id, program_id) is the
  //   real authority on whether the id names a program THIS tenant owns.
  if (programId !== null && typeof programId !== "string") {
    throw invalid(`programId must be a string id, or empty — got ${JSON.stringify(programId)}`);
  }

  // ── PRACTICE DEFAULTS — fill an ABSENCE only, never override a value the caller sent. ─────────
  let resolvedDuration = durationMinutes;
  if (resolvedDuration === undefined || resolvedDuration === null) {
    resolvedDuration = await getSetting(tx, "items.default_duration_minutes", 60);
  }
  let resolvedAmount = amountMinor;
  if (resolvedAmount === undefined || resolvedAmount === null) {
    resolvedAmount = await getSetting(tx, "items.default_price_minor", 0);
  }
  let resolvedBookable = bookable;
  if (resolvedBookable === undefined || resolvedBookable === null) {
    resolvedBookable = await getSetting(tx, "items.default_bookable_online", true);
  }
  let resolvedUnitId = unitId;
  if (resolvedUnitId === undefined || resolvedUnitId === null) {
    const { rows: defaultUnitRows } = await run(tx, db
      .selectFrom("keystone.unit")
      .select("id")
      .where("tenant_id", "=", tenantId)
      .where("is_default", "=", true)
      .limit(1));
    resolvedUnitId = defaultUnitRows[0]?.id ?? null;
  }

  if (!Number.isInteger(resolvedDuration) || resolvedDuration <= 0) {
    throw invalid(`durationMinutes must be a positive integer — got ${JSON.stringify(resolvedDuration)}`);
  }
  assertMoney(resolvedAmount, currency);
  if (typeof resolvedBookable !== "boolean") {
    throw invalid(`bookable must be a boolean — got ${JSON.stringify(resolvedBookable)}`);
  }
  if (!Array.isArray(deliveryModes) || deliveryModes.length === 0) {
    throw invalid("deliveryModes must be a non-empty array");
  }
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw invalid(`capacity must be a positive integer — got ${JSON.stringify(capacity)}`);
  }

  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  // ★★★ `price_minor` IS NOT WRITTEN — P8.7 retired it (migration 0109). It used to be set here
  //     "because the column is NOT NULL", one value at creation and never updated again, which is
  //     what made two numbers claim to be the price the moment anybody re-priced. The column is now
  //     nullable and empty; `price` is the only answer to what this costs.
  try {
    await run(tx, db
      .insertInto("keystone.service")
      .values({
        id: id ?? null,
        tenant_id: tenantId ?? null,
        name: trimmedName ?? null,
        duration_minutes: resolvedDuration ?? null,
        currency: currency ?? null,
        bookable: resolvedBookable ?? null,
        category_id: categoryId ?? null,
        image_id: imageId ?? null,
        colour: colour ?? null,
        sku: sku ?? null,
        invoice_wording: invoiceWording ?? null,
        addon_only: addonOnly ?? null,
        intake_form_id: intakeFormId ?? null,
        description: description ?? null,
        internal_notes: internalNotes ?? null,
        tax_code: taxCode ?? null,
        delivery_modes: deliveryModes ?? null,
        capacity: capacity ?? null,
        unit_id: resolvedUnitId ?? null,
        program_id: programId ?? null,
      }));
  } catch (e) {
    // ★ `service_tenant_name_key` (0009) — UNIQUE (tenant_id, lower(name)), already in place before
    //   0410 ever added a column. 14.20's own named sentence, verbatim.
    if (e.code === UNIQUE_VIOLATION) {
      throw conflict(`You already have a service called ${trimmedName}.`, { field: "name" });
    }
    if (e.code === CHECK_VIOLATION) throw invalid(`the database refused this service: ${e.constraint ?? e.message}`);
    if (e.code === FOREIGN_KEY_VIOLATION) throw invalid(`the database refused this service: ${e.constraint ?? e.message}`);
    throw e;
  }

  // ★ 14.3 — `service_host`, empty = anyone on the team (F06 §2.2). `ON CONFLICT … DO NOTHING`
  //   absorbs a duplicate id inside the caller's own array; this is a brand-new service, so nothing
  //   pre-existing can collide with it.
  if (Array.isArray(hostIds) && hostIds.length > 0) {
    for (const hostId of hostIds) {
      try {
        await tx.query(
          `INSERT INTO keystone.service_host (tenant_id, service_id, app_user_id)
           VALUES ($1,$2,$3)
           ON CONFLICT ON CONSTRAINT service_host_unique DO NOTHING`,
          [tenantId, id, hostId]);
      } catch (e) {
        if (e.code === FOREIGN_KEY_VIOLATION) throw invalid(`no team member ${hostId} exists in this practice`);
        throw e;
      }
    }
  }

  await emit(tx, {
    tenantId, topic: "items.service.created", emittedBy: SECTION,
    subjectType: "service", subjectId: id,
    // ★ FIX ROUND 1, I1.
    actor: userActor(actorUserId),
    // ★ §2.4 payload rule — the SAME two keys this event has always carried; no free text added.
    payload: { duration_minutes: resolvedDuration, bookable: resolvedBookable },
  });

  // ★★ THE PRICE IS A SEPARATE ROW AND A SEPARATE EVENT, in the same transaction. Two facts happened:
  //    a service exists, and it costs this much. Collapsing them would mean a later re-price emitted a
  //    different topic from the original pricing, so a consumer tracking `items.price.changed` would
  //    never see the first one.
  const price = await createPrice(
    tx, { tenantId, subjectType: "service", subjectId: id, amountMinor: resolvedAmount, currency, actorUserId });

  return { id, name: trimmedName, duration_minutes: resolvedDuration, priceId: price.id };
}

/**
 * Create a package and its lines.
 * @param lines [{ serviceId, quantity }] — at least one.
 */
export async function createPackage(
  tx, { tenantId, name, amountMinor, currency = "USD", installmentsAllowed = false, lines = [],
        description = null, imageId = null, expiryMonths = null, warnAtRemaining = 2,
        portalSellable = false, publicSellable = false,
        programId = null, categoryId = null,
        actorUserId = null }
) {
  if (typeof name !== "string" || !name.trim()) throw invalid("a package needs a name");
  if (programId !== null && typeof programId !== "string") {
    throw invalid(`programId must be a string id, or empty — got ${JSON.stringify(programId)}`);
  }
  // ★ Programs follow-up brief Part 2 — Category extended to package (migration 0544, pending).
  //   Optional/additive, same footing as programId.
  if (categoryId !== null && typeof categoryId !== "string") {
    throw invalid(`categoryId must be a string id, or empty — got ${JSON.stringify(categoryId)}`);
  }
  assertMoney(amountMinor, currency);
  if (typeof installmentsAllowed !== "boolean") {
    throw invalid(`installmentsAllowed must be a boolean — got ${JSON.stringify(installmentsAllowed)}`);
  }
  // ★ 14.3/14.20 — `package.expiry_months` CHECK (0410): 1–120, or NULL ("never expires").
  //   0 is falsy but IS an integer, so it must be caught here rather than reading as "not sent".
  if (expiryMonths !== null && expiryMonths !== undefined &&
      (!Number.isInteger(expiryMonths) || expiryMonths < 1 || expiryMonths > 120)) {
    throw invalid("Pick between 1 and 120 months, or leave it empty.");
  }
  if (!Number.isInteger(warnAtRemaining) || warnAtRemaining < 0) {
    throw invalid(`warnAtRemaining must be a non-negative integer — got ${JSON.stringify(warnAtRemaining)}`);
  }
  if (typeof portalSellable !== "boolean") {
    throw invalid(`portalSellable must be a boolean — got ${JSON.stringify(portalSellable)}`);
  }
  if (typeof publicSellable !== "boolean") {
    throw invalid(`publicSellable must be a boolean — got ${JSON.stringify(publicSellable)}`);
  }
  // ★★ A PACKAGE WITH NO LINES IS REFUSED. It would be a thing a customer can buy that entitles them
  //    to nothing — billable and undeliverable, which is the failure mode ADDENDUM 3 spends a whole
  //    item on elsewhere. There is no such thing as an empty package.
  if (!Array.isArray(lines) || lines.length === 0) {
    throw invalid("a package must contain at least one service line — an empty package is billable and delivers nothing");
  }
  for (const l of lines) {
    if (!l?.serviceId) throw invalid("every package line needs a serviceId");
    if (!Number.isInteger(l.quantity) || l.quantity <= 0) {
      throw invalid(`every package line needs a positive integer quantity — got ${JSON.stringify(l.quantity)}`);
    }
  }

  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  await run(tx, db
    // ★ `price_minor` retired — see createService above and migration 0109.
    // ★ `validity_days` retired — MOCKUPS §0:35 (C2), migration 0264: packages never expire.
    // ★ `installments_allowed` — migration 0268 (B0/CT-110 wave). MOCKUPS §8:255, "Can be paid in
    //   installments" — a per-package toggle only; the installment SCHEDULE itself is spec 05's own
    //   money/Stripe machinery, not built here.
    // ★ 14.3 (migration 0410) — description/image_id/expiry_months/warn_at_remaining/
    //   portal_sellable/public_sellable, written in the same INSERT.
    .insertInto("keystone.package")
    .values({
      id: id ?? null,
      tenant_id: tenantId ?? null,
      name: (name.trim()) ?? null,
      currency: currency ?? null,
      installments_allowed: installmentsAllowed ?? null,
      description: description ?? null,
      image_id: imageId ?? null,
      expiry_months: expiryMonths ?? null,
      warn_at_remaining: warnAtRemaining ?? null,
      portal_sellable: portalSellable ?? null,
      public_sellable: publicSellable ?? null,
      program_id: programId ?? null,
      category_id: categoryId ?? null,
    }));

  for (const l of lines) {
    try {
      await run(tx, db
        .insertInto("keystone.package_line")
        .values({
          tenant_id: tenantId ?? null,
          package_id: id ?? null,
          service_id: l.serviceId ?? null,
          quantity: l.quantity ?? null,
        }));
    } catch (e) {
      // ★ `UNIQUE (tenant_id, package_id, service_id)` — one line per service. Two lines for the same
      //   service is ambiguous about the quantity, so it is a caller error with a clear fix: add the
      //   quantities together.
      if (e.code === UNIQUE_VIOLATION) {
        throw invalid(`service ${l.serviceId} appears twice in this package — combine the quantities into one line`);
      }
      throw e;
    }
  }

  await emit(tx, {
    tenantId, topic: "items.package.created", emittedBy: SECTION,
    subjectType: "package", subjectId: id,
    // ★ FIX ROUND 1, I1.
    actor: userActor(actorUserId),
    payload: { line_count: lines.length, installments_allowed: installmentsAllowed },
  });
  const price = await createPrice(
    tx, { tenantId, subjectType: "package", subjectId: id, amountMinor, currency, actorUserId });
  return { id, name: name.trim(), lineCount: lines.length, priceId: price.id };
}

/**
 * Create a recurring plan and its first price.
 * ★★★ TASK 2.5 — 02-items.md §1 point 4 / §2 / §3 (migration 0267). "A plan's 'sessions included
 *     each month' is not modelled at all" until this extension: `serviceId`/`sessionsIncluded`/
 *     `rolloverMode`/`rolloverCap` are the four new columns 0267 added, mirrored here at the
 *     application layer the same way `assertDiscountShape` mirrors 0265's CHECK constraints — a
 *     `422` naming the field beats a raw constraint violation reaching the caller.
 * ★ A FLAT MEMBERSHIP PLAN GRANTS NO SESSIONS AT ALL — `sessionsIncluded` defaults to `0` and needs
 *   no `serviceId`; the moment it grants ANY sessions it has to say which service they are sessions
 *   OF (`plan_sessions_need_service`, 0267), or "Session 4 of 12" has nothing to count against.
 */
export async function createPlan(
  tx, { tenantId, name, interval, amountMinor, currency = "USD", lines = [],
        rolloverMode = "none", rolloverCap = null,
        description = null, billingDay = null, allowClientPause = false,
        maxPausesPerYear = null, maxPauseMonths = null,
        dunningRetries = null, dunningDays = null, dunningPauseAfter = null,
        programId = null, categoryId = null,
        minimumTermMonths = null,
        actorUserId = null }
) {
  if (typeof name !== "string" || !name.trim()) throw invalid("a plan needs a name");
  if (programId !== null && typeof programId !== "string") {
    throw invalid(`programId must be a string id, or empty — got ${JSON.stringify(programId)}`);
  }
  if (categoryId !== null && typeof categoryId !== "string") {
    throw invalid(`categoryId must be a string id, or empty — got ${JSON.stringify(categoryId)}`);
  }
  // ★ Part 8 (Family Coaching) needs a minimum-term plan — migration 0544 adds
  //   `plan.minimum_term_months`, nullable (no minimum = month-to-month, today's only shape).
  if (minimumTermMonths !== null && minimumTermMonths !== undefined &&
      (!Number.isInteger(minimumTermMonths) || minimumTermMonths < 1)) {
    throw invalid(`minimumTermMonths must be a positive integer, or empty — got ${JSON.stringify(minimumTermMonths)}`);
  }
  if (!PLAN_INTERVALS.includes(interval)) {
    throw invalid(`interval must be one of ${PLAN_INTERVALS.join(", ")} — got ${JSON.stringify(interval)}`);
  }
  assertMoney(amountMinor, currency);
  // ★★★ M2 (F805) — a plan's sessions live in `plan_line` only. `lines` is
  //     `[{ serviceId, quantityPerCycle }]`, `quantityPerCycle` a positive integer or `null` =
  //     unlimited. An empty `lines` is a flat membership plan that grants no sessions at all.
  if (!Array.isArray(lines)) throw invalid("lines must be an array");
  {
    const seen = new Set();
    for (const l of lines) {
      if (!l?.serviceId) throw invalid("every plan line needs a serviceId");
      if (seen.has(l.serviceId)) throw invalid("each service appears once in a plan");
      seen.add(l.serviceId);
      const q = l.quantityPerCycle;
      if (q !== null && q !== undefined && !(Number.isInteger(q) && q > 0)) {
        throw invalid("lines[i].quantityPerCycle must be a positive whole number, or empty for unlimited");
      }
    }
  }
  if (!PLAN_ROLLOVER_MODES.includes(rolloverMode)) {
    throw invalid(`rolloverMode must be one of ${PLAN_ROLLOVER_MODES.join(", ")} — got ${JSON.stringify(rolloverMode)}`);
  }
  // ★ §2's own route-table wording, verbatim: "A cap needs a number" — the 422 this drawer's
  //   rollover fields exist to prevent.
  if (rolloverMode === "cap" && !(Number.isInteger(rolloverCap) && rolloverCap > 0)) {
    throw invalid("A cap needs a number");
  }
  if (rolloverMode === "none" && rolloverCap !== null && rolloverCap !== undefined) {
    throw invalid("A cap only applies when unused sessions roll over");
  }
  // ★ 14.3/14.20 — `plan.billing_day` CHECK (0410): 1–28, or NULL.
  if (billingDay !== null && billingDay !== undefined &&
      (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 28)) {
    throw invalid("Pick a day between the 1st and the 28th.");
  }
  if (typeof allowClientPause !== "boolean") {
    throw invalid(`allowClientPause must be a boolean — got ${JSON.stringify(allowClientPause)}`);
  }
  for (const [label, v] of [["maxPausesPerYear", maxPausesPerYear], ["maxPauseMonths", maxPauseMonths],
                             ["dunningRetries", dunningRetries], ["dunningDays", dunningDays],
                             ["dunningPauseAfter", dunningPauseAfter]]) {
    if (v !== null && v !== undefined && !Number.isInteger(v)) {
      throw invalid(`${label} must be an integer, or absent — got ${JSON.stringify(v)}`);
    }
  }

  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  try {
    await run(tx, db
      // ★ `interval` is a reserved word in SQL — quoted, and the quoting is why F21's "plan_price does
      //   not exist" note matters: the plan's price lives in `price`, keyed by subject, not in a
      //   `plan_price` table that was never built.
      // ★ `price_minor` retired — see createService above and migration 0109.
      // ★ 14.3 (migration 0410) — description/billing_day/allow_client_pause/max_pauses_per_year/
      //   max_pause_months/dunning_retries/dunning_days/dunning_pause_after, same INSERT.
      // ★★★ M2 (F805) — `service_id`/`sessions_included` dropped from this INSERT; a plan's
      //     sessions live in `plan_line` only (inserted below, one row per line).
      .insertInto("keystone.plan")
      .values({
        id: id ?? null,
        tenant_id: tenantId ?? null,
        name: (name.trim()) ?? null,
        currency: currency ?? null,
        interval: interval ?? null,
        rollover_mode: rolloverMode ?? null,
        rollover_cap: (rolloverMode === "cap" ? rolloverCap : null) ?? null,
        description: description ?? null,
        billing_day: billingDay ?? null,
        allow_client_pause: allowClientPause ?? null,
        max_pauses_per_year: maxPausesPerYear ?? null,
        max_pause_months: maxPauseMonths ?? null,
        dunning_retries: dunningRetries ?? null,
        dunning_days: dunningDays ?? null,
        dunning_pause_after: dunningPauseAfter ?? null,
        program_id: programId ?? null,
        category_id: categoryId ?? null,
        minimum_term_months: minimumTermMonths ?? null,
      }));
  } catch (e) {
    if (e.code === CHECK_VIOLATION) throw invalid(`the database refused this plan: ${e.constraint ?? e.message}`);
    throw e;
  }

  // ★★★ M2 (F805) — one `plan_line` row per line; `quantityPerCycle` NULL = unlimited. Mirrors
  //     createPackage's own per-line loop above.
  for (const l of lines) {
    try {
      await tx.query(
        `INSERT INTO keystone.plan_line (tenant_id, plan_id, service_id, quantity_per_cycle)
         VALUES ($1,$2,$3,$4)`,
        [tenantId, id, l.serviceId, l.quantityPerCycle ?? null]);
    } catch (e) {
      // ★ `UNIQUE (tenant_id, plan_id, service_id)` (0514) — one line per service.
      if (e.code === UNIQUE_VIOLATION) {
        throw invalid("each service appears once in a plan");
      }
      if (e.code === FOREIGN_KEY_VIOLATION) {
        throw invalid(`no service ${l.serviceId} exists in this practice's catalogue`);
      }
      throw e;
    }
  }

  await emit(tx, {
    tenantId, topic: "items.plan.created", emittedBy: SECTION,
    subjectType: "plan", subjectId: id,
    // ★ FIX ROUND 1, I1.
    actor: userActor(actorUserId),
    payload: { interval, lines: lines.map(l => ({ service_id: l.serviceId, quantity_per_cycle: l.quantityPerCycle })),
               rollover_mode: rolloverMode, rollover_cap: rolloverMode === "cap" ? rolloverCap : null },
  });
  const price = await createPrice(
    tx, { tenantId, subjectType: "plan", subjectId: id, amountMinor, currency, actorUserId });
  return { id, name: name.trim(), interval, priceId: price.id };
}

/**
 * ★★★ A PER-ACCOUNT (OR PER-PERSON) OVERRIDE — **NOT A FORKED PLAN.**
 *
 * §Z4's warning: the tempting alternative is to copy the plan, change the number and attach the copy
 * to one customer. That produces a catalogue where two entries look identical, only one is real, and
 * every report that groups by plan silently splits. ★ A `contracted_price` row instead says "this
 * ONE party pays THIS for THAT catalogue entry", and the catalogue entry stays single.
 *
 * ★★ `contracted_price_one_party` CHECK: exactly one of account_id / app_user_id. Both would be an
 *    override whose owner is ambiguous; neither would be an override that applies to everyone, which
 *    is just a price.
 * ★ It does NOT emit `items.price.changed` — the catalogue price did not change. The event belongs to
 *   the party's agreement, and the topic for that is a documents/money concern, so this returns the
 *   row and lets the caller's own flow record it rather than borrowing a topic that would be wrong.
 */
export async function setContractedPrice(
  tx, { tenantId, accountId = null, appUserId = null, subjectType, subjectId, amountMinor, currency = "USD" }
) {
  if (!PRICE_SUBJECTS.includes(subjectType)) {
    throw invalid(`subject_type must be one of ${PRICE_SUBJECTS.join(", ")} — got ${JSON.stringify(subjectType)}`);
  }
  assertMoney(amountMinor, currency);
  if ((accountId === null) === (appUserId === null)) {
    throw invalid(
      "a contracted price belongs to EXACTLY ONE party — give an accountId or an appUserId, not both " +
      "and not neither (both is ambiguous; neither is just a price)");
  }

  const at = (await tx.query(`SELECT now() AS t`)).rows[0].t;
  // ★ The same supersede shape as `price`: close the open override for this party+subject, then
  //   insert. An override is a history too — "what did this customer pay in March" has to be
  //   answerable after the rate changes.
  await tx.query(
    `UPDATE keystone.contracted_price
        SET effective_to = $5
      WHERE tenant_id = $1 AND subject_type = $2 AND subject_id = $3
        AND ($4::uuid IS NULL OR account_id = $4) AND ($6::uuid IS NULL OR app_user_id = $6)
        AND effective_to IS NULL AND effective_from < $5`,
    [tenantId, subjectType, subjectId, accountId, at, appUserId]);

  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  try {
    await run(tx, db
      .insertInto("keystone.contracted_price")
      .values({
        id: id ?? null,
        tenant_id: tenantId ?? null,
        account_id: accountId ?? null,
        app_user_id: appUserId ?? null,
        subject_type: subjectType ?? null,
        subject_id: subjectId ?? null,
        amount_minor: amountMinor ?? null,
        currency: currency ?? null,
        effective_from: at ?? null,
      }));
  } catch (e) {
    if (e.code === CHECK_VIOLATION) throw invalid(`the database refused this override: ${e.constraint ?? e.message}`);
    throw e;
  }
  return { id, amount_minor: amountMinor, currency, party: accountId ? "account" : "app_user" };
}

/**
 * ★ Read the price in force for a catalogue entry right now. Exported because the supersede law is
 *   only useful if the read side honours the window — a reader that took `service.price_minor` would
 *   get the B2.1 legacy mirror and be wrong from the first re-price onwards.
 */
export async function currentPrice(
  tx, { tenantId, subjectType, subjectId,
        // ★ 14.6 — same optional variation as createPrice/keystone.current_price(). Both default
        //   NULL, which resolves to the base row only — today's exact, unchanged behaviour.
        locationId = null, deliveryMode = null }
) {
  // ★ 14.6 — mirrors keystone.current_price()'s resolution (0413): (location AND mode) > location
  //   > mode > base. Ranked in SQL rather than in JS so the two implementations cannot drift apart
  //   on which row wins.
  const { rows } = await tx.query(
    `SELECT ranked.id, ranked.amount_minor, ranked.currency, ranked.effective_from
       FROM (
         SELECT p.id, p.amount_minor, p.currency, p.effective_from,
                CASE
                  WHEN $4::uuid IS NOT NULL AND $5::text IS NOT NULL
                       AND p.location_id = $4 AND p.delivery_mode = $5 THEN 1
                  WHEN $4::uuid IS NOT NULL
                       AND p.location_id = $4 AND p.delivery_mode IS NULL THEN 2
                  WHEN $5::text IS NOT NULL
                       AND p.location_id IS NULL AND p.delivery_mode = $5 THEN 3
                  WHEN p.location_id IS NULL AND p.delivery_mode IS NULL THEN 4
                END AS specificity
           FROM keystone.price p
          WHERE p.tenant_id = $1 AND p.subject_type = $2 AND p.subject_id = $3
            AND p.effective_to IS NULL
       ) ranked
      WHERE ranked.specificity IS NOT NULL
      ORDER BY ranked.specificity ASC, ranked.effective_from DESC
      LIMIT 1`,
    [tenantId, subjectType, subjectId, locationId, deliveryMode]);
  if (!rows[0]) throw notFound(`no price is in force for ${subjectType} ${subjectId}`);
  return rows[0];
}

/**
 * ★★★ TASK 2.7 / FINDING 3 (the maintainer ruled, 22 Sep 2026) — WHICH credit becomes eligible, and nothing else.
 *
 * A package sold on an installment plan unlocks its credits AS EACH INSTALLMENT IS PAID, not all at
 * once (option B of the gap-list's three). This is a PURE function — no database, no side effect — so
 * both call sites that need it (createEntitlement's initial split, unlockNextInstallment's later
 * increment; both spec 05's `src/money/writes.mjs`, unmodified by this task) compute the exact same
 * schedule from the exact same rule, rather than each hand-rolling its own fraction.
 *
 * ★★ CUMULATIVE, NEVER A PER-INSTALLMENT DELTA. `unlockedCount` is the count unlocked THROUGH
 *    `installmentsPaid`, computed fresh each time as `floor(totalCredits * installmentsPaid /
 *    installmentsTotal)` — never re-derived by adding up previous fractions, which could round
 *    differently on every call and drift from the true total. Reading it at
 *    `installmentsPaid === installmentsTotal` always returns exactly `totalCredits` (floor of a whole
 *    multiple), so the schedule can never under- or over-unlock by a compounding rounding error.
 *
 * Example (the task's own): a 10-credit package sold in 3 installments — after 1 of 3 paid,
 * `floor(10×1/3) = 3` credits usable (not 10, not 0); after 2 of 3, `floor(10×2/3) = 6`; after 3 of 3,
 * `floor(10×3/3) = 10` — the exact remaining 4 unlock on the last payment, not before it.
 *
 * `installmentsTotal` NULL or `1` (ordinary, non-installment purchase) is the positive control: every
 * credit is unlocked immediately, matching today's createEntitlement behaviour unchanged.
 *
 * @returns { unlockedCount }
 */
export function resolveInstallmentUnlock({ totalCredits, installmentsTotal, installmentsPaid }) {
  if (!Number.isInteger(totalCredits) || totalCredits <= 0) {
    throw invalid(`totalCredits must be a positive integer — got ${JSON.stringify(totalCredits)}`);
  }
  // ★ NULL or 1 both mean "no installment schedule" — every credit unlocks at once, the ordinary case.
  if (installmentsTotal === null || installmentsTotal === undefined || installmentsTotal === 1) {
    return { unlockedCount: totalCredits };
  }
  if (!Number.isInteger(installmentsTotal) || installmentsTotal <= 1) {
    throw invalid(`installmentsTotal must be an integer greater than 1, or null — got ${JSON.stringify(installmentsTotal)}`);
  }
  if (!Number.isInteger(installmentsPaid) || installmentsPaid < 1 || installmentsPaid > installmentsTotal) {
    throw invalid(
      `installmentsPaid must be an integer between 1 and installmentsTotal (${installmentsTotal}) — ` +
      `got ${JSON.stringify(installmentsPaid)}`);
  }
  return { unlockedCount: Math.floor((totalCredits * installmentsPaid) / installmentsTotal) };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ★★★ TASK 2.4 — DISCOUNTS (02-items.md §2/§3/§5, migration 0265/0266) AND ITEM AGREEMENT
//     REQUIREMENTS (§2/§3/§5, migration 0269/0270). Additive: nothing above this line is touched.
// ═══════════════════════════════════════════════════════════════════════════════

const DISCOUNT_KINDS = Object.freeze(["percent", "fixed"]);
const DISCOUNT_APPLIES_TO = Object.freeze(["service", "package", "plan", "any"]);

const DISCOUNT_SHAPE_MESSAGE = "Pick percent or a fixed amount, not both";

/**
 * `discount_kind_shape` (0265) mirrored at the application layer so a bad shape is a `422` naming
 * the field, not a raw constraint violation. `kind:"percent"` needs `percentBp` ALONE;
 * `kind:"fixed"` needs `amountMinor`+`currency` ALONE — the companion pair for the OTHER kind
 * present is refused exactly like the pair being entirely absent, both read by §2's route table as
 * "both/neither of percent+fixed".
 */
function assertDiscountShape(kind, percentBp, amountMinor, currency) {
  if (!DISCOUNT_KINDS.includes(kind)) {
    throw invalid(`kind must be one of ${DISCOUNT_KINDS.join(", ")} — got ${JSON.stringify(kind)}`);
  }
  const percentGiven = percentBp !== null && percentBp !== undefined;
  const fixedGiven = (amountMinor !== null && amountMinor !== undefined) ||
                      (currency !== null && currency !== undefined);
  if (kind === "percent") {
    const percentOk = Number.isInteger(percentBp) && percentBp >= 1 && percentBp <= 10000;
    if (!percentOk || fixedGiven) throw invalid(DISCOUNT_SHAPE_MESSAGE);
  } else {
    const fixedOk = Number.isInteger(amountMinor) && amountMinor > 0 &&
      typeof currency === "string" && /^[A-Z]{3}$/.test(currency);
    if (!fixedOk || percentGiven) throw invalid(DISCOUNT_SHAPE_MESSAGE);
  }
}

/**
 * ★★★ `ItemsDiscounts` "New discount" drawer — 02-items.md §2. A saved, reusable, named discount —
 *     never mirrored to Stripe (§10, no Coupon/PromotionCode on either account); the amount is only
 *     ever computed server-side at the moment spec 05's `createLineItem` applies it.
 * ★ `code`/`name` collisions are the two partial-unique indexes 0265 already carries
 *   (`discount_tenant_name_key`, `discount_tenant_code_key`) — caught below and named in the `409`.
 */
export async function createDiscount(
  tx, { tenantId, name, code = null, kind, percentBp = null, amountMinor = null, currency = null,
        appliesTo, coachMayApply = false, maxRedemptions = null, validFrom = null, validTo = null,
        descriptionClient = null, maxDiscountMinor = null, firstPurchaseOnly = false,
        perPersonLimit = null, targetIds = null,
        actorUserId = null }
) {
  if (typeof name !== "string" || !name.trim()) throw invalid("a discount needs a name");
  assertDiscountShape(kind, percentBp, amountMinor, currency);
  if (!DISCOUNT_APPLIES_TO.includes(appliesTo)) {
    throw invalid(`appliesTo must be one of ${DISCOUNT_APPLIES_TO.join(", ")} — got ${JSON.stringify(appliesTo)}`);
  }
  if (typeof coachMayApply !== "boolean") {
    throw invalid(`coachMayApply must be a boolean — got ${JSON.stringify(coachMayApply)}`);
  }
  if (maxRedemptions !== null && maxRedemptions !== undefined &&
      (!Number.isInteger(maxRedemptions) || maxRedemptions <= 0)) {
    throw invalid(`maxRedemptions must be a positive integer, or absent — got ${JSON.stringify(maxRedemptions)}`);
  }
  // ★ `discount_window_shape` (0265) mirrored the same way — a `422` naming the field beats a raw
  //   constraint violation reaching the caller.
  if (validFrom != null && validTo != null && !(new Date(validTo).getTime() > new Date(validFrom).getTime())) {
    throw invalid("The end date has to be after the start");
  }
  // ★ 14.3/14.20 — `discount_cap_is_percent_only` (0410): `maxDiscountMinor` caps a PERCENT discount's
  //   payout; a fixed discount is already capped by its own amount, so a cap on one is meaningless.
  //   Mirrored here, same reason as every other CHECK mirrored in this function: a 422 naming the
  //   field beats the raw constraint violation reaching the caller.
  if (maxDiscountMinor !== null && maxDiscountMinor !== undefined && kind !== "percent") {
    throw invalid("Only for percentage discounts. A fixed amount is already capped.");
  }
  if (maxDiscountMinor !== null && maxDiscountMinor !== undefined &&
      (!Number.isInteger(maxDiscountMinor) || maxDiscountMinor <= 0)) {
    throw invalid(`maxDiscountMinor must be a positive integer, or absent — got ${JSON.stringify(maxDiscountMinor)}`);
  }
  if (typeof firstPurchaseOnly !== "boolean") {
    throw invalid(`firstPurchaseOnly must be a boolean — got ${JSON.stringify(firstPurchaseOnly)}`);
  }
  if (perPersonLimit !== null && perPersonLimit !== undefined &&
      (!Number.isInteger(perPersonLimit) || perPersonLimit <= 0)) {
    throw invalid(`perPersonLimit must be a positive integer, or absent — got ${JSON.stringify(perPersonLimit)}`);
  }
  if (targetIds !== null && targetIds !== undefined && !Array.isArray(targetIds)) {
    throw invalid(`targetIds must be an array of ids, or absent — got ${JSON.stringify(targetIds)}`);
  }

  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  const trimmedName = name.trim();
  try {
    await run(tx, db
      // ★ 14.3 (migration 0410) — description_client/max_discount_minor/first_purchase_only/
      //   per_person_limit/target_ids, same INSERT. `stripe_coupon_id`/`stripe_promotion_code_id`
      //   are 14.26's own write (Stripe sync), left NULL here.
      .insertInto("keystone.coupon")
      .values({
        id: id ?? null,
        tenant_id: tenantId ?? null,
        name: trimmedName ?? null,
        kind: kind ?? null,
        percent_bp: percentBp ?? null,
        amount_minor: amountMinor ?? null,
        currency: currency ?? null,
        applies_to: appliesTo ?? null,
        coach_may_apply: coachMayApply ?? null,
        max_redemptions: maxRedemptions ?? null,
        valid_from: validFrom ?? null,
        valid_to: validTo ?? null,
        description_client: descriptionClient ?? null,
        max_discount_minor: maxDiscountMinor ?? null,
        first_purchase_only: firstPurchaseOnly ?? null,
        per_person_limit: perPersonLimit ?? null,
        target_ids: targetIds ?? null,
      }));
  } catch (e) {
    if (e.code === UNIQUE_VIOLATION) {
      throw conflict(
        `the name ${JSON.stringify(trimmedName)} is already used by another discount`);
    }
    if (e.code === CHECK_VIOLATION) throw invalid(`the database refused this discount: ${e.constraint ?? e.message}`);
    throw e;
  }

  // ★ Insert a promotion_code row if a code was provided
  if (code && code.trim()) {
    try {
      await run(tx, db
        .insertInto("keystone.promotion_code")
        .values({
          tenant_id: tenantId ?? null,
          coupon_id: id ?? null,
          code: (code.trim()) ?? null,
          active: true,
        }));
    } catch (e) {
      if (e.code === UNIQUE_VIOLATION) {
        throw conflict(`the code ${JSON.stringify(code)} is already used by another discount`);
      }
      if (e.code === CHECK_VIOLATION) throw invalid(`the database refused this code: ${e.constraint ?? e.message}`);
      throw e;
    }
  }

  await emit(tx, {
    tenantId, topic: "items.discount.created", emittedBy: SECTION,
    subjectType: "discount", subjectId: id,
    actor: userActor(actorUserId),
    payload: { kind, applies_to: appliesTo, coach_may_apply: coachMayApply },
  });

  return { id, name: trimmedName };
}

/**
 * ★ `ItemsDiscounts` row action "Stop offering"/"Offer again" — 02-items.md §2. Same no-op-refused
 *   idiom as every other active-toggle route in this spec: a request that would not change anything
 *   is a `409`, not a silent `200`.
 */
export async function setDiscountActive(tx, { tenantId, discountId, active, actorUserId = null }) {
  if (typeof active !== "boolean") {
    throw invalid(`active must be a boolean — got ${JSON.stringify(active)}`);
  }
  const { rows } = await run(tx, db
    .selectFrom("keystone.coupon")
    .select("active")
    .where("tenant_id", "=", tenantId)
    .where("id", "=", discountId));
  if (!rows[0]) throw notFound(`no discount ${discountId} in this practice's catalogue`);
  if (rows[0].active === active) {
    throw conflict(active
      ? "This discount is already being offered"
      : "This discount is already not being offered");
  }

  await run(tx, db
    .updateTable("keystone.coupon")
    .set({ active: active ?? null })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", discountId));

  await emit(tx, {
    tenantId, topic: "items.discount.active_changed", emittedBy: SECTION,
    subjectType: "discount", subjectId: discountId,
    actor: userActor(actorUserId),
    payload: { active },
  });

  return { id: discountId, active };
}

/**
 * ★ `POST /api/items/promotion-codes` — add a promotion code to an existing coupon.
 *   `object: "discount", action: "edit"` (same permission as coupon updates).
 */
export async function addPromotionCode(tx, { tenantId, couponId, code, actorUserId = null }) {
  if (typeof code !== "string" || !code.trim()) {
    throw invalid("a promotion code is required");
  }

  // Verify coupon exists
  const { rows: couponRows } = await run(tx, db
    .selectFrom("keystone.coupon")
    .select("id")
    .where("tenant_id", "=", tenantId)
    .where("id", "=", couponId));
  if (!couponRows[0]) throw notFound(`no coupon ${couponId} in this practice's catalogue`);

  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  const trimmedCode = code.trim();
  try {
    await run(tx, db
      .insertInto("keystone.promotion_code")
      .values({
        id: id ?? null,
        tenant_id: tenantId ?? null,
        coupon_id: couponId ?? null,
        code: trimmedCode ?? null,
        active: true,
      }));
  } catch (e) {
    if (e.code === UNIQUE_VIOLATION) {
      throw conflict(`the code ${JSON.stringify(trimmedCode)} is already used`);
    }
    if (e.code === CHECK_VIOLATION) throw invalid(`the database refused this code: ${e.constraint ?? e.message}`);
    throw e;
  }

  await emit(tx, {
    tenantId, topic: "items.promotion_code.created", emittedBy: SECTION,
    subjectType: "promotion_code", subjectId: id,
    actor: userActor(actorUserId),
    payload: { coupon_id: couponId, code: trimmedCode },
  });

  return { id, couponId, code: trimmedCode, active: true };
}

/**
 * ★ `POST /api/items/promotion-codes/deactivate` — deactivate a promotion code.
 *   `object: "discount", action: "edit"` (same permission as coupon updates).
 */
export async function deactivatePromotionCode(tx, { tenantId, promotionCodeId, actorUserId = null }) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.promotion_code")
    .select(["active", "coupon_id"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", promotionCodeId));
  if (!rows[0]) throw notFound(`no promotion code ${promotionCodeId} in this practice's catalogue`);
  if (!rows[0].active) {
    throw conflict("This promotion code is already deactivated");
  }

  await run(tx, db
    .updateTable("keystone.promotion_code")
    .set({ active: false })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", promotionCodeId));

  await emit(tx, {
    tenantId, topic: "items.promotion_code.deactivated", emittedBy: SECTION,
    subjectType: "promotion_code", subjectId: promotionCodeId,
    actor: userActor(actorUserId),
    payload: { coupon_id: rows[0].coupon_id },
  });

  return { id: promotionCodeId, active: false };
}

const CONTRACT_BUILDER = "contract";

/**
 * ★★★ `ItemsAttachAgreement` — 02-items.md §2/§3 (0269). ONE required agreement per item: presence
 *     of the row IS "required". `templateId` must name a `builder:'contract'` template — checked
 *     here, at write time, per 0269's own note, never duplicated as a second database constraint.
 * ★ `getAgreementRequirement` (task 2.3, `./agreements.mjs`) answers "does this item already have
 *   one" — imported and called, never redefined, per this task's own instruction.
 */
export async function attachAgreementRequirement(
  tx, { tenantId, itemType, itemId, templateId,
        firstBookingOnly = true, holdUntilSigned = false, teenTemplateId = null,
        actorUserId = null }
) {
  if (!PRICE_SUBJECTS.includes(itemType)) {
    throw invalid(`itemType must be one of ${PRICE_SUBJECTS.join(", ")} — got ${JSON.stringify(itemType)}`);
  }

  // ★ DOCUSTAY WALL FIX — routed through documents/api.mjs's existing `templateBuilderAndName`
  //   (D1, 27 Sep) rather than a direct query; only the `.builder` field is needed here.
  const template = await templateBuilderAndName(tx, { tenantId, templateId });
  if (!template || template.builder !== CONTRACT_BUILDER) {
    throw invalid("Only a contract can be an agreement");
  }
  if (typeof firstBookingOnly !== "boolean") {
    throw invalid(`firstBookingOnly must be a boolean — got ${JSON.stringify(firstBookingOnly)}`);
  }
  if (typeof holdUntilSigned !== "boolean") {
    throw invalid(`holdUntilSigned must be a boolean — got ${JSON.stringify(holdUntilSigned)}`);
  }

  const existing = await getAgreementRequirement(tx, { tenantId, itemType, itemId });
  if (existing) throw conflict("Detach the current agreement first");

  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  try {
    await run(tx, db
      // ★ 14.3 (migration 0410) — first_booking_only/hold_until_signed/teen_template_id, same INSERT.
      .insertInto("keystone.item_agreement_requirement")
      .values({
        id: id ?? null,
        tenant_id: tenantId ?? null,
        item_type: itemType ?? null,
        item_id: itemId ?? null,
        template_id: templateId ?? null,
        first_booking_only: firstBookingOnly ?? null,
        hold_until_signed: holdUntilSigned ?? null,
        teen_template_id: teenTemplateId ?? null,
      }));
  } catch (e) {
    // ★ Belt and braces against a race the proactive `getAgreementRequirement` read above cannot
    //   close by itself — the same UNIQUE (tenant_id, item_type, item_id) 0269 already carries.
    if (e.code === UNIQUE_VIOLATION) throw conflict("Detach the current agreement first");
    if (e.code === FOREIGN_KEY_VIOLATION) throw invalid(`no template ${teenTemplateId} exists in this practice`);
    throw e;
  }

  await emit(tx, {
    tenantId, topic: "items.agreement_requirement.attached", emittedBy: SECTION,
    // ★ §5 — carried on the ITEM it attaches to (no record page of its own), reusing the existing
    //   service/package/plan subject types rather than a new one.
    subjectType: itemType, subjectId: itemId,
    actor: userActor(actorUserId),
    payload: { requirement_id: id, template_id: templateId },
  });

  return { id, itemType, itemId, templateId };
}

/**
 * ★ `ItemsAttachAgreement` "Detach" — 02-items.md §2. The spec's own route is
 *   `DELETE /api/items/agreements/:id`; every mutating route in this application is `POST`
 *   (P15B.13 — Idempotency-Key required and replayed, `src/routes/writes.mjs:1-3`, no `DELETE`
 *   verb exists anywhere in this codebase today), so this is wired as `POST` with the row's own
 *   `id` in the body, the same convention `/api/people/guardian/remove` already uses for "detach an
 *   association" rather than a raw HTTP `DELETE`. Reported to Opus as a deliberate, evidenced
 *   adaptation, not a silent rename.
 */
export async function detachAgreementRequirement(tx, { tenantId, id, actorUserId = null }) {
  const { rows } = await run(tx, db
    .deleteFrom("keystone.item_agreement_requirement")
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id)
    .returning(["item_type", "item_id"]));
  if (!rows[0]) throw notFound("no such requirement");

  await emit(tx, {
    tenantId, topic: "items.agreement_requirement.detached", emittedBy: SECTION,
    subjectType: rows[0].item_type, subjectId: rows[0].item_id,
    actor: userActor(actorUserId),
    payload: { requirement_id: id },
  });

  return { id, detached: true };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ★★★ TASK 2.5 — REMAINING ITEMS BEHAVIORS (02-items.md §1/§2/§3/§10). Additive: nothing above
//     this line is touched except `createPlan`'s own extension (this task's other named change,
//     §2's "existing, extended" route) and the two new constants beside `PLAN_INTERVALS`.
// ═══════════════════════════════════════════════════════════════════════════════

const ITEM_ACTIVE_TABLE = Object.freeze({
  service: "keystone.service",
  package: "keystone.package",
  plan: "keystone.plan",
});

/**
 * ★★★ `ItemsServices`/`ItemsPackages`/`ItemsPlans` row action "Stop selling"/"Sell again" AND the
 *     `ItemsStopSelling` record-page confirm — 02-items.md §1 point 3 / §2. [MEASURED, §1:38] five
 *     item routes existed and NOT ONE ever set `active` — this closes that gap. Same no-op-refused
 *     idiom as `setDiscountActive` (task 2.4): a request that would not change anything is a `409`,
 *     not a silent `200`, so the positive control (starting the SAME item again) is what proves the
 *     refusal is about the no-op, not about the item (§12 item 1).
 * ★ §2's route table shows the SAME body shape (`{ itemType, itemId }`) for both directions with
 *   "(server sets active:false/:true)" as a parenthetical — read here, deliberately, the same way
 *   `setDiscountActive`'s own `{ discountId, active }` shape already reads: the CALLER states the
 *   target `active` explicitly (the button that renders already knows which direction it offers,
 *   the same way `ItemsDiscounts`' "Stop offering"/"Offer again" already does), not a same-body
 *   toggle the route infers from the row's current state. Kept consistent with the one sibling
 *   route this spec already built, rather than introduced as a second, silently different shape.
 */
export async function setItemActive(tx, { tenantId, itemType, itemId, active, actorUserId = null }) {
  if (!PRICE_SUBJECTS.includes(itemType)) {
    throw invalid(`itemType must be one of ${PRICE_SUBJECTS.join(", ")} — got ${JSON.stringify(itemType)}`);
  }
  if (typeof active !== "boolean") {
    throw invalid(`active must be a boolean — got ${JSON.stringify(active)}`);
  }
  const table = ITEM_ACTIVE_TABLE[itemType];
  const { rows } = await tx.query(
    `SELECT active FROM ${table} WHERE tenant_id = $1 AND id = $2`, [tenantId, itemId]);
  if (!rows[0]) throw notFound(`no ${itemType} ${itemId} in this practice's catalogue`);
  if (rows[0].active === active) {
    throw conflict(active
      ? "This is already for sale"
      : "This is already not for sale");
  }

  await tx.query(`UPDATE ${table} SET active = $3 WHERE tenant_id = $1 AND id = $2`,
    [tenantId, itemId, active]);

  await emit(tx, {
    // ★ §5's own table names each direction its own topic per subject type — six in total, not one
    //   shared `.active_changed` reading a boolean, matching `items.service.archived`'s own posture.
    tenantId, topic: `items.${itemType}.${active ? "sellable_again" : "stopped_selling"}`,
    emittedBy: SECTION,
    subjectType: itemType, subjectId: itemId,
    actor: userActor(actorUserId),
    payload: { active },
  });

  return { id: itemId, itemType, active };
}

/**
 * ★★★ 02-items.md §10 — the exact interface handed to spec 05's own `createSubscription`/renewal
 *     call site: "call on every successful subscription payment, THEN call `createEntitlement`…
 *     with the returned values." PURE — no database, no side effect — so both this spec's own
 *     tests and spec 05's later call site compute the exact same grant from the exact same rule.
 * ★ `rolloverMode:'none'` (MOCKUPS §8 "use them or lose them"): every session included grants,
 *   full stop, and expires with that period — `expiresAt` is simply `periodEnd`, unconditionally.
 * ★★ `rolloverMode:'cap'` ("roll over, up to N saved"): nothing expires (`expiresAt: null` — the
 *    existing due-sweep never touches a rollover grant on a schedule), but the GRANT itself is
 *    clamped so `carryoverAvailable + grantCount` never exceeds `rolloverCap` — a client already
 *    sitting at the cap is granted zero more, never a negative count.
 */
export function resolvePeriodGrant({
  sessionsIncluded, rolloverMode, rolloverCap = null, carryoverAvailable = 0, periodEnd = null,
}) {
  if (!Number.isInteger(sessionsIncluded) || sessionsIncluded < 0) {
    throw invalid(`sessionsIncluded must be a non-negative integer — got ${JSON.stringify(sessionsIncluded)}`);
  }
  if (!PLAN_ROLLOVER_MODES.includes(rolloverMode)) {
    throw invalid(`rolloverMode must be one of ${PLAN_ROLLOVER_MODES.join(", ")} — got ${JSON.stringify(rolloverMode)}`);
  }
  if (rolloverMode === "none") {
    return { grantCount: sessionsIncluded, expiresAt: periodEnd };
  }
  // rolloverMode === "cap"
  if (!Number.isInteger(rolloverCap) || rolloverCap <= 0) {
    throw invalid(`rolloverCap must be a positive integer when rolloverMode is "cap" — got ${JSON.stringify(rolloverCap)}`);
  }
  const carryover = Number.isInteger(carryoverAvailable) ? carryoverAvailable : 0;
  // ★★ THE CLAMP. Never negative (Math.max(0, …)), never carries the total past the cap.
  const grantCount = Math.max(0, Math.min(sessionsIncluded, rolloverCap - carryover));
  return { grantCount, expiresAt: null };
}

export { RAISE_EXCEPTION as PRICE_TRIGGER_SQLSTATE };
