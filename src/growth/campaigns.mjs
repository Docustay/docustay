// @ts-check
/**
 * GROWTH — segments and campaigns. P20.11.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ A LIST IS A SAVED FILTER OVER `app_user`, NOT A SECOND SUBSCRIBER STORE. That rule shapes every
 *     function here: `resolveSegment()` runs a QUERY at send time, so the audience is whatever the
 *     practice actually looks like at that moment. There is no membership table to fall out of date,
 *     because there is no membership table.
 *
 * ★★★ AND SENDING GOES THROUGH THE **EXISTING** FAN-OUT — one `notification` + one
 *     `notification_delivery` per recipient. Growth adds NO delivery bookkeeping of its own:
 *     "did it actually send" is already answerable there, and P18.9 proved that path end to end
 *     against Resend. A second delivery record would be the same drift defect one layer down.
 */

import { emit } from "../events/outbox.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";
// ★ 11.10 — the shared "what is a regular" definition (S11-OQ-3(a), RULED, 11.3). Imported and
//   called here, never redefined: `regularOfServiceSql` is the parameterised SQL fragment,
//   `REGULAR_WINDOW_DAYS`/`REGULAR_MIN_ATTENDED` are the two constants that fragment closes over.
import { regularOfServiceSql, REGULAR_WINDOW_DAYS, REGULAR_MIN_ATTENDED } from "../people/regulars.mjs";
// ★ 11.10 — money/date formatting, reused rather than re-implemented (11.3).
import { formatMinor, formatDayMonth } from "../money/format.mjs";
// ★★ 20.46 — TEMPLATE RESOLUTION — The ONE place that resolves a template key to (subject, html, text, version).
import { resolveTemplate } from "../email/resolveTemplate.mjs";

/**
 * ★★ THE FILTER LANGUAGE IS A CLOSED SET, NOT ARBITRARY SQL OR ARBITRARY JSON.
 *
 * ★★★ A `filter` column holding free-form SQL would be an injection surface with a tenant's name on
 *     it — anybody who can save a segment could read another tenant's rows, or write. And arbitrary
 *     JSON interpreted loosely is the same hole with extra steps. So the fields are enumerated here,
 *     each maps to ONE column, and anything unrecognised is REFUSED rather than ignored.
 *   ★ Ignoring an unknown key is the dangerous choice: a typo in `role` would silently widen the
 *     audience to everyone, and a campaign is the one place where "slightly too many recipients" is
 *     a thing you cannot take back.
 */
export const SEGMENT_FIELDS = Object.freeze({
  role: { column: "role", op: "in",
          values: ["staff", "adult_client", "adolescent_client", "parent"] },
  staff_role: { column: "staff_role", op: "in", values: null },
  // ★ `has_email` exists because a campaign is email; a person with no address is not a recipient and
  //   must be excluded EXPLICITLY rather than by the send loop quietly skipping them.
  has_email: { column: "email", op: "not_null", values: null },
  // ★ 11.10 (S11-OQ-6) — "regulars of THIS service", not "regulars of anything". No `column`: the
  //   whole predicate comes from `regularOfServiceSql`, which needs the service id as a bind param,
  //   not a comparison against one column.
  regular_of_service: { column: null, op: "regular_of_service", values: null },
  // ★★ 16.19 — the six "living list" predicates (0455's seed segments), same closed-vocabulary
  //   discipline as everything above: each maps to its own EXISTS/NOT EXISTS fragment, not to a
  //   single column, so each gets its own `op` and no `column`.
  quiet_days:             { column: null, op: "quiet_days",             values: null },
  credits_remaining_lte:  { column: null, op: "credits_remaining_lte",  values: null },
  owes_money:             { column: null, op: "owes_money",             values: null },
  never_booked:           { column: null, op: "never_booked",           values: null },
  on_waitlist:            { column: null, op: "on_waitlist",            values: null },
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SegmentFilterError extends Error {
  constructor(message) { super(message); this.name = "SegmentFilterError"; }
}

/**
 * ★★★ 16.19 — "GONE QUIET", AS ITS OWN REUSABLE SQL FRAGMENT.
 * True when a person (aliased `u`, matching every other fragment in this file) has:
 *   (1) no booking as a participant in the last N days,
 *   (2) no FUTURE booking, and
 *   (3) no cancellation in the last N days.
 * `paramIndex` names the ONE bind parameter (the day count `N`) — reused three times in the
 * fragment, which `pg` allows (the same `$n` may appear more than once in one query).
 * ★ Exported so both `compileFilter`'s `quiet_days` predicate AND a different task's sweep
 *   (16.21, `src/automations/sweeps.mjs`) can share ONE definition of "quiet" rather than two
 *   that drift apart.
 */
export function quietClientsSql(paramIndex) {
  return `(
    NOT EXISTS (
      SELECT 1 FROM keystone.booking b
        JOIN keystone.booking_participant bp ON bp.booking_id = b.id
       WHERE bp.tenant_id = u.tenant_id AND bp.app_user_id = u.id
         AND b.state <> 'cancelled'
         AND b.starts_at > now() - make_interval(days => $${paramIndex}::int)
         AND b.starts_at <= now()
    )
    AND NOT EXISTS (
      SELECT 1 FROM keystone.booking b
        JOIN keystone.booking_participant bp ON bp.booking_id = b.id
       WHERE bp.tenant_id = u.tenant_id AND bp.app_user_id = u.id
         AND b.state <> 'cancelled'
         AND b.starts_at > now()
    )
    AND NOT EXISTS (
      SELECT 1 FROM keystone.booking b
        JOIN keystone.booking_participant bp ON bp.booking_id = b.id
       WHERE bp.tenant_id = u.tenant_id AND bp.app_user_id = u.id
         AND b.state = 'cancelled'
         AND b.cancelled_at > now() - make_interval(days => $${paramIndex}::int)
    )
  )`;
}

/**
 * COMPILE a stored filter to a parameterised WHERE clause.
 * ★★ Parameterised, always. The values never reach the SQL string.
 */
export function compileFilter(filter, startIndex = 2) {
  if (!filter || typeof filter !== "object" || Array.isArray(filter)) {
    throw new SegmentFilterError("a segment filter must be a JSON object");
  }
  const keys = Object.keys(filter);
  if (keys.length === 0) {
    // ★★★ AN EMPTY FILTER IS REFUSED, NOT TREATED AS "EVERYONE". "Send to everybody" must be written
    //     down on purpose — an empty object is far more likely to be a bug in whatever produced it,
    //     and the failure mode is emailing the entire practice.
    throw new SegmentFilterError(
      "a segment filter may not be empty. ★ An empty filter would mean EVERY person in the practice, " +
      "and that must be stated deliberately (e.g. {\"has_email\": true}) rather than arrived at by an " +
      "object that happened to come out blank.");
  }

  const clauses = [];
  const params = [];
  let i = startIndex;
  for (const key of keys) {
    const spec = SEGMENT_FIELDS[key];
    if (!spec) {
      throw new SegmentFilterError(
        `"${key}" is not a segment field. Known fields: ${Object.keys(SEGMENT_FIELDS).join(", ")}. ` +
        `★ Unknown keys are REFUSED rather than ignored: a typo in a field name would silently widen ` +
        `the audience, and a campaign is the one place "slightly too many recipients" cannot be undone.`);
    }
    const v = filter[key];
    if (spec.op === "not_null") {
      if (v !== true) {
        throw new SegmentFilterError(`"${key}" only accepts true (got ${JSON.stringify(v)})`);
      }
      clauses.push(`u.${spec.column} IS NOT NULL AND btrim(u.${spec.column}) <> ''`);
      continue;
    }
    if (spec.op === "regular_of_service") {
      // ★ 11.10 — exactly ONE uuid, never a list. "Regulars of these three services" is not a
      //   question this field answers; a segment aimed at more than one service is a different
      //   filter this closed vocabulary does not have yet.
      if (typeof v !== "string" || !UUID_RE.test(v)) {
        throw new SegmentFilterError(`"${key}" must be a single uuid string (got ${JSON.stringify(v)})`);
      }
      clauses.push(regularOfServiceSql("u", `$${i}`, `$${i + 1}`, `$${i + 2}`));
      params.push(v, REGULAR_WINDOW_DAYS, REGULAR_MIN_ATTENDED);
      i += 3;
      continue;
    }
    // ★★ 16.19 — the six-living-list predicates. Same closed-set discipline as every branch above:
    //   one bind param at most, pushed onto `params` in the same order it appears in `where`.
    if (spec.op === "quiet_days") {
      if (!Number.isInteger(v) || v <= 0) {
        throw new SegmentFilterError(`"${key}" must be a positive integer number of days (got ${JSON.stringify(v)})`);
      }
      clauses.push(quietClientsSql(i));
      params.push(v);
      i += 1;
      continue;
    }
    if (spec.op === "credits_remaining_lte") {
      if (!Number.isInteger(v) || v <= 0) {
        throw new SegmentFilterError(`"${key}" must be a positive integer (got ${JSON.stringify(v)})`);
      }
      // ★ An ACTIVE entitlement whose AVAILABLE credit count is between 1 and N — zero available
      //   credits means "exhausted", which is a different fact than "running low".
      clauses.push(
        `EXISTS (SELECT 1 FROM keystone.entitlement e WHERE e.tenant_id = u.tenant_id ` +
        `AND e.owner_user_id = u.id AND e.status = 'active' ` +
        `AND (SELECT count(*) FROM keystone.entitlement_credit ec ` +
        `WHERE ec.entitlement_id = e.id AND ec.status = 'available') BETWEEN 1 AND $${i}::int)`);
      params.push(v);
      i += 1;
      continue;
    }
    if (spec.op === "owes_money" || spec.op === "never_booked" || spec.op === "on_waitlist") {
      if (v !== true) {
        throw new SegmentFilterError(`"${key}" only accepts true (got ${JSON.stringify(v)})`);
      }
      if (spec.op === "owes_money") {
        clauses.push(
          `EXISTS (SELECT 1 FROM keystone.person_owes po WHERE po.tenant_id = u.tenant_id ` +
          `AND po.person_id = u.id AND po.owes_minor > 0)`);
      } else if (spec.op === "never_booked") {
        clauses.push(
          `NOT EXISTS (SELECT 1 FROM keystone.booking_participant bp ` +
          `WHERE bp.tenant_id = u.tenant_id AND bp.app_user_id = u.id)`);
      } else {
        clauses.push(
          `EXISTS (SELECT 1 FROM keystone.booking_waitlist_entry w WHERE w.tenant_id = u.tenant_id ` +
          `AND w.client_user_id = u.id AND w.status IN ('waiting','offered'))`);
      }
      continue;
    }
    const list = Array.isArray(v) ? v : [v];
    if (list.length === 0) throw new SegmentFilterError(`"${key}" was given an empty list`);
    if (spec.values) {
      const bad = list.filter((x) => !spec.values.includes(x));
      if (bad.length) {
        throw new SegmentFilterError(
          `"${key}" does not accept ${JSON.stringify(bad)}. Allowed: ${spec.values.join(", ")}`);
      }
    }
    clauses.push(`u.${spec.column} = ANY($${i}::text[])`);
    params.push(list);
    i += 1;
  }
  return { where: clauses.join(" AND "), params };
}

/** CREATE a segment. ★ The filter is compiled here so an invalid one is refused at SAVE time, not
 *  discovered at send time with a campaign half-out. */
export async function createSegment(tx, { tenantId, name, filter, createdBy = null }) {
  if (!tenantId) throw new Error("createSegment needs a tenantId");
  compileFilter(filter);   // ★ throws SegmentFilterError before anything is stored
  const { rows } = await run(tx, db
    .insertInto("keystone.segment")
    .values({
      tenant_id: tenantId ?? null,
      name: String(name).trim() ?? null,
      filter: filter ?? null,
      created_by: createdBy ?? null,
    })
    .returning(["id", "name"]));
  return Object.freeze({ id: rows[0].id, name: rows[0].name });
}

/**
 * CREATE a campaign, as a DRAFT.
 *
 * ★★★ THIS EXISTS BECAUSE `write-census` DEMANDED IT — the same finding it made for
 *     `run_schedule_item` one item earlier: *"keystone.campaign is UPDATED somewhere but NEVER
 *     INSERTED in src/ — so no row can exist for that UPDATE to find."* `sendCampaign` moves a campaign
 *     through its states and nothing could create one. A table nothing INSERTS is a feature that cannot
 *     START, and the gate's own fixture inserting directly is exactly how that stays invisible.
 *
 * ★★ IT IS ALWAYS A DRAFT. There is no `createAndSend`: the send is a separate, deliberate act with a
 *    refusal on repeat, because it is the one operation here that cannot be undone.
 *  ★ The segment is resolved ONCE at creation purely to REFUSE an empty audience — a campaign aimed at
 *    nobody is a mistake somebody should hear about while they are still writing it, not after they
 *    press send and wonder why it was quiet.
 *
 * ★★★ TASK 20.49 — channel defaults to 'email'. SMS campaigns send the `body` as text (subject dropped).
 * ★ TASK 20.46 — `templateKey` optional; if set, sendCampaign will resolve it at send time and
 *   stamp the batch with the active version, so a later template change does not rewrite history.
 */
export async function createCampaign(
  tx, { tenantId, name, segmentId, subject, body, channel = 'email', leaveOutSegmentId = null, neverMoreThanDays = 90, templateKey = null }
) {
  if (!tenantId) throw new Error("createCampaign needs a tenantId");
  if (!segmentId) throw new Error("createCampaign needs a segmentId");
  if (!channel || !['email', 'sms'].includes(channel)) {
    throw new Error(`createCampaign: channel must be 'email' or 'sms' (got ${JSON.stringify(channel)})`);
  }
  const { recipients, segment } = await resolveSegmentById(tx, { tenantId, segmentId });
  if (recipients.length === 0) {
    throw new Error(
      `createCampaign: segment "${segment.name}" currently resolves to NOBODY. ★ A campaign aimed at ` +
      `nobody is a mistake worth hearing about while it is being written, not after it is sent and the ` +
      `silence gets read as poor engagement. ★★ Note the audience can still change before the send — ` +
      `that is the point of a saved filter — so this is a warning at the moment of authoring, not a ` +
      `guarantee about the send.`);
  }
  const { rows } = await run(tx, db
    // ★ 16.19 — `leave_out_segment_id`/`never_more_than_days` (0446, task 16.5). Written here so a
    //   campaign always has SOME value for the guard columns, even before the composer UI sets them.
    // ★ R24 (RECONCILE, the maintainer 27 Sep) — NO `channel` column exists on keystone.campaign (no migration ever created it);
    //   inserting it made every POST /api/growth/campaigns a 500. `channel` is still validated above.
    // ★ 20.46 — add template_key to store which template was picked, if any
    .insertInto("keystone.campaign")
    .values({
      tenant_id: tenantId ?? null,
      name: String(name).trim() ?? null,
      segment_id: segmentId ?? null,
      subject: String(subject).trim() ?? null,
      body: String(body).trim() ?? null,
      leave_out_segment_id: leaveOutSegmentId ?? null,
      never_more_than_days: neverMoreThanDays ?? null,
      template_key: templateKey ?? null,
    })
    .returning(["id", "name", "state"]));
  return Object.freeze({
    id: rows[0].id, name: rows[0].name, state: rows[0].state,
    audienceAtAuthoring: recipients.length,
  });
}

/**
 * RESOLVE a segment to its people, NOW, with hard-required exclusions.
 * ★★★ This is the whole argument for a saved filter: the answer is computed from `app_user` at the
 *     moment it is asked, so an archived client or a corrected address is reflected without anybody
 *     remembering to sync a list.
 *
 * ★★★ HARD REQUIREMENT: ALWAYS EXCLUDE under-18, opted-out, unsubscribed, and bounced.
 * These exclusions are NOT optional and apply to EVERY segment resolve, regardless of criteria.
 *   • Under-18: date_of_birth must exist AND person must be 18+ (by today's date)
 *   • Opted-out/unsubscribed: do_not_email must be false (not opted out)
 *   • Bounced: email_bounced_at must be NULL (not bounced)
 */
export async function resolveSegment(tx, tenantId, segmentCriteria) {
  if (!tenantId) throw new Error("resolveSegment needs a tenantId");
  if (!segmentCriteria || typeof segmentCriteria !== "object" || Array.isArray(segmentCriteria)) {
    throw new SegmentFilterError("segmentCriteria must be a JSON object");
  }

  const { where, params } = compileFilter(segmentCriteria);

  // ★★★ HARD-CODED EXCLUSION FILTERS. These ALWAYS apply, regardless of segment criteria.
  // No person under 18 is eligible for any campaign.
  const ageExclude = `(u.date_of_birth IS NULL OR
    extract(year from age(u.date_of_birth)) >= 18)`;

  // ★★★ OPTED-OUT/UNSUBSCRIBED: Exclude anyone who has opted out of email.
  // A person with do_not_email=true is explicitly excluded from campaigns.
  const optOutExclude = `u.do_not_email = false`;

  // ★★★ BOUNCED EMAIL: No one with a bounced email address receives campaigns.
  const bounceExclude = `u.email_bounced_at IS NULL`;

  // ★★★ 16.19 — EXPLICITLY UNSUBSCRIBED (consent_type='marketing', is_active=false). The MOST
  //     RECENT marketing `consent_record` row decides it, not "any row ever" — a resubscribe is a
  //     NEW row with `is_active=true`, and it must override an older `is_active=false` row rather
  //     than being permanently shadowed by it. `coalesce(..., true)` means "no consent history at
  //     all" defaults to included, matching the existing do_not_email/bounce defaults above.
  const unsubscribeExclude = `coalesce((
    SELECT cr.is_active FROM keystone.consent_record cr
     WHERE cr.tenant_id = u.tenant_id AND cr.person_id = u.id AND cr.consent_type = 'marketing'
     ORDER BY cr.created_at DESC LIMIT 1
  ), true) = true`;

  const { rows } = await tx.query(
    `SELECT u.id, u.display_name, u.email FROM keystone.app_user u
      WHERE u.tenant_id = $1
        AND ${where}
        AND ${ageExclude}
        AND ${optOutExclude}
        AND ${bounceExclude}
        AND ${unsubscribeExclude}
      ORDER BY u.display_name`,
    // ★ FIX (S11-OQ-6, 11.10, was 42P02 "there is no parameter $1") — `compileFilter`'s own params
    //   start at $2 because $1 is `tenantId`, bound in the WHERE clause above. This array has to
    //   carry it, or the query never had a $1 to bind in the first place.
    [tenantId, ...params]);

  return Object.freeze({ recipients: rows });
}

/**
 * ★★★ 11.10 — A PRICE CHANGE DRAFTS A CAMPAIGN'S AUDIENCE, NEVER ITS WORDS.
 *
 * `createPrice({ tellRegulars: true })` calls this to answer "who books this service regularly,
 * and how many of them", in the SAME transaction as the price change. What it deliberately does
 * NOT do is write the notice a person actually receives — that copy is S11-OQ-3(c), owned by
 * Stage 16, and `keystone.campaign.subject`/`.body` are `NOT NULL` with a non-empty CHECK
 * (`0061_growth.sql:49-50`): there is no value this function could put there that is not either an
 * empty string (refused by the CHECK) or invented customer-facing prose (not this task's to write).
 * ★★ So this returns FACTS, not a campaign: `{ segmentId, audienceAtAuthoring, facts }` when there
 *    is somebody to tell, `null` when there is nobody — "nobody to tell" is not an error for a
 *    price change, and nothing is written in that case (no segment, no anything).
 *  ★ The segment IS written (`createSegment`), because "who" is answerable today without anybody
 *    having written a word — Stage 16's composer reads `segmentId` back to build the actual
 *    `campaign` row once a human has supplied subject/body.
 */
export async function draftPriceChangeCampaign(
  tx, { tenantId, serviceId, oldAmountMinor, newAmountMinor, currency, effectiveFrom, createdBy = null }
) {
  if (!tenantId) throw new Error("draftPriceChangeCampaign needs a tenantId");
  if (!serviceId) throw new Error("draftPriceChangeCampaign needs a serviceId");

  const filter = Object.freeze({ regular_of_service: serviceId, has_email: true });
  const { recipients } = await resolveSegment(tx, tenantId, filter);
  if (recipients.length === 0) return null;

  const svc = (await run(tx, db.selectFrom("keystone.service").select(["name"]).where("id", "=", serviceId))).rows[0];
  const serviceName = svc?.name ?? null;

  const { id: segmentId } = await createSegment(tx, {
    tenantId, name: `Regulars of ${serviceName ?? serviceId}`, filter, createdBy,
  });

  const facts = Object.freeze({
    serviceId, serviceName,
    oldAmountMinor, newAmountMinor, currency,
    oldAmountFormatted: formatMinor(oldAmountMinor, currency),
    newAmountFormatted: formatMinor(newAmountMinor, currency),
    effectiveFrom,
    effectiveFromFormatted: formatDayMonth(effectiveFrom),
  });

  return Object.freeze({ segmentId, audienceAtAuthoring: recipients.length, facts });
}

/**
 * ★★★ INTERNAL: Resolve a SAVED segment by ID (for createCampaign/sendCampaign).
 * Calls resolveSegment() with the fetched segment's filter criteria.
 */
async function resolveSegmentById(tx, { tenantId, segmentId }) {
  const seg = (await run(tx, db.selectFrom("keystone.segment").select(["id", "name", "filter"]).where("tenant_id", "=", tenantId).where("id", "=", segmentId))).rows[0];
  if (!seg) throw new Error(`resolveSegmentById: segment ${segmentId} is not visible in this tenant`);
  const { recipients } = await resolveSegment(tx, tenantId, seg.filter);
  return Object.freeze({ segment: seg, recipients });
}

/**
 * ★★★ 16.19 — EVERY PRACTICE GETS THE SIX "LIVING LIST" SEGMENTS, IDEMPOTENTLY. 0455 backfilled
 *     existing practices; THIS is the runtime path for a NEW practice, called once from
 *     `runCriticalPrefix()` (src/provisioning/prefix.mjs) in the same transaction as the rest of
 *     provisioning. The filters and `seed_key`s are IDENTICAL to 0455's, on purpose — one
 *     definition, not two that can drift apart.
 * ★ `ON CONFLICT (tenant_id, seed_key) WHERE seed_key IS NOT NULL DO NOTHING` — safe to call more
 *   than once for the same tenant (defensive: provisioning is not expected to retry this step, but
 *   idempotence costs nothing here and 0455's own pattern already relies on it).
 */
export async function seedLivingSegments(tx, tenantId) {
  if (!tenantId) throw new Error("seedLivingSegments needs a tenantId");
  // ★ 0503, MEASURED: this ran as a plain INSERT on the SIGNUP connection (role `app_signup`),
  //   which holds no INSERT/SELECT on keystone.segment — every new-practice signup failed with
  //   "permission denied for table segment". `keystone.seed_living_segments` is now a SECURITY
  //   DEFINER (db/migrations/0503_signup_seeds_the_living_lists.sql) on the same footing as
  //   `keystone.seed_units`; the six rows live in that one definition now, not here.
  await tx.query(`SELECT keystone.seed_living_segments($1)`, [tenantId]);
}

/**
 * ★★ 16.19 — EDIT A DRAFT. Refuses on anything else: once a send has begun, the audience and copy
 *    are frozen so "what did they actually receive" stays answerable (same argument `sendCampaign`
 *    makes for its own idempotence-by-refusal).
 * ★ 20.46 — `templateKey` optional; when set, it is stored so sendCampaign can resolve it at send time.
 */
export async function updateCampaign(
  tx, { tenantId, campaignId, name, segmentId, subject, body, leaveOutSegmentId, neverMoreThanDays, templateKey }
) {
  if (!tenantId) throw new Error("updateCampaign needs a tenantId");
  if (!campaignId) throw new Error("updateCampaign needs a campaignId");
  const c = (await run(tx, db.selectFrom("keystone.campaign").select(["id", "name", "state"]).where("tenant_id", "=", tenantId).where("id", "=", campaignId))).rows[0];
  if (!c) throw new Error(`updateCampaign: campaign ${campaignId} is not visible in this tenant`);
  if (c.state !== "draft") {
    throw new Error(
      `updateCampaign: campaign "${c.name}" is ${c.state}, not draft. ★ Only a draft can be edited — ` +
      `once sending has begun, the audience and copy are frozen so "what did they receive" stays ` +
      `answerable.`);
  }

  const sets = [];
  const params = [tenantId, campaignId];
  let i = 3;
  const add = (col, val) => { sets.push(`${col} = $${i}`); params.push(val); i += 1; };
  if (name !== undefined) add("name", String(name).trim());
  if (segmentId !== undefined) add("segment_id", segmentId);
  if (subject !== undefined) add("subject", String(subject).trim());
  if (body !== undefined) add("body", String(body).trim());
  if (leaveOutSegmentId !== undefined) add("leave_out_segment_id", leaveOutSegmentId);
  if (neverMoreThanDays !== undefined) add("never_more_than_days", neverMoreThanDays);
  if (templateKey !== undefined) add("template_key", templateKey);
  if (sets.length === 0) throw new Error("updateCampaign: nothing to update");

  const { rows } = await tx.query(
    `UPDATE keystone.campaign SET ${sets.join(", ")}, updated_at = now()
      WHERE tenant_id = $1 AND id = $2 RETURNING id, name, state`,
    params);
  return Object.freeze({ id: rows[0].id, name: rows[0].name, state: rows[0].state });
}

/**
 * ★★★ 16.19 — createCampaign WHEN THERE IS NO campaignId YET, updateCampaign WHEN THERE IS. One
 *     entry point for the composer so it does not have to decide which write to call.
 */
export async function saveCampaign(tx, args) {
  if (args && args.campaignId) {
    return updateCampaign(tx, args);
  }
  return createCampaign(tx, args);
}

/**
 * ★★★ 16.19 — THE COMPOSER'S "who is this actually going to, and why is anyone missing" READ.
 * Starts from the segment's OWN filter (not `resolveSegment`, which now ALSO excludes an
 * unsubscribed person outright) so an unsubscribed match can be reported BY NAME as `reason:
 * "unsubscribed"` instead of silently vanishing the way it does inside `resolveSegment`/
 * `eligibleRecipients`. The mandatory age/opt-out/bounced exclusions still apply — those three
 * are not a reportable "reason", they are never-negotiable, same as every other campaign read.
 * ★ Reason precedence when more than one applies: unsubscribed > left_out > recently_sent.
 */
export async function campaignAudience(tx, { tenantId, segmentId, leaveOutSegmentId = null, neverMoreThanDays = 90 }) {
  if (!tenantId) throw new Error("campaignAudience needs a tenantId");
  if (!segmentId) throw new Error("campaignAudience needs a segmentId");

  const seg = (await run(tx, db.selectFrom("keystone.segment").select(["id", "name", "filter"]).where("tenant_id", "=", tenantId).where("id", "=", segmentId))).rows[0];
  if (!seg) throw new Error(`campaignAudience: segment ${segmentId} is not visible in this tenant`);

  const { where, params } = compileFilter(seg.filter);
  const ageExclude = `(u.date_of_birth IS NULL OR extract(year from age(u.date_of_birth)) >= 18)`;
  const optOutExclude = `u.do_not_email = false`;
  const bounceExclude = `u.email_bounced_at IS NULL`;

  const { rows: pool } = await tx.query(
    `SELECT u.id, u.display_name FROM keystone.app_user u
      WHERE u.tenant_id = $1 AND ${where} AND ${ageExclude} AND ${optOutExclude} AND ${bounceExclude}
      ORDER BY u.display_name`,
    [tenantId, ...params]);

  let leaveOutIds = new Set();
  if (leaveOutSegmentId) {
    const leaveOutSeg = (await run(tx, db.selectFrom("keystone.segment").select(["filter"]).where("tenant_id", "=", tenantId).where("id", "=", leaveOutSegmentId))).rows[0];
    if (leaveOutSeg) {
      const { recipients } = await resolveSegment(tx, tenantId, leaveOutSeg.filter);
      leaveOutIds = new Set(recipients.map((r) => r.id));
    }
  }

  const excluded = [];
  let count = 0;
  for (const p of pool) {
    const unsub = (await run(tx, db.selectFrom("keystone.consent_record").select(["is_active"]).where("tenant_id", "=", tenantId).where("person_id", "=", p.id).where("consent_type", "=", "marketing").orderBy("created_at", "desc").limit(1))).rows[0];
    if (unsub && unsub.is_active === false) {
      excluded.push({ person_id: p.id, display_name: p.display_name, reason: "unsubscribed" });
      continue;
    }
    if (leaveOutIds.has(p.id)) {
      excluded.push({ person_id: p.id, display_name: p.display_name, reason: "left_out" });
      continue;
    }
    const recent = (await run(tx, db.selectFrom("keystone.notification").select(sql`1`).where("tenant_id", "=", tenantId).where("recipient_id", "=", p.id).where("topic", "=", "growth.campaign.sent").where(sql`created_at > now() - make_interval(days => ${sql.val(neverMoreThanDays)}::int)`).limit(1))).rows[0];
    if (recent) {
      excluded.push({ person_id: p.id, display_name: p.display_name, reason: "recently_sent" });
      continue;
    }
    count += 1;
  }

  return Object.freeze({ count, excluded: Object.freeze(excluded) });
}

/**
 * ★★★ 16.19 — THE RECIPIENTS A SEND ACTUALLY GOES TO: in the segment (with `resolveSegment`'s
 *     full exclusion set, unsubscribed included) AND NOT in the leave-out segment AND not sent
 *     `growth.campaign.sent` within `never_more_than_days` days.
 * `campaign` carries the DB row's snake_case columns (`segment_id`/`leave_out_segment_id`/
 * `never_more_than_days`) — the shape every caller in this file already reads off `keystone.campaign`.
 */
export async function eligibleRecipients(tx, { tenantId, campaign }) {
  if (!tenantId) throw new Error("eligibleRecipients needs a tenantId");
  if (!campaign) throw new Error("eligibleRecipients needs a campaign");
  const segmentId = campaign.segment_id ?? campaign.segmentId;
  const leaveOutSegmentId = campaign.leave_out_segment_id ?? campaign.leaveOutSegmentId ?? null;
  const neverMoreThanDays = campaign.never_more_than_days ?? campaign.neverMoreThanDays ?? 90;
  if (!segmentId) throw new Error("eligibleRecipients needs campaign.segment_id");

  const { recipients } = await resolveSegmentById(tx, { tenantId, segmentId });
  if (recipients.length === 0) return [];

  let leaveOutIds = new Set();
  if (leaveOutSegmentId) {
    const { recipients: leaveOutRecipients } =
      await resolveSegmentById(tx, { tenantId, segmentId: leaveOutSegmentId });
    leaveOutIds = new Set(leaveOutRecipients.map((r) => r.id));
  }

  const eligible = [];
  for (const r of recipients) {
    if (leaveOutIds.has(r.id)) continue;
    const recent = (await tx.query(
      `SELECT 1 FROM keystone.notification
        WHERE tenant_id=$1 AND recipient_id=$2 AND topic='growth.campaign.sent'
          AND created_at > now() - make_interval(days => $3::int)
        LIMIT 1`,
      [tenantId, r.id, neverMoreThanDays])).rows[0];
    if (recent) continue;
    eligible.push(r);
  }
  return eligible;
}

/**
 * ★★★ 16.19 — SEND NO LONGER FANS OUT HERE. It QUEUES exactly one `campaign_send_batch` row
 *     (`batch_status='pending'`) and emits `growth.campaign.queued`; a DIFFERENT task's queue
 *     listener (16.32, `deliver_campaign_batch` in `src/queue/tasks.mjs`) is what actually walks
 *     the batch and creates the per-recipient `notification` rows. Doing the fan-out inline here,
 *     synchronously, inside the route's transaction, is exactly what made a 4,000-person send a
 *     request that could not finish before its own HTTP timeout.
 *
 * ★★ THE STATE MACHINE IS draft|scheduled → sending → (queued for delivery), AND `sending` IS
 *    WRITTEN BEFORE THE AUDIENCE IS EVEN COMPUTED. If the process dies mid-send, the row says
 *    `sending` — which is true, and is recoverable — rather than looking like an untouched draft.
 *
 * ★★★ IDEMPOTENCE BY REFUSAL, still. A campaign is not a retryable job: sending it twice means
 *     emailing the practice twice, which cannot be undone and which nobody forgives.
 *
 * ★★★ TASK 20.46 — TEMPLATE FREEZING AT SEND TIME. If the campaign row has a `template_key` set,
 *     `resolveTemplate` is called AT SEND TIME (not at draft time) to capture the version active
 *     NOW. If a template is later activated or re-versioned (migration 0484), the batch record
 *     stays frozen — "what was actually sent" is unchanged. If `template_key` is NULL, both batch
 *     columns are NULL (the campaign was free-typed).
 */
export async function sendCampaign(tx, { tenantId, campaignId }) {
  if (!tenantId) throw new Error("sendCampaign needs a tenantId");
  const c = (await run(tx, db.selectFrom("keystone.campaign").select(["id", "name", "segment_id", "leave_out_segment_id", "never_more_than_days", "subject", "body", "state", "template_key"]).where("tenant_id", "=", tenantId).where("id", "=", campaignId))).rows[0];
  if (!c) throw new Error(`sendCampaign: campaign ${campaignId} is not visible in this tenant`);
  if (c.state !== "draft" && c.state !== "scheduled") {
    throw new Error(
      `sendCampaign: campaign "${c.name}" is ${c.state}, not draft or scheduled. ★ A campaign is not ` +
      `retryable — sending twice emails the practice twice, and that cannot be taken back. Copy it to a ` +
      `new draft if it genuinely needs to go again.`);
  }

  await run(tx, db.updateTable("keystone.campaign").set({ state: "sending" }).where("tenant_id", "=", tenantId).where("id", "=", campaignId));

  // ★ NOT resolveSegmentById's raw list — `eligibleRecipients` also applies the leave-out segment
  //   and the never-more-than-N-days repeat guard, on top of `resolveSegment`'s own exclusions.
  const eligible = await eligibleRecipients(tx, { tenantId, campaign: c });
  if (eligible.length === 0) {
    throw new Error(
      `sendCampaign: campaign "${c.name}" resolves to 0 eligible recipients once the leave-out ` +
      `segment, the ${c.never_more_than_days}-day repeat window and unsubscribes are applied. ★ A send ` +
      `with nobody to receive it is refused rather than silently queued.`);
  }

  // ★★★ TEMPLATE FREEZING: Resolve at send time so later template changes don't rewrite history.
  let templateKey = null;
  let templateVersion = null;
  if (c.template_key) {
    try {
      const resolved = await resolveTemplate(tx, tenantId, c.template_key);
      templateKey = c.template_key;
      templateVersion = resolved.version;
    } catch (err) {
      // ★★ 20.46 RULING: A template key vanishing must never cause a send to fail — the campaign
      // row carries its OWN saved subject and body, picked at edit time. Stamp the batch with the key
      // and version NULL: "this campaign came from that template, and we cannot tell which version".
      // Three cases: no template (both NULL), template resolves (both set), template key vanished (key
      // set, version NULL). A rename must not cause an outage.
      templateKey = c.template_key;
      templateVersion = null;
    }
  }

  const { rows: batchRows } = await run(tx, db
    .insertInto("keystone.campaign_send_batch")
    .values({
      tenant_id: tenantId ?? null,
      campaign_id: campaignId ?? null,
      total_count: eligible.length ?? null,
      batch_status: "pending",
      template_key: templateKey ?? null,
      template_version: templateVersion ?? null,
    })
    .returning(["id"]));
  const batchId = batchRows[0].id;

  await emit(tx, {
    tenantId, topic: "growth.campaign.queued", emittedBy: "growth",
    subjectType: "campaign", subjectId: campaignId,
    payload: { batch_id: batchId },
  });

  return Object.freeze({ batchId, eligibleCount: eligible.length });
}

/**
 * ★★ 16.19 — draft → 'scheduled', with the `scheduled_for` timestamp the "scheduled" state requires
 *    (`campaign_scheduled_shape`, 0446). The actual send still goes through `sendCampaign` — a
 *    different task's sweep/scheduler calls it once `scheduled_for` has passed.
 */
export async function scheduleCampaign(tx, { tenantId, campaignId, sendAt }) {
  if (!tenantId) throw new Error("scheduleCampaign needs a tenantId");
  if (!campaignId) throw new Error("scheduleCampaign needs a campaignId");
  if (!sendAt) throw new Error("scheduleCampaign needs a sendAt");
  const c = (await run(tx, db.selectFrom("keystone.campaign").select(["id", "name", "state"]).where("tenant_id", "=", tenantId).where("id", "=", campaignId))).rows[0];
  if (!c) throw new Error(`scheduleCampaign: campaign ${campaignId} is not visible in this tenant`);
  if (c.state !== "draft") {
    throw new Error(
      `scheduleCampaign: campaign "${c.name}" is ${c.state}, not draft. ★ Only a draft can be scheduled.`);
  }

  await run(tx, db.updateTable("keystone.campaign").set({ state: "scheduled", scheduled_for: sendAt ?? null }).where("tenant_id", "=", tenantId).where("id", "=", campaignId));

  await emit(tx, {
    tenantId, topic: "growth.campaign.scheduled", emittedBy: "growth",
    subjectType: "campaign", subjectId: campaignId,
    payload: { scheduled_for: sendAt },
  });

  return Object.freeze({ id: campaignId, state: "scheduled", scheduledFor: sendAt });
}

/**
 * ★★★ 16.19 — A ONE-OFF SEND TO THE ACTOR ONLY, bypassing the batch/queue mechanism entirely.
 *     `createNotification` is called DIRECTLY, exactly once, the same way the old inline
 *     `sendCampaign` fan-out used to — because a test send is not "the audience", it is one person
 *     previewing their own copy, and does not touch `campaign_send_batch` or the campaign's state.
 */
export async function testCampaign(tx, { tenantId, campaignId, actorUserId }) {
  if (!tenantId) throw new Error("testCampaign needs a tenantId");
  if (!campaignId) throw new Error("testCampaign needs a campaignId");
  if (!actorUserId) throw new Error("testCampaign needs an actorUserId");
  const c = (await run(tx, db.selectFrom("keystone.campaign").select(["id", "name", "subject", "body"]).where("tenant_id", "=", tenantId).where("id", "=", campaignId))).rows[0];
  if (!c) throw new Error(`testCampaign: campaign ${campaignId} is not visible in this tenant`);

  const ev = await emit(tx, {
    tenantId, topic: "growth.campaign.sent", emittedBy: "growth",
    subjectType: "campaign", subjectId: campaignId,
    payload: { test: true, recipient_count: 1 },
  });

  const { createNotification } = await import("../notifications/writes.mjs");
  const { id: notificationId } = await createNotification(tx, {
    tenantId, recipientId: actorUserId, eventId: ev.id,
    topic: "growth.campaign.sent",
    title: c.subject,
    body: c.body,
  });

  return Object.freeze({ notificationId });
}

/**
 * ★★★ 16.19 — "WHAT DID SENDING IT ACTUALLY DO": counted from the recipients who got a
 *     `growth.campaign.sent` notification for THIS campaign (found via the event each one points
 *     at — the same `subject_type='campaign'`/`subject_id` link `sendCampaign`/the queue listener
 *     write), and what each of them did in the 30 days after the send:
 *       booked       — made a NEW booking (booking.created_at in the window)
 *       came_back    — ATTENDED a session (booking_participant.attended IS TRUE, booking.starts_at
 *                      in the window)
 *       bought_again — a NEW entitlement (a purchased package/service) owned by them, created in
 *                      the window
 *     The anchor is the campaign's own `sent_at` when set, falling back to the earliest matching
 *     notification's `created_at` — `sent_at` is not guaranteed to be populated by every delivery
 *     path today.
 */
export async function campaignResults(tx, { tenantId, campaignId }) {
  if (!tenantId) throw new Error("campaignResults needs a tenantId");
  if (!campaignId) throw new Error("campaignResults needs a campaignId");

  const c = (await run(tx, db.selectFrom("keystone.campaign").select(["id", "name", "sent_at"]).where("tenant_id", "=", tenantId).where("id", "=", campaignId))).rows[0];
  if (!c) throw new Error(`campaignResults: campaign ${campaignId} is not visible in this tenant`);

  const { rows: notifRows } = await tx.query(
    `SELECT DISTINCT n.recipient_id, min(n.created_at) OVER () AS earliest
       FROM keystone.notification n
       JOIN keystone.event e ON e.id = n.event_id
      WHERE n.tenant_id = $1 AND e.subject_type = 'campaign' AND e.subject_id = $2
        AND n.topic = 'growth.campaign.sent'`,
    [tenantId, campaignId]);

  const recipientIds = notifRows.map((r) => r.recipient_id);
  const sent = recipientIds.length;
  const anchor = c.sent_at ?? notifRows[0]?.earliest ?? null;
  const empty = Object.freeze({ booked: 0, came_back: 0, bought_again: 0 });

  if (sent === 0 || !anchor) {
    return Object.freeze({ sent, came_of_it: empty });
  }

  const bookedRow = (await run(tx, db
    .selectFrom("keystone.booking_participant as bp")
    .innerJoin("keystone.booking as b", "b.id", "bp.booking_id")
    .select(sql`count(DISTINCT bp.app_user_id)`.as("n"))
    .where("bp.tenant_id", "=", tenantId)
    .where(sql`bp.app_user_id = ANY(${sql.val(recipientIds)}::uuid[])`)
    .where(sql`b.created_at > ${sql.val(anchor)}::timestamptz AND b.created_at <= ${sql.val(anchor)}::timestamptz + interval '30 days'`))).rows[0];

  const cameBackRow = (await run(tx, db
    .selectFrom("keystone.booking_participant as bp")
    .innerJoin("keystone.booking as b", "b.id", "bp.booking_id")
    .select(sql`count(DISTINCT bp.app_user_id)`.as("n"))
    .where("bp.tenant_id", "=", tenantId)
    .where(sql`bp.app_user_id = ANY(${sql.val(recipientIds)}::uuid[])`)
    .where("bp.attended", "is", true)
    .where(sql`b.starts_at > ${sql.val(anchor)}::timestamptz AND b.starts_at <= ${sql.val(anchor)}::timestamptz + interval '30 days'`))).rows[0];

  const boughtAgainRow = (await run(tx, db
    .selectFrom("keystone.entitlement as e")
    .select(sql`count(DISTINCT e.owner_user_id)`.as("n"))
    .where("e.tenant_id", "=", tenantId)
    .where(sql`e.owner_user_id = ANY(${sql.val(recipientIds)}::uuid[])`)
    .where(sql`e.created_at > ${sql.val(anchor)}::timestamptz AND e.created_at <= ${sql.val(anchor)}::timestamptz + interval '30 days'`))).rows[0];

  return Object.freeze({
    sent,
    came_of_it: Object.freeze({
      booked: Number(bookedRow.n),
      came_back: Number(cameBackRow.n),
      bought_again: Number(boughtAgainRow.n),
    }),
  });
}
