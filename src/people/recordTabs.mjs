// @ts-check
// 12.11 — THE PERSON RECORD PAYLOAD: TABS, VARIANTS, MONEY STRIPPED AT THE QUERY.
//
// ★★★ ONE EXPORT, `personRecordTabs(tx, { viewerId, personId })`, called ONLY from
//     `GET /api/records/:type/:id` (src/routes/index.mjs) for `type === "person"`, in the SAME
//     transaction as the record read itself — never a second round trip, same reasoning as
//     `activity`/`relatedRows` beside it in that handler.
//
// ★★★ MONEY IS STRIPPED AT THE QUERY, NOT AT THE EDGE. `mayMoney` is computed first and the
//     `money` key is OMITTED (never emptied, never nulled) when it is false — a viewer without the
//     grant cannot even learn the shape carries a balance, and the money queries below never run
//     for her. Same discipline `src/money/payerGroups.mjs`'s `listPayerGroups`/`readPayerGroup`
//     already use for `owingMinor`/`currency`/`state`/`owing`/`history`.
//
// ★ NO TENANT_ID PARAMETER ANYWHERE IN THIS FILE. Every table here carries FORCEd RLS
//   (`tenant_isolation`), and `tx` already runs inside the request's tenant transaction — the same
//   convention `readPayerGroup`/`listPayerGroups` already use (neither takes a `tenantId`).
//
// ★ PERSON→PERSON AND PERSON→PARTY REFERRAL EDGES STAY SEPARATE (0081:11-19, MEASURED). This
//   module never assumes one reaches the other — `foundThrough` reads BOTH columns
//   (`referred_by_id`, `referred_by_party_id`) and a CHECK on `app_user` already guarantees at most
//   one of them is set.
//
// ★★ TWO HONEST NULLS, BOTH FOLLOWING A PRECEDENT ALREADY SET BY 12.5/12.6, NOT INVENTED HERE:
//   · `howPays.card.expMonth`/`expYear` — `keystone.payment_method` (0015) carries `last_four` and
//     `brand` only; there is no expiry column. Exactly the shape of the `history[].method` gap
//     `readPayerGroup` already documents (src/money/payerGroups.mjs:571-582) — nulled, not guessed.
//   · `notesPreview[].excerpt` — `document_instance` carries a `title` and a structured
//     `template_snapshot` jsonb whose field names are template-specific; there is no free-text body
//     column to preview. Nulled for the same reason: an approximation on a clinical surface is a
//     wrong statement, not a partial one.
//
// ★ `sessions.rows`/`documents.signed`/`documents.waiting`/`money.paidRows` shapes are this
//   module's own reasonable reading of the plan's `[...]` — documented at each query below, not
//   guessed silently.

import { portalStatus } from "./portalStatus.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";
import { sessionNotesPreviewFor, signedInstancesFor, waitingInstancesFor, totalInstanceCountFor } from "../documents/api.mjs";

/**
 * @param {object} tx - the request's tenant-scoped transaction client.
 * @param {{ viewerId: string|null, personId: string }} args
 */
export async function personRecordTabs(tx, { viewerId, personId }) {
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // BASE FACTS — one query, everything `variant`, `factLine`, `details`, `foundThrough`,
  // `portalStatus` and `mayMoney` need from `app_user` itself, plus the two name joins
  // (archived-by, referred-by-person) and the one party join (referred-by-party).
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  const { rows: baseRows } = await tx.query(
    `SELECT u.id, u.display_name, u.email, u.role, u.lifecycle_status, u.archived_at,
            u.archived_by, u.owner_user_id, u.joined_at, u.mobile_phone,
            u.preferred_contact_method, u.date_of_birth, u.consent_status, u.source,
            u.referred_by_id, u.referred_by_party_id, u.email_bounced_at,
            archiver.display_name  AS archived_by_name,
            referrer.display_name  AS referred_by_name,
            party.name              AS referred_by_party_name,
            (SELECT count(*) FROM keystone.booking_participant bp
               JOIN keystone.booking b ON b.id = bp.booking_id
              WHERE bp.app_user_id = u.id AND b.state = 'completed') AS completed_bookings_count
       FROM keystone.app_user u
       LEFT JOIN keystone.app_user archiver ON archiver.id = u.archived_by
       LEFT JOIN keystone.app_user referrer ON referrer.id = u.referred_by_id
       LEFT JOIN keystone.network_party party ON party.id = u.referred_by_party_id
      WHERE u.id = $1`,
    [personId]);
  const u = baseRows[0];
  if (!u) {
    // ★ Defensive only — the caller (routes/index.mjs) resolves personId from a row it just read
    //   in the same transaction, so this should be unreachable. Never silently returns a half object.
    throw new Error(`personRecordTabs: no app_user with id ${personId} in this transaction`);
  }

  const completedBookings = Number(u.completed_bookings_count ?? 0);
  const variant = u.archived_at
    ? "archived"
    : u.role === "adolescent_client"
      ? "teen"
      : (u.lifecycle_status === "lead" && completedBookings === 0)
        ? "new"
        : "full";

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // `mayMoney` — EXACTLY the predicate the plan names: this person's OWN `owner_user_id`, not a
  // blanket `NULL` check. Every money query below is skipped entirely when this is false.
  // ─────────────────────────────────────────────────────────────────────────────────────────
  const { rows: moneyRows } = await tx.query(
    `SELECT keystone.user_may($1, 'invoice', 'view', $2) AS allowed`,
    [viewerId, u.owner_user_id]);
  const mayMoney = moneyRows[0]?.allowed === true;

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // WHO PAYS — the payer group (if any) covering this person, its contact, and who else is on it.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  const { rows: groupRows } = await tx.query(
    `SELECT pg.id, pg.name, pg.kind, pg.contact_user_id, contact.display_name AS contact_name
       FROM keystone.payer_group_member pgm
       JOIN keystone.payer_group pg ON pg.id = pgm.payer_group_id
       LEFT JOIN keystone.app_user contact ON contact.id = pg.contact_user_id
      WHERE pgm.person_id = $1 AND pg.archived_at IS NULL
      LIMIT 1`,
    [personId]);
  const groupRow = groupRows[0] ?? null;

  let contact = null;
  if (groupRow?.contact_user_id) {
    const { rows: relRows } = await run(tx, db
      .selectFrom("keystone.guardian")
      .select("relationship")
      .where("guardian_user_id", "=", groupRow.contact_user_id)
      .where("child_user_id", "=", personId));
    contact = {
      id: groupRow.contact_user_id,
      name: groupRow.contact_name,
      relationship: relRows[0]?.relationship ?? null,
    };
  }

  let alsoOnAccount = [];
  if (groupRow) {
    const { rows: alsoRows } = await tx.query(
      `SELECT pgm2.person_id, au.display_name,
              date_part('year', age(au.date_of_birth))::int AS age,
              g.relationship
         FROM keystone.payer_group_member pgm2
         JOIN keystone.app_user au ON au.id = pgm2.person_id
         LEFT JOIN keystone.guardian g
           ON g.guardian_user_id = pgm2.person_id AND g.child_user_id = $2
        WHERE pgm2.payer_group_id = $1 AND pgm2.person_id IS NOT NULL AND pgm2.person_id <> $2
        ORDER BY au.display_name`,
      [groupRow.id, personId]);
    alsoOnAccount = alsoRows.map((r) => ({
      id: r.person_id, name: r.display_name, age: r.age, relationship: r.relationship,
    }));
  }

  // ★ boundaryLine — the plan's two literal sentences, teen first (outranks the adult-contact case,
  //   since a teen's own guardian IS its payer-group contact in the ordinary case, and the wording
  //   differs). `guardianFirst`/`contactFirst` are the first token of the display name.
  const firstToken = (name) => (typeof name === "string" ? name.trim().split(/\s+/)[0] : null);
  let teenGuardians = [];
  let boundaryLine = null;
  if (variant === "teen") {
    const { rows: guardianRows } = await run(tx, db
      .selectFrom("keystone.guardian as g")
      .innerJoin("keystone.app_user as au", "au.id", "g.guardian_user_id")
      .select(["au.id", "au.display_name", "g.relationship"])
      .where("g.child_user_id", "=", personId)
      .orderBy("au.display_name", "asc"));
    teenGuardians = guardianRows.map((r) => ({ id: r.id, name: r.display_name, relationship: r.relationship }));
    const guardianFirst = firstToken(teenGuardians[0]?.name);
    if (guardianFirst) {
      boundaryLine = `${guardianFirst} sees attendance and what's owed. Never the notes.`;
    }
  } else if (contact && contact.id !== personId) {
    const contactFirst = firstToken(contact.name);
    if (contactFirst) {
      boundaryLine = `${contactFirst} sees: attendance and what's owed. Never the notes.`;
    }
  }

  const whoPays = {
    group: groupRow ? { id: groupRow.id, name: groupRow.name, kind: groupRow.kind } : null,
    contact,
    boundaryLine,
    alsoOnAccount,
  };

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // FACT LINE — clientSince (joined_at, NOT created_at — 0076's own distinction), payerName
  // (whoever actually pays: the group contact, else the group itself, else the person), cadence
  // (the most recent non-cancelled booking's recurrence_cadence — same "most recent" pattern
  // `current_coach`/`credit_progress` already use in src/records/queries.mjs).
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  const { rows: cadenceRows } = await run(tx, db
    .selectFrom("keystone.booking_participant as bp")
    .innerJoin("keystone.booking as b", "b.id", "bp.booking_id")
    .select("b.recurrence_cadence")
    .where("bp.app_user_id", "=", personId)
    .where("b.state", "<>", "cancelled")
    .orderBy("b.starts_at", "desc")
    .limit(1));
  const factLine = {
    clientSince: u.joined_at,
    payerName: contact?.name ?? groupRow?.name ?? u.display_name,
    cadence: cadenceRows[0]?.recurrence_cadence ?? null,
  };

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // COMING UP — next 3 confirmed/pending-payment bookings, scoped by the SAME `engagement`
  // predicate `RECORD_QUERIES.booking` uses (src/records/queries.mjs:646), because a booking's
  // host may be a different coach than whoever owns this person record — scope is a separate
  // axis from the verb (05), not inherited from the person read above it.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  const { rows: comingUpRows } = await tx.query(
    `SELECT b.id AS booking_id, b.starts_at, b.title,
            CASE WHEN b.location_kind IS NOT NULL THEN b.location_detail ELSE NULL END AS location_detail,
            host.display_name AS host_name, b.state
       FROM keystone.booking_participant bp
       JOIN keystone.booking b ON b.id = bp.booking_id
       JOIN keystone.app_user host ON host.id = b.host_id
      WHERE bp.app_user_id = $1
        AND b.starts_at > now()
        AND b.state IN ('confirmed', 'pending_payment')
        AND keystone.user_may($2, 'engagement', 'view', b.host_id)
      ORDER BY b.starts_at ASC
      LIMIT 3`,
    [personId, viewerId]);
  const comingUp = comingUpRows.map((r) => ({
    bookingId: r.booking_id, startsAt: r.starts_at, title: r.title,
    locationDetail: r.location_detail, hostName: r.host_name, state: r.state,
  }));

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // NOTES PREVIEW — 3 latest session notes the viewer may read. No extra predicate needed beyond
  // `subject_user_id`/`is_session_note`: `document_instance` carries FORCEd RLS and the request's
  // transaction already has `keystone.user_id` set (src/db/index.mjs), so `document_is_visible`
  // (0194 §B) is applied by Postgres itself — the same reliance the route's own
  // `RECORD_QUERIES.document` places on `scopedRecord`, just via the table's own policy here
  // instead of a hand-written predicate, because this is a related list off an already-authorised
  // record, matching `RELATED_QUERIES['booking.participants']`'s reasoning.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★ DOCUSTAY WALL FIX — routed through documents/api.mjs; same query, relocated verbatim.
  const noteRows = await sessionNotesPreviewFor(tx, { subjectUserId: personId });
  const notesPreview = noteRows.map((r) => ({
    id: r.id, title: r.title, excerpt: null, createdAt: r.created_at, authorName: r.author_name,
  }));

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // SESSIONS — count/since/cancelledInGoodTime are computed over completed/cancelled bookings;
  // `rows` is this module's own reading of the plan's `[...]`: the same shape `comingUp` uses
  // minus location/host (a history list, not a "where do I need to be" list). Same `engagement`
  // scope predicate as `comingUp`, same reason.
  //
  // ★ `cancelledInGoodTime` compares `cancelled_at` against `starts_at` minus the SERVICE's own
  //   `booking_policy.cancellation_notice_minutes` — LEFT JOINed because a service may have no
  //   policy row yet, in which case `1440` (24h) is used, the SAME system default
  //   `src/booking/writes.mjs:426` already falls back to for an unset override.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  const { rows: sessionStatRows } = await tx.query(
    `SELECT count(*) FILTER (WHERE b.state = 'completed')            AS completed_count,
            min(b.starts_at) FILTER (WHERE b.state = 'completed')    AS since,
            count(*) FILTER (
              WHERE b.state = 'cancelled' AND b.cancelled_at IS NOT NULL
                AND b.cancelled_at <= b.starts_at
                     - (make_interval(mins => coalesce(bpo.cancellation_notice_minutes, 1440)))
            ) AS cancelled_in_good_time
       FROM keystone.booking_participant bp
       JOIN keystone.booking b ON b.id = bp.booking_id
       LEFT JOIN keystone.booking_policy bpo ON bpo.service_id = b.service_id
      WHERE bp.app_user_id = $1
        AND keystone.user_may($2, 'engagement', 'view', b.host_id)`,
    [personId, viewerId]);
  const { rows: sessionRowsRaw } = await tx.query(
    `SELECT b.id AS booking_id, b.starts_at, b.title, b.state
       FROM keystone.booking_participant bp
       JOIN keystone.booking b ON b.id = bp.booking_id
      WHERE bp.app_user_id = $1
        AND keystone.user_may($2, 'engagement', 'view', b.host_id)
      ORDER BY b.starts_at DESC
      LIMIT 50`,
    [personId, viewerId]);
  const sessions = {
    count: Number(sessionStatRows[0]?.completed_count ?? 0),
    since: sessionStatRows[0]?.since ?? null,
    cancelledInGoodTime: Number(sessionStatRows[0]?.cancelled_in_good_time ?? 0),
    rows: sessionRowsRaw.map((r) => ({
      bookingId: r.booking_id, startsAt: r.starts_at, title: r.title, state: r.state,
    })),
  };

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // DOCUMENTS — signed (executed) and waiting (sent/partially_signed), RLS-filtered the same way
  // notesPreview is. `version` is the TEMPLATE's version at read time (`document_template.version`
  // is the only version anywhere in this schema — a document_instance has no version of its own).
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★ DOCUSTAY WALL FIX — routed through documents/api.mjs; same two queries, relocated verbatim.
  const signedRows = await signedInstancesFor(tx, { subjectUserId: personId });
  const waitingRows = await waitingInstancesFor(tx, { subjectUserId: personId });
  const documents = {
    signed: signedRows.map((r) => ({ id: r.id, title: r.title, signedAt: r.executed_at, version: r.version ?? undefined })),
    waiting: waitingRows.map((r) => ({ id: r.id, title: r.title, sentAt: r.sent_at })),
  };

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // DETAILS — email/phone/prefersText. `phone` reads `mobile_phone`, the same column
  // `src/records/lists/people.mjs`'s `MOBILE` column and every People list already treat as "the"
  // phone (home_phone has no equivalent single-field use anywhere in this codebase).
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  const details = {
    email: u.email,
    phone: u.mobile_phone,
    prefersText: u.preferred_contact_method === "text",
  };

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // FOUND THROUGH — the two separate referral edges (0081:11-19), read but never merged.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  const foundThrough = {
    partyId: u.referred_by_party_id,
    partyName: u.referred_by_party_name,
    referredByName: u.referred_by_name,
    source: u.source,
  };

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // TEEN — age, guardians (already read above for boundaryLine), consentStatus.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  let teen = null;
  if (variant === "teen") {
    const { rows: ageRows } = await tx.query(
      `SELECT date_part('year', age(date_of_birth))::int AS age FROM keystone.app_user WHERE id = $1`,
      [personId]);
    teen = {
      age: ageRows[0]?.age ?? null,
      guardians: teenGuardians,
      consentStatus: u.consent_status,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // GOALS COUNT — a bare number, not gated behind `mayGoal` a second time: reaching this route at
  // all already required staff-only `person: view` (05), and a count carries no title/detail text
  // (the private content `mayGoal` exists to protect, per src/people/goals.mjs's own header).
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  const { rows: goalRows } = await tx.query(
    `SELECT count(*)::int AS n FROM keystone.person_goal WHERE person_id = $1`,
    [personId]);
  const goalsCount = goalRows[0]?.n ?? 0;

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // PORTAL STATUS — the three facts the caller must resolve, per portalStatus.mjs's own contract.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  const { rows: signedInRows } = await tx.query(
    `SELECT keystone.person_ever_signed_in($1) AS ok`, [personId]);
  const { rows: inviteRows } = await tx.query(
    `SELECT created_at FROM keystone.invite WHERE lower(email) = lower($1) ORDER BY created_at DESC LIMIT 1`,
    [u.email]);
  const portalStatusValue = portalStatus({
    hasEverSignedIn: signedInRows[0]?.ok === true,
    invitedAt: inviteRows[0]?.created_at ?? null,
    emailBouncedAt: u.email_bounced_at,
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ARCHIVED — reason (kind 'archive', latest for the subject, 0140), archivedByName, stats.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  let archived = null;
  if (variant === "archived") {
    const { rows: reasonRows } = await run(tx, db
      .selectFrom("keystone.record_reason")
      .select("reason")
      .where("subject_type", "=", "person")
      .where("subject_id", "=", personId)
      .where("kind", "=", "archive")
      .orderBy("created_at", "desc")
      .limit(1));
    // ★ DOCUSTAY WALL FIX — routed through documents/api.mjs; same query, relocated verbatim.
    const documentCount = await totalInstanceCountFor(tx, { subjectUserId: personId });
    const stats = {
      sessions: sessions.count,
      documents: documentCount,
      firstAt: sessions.since,
      lastAt: sessionRowsRaw.find((r) => r.state === "completed")?.starts_at ?? null,
    };
    archived = {
      archivedAt: u.archived_at,
      archivedByName: u.archived_by_name,
      reason: reasonRows[0]?.reason ?? null,
      stats,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // MONEY — the whole block, and every query inside it, skipped entirely when `mayMoney` is false.
  // `owing`/`paidRows` cover this person's OWN payer_user_id and, when one exists, their payer
  // group's contact — the same combined-ids idiom `openInvoiceFor` (src/money/payerGroups.mjs)
  // already uses. `credits` reads `entitlement`/`entitlement_credit` per CT-F03's consolidated
  // model (Stage 11), owner_user_id scoped to the person themselves (the same scoping
  // `credit_progress` in src/records/queries.mjs uses).
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  let money;
  let archivedPaidMinor;
  if (mayMoney) {
    const payerIds = [personId, groupRow?.contact_user_id].filter((v) => v != null);

    let owing = [];
    let paidRows = [];
    if (payerIds.length > 0) {
      const { rows: owingRows } = await tx.query(
        `SELECT ie.id AS invoice_id, ie.invoice_number, ie.amount_minor, ie.currency, i.due_at, i.memo
           FROM keystone.invoice_effective ie
           LEFT JOIN keystone.invoice i ON i.id = ie.id
          WHERE ie.status = 'open' AND ie.payer_user_id = ANY($1::uuid[])
          ORDER BY i.created_at NULLS LAST`,
        [payerIds]);
      owing = owingRows.map((r) => ({
        invoiceId: r.invoice_id, invoiceNumber: r.invoice_number, amountMinor: r.amount_minor,
        currency: r.currency, dueAt: r.due_at, memo: r.memo,
      }));

      const { rows: paidInvoiceRows } = await tx.query(
        `SELECT ie.id AS invoice_id, ie.invoice_number, ie.amount_minor, ie.currency, ie.paid_at
           FROM keystone.invoice_effective ie
          WHERE ie.status = 'paid' AND ie.payer_user_id = ANY($1::uuid[])
          ORDER BY ie.paid_at DESC NULLS LAST`,
        [payerIds]);
      paidRows = paidInvoiceRows.map((r) => ({
        invoiceId: r.invoice_id, invoiceNumber: r.invoice_number, amountMinor: r.amount_minor,
        currency: r.currency, paidAt: r.paid_at,
      }));
    }

    const paidSinceMinor = paidRows.reduce((sum, r) => sum + Number(r.amountMinor ?? 0), 0);
    const paidInvoiceCount = paidRows.length;
    const firstPaidAt = paidRows.length
      ? paidRows.reduce((min, r) => (r.paidAt < min ? r.paidAt : min), paidRows[0].paidAt)
      : null;
    archivedPaidMinor = paidSinceMinor;

    const { rows: creditRows } = await tx.query(
      `SELECT e.id AS entitlement_id, s.name AS service_name, e.total_credits AS total,
              (SELECT count(*)::int FROM keystone.entitlement_credit ec
                WHERE ec.entitlement_id = e.id AND ec.status = 'consumed') AS used,
              e.expires_at
         FROM keystone.entitlement e
         JOIN keystone.service s ON s.id = e.service_id
        WHERE e.owner_user_id = $1 AND e.status = 'active'
        ORDER BY e.created_at DESC`,
      [personId]);
    const credits = creditRows.map((r) => ({
      entitlementId: r.entitlement_id, serviceName: r.service_name, total: r.total,
      used: r.used, expiresAt: r.expires_at,
    }));

    // ★ HONEST NULL — see the module header. Whoever's card is actually charged: the group's
    //   contact if there is one, else the person themselves.
    const cardHolderId = groupRow?.contact_user_id ?? personId;
    // ★ FIX, 1 Oct 2026 (saved-card brief, Part 6) — `detached_at IS NULL` was missing: a removed
    //   card keeps whatever `is_default` it had when it was attached (detach only stamps
    //   `detached_at` — src/money/cardUpdate.mjs never clears the flag, by design, since a
    //   detached row's `is_default` is simply meaningless afterwards), so this could have shown a
    //   card that had been removed as "the card on file". `exp_month`/`exp_year` were also never
    //   selected even though the frontend (PersonMoneyTab.jsx) already has a conditional branch
    //   waiting to render them — this is that read.
    const { rows: cardRows } = await run(tx, db
      .selectFrom("keystone.person_card_effective")
      .select(["last_four", "brand", "exp_month", "exp_year"])
      .where("app_user_id", "=", cardHolderId)
      .where("is_default", "=", true)
      .limit(1));
    const card = cardRows.length
      ? { brand: cardRows[0].brand, last4: cardRows[0].last_four, expMonth: cardRows[0].exp_month, expYear: cardRows[0].exp_year }
      : null;

    money = {
      owing, credits, paidSinceMinor, paidInvoiceCount, firstPaidAt, paidRows,
      howPays: {
        card,
        viaGroupName: groupRow?.name ?? null,
        invoicesGoToName: contact?.name ?? u.display_name,
      },
    };

    if (archived) archived.stats.paidMinor = archivedPaidMinor;
  }

  return {
    variant, mayMoney, factLine, comingUp, notesPreview, sessions, documents, whoPays, details,
    foundThrough, teen, archived, goalsCount,
    ...(money ? { money } : {}),
    portalStatus: portalStatusValue,
  };
}
