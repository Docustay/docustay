// @ts-check
// Task 6.4 — SetData export half (06-settings.md §2.6, §3 migration 0337, §7 "Data export builder",
// §12 test 6).
//
// ★ NO ZIP LIBRARY. MOCKUPS/§2.6 describe "a downloadable file containing the practice's own current
//   data" — this build's own Done bar (FEATURES-COMBINED-PLAN.md task 6.4) — without naming a format.
//   No archive/zip dependency exists in this codebase [MEASURED, package.json has no `archiver`/`zip`/
//   `jszip`] and adding one is an `npm install`, which this build may not run. The export is therefore
//   one JSON document — every row this practice owns, machine-readable and human-readable both — put
//   to the object store the same way every other stored artefact in this codebase already is
//   (src/storage/s3.mjs). Flagged as a scope decision in this build's report.
//
// ★ SYNCHRONOUS, SAME REASONING AS `src/settings/importCsv.mjs`'s OWN HEADER NOTE: no application
//   code anywhere enqueues a graphile-worker job directly, and wiring the first one is outside this
//   task's own file list. `requestDataExport` below does the whole build inline; the row still moves
//   'queued' → 'processing' → 'ready'/'failed' (§3), just within one request rather than across a
//   worker hop.

import { invalid, notFound, dependency } from "../http/errors.mjs";
import { objectKey, putObject, getObject } from "../storage/s3.mjs";
import { emit, userActor } from "../events/outbox.mjs";
import { writeAudit } from "../permissions/audit.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

/** Every table this export gathers, and the column list it reads — the practice's OWN data, nothing
 *  cross-tenant (every query below is `WHERE tenant_id = $1`, reached under the same RLS every other
 *  tenant-scoped read in this codebase relies on). */
async function gatherEverything(tx, tenantId) {
  const [people, accounts, bookings, invoices] = await Promise.all([
    tx.query(
      `SELECT id, email, display_name, first_name, last_name, role, staff_role, mobile_phone,
              date_of_birth, lifecycle_status, created_at
         FROM keystone.app_user WHERE tenant_id = $1 ORDER BY created_at`, [tenantId]),
    tx.query(`SELECT id, name, status, created_at FROM keystone.account WHERE tenant_id = $1 ORDER BY created_at`,
      [tenantId]),
    tx.query(
      `SELECT id, state, starts_at, ends_at, created_at FROM keystone.booking WHERE tenant_id = $1 ORDER BY created_at`,
      [tenantId]),
    tx.query(
      // Stripe-mirror §4 stage (e): status/amount/currency are Stripe's (invoice_effective); created_at
      // is the platform's own (null for a Stripe-only invoice that never had a the platform row).
      `SELECT ie.id, ie.status, ie.amount_minor, ie.currency, i.created_at
         FROM keystone.invoice_effective ie
         LEFT JOIN keystone.invoice i ON i.id = ie.id
        WHERE ie.tenant_id = $1 ORDER BY i.created_at NULLS LAST, ie.id`,
      [tenantId]),
  ]);
  return {
    people: people.rows, accounts: accounts.rows, bookings: bookings.rows, invoices: invoices.rows,
  };
}

async function gatherOnePerson(tx, tenantId, personId) {
  const { rows } = await tx.query(
    `SELECT id, email, display_name, first_name, last_name, role, staff_role, mobile_phone,
            date_of_birth, lifecycle_status, created_at
       FROM keystone.app_user WHERE tenant_id = $1 AND id = $2`, [tenantId, personId]);
  if (rows.length === 0) throw notFound("no such person in this organisation");
  return { person: rows[0] };
}

/**
 * §2.6 `POST /api/settings/data/export` — owner only (gated by the caller, same idiom
 * `guarded(navPath, "owner", ...)` already uses elsewhere in this file). Builds the file inline and
 * returns the row's id/status.
 */
export async function requestDataExport(tx, { tenantId, requestedBy, scope, personId = null }) {
  if (!["everything", "one_person"].includes(scope)) {
    throw invalid("scope must be 'everything' or 'one_person'");
  }
  if (scope === "one_person" && !personId) throw invalid("personId is required for scope 'one_person'");

  // ★ notFound BEFORE the insert — a request naming a person outside this tenant should read as
  //   "no such person", not as a row this practice never asked to have.
  if (scope === "one_person") {
    const { rowCount } = await run(tx, db
      .selectFrom("keystone.app_user")
      .select("id")
      .where("tenant_id", "=", tenantId)
      .where("id", "=", personId));
    if (rowCount === 0) throw notFound("no such person in this organisation");
  }

  const { rows: inserted } = await run(tx, db
    .insertInto("keystone.data_export")
    .values({
      tenant_id: tenantId ?? null,
      requested_by: requestedBy ?? null,
      scope: scope ?? null,
      person_id: (scope === "one_person" ? personId : null) ?? null,
      status: "processing",
    })
    .returning(["id", "requested_at"]));
  const exportId = inserted[0].id;

  await emit(tx, {
    tenantId, topic: "settings.data.export_requested", emittedBy: "settings",
    actor: userActor(requestedBy),
    payload: { exportId, scope },
  });

  try {
    const data = scope === "everything"
      ? await gatherEverything(tx, tenantId)
      : await gatherOnePerson(tx, tenantId, personId);
    const body = Buffer.from(JSON.stringify({ scope, generatedAt: new Date().toISOString(), data }, null, 2));
    const key = objectKey({ tenantId, kind: "data_export", id: `${exportId}.json` });
    const put = await putObject({ key, body, contentType: "application/json" });
    if (!put.ok) throw dependency(`the file store refused this export: ${put.error}`);

    await run(tx, db
      .updateTable("keystone.data_export")
      .set({ status: "ready", object_key: key ?? null, completed_at: sql`now()` })
      .where("id", "=", exportId));
    await emit(tx, {
      tenantId, topic: "settings.data.export_ready", emittedBy: "settings",
      actor: userActor(requestedBy),
      payload: { exportId, scope },
    });
  } catch (e) {
    await run(tx, db
      .updateTable("keystone.data_export")
      .set({ status: "failed" })
      .where("id", "=", exportId));
    // ★ A failed export is a recorded fact (§7: "no silent stuck-at-processing state"), not a thrown
    //   500 — the row is what SetData's list reads to show "Failed — try again".
  }

  await writeAudit(tx, {
    tenantId, action: "settings.changed", object: "settings.data_export",
    actorUserId: requestedBy ?? null,
    after: { exportId, scope, personId: scope === "one_person" ? personId : null },
  });

  const { rows: final } = await run(tx, db
    .selectFrom("keystone.data_export")
    .select("status")
    .where("id", "=", exportId));
  return { exportId, status: final[0]?.status ?? "queued" };
}

/** §2.6 export status list. */
export async function listDataExports(tx, { tenantId }) {
  const { rows } = await tx.query(
    `SELECT e.id, e.scope, e.status, e.requested_at, e.completed_at,
            p.display_name AS person_name
       FROM keystone.data_export e
       LEFT JOIN keystone.app_user p ON p.id = e.person_id
      WHERE e.tenant_id = $1
      ORDER BY e.requested_at DESC`, [tenantId]);
  return rows.map((r) => ({
    id: r.id, scope: r.scope, personName: r.person_name ?? null, status: r.status,
    requestedAt: r.requested_at, completedAt: r.completed_at,
    downloadUrl: r.status === "ready" ? `/api/settings/data/exports/${r.id}/download` : null,
  }));
}

/** The download route's own read — the stored bytes for a `ready` export in THIS tenant. */
export async function loadDataExportFile(tx, { tenantId, exportId }) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.data_export")
    .select(["object_key", "status"])
    .where("id", "=", exportId)
    .where("tenant_id", "=", tenantId));
  if (rows.length === 0) throw notFound("no such export");
  if (rows[0].status !== "ready" || !rows[0].object_key) throw invalid("this export is not ready yet");
  const got = await getObject({ key: rows[0].object_key });
  if (!got.ok) throw dependency("the file store could not return this export");
  return got.body;
}
