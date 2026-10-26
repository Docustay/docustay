// @ts-check
// R2 — MERGE DUPLICATES. Preview, apply, and undo.
//
// ★★★ THE SURVIVORSHIP RULES (TY'S OWN WORDS):
//   • Non-empty beats empty
//   • Most recently verified email wins (simplify: non-empty beats empty, or per caller's override)
//   • Earliest create date survives (preserves attribution)
//   • Notes and tags are CONCATENATED, never chosen between
//   • The portal login follows the survivor
//   • Any field overridable by the person merging (caller may pass explicit overrides)

import { emit, userActor } from "../events/outbox.mjs";
import { invalid, notFound, forbidden } from "../http/errors.mjs";
import { archiveRecord, restoreRecord } from "./archive.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";
import { DOCUMENTS_DOMAIN } from "../documents/frontDoor.mjs";

// ★★★ FIX (coordinator review, 23 Sep 2026) — the two PERSON_FK_REFS probes below used to swallow
//     EVERY query error identically (a real bug, a transient connection failure, a future typo)
//     the same way as "this table/column genuinely doesn't exist", which would let a real failure
//     masquerade as "nothing to reparent" and the merge still report success. This narrows the
//     swallow to exactly the two Postgres codes that mean "not found in the schema" — 42P01
//     (undefined_table) and 42703 (undefined_column) — and rethrows everything else.
function isMissingRelation(err) {
  return err?.code === "42P01" || err?.code === "42703";
}

// ★★★ RUN-2 T9 (26 Sep 2026) — THE LIST IS FILTERED BY THE LIVE CATALOGUE, NOT BY CATCHING ERRORS.
//     The `.catch(isMissingRelation)` below cannot work inside a transaction: the FIRST failed query
//     aborts the transaction and every later query fails "current transaction is aborted" — which is
//     exactly what happened. [EXECUTED, scripts/test/destructive.mjs] 11 of the 86 entries name a table
//     that is not in `keystone` (api_token, keystone_auth, booking_hold, booking_slot, …) or lacks
//     `tenant_id`, so merge PREVIEW and merge itself 500'd for every pair of people. One catalogue read
//     keeps only the pairs where the column, `tenant_id` and `id` all exist and this role can see them
//     (information_schema lists only columns the caller has a privilege on).
async function liveRefs(tx) {
  const tables = [...new Set(PERSON_FK_REFS.map((r) => r.table))];
  const { rows } = await run(tx, db.selectFrom("information_schema.columns").select(["table_name", "column_name"]).where("table_schema", "=", "keystone").where(sql`table_name = ANY(${sql.val(tables)})`));
  const cols = new Map();
  for (const r of rows) (cols.get(r.table_name) ?? cols.set(r.table_name, new Set()).get(r.table_name)).add(r.column_name);
  // ★ …and whether this role may UPDATE it. [EXECUTED] app_rw cannot write booking_link_redirect, and
  //   the reparent loop's `SELECT … FOR UPDATE` raised 42501 — merge answered "insufficient privilege".
  const { rows: priv } = await tx.query(
    `SELECT t AS table_name, has_table_privilege('keystone.' || t, 'UPDATE') AS can_update
       FROM unnest($1::text[]) AS t WHERE to_regclass('keystone.' || t) IS NOT NULL`, [tables]);
  const canUpdate = new Map(priv.map((r) => [r.table_name, r.can_update]));
  return PERSON_FK_REFS.filter(({ table, column }) => {
    const c = cols.get(table);
    return c && c.has(column) && c.has("tenant_id") && c.has("id");
  }).map((r) => ({ ...r, canUpdate: canUpdate.get(r.table) === true }));
}

// ★★ STRIPE CUSTOMER ID MERGE. When merging two people, the survivor keeps their stripe_customer_id.
//    The loser's stripe_customer_id is archived with the loser row (migration 0357). The payment
//    history stays with the person it was created on; there is no multi-customer merge in Stripe.
// ★ The FK inventory: every (table, column) pair that points at app_user.
// Extracted from PERSON-FK-INVENTORY.md — this is the authoritative list.
const PERSON_FK_REFS = [
  { table: "account", column: "created_by" },
  { table: "account", column: "owner_user_id" },
  { table: "account", column: "primary_contact_id" },
  { table: "account_contact", column: "added_by" },
  { table: "account_contact", column: "app_user_id" },
  { table: "api_token", column: "created_by" },
  { table: "api_token", column: "revoked_by" },
  { table: "app_user", column: "created_by" },
  { table: "app_user", column: "owner_user_id" },
  { table: "app_user", column: "referred_by_id" },
  { table: "availability_rule", column: "host_id" },
  { table: "booking", column: "created_by" },
  { table: "booking", column: "host_id" },
  { table: "booking_absence", column: "host_id" },
  { table: "booking_hold", column: "host_id" },
  { table: "booking_link_redirect", column: "redirect_to_app_user_id" },
  { table: "booking_participant", column: "app_user_id" },
  { table: "booking_participant_slot_link", column: "app_user_id" },
  { table: "booking_slot", column: "host_id" },
  { table: "booking_waitlist_entry", column: "client_user_id" },
  { table: "booking_waitlist_entry", column: "host_id" },
  { table: "calendar_connection", column: "host_id" },
  { table: "calendar_subscribe_token", column: "host_id" },
  { table: "campaign", column: "created_by" },
  { table: "campaign", column: "sent_by" },
  { table: "contracted_price", column: "app_user_id" },
  { table: "custom_field", column: "created_by" },
  { table: "custom_field_value", column: "updated_by" },
  { table: "data_export", column: "person_id" },
  { table: "data_export", column: "requested_by" },
  { table: "date_override", column: "host_id" },
  { table: "device_token", column: "app_user_id" },
  ...DOCUMENTS_DOMAIN.mergeColumns,   // Documents' own columns pointing at app_user — declared by Documents (ISLAND-PROGRAMS §2)
  { table: "embed_submission", column: "promoted_to" },
  { table: "entitlement", column: "owner_user_id" },
  { table: "guardian", column: "child_user_id" },
  { table: "guardian", column: "created_by" },
  { table: "guardian", column: "guardian_user_id" },
  { table: "import_run", column: "created_by" },
  { table: "invite", column: "child_user_id" },
  { table: "invite", column: "invited_by" },
  { table: "invoice", column: "created_by" },
  { table: "invoice", column: "payer_user_id" },
  { table: "keystone_auth", column: "app_user_id" },
  { table: "keystone_auth", column: "created_by" },
  { table: "keystone_auth", column: "revoked_by" },
  { table: "keystone_auth", column: "viewing_as_app_user_id" },
  { table: "link_token", column: "issued_to" },
  { table: "network_party", column: "created_by" },
  { table: "network_party", column: "owner_user_id" },
  { table: "network_party", column: "primary_contact_id" },
  { table: "notification", column: "recipient_id" },
  { table: "notification_preference", column: "app_user_id" },
  { table: "payment", column: "payer_user_id" },
  { table: "payment_method", column: "app_user_id" },
  // ★ ADDED post-hoc (coordinator review, 23 Sep 2026) — migrations 0349/0350, both from this SAME
  //   touch-up round, added FKs into app_user that this list was never updated for. Without these,
  //   merging a duplicate silently orphaned the loser's attachments (invisible from the survivor's
  //   attachment list, not archived, not reparented) and left telemetry pointing at an archived row.
  { table: "person_attachment", column: "person_id" },
  { table: "person_attachment", column: "uploaded_by" },
  { table: "telemetry_event", column: "app_user_id" },
  // ★ ADDED (coordinator review, 24 Sep 2026, overnight B+C run) — migrations 0359/0360, built the
  //   same night, added new FKs into app_user that this list was never updated for (same class of
  //   gap the 23 Sep review above already found twice). B3.4 correctly declined to guess at these
  //   without searching; confirmed against C1.4/C1.5's own reports instead of the schema directly.
  { table: "network_referral", column: "referred_person_id" },
  { table: "payer_group_member", column: "person_id" },
  { table: "record_reason", column: "created_by" },
  { table: "saved_view", column: "owner_person_id" },
  { table: "segment", column: "created_by" },
  { table: "subscription", column: "app_user_id" },
  { table: "task", column: "assignee_id" },
  { table: "task", column: "created_by_app_user_id" },
  { table: "team_member", column: "added_by" },
  { table: "team_member", column: "user_id" },
  { table: "tenant_intake", column: "submitted_by" },
  { table: "tenant_setting", column: "updated_by" },
  { table: "user_role", column: "granted_by" },
  { table: "user_role", column: "user_id" },
  // ★ ADDED (task 12.12) — five new tenant tables landed in Stage 12 (12.2, 12.3, 12.5, 12.6, 12.10),
  //   each carrying a person-shaped column PERSON_FK_REFS did not yet know about. Ten entries, not
  //   eleven: `{ table: "network_referral", column: "referred_person_id" }` is ALREADY above (0359,
  //   task 12.6's predecessor), one of the dividends of reusing the built table (OQ-12.2).
  //   `person_merge_dismissal` (this task's own new table) is deliberately NOT listed here — see the
  //   DELETE in applyMerge below, and the migration's header comment.
  { table: "location", column: "created_by" },
  { table: "staff_shift", column: "app_user_id" },
  { table: "staff_shift", column: "created_by" },
  { table: "time_off", column: "app_user_id" },
  { table: "time_off", column: "created_by" },
  { table: "network_referral", column: "created_by" },
  { table: "person_goal", column: "person_id" },
  { table: "person_goal", column: "created_by" },
  { table: "payer_group", column: "contact_user_id" },
  { table: "payer_group", column: "archived_by" },
];

/**
 * Compute survivorship for a merge WITHOUT MODIFYING ANYTHING.
 * Returns per-field winner info and counts of what would move.
 */
export async function previewMerge(tx, { tenantId, survivorId, loserId }) {
  if (!tenantId) throw invalid("previewMerge requires tenantId");
  if (!survivorId) throw invalid("previewMerge requires survivorId");
  if (!loserId) throw invalid("previewMerge requires loserId");

  // Fetch both people
  const { rows: survivors } = await run(tx, db.selectFrom("keystone.app_user").select(["id", "display_name", "email", "mobile_phone", "tags", "notes", "created_at"]).where("id", "=", survivorId).where("tenant_id", "=", tenantId));
  if (survivors.length === 0) throw notFound("survivor not found in this practice");

  const { rows: losers } = await run(tx, db.selectFrom("keystone.app_user").select(["id", "display_name", "email", "mobile_phone", "tags", "notes", "created_at"]).where("id", "=", loserId).where("tenant_id", "=", tenantId));
  if (losers.length === 0) throw notFound("loser not found in this practice");

  const survivor = survivors[0];
  const loser = losers[0];

  // Compute field winners
  const fields = [];

  // Name: non-empty beats empty
  fields.push({
    field: "display_name",
    survivorValue: survivor.display_name,
    loserValue: loser.display_name,
    winner: survivor.display_name ? "survivor" : "loser",
    reason: survivor.display_name && loser.display_name ? "most complete" : "non-empty wins",
  });

  // Email: non-empty beats empty
  fields.push({
    field: "email",
    survivorValue: survivor.email,
    loserValue: loser.email,
    winner: survivor.email ? "survivor" : "loser",
    reason: "non-empty wins",
  });

  // Mobile: non-empty beats empty
  fields.push({
    field: "mobile_phone",
    survivorValue: survivor.mobile_phone,
    loserValue: loser.mobile_phone,
    winner: survivor.mobile_phone ? "survivor" : "loser",
    reason: "non-empty wins",
  });

  // Created: earliest kept (preserve attribution)
  const survivorCreated = new Date(survivor.created_at);
  const loserCreated = new Date(loser.created_at);
  fields.push({
    field: "created_at",
    survivorValue: survivor.created_at,
    loserValue: loser.created_at,
    winner: survivorCreated <= loserCreated ? "survivor" : "loser",
    reason: "earliest kept",
  });

  // Tags: concatenated (both kept)
  fields.push({
    field: "tags",
    survivorValue: survivor.tags,
    loserValue: loser.tags,
    winner: "both",
    reason: "both kept (concatenated)",
  });

  // Notes: concatenated (both kept)
  fields.push({
    field: "notes",
    survivorValue: survivor.notes,
    loserValue: loser.notes,
    winner: "both",
    reason: "both kept (concatenated)",
  });

  // Count related rows per FK
  const relatedCounts = {};
  for (const { table, column } of await liveRefs(tx)) {
    const { rows } = await tx.query(
      `SELECT count(*)::int AS n FROM keystone.${table} WHERE ${column} = $1 AND tenant_id = $2`,
      [loserId, tenantId]
    ).catch((err) => {
      if (isMissingRelation(err)) return { rows: [{ n: 0 }] };
      throw err;
    });

    if (rows[0].n > 0) {
      const label = table.replace(/_/g, " ");
      relatedCounts[label] = (relatedCounts[label] || 0) + rows[0].n;
    }
  }

  // ★ TASK 12.12 — MergePreview's drawn "what happens" and "why we think it's her" rows.

  // "The modal never says 'and more'": every relatedCounts key gets its own whatHappens row, before
  // the named fixed rows below. Every re-parented class is Kept (it moves to the survivor).
  const whatHappens = [];
  for (const [label, count] of Object.entries(relatedCounts)) {
    whatHappens.push({
      label,
      detail: `${count} ${count === 1 ? "row" : "rows"} on ${label} move to one record`,
      verdict: "kept",
    });
  }

  // Sessions total, named explicitly.
  const sessionsCount = relatedCounts["booking"] || 0;
  whatHappens.push({
    label: "sessions",
    detail: sessionsCount > 0
      ? `${sessionsCount} session${sessionsCount === 1 ? "" : "s"} on one record`
      : "no sessions to combine",
    verdict: "kept",
  });

  // Both emails.
  whatHappens.push({
    label: "email",
    detail: survivor.email && loser.email && survivor.email !== loser.email
      ? `both ${survivor.email} and ${loser.email}`
      : (survivor.email || loser.email || "no email on either record"),
    verdict: "kept",
  });

  // The portal login that stays — "the portal login follows the survivor" (this file's header rule).
  whatHappens.push({
    label: "portal login",
    detail: survivor.email ? `${survivor.email} stays active` : "no portal login on the survivor",
    verdict: "kept",
  });

  // Who pays — the survivor keeps billing identity (this file's header: stripe_customer_id merge rule).
  whatHappens.push({
    label: "billing",
    detail: "the survivor's Stripe customer and payment history stay; the loser's is archived with the loser row",
    verdict: "kept",
  });

  // The dropped created date — earliest survives (per the `created_at` field winner above), so
  // whichever date is NOT the winner is the one that drops.
  const createdWinnerField = fields.find((f) => f.field === "created_at");
  whatHappens.push({
    label: "created date",
    detail: String(createdWinnerField.winner === "survivor" ? loser.created_at : survivor.created_at),
    verdict: "dropped",
  });

  // "Why we think it's her" — same phone, same surname+first name where true.
  // ★ Coach/service comparison is NOT included: it would require querying columns this function does
  //   not already read, and this task`s file list does not name a coach/service column to query —`
  //   guessing at one risks citing a column that does not exist. Reported, not guessed.
  const evidence = [];
  if (survivor.mobile_phone && loser.mobile_phone && survivor.mobile_phone === loser.mobile_phone) {
    evidence.push({ label: "same phone", detail: survivor.mobile_phone });
  }
  const survivorNameParts = (survivor.display_name || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  const loserNameParts = (loser.display_name || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (survivorNameParts.length > 0 && loserNameParts.length > 0 &&
      survivorNameParts[0] === loserNameParts[0] &&
      survivorNameParts[survivorNameParts.length - 1] === loserNameParts[loserNameParts.length - 1]) {
    evidence.push({ label: "same first and last name", detail: survivor.display_name });
  }

  return {
    fields,
    relatedCounts,
    whatHappens,
    evidence,
    undoUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

/**
 * Apply the merge: reparent every child row, archive loser, record tombstone.
 */
export async function applyMerge(tx, { tenantId, survivorId, loserId, actorUserId, overrides = {} }) {
  if (!tenantId) throw invalid("applyMerge requires tenantId");
  if (!survivorId) throw invalid("applyMerge requires survivorId");
  if (!loserId) throw invalid("applyMerge requires loserId");
  if (!actorUserId) throw invalid("applyMerge requires actorUserId");

  // Validate both people exist and are not archived
  const { rows: survivors } = await run(tx, db.selectFrom("keystone.app_user").select(["id", "display_name", "email", "mobile_phone", "tags", "notes", "created_at"]).where("id", "=", survivorId).where("tenant_id", "=", tenantId).where("archived_at", "is", null));
  if (survivors.length === 0) throw notFound("survivor not found or already archived in this practice");

  const { rows: losers } = await run(tx, db.selectFrom("keystone.app_user").select(["id", "display_name", "email", "mobile_phone", "tags", "notes", "created_at"]).where("id", "=", loserId).where("tenant_id", "=", tenantId).where("archived_at", "is", null));
  if (losers.length === 0) throw notFound("loser not found or already archived in this practice");

  const survivor = survivors[0];
  const loser = losers[0];

  // Compute survivorship (reuse preview logic)
  const computed = await previewMerge(tx, { tenantId, survivorId, loserId });

  // Build final field values, applying overrides
  const finalValues = {};
  for (const field of computed.fields) {
    if (field.field in overrides) {
      finalValues[field.field] = overrides[field.field];
    } else {
      // Apply default survivorship rule
      if (field.winner === "both") {
        // Concatenate
        if (field.field === "tags") {
          // ★ RUN-2 T9 — `app_user.tags` is text[] (MEASURED), not a comma string: `.split` threw on
          //   every merge ("survivor.tags.split is not a function"). Accept both, write an array back.
          const asList = (v) => (Array.isArray(v) ? v : v ? String(v).split(",") : []).map((t) => String(t).trim()).filter(Boolean);
          const combined = [...new Set([...asList(survivor.tags), ...asList(loser.tags)])]; // Unique
          finalValues[field.field] = combined;
        } else if (field.field === "notes") {
          const parts = [];
          if (survivor.notes) parts.push(survivor.notes);
          if (loser.notes) parts.push(loser.notes);
          finalValues[field.field] = parts.length > 0 ? parts.join("\n---\n") : null;
        }
      } else {
        // Use winner's value
        const winner = field.winner === "survivor" ? survivor : loser;
        finalValues[field.field] = winner[field.field];
      }
    }
  }

  // Step 3: Apply merged values to SURVIVOR
  await tx.query(
    `UPDATE keystone.app_user
        SET display_name = $1,
            email = $2,
            mobile_phone = $3,
            tags = $4,
            notes = $5
      WHERE id = $6 AND tenant_id = $7`,
    [
      finalValues.display_name,
      finalValues.email,
      finalValues.mobile_phone,
      finalValues.tags,
      finalValues.notes,
      survivorId,
      tenantId,
    ]
  );

  // ★ QUEUE §4 — the survivor keeps every program either person was in. `person_program` is NOT in PERSON_FK_REFS (re-pointing would hit its
  //   (person, program) primary key), so the loser's programs are COPIED onto the survivor; the loser's own rows stay with the archived record.
  await tx.query(
    `INSERT INTO keystone.person_program (tenant_id, person_id, program_id)
     SELECT tenant_id, $3, program_id FROM keystone.person_program WHERE tenant_id = $1 AND person_id = $2
     ON CONFLICT DO NOTHING`,
    [tenantId, loserId, survivorId]
  );

  // ★ TASK 12.12 — before the re-parent loop, drop any dismissal touching the loser. A dismissal is
  //   a suggestion memory, not history — re-pointing it could collide with the pair's unique key
  //   (person_low_id, person_high_id), so it is deleted rather than reparented. This is why
  //   `person_merge_dismissal` is NOT in PERSON_FK_REFS above. Undo does not restore it.
  await tx.query(
    `DELETE FROM keystone.person_merge_dismissal
      WHERE tenant_id = $1 AND (person_low_id = $2 OR person_high_id = $2)`,
    [tenantId, loserId]
  );

  // Step 4: Reparent child rows and record what moved
  const reparented = [];

  for (const { table, column, canUpdate } of await liveRefs(tx)) {
    // ★ RUN-2 T9 — a table this role may not write is COUNTED, never skipped silently: rows there would
    //   be left pointing at a person who no longer exists. None → nothing to move; some → refuse by name.
    if (!canUpdate) {
      const { rows: [{ n }] } = await tx.query(
        `SELECT count(*)::int AS n FROM keystone.${table} WHERE ${column} = $1 AND tenant_id = $2`, [loserId, tenantId]);
      if (n > 0) {
        throw forbidden(`This merge would leave ${n} ${table.replace(/_/g, " ")} row(s) behind that the practice cannot move. Nothing was changed.`);
      }
      continue;
    }
    // Get the ids before update so we can snapshot them
    const { rows: beforeRows } = await tx.query(
      `SELECT id FROM keystone.${table} WHERE ${column} = $1 AND tenant_id = $2 FOR UPDATE`,
      [loserId, tenantId]
    ).catch((err) => {
      if (isMissingRelation(err)) return { rows: [] };
      throw err;
    });

    if (beforeRows.length > 0) {
      const ids = beforeRows.map((r) => r.id);

      // Reparent
      await tx.query(
        `UPDATE keystone.${table} SET ${column} = $1 WHERE ${column} = $2 AND tenant_id = $3`,
        [survivorId, loserId, tenantId]
      );

      // Record snapshot
      reparented.push({
        table,
        column,
        ids,
      });
    }
  }

  // Step 5: Archive the loser
  await archiveRecord(tx, {
    tenantId,
    object: "person",
    id: loserId,
    actorUserId,
    reason: "merged into survivor",
  });

  // Step 6: Insert tombstone
  const { rows: tombstoneRows } = await tx.query(
    `INSERT INTO keystone.person_merge_tombstone
        (tenant_id, loser_id, survivor_id, merged_at, merged_by, undo_deadline, reparented)
     VALUES ($1, $2, $3, now(), $4, now() + INTERVAL '30 days', $5)
     RETURNING id`,
    [tenantId, loserId, survivorId, actorUserId, JSON.stringify(reparented)]
  );

  // Step 7: Emit event
  await emit(tx, {
    tenantId,
    topic: "people.person.merged",
    emittedBy: "people",
    subjectType: "person",
    subjectId: survivorId,
    actor: userActor(actorUserId),
    payload: {
      survivorId,
      loserId,
      merged_by: actorUserId,
    },
  });

  return {
    survivorId,
    loserId,
    merged: true,
    reparented,
  };
}

/**
 * ★ TASK 12.12 — "Not the same person". Record that this pair should never be suggested again by
 * `findPossibleDuplicate`. Idempotent: dismissing an already-dismissed pair is not an error.
 * @returns { id }
 */
export async function dismissMergePair(tx, { tenantId, personAId, personBId, actorUserId }) {
  if (!tenantId) throw invalid("dismissMergePair requires tenantId");
  if (!personAId) throw invalid("dismissMergePair requires personAId");
  if (!personBId) throw invalid("dismissMergePair requires personBId");
  if (personAId === personBId) throw invalid("cannot dismiss a person against themselves");

  const lowId = personAId < personBId ? personAId : personBId;
  const highId = personAId < personBId ? personBId : personAId;

  const { rows } = await tx.query(
    `INSERT INTO keystone.person_merge_dismissal (tenant_id, person_low_id, person_high_id, dismissed_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, person_low_id, person_high_id) DO NOTHING
     RETURNING id`,
    [tenantId, lowId, highId, actorUserId ?? null]
  );

  let id = rows[0]?.id ?? null;
  if (id === null) {
    // Already dismissed — look up the existing row's id rather than treating this as a failure.
    const { rows: existingRows } = await run(tx, db.selectFrom("keystone.person_merge_dismissal").select(["id"]).where("tenant_id", "=", tenantId).where("person_low_id", "=", lowId).where("person_high_id", "=", highId));
    id = existingRows[0]?.id ?? null;
  }

  await emit(tx, {
    tenantId,
    topic: "people.person.merge_dismissed",
    emittedBy: "people",
    subjectType: "person_merge_dismissal",
    subjectId: id,
    actor: userActor(actorUserId),
    payload: {},
  });

  return { id };
}

/**
 * Undo a merge: restore child rows from tombstone snapshot, restore loser.
 */
export async function undoMerge(tx, { tenantId, survivorId, loserId, actorUserId }) {
  if (!tenantId) throw invalid("undoMerge requires tenantId");
  if (!survivorId) throw invalid("undoMerge requires survivorId");
  if (!loserId) throw invalid("undoMerge requires loserId");
  if (!actorUserId) throw invalid("undoMerge requires actorUserId");

  // Find the tombstone
  const { rows: tombstoneRows } = await run(tx, db.selectFrom("keystone.person_merge_tombstone").select(["id", "undo_deadline", "reparented"]).where("tenant_id", "=", tenantId).where("survivor_id", "=", survivorId).where("loser_id", "=", loserId).where("undone_at", "is", null));

  if (tombstoneRows.length === 0) {
    throw notFound("no active merge found for this survivor/loser pair");
  }

  const tombstone = tombstoneRows[0];

  // Check deadline
  if (new Date() > new Date(tombstone.undo_deadline)) {
    throw invalid("the 30-day undo window has passed");
  }

  // Reverse each reparent from the snapshot
  // ★ FIX (coordinator review, 23 Sep 2026) — this UPDATE was the one write in this file with no
  //   explicit tenant_id predicate, relying solely on RLS where every other query here (including
  //   applyMerge's own reparent UPDATE) names the tenant explicitly. FORCE ROW LEVEL SECURITY makes
  //   this not an active hole, but the ids in `ids` are already this tenant's own (captured by
  //   applyMerge's tenant-scoped SELECT), so naming tenant_id here costs nothing and keeps this
  //   file's own defense-in-depth pattern consistent.
  // ★ RUN-2 T9 — `reparented` is jsonb, which pg returns ALREADY PARSED; JSON.parse on the object threw
  //   ("[object Object]" is not valid JSON), so undo had never worked. Accept both shapes.
  const reparented = typeof tombstone.reparented === "string" ? JSON.parse(tombstone.reparented) : (tombstone.reparented ?? []);
  for (const { table, column, ids } of reparented) {
    await tx.query(
      `UPDATE keystone.${table} SET ${column} = $1 WHERE id = ANY($2) AND tenant_id = $3`,
      [loserId, ids, tenantId]
    );
  }

  // Restore the loser
  await restoreRecord(tx, {
    tenantId,
    object: "person",
    id: loserId,
    actorUserId,
  });

  // Mark tombstone as undone
  await tx.query(
    `UPDATE keystone.person_merge_tombstone SET undone_at = now() WHERE id = $1`,
    [tombstone.id]
  );

  // Emit event
  await emit(tx, {
    tenantId,
    topic: "people.person.merge_undone",
    emittedBy: "people",
    subjectType: "person",
    subjectId: loserId, // The loser is now restored
    actor: userActor(actorUserId),
    payload: {
      survivorId,
      loserId,
      undone_by: actorUserId,
    },
  });

  return {
    survivorId,
    loserId,
    undone: true,
  };
}
