// @ts-check
// P15B.5 — THE ACCOUNTS WRITES. createAccount · updateAccount · createAccountPipeline · advanceStage.
//
// ★★★ §A3: "BUILD / PROVISION / RUN ARE THREE PIPELINES AND MUST NOT COLLAPSE INTO ONE." That is not
//     a style preference; the three answer different questions and carry different columns:
//       · build     — WHERE IN A SEQUENCE is this piece of work?   → `stage`, no cadence
//       · run       — HOW OFTEN does this recur?                   → `cadence`, no stage
//       · provision — a one-shot that a provisioning RUN executes  → neither; a run id
//     [MEASURED from the catalog] the database already says exactly this, as `pipeline_shape`:
//       CHECK ((kind='build'     AND stage IS NOT NULL AND cadence IS NULL AND provisioning_run_id IS NULL)
//           OR (kind='run'       AND stage IS NULL     AND cadence IS NOT NULL)
//           OR (kind='provision' AND stage IS NULL     AND cadence IS NULL))
//     ★★ SO COLLAPSING THEM IS UNREPRESENTABLE, not merely discouraged — a "build with a cadence" or
//        a "run with a stage" cannot be stored at all. This module's job is to make the refusal
//        legible before Postgres has to, and NEVER to paper over it by filling in a default.
//
// ★ Every function takes `tx` and emits in the same transaction (§X4.1 / P15B.2).

import { emit, userActor } from "../events/outbox.mjs";
import { invalid, notFound, unprocessable } from "../http/errors.mjs";
// ★ C1.9 — required fields validation
import { requiredFor, validateRequired } from "../records/fieldRules.mjs";
// ★ C1.2 — Stripe customer sync
import { ensureCustomer } from "../money/customers.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

const SECTION = "accounts";

export const ACCOUNT_STATUSES = Object.freeze(["prospect", "active", "paused", "closed"]);
export const ACCOUNT_TYPES = Object.freeze(["prospect", "customer", "partner", "vendor", "other"]);
export const PIPELINE_KINDS = Object.freeze(["build", "provision", "run"]);
export const PIPELINE_STATES = Object.freeze(["active", "paused", "complete", "cancelled"]);

const CHECK_VIOLATION = "23514";
const FOREIGN_KEY_VIOLATION = "23503";

/**
 * Create an account — a customer of THIS practice. Accepts all 28 account columns.
 * ★ `customerTenantId` is for the GLT case where the customer is itself a Keystone tenant. It is
 *   nullable and stays null for an ordinary account; passing one does NOT make the two tenants
 *   related in any RLS sense, it is a reference for a human.
 */
export async function createAccount(
  tx, {
    tenantId,
    name,
    status = "active",
    customerTenantId = null,
    actorUserId = null,
    accountNumber = null,
    parentAccountId = null,
    accountType = null,
    industry = null,
    primaryContactId = null,
    phone = null,
    email = null,
    website = null,
    billingLine1 = null,
    billingLine2 = null,
    billingCity = null,
    billingStateRegion = null,
    billingPostcode = null,
    billingCountry = null,
    employeeCount = null,
    description = null,
    source = null,
    tags = null,
    ownerUserId = null,
  }
) {
  // ★ C1.9 — validate required fields from the setting
  const required = await requiredFor(tx, tenantId, "account");
  const validation = validateRequired({ name, email }, required);

  if (!validation.ok) {
    throw unprocessable(
      `missing required fields: ${validation.missing.join(", ")}`,
      { fields: validation.missing }
    );
  }

  if (!ACCOUNT_STATUSES.includes(status)) {
    throw invalid(`status must be one of ${ACCOUNT_STATUSES.join(", ")} — got ${JSON.stringify(status)}`);
  }
  if (accountType !== null && !ACCOUNT_TYPES.includes(accountType)) {
    throw invalid(`account_type must be one of ${ACCOUNT_TYPES.join(", ")} — got ${JSON.stringify(accountType)}`);
  }
  if (employeeCount !== null && (typeof employeeCount !== "number" || employeeCount < 0)) {
    throw invalid("employee count cannot be negative");
  }

  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  // ★ FIX (R2-A verification) — `tags` is `NOT NULL DEFAULT '{}'`; an explicit NULL in the VALUES
  //   list bypasses the column default and raises not_null_violation. Every create without tags
  //   (the common case — AccountForm's tags field is optional) hit this. `[]`, never `null`.
  const normalizedTags = Array.isArray(tags) ? tags : (tags ? JSON.parse(tags) : []);

  try {
    await run(tx, db
      .insertInto("keystone.account")
      .values({
        id: id ?? null,
        tenant_id: tenantId ?? null,
        name: name.trim() ?? null,
        status: status ?? null,
        customer_tenant_id: customerTenantId ?? null,
        account_number: (accountNumber ? accountNumber.trim() : null) ?? null,
        parent_account_id: parentAccountId ?? null,
        account_type: accountType ?? null,
        industry: (industry ? industry.trim() : null) ?? null,
        primary_contact_id: primaryContactId ?? null,
        phone: (phone ? phone.trim() : null) ?? null,
        email: (email ? email.trim() : null) ?? null,
        website: (website ? website.trim() : null) ?? null,
        billing_line1: (billingLine1 ? billingLine1.trim() : null) ?? null,
        billing_line2: (billingLine2 ? billingLine2.trim() : null) ?? null,
        billing_city: (billingCity ? billingCity.trim() : null) ?? null,
        billing_state_region: (billingStateRegion ? billingStateRegion.trim() : null) ?? null,
        billing_postcode: (billingPostcode ? billingPostcode.trim() : null) ?? null,
        billing_country: (billingCountry ? billingCountry.trim() : null) ?? null,
        employee_count: employeeCount ?? null,
        description: (description ? description.trim() : null) ?? null,
        source: (source ? source.trim() : null) ?? null,
        tags: normalizedTags ?? null,
        owner_user_id: ownerUserId ?? null,
      })
    );
  } catch (e) {
    if (e.code === FOREIGN_KEY_VIOLATION) {
      throw invalid(`invalid reference: ${e.constraint ?? e.message}`);
    }
    if (e.code === CHECK_VIOLATION) {
      throw invalid(`constraint violation: ${e.constraint ?? e.message}`);
    }
    throw e;
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★ C1.2 — STRIPE CUSTOMER SYNC. Ensure the account gets a Stripe Customer on the practice's
  //   connected account. If no Connect account exists yet, this queues the customer (stores as
  //   null) and backfill runs it later.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  await ensureCustomer(tx, { tenantId, accountId: id });

  await emit(tx, {
    tenantId,
    topic: "accounts.account.created",
    emittedBy: SECTION,
    subjectType: "account",
    subjectId: id,
    // ★ FIX ROUND 1, I1 — `actorUserId` is the session id `routes/writes.mjs:230` stamps last.
    actor: userActor(actorUserId),
    payload: { status, is_tenant_customer: customerTenantId !== null },
  });
  return {
    id,
    name: name.trim(),
    status,
    customer_tenant_id: customerTenantId,
    account_number: accountNumber ? accountNumber.trim() : null,
    parent_account_id: parentAccountId,
    account_type: accountType,
    industry: industry ? industry.trim() : null,
    primary_contact_id: primaryContactId,
    phone: phone ? phone.trim() : null,
    email: email ? email.trim() : null,
    website: website ? website.trim() : null,
    billing_line1: billingLine1 ? billingLine1.trim() : null,
    billing_line2: billingLine2 ? billingLine2.trim() : null,
    billing_city: billingCity ? billingCity.trim() : null,
    billing_state_region: billingStateRegion ? billingStateRegion.trim() : null,
    billing_postcode: billingPostcode ? billingPostcode.trim() : null,
    billing_country: billingCountry ? billingCountry.trim() : null,
    employee_count: employeeCount,
    description: description ? description.trim() : null,
    source: source ? source.trim() : null,
    tags: normalizedTags,
    owner_user_id: ownerUserId,
  };
}

/**
 * Update an account's name and/or status.
 * ★★ A STATUS CHANGE IS PART OF `account.updated`, NOT ITS OWN TOPIC — because the catalogue has no
 *    `account.status_changed` and a topic is a schema change, not a string (P15B.3). The payload
 *    names the new status so a consumer never has to re-read to find out what happened.
 */
export async function updateAccount(tx, { tenantId, accountId, name, status, actorUserId = null }) {
  const sets = [];
  const args = [accountId];
  const changed = [];
  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) throw invalid("an account name cannot be blank");
    args.push(name.trim()); sets.push(`name = $${args.length}`); changed.push("name");
  }
  if (status !== undefined) {
    if (!ACCOUNT_STATUSES.includes(status)) {
      throw invalid(`status must be one of ${ACCOUNT_STATUSES.join(", ")} — got ${JSON.stringify(status)}`);
    }
    args.push(status); sets.push(`status = $${args.length}`); changed.push("status");
  }
  if (sets.length === 0) throw invalid("nothing to update");

  const r = await tx.query(
    `UPDATE keystone.account SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, args);
  // ★ Zero rows is 404, not success. Under RLS a cross-tenant id looks exactly like a missing one,
  //   and an UPDATE that matches nothing raises nothing (D-17.19).
  if (r.rowCount === 0) throw notFound("no such account in this organisation");

  await emit(tx, {
    tenantId,
    topic: "accounts.account.updated",
    emittedBy: SECTION,
    subjectType: "account",
    subjectId: accountId,
    // ★ FIX ROUND 1, I1.
    actor: userActor(actorUserId),
    payload: { fields: changed, ...(status !== undefined ? { status } : {}) },
  });
  return { id: accountId, fields: changed };
}

/**
 * ★★★ CREATE ONE OF THE THREE PIPELINES. The shape is decided by `kind` and nothing else.
 *
 * @param kind      'build' | 'provision' | 'run'
 * @param stage     REQUIRED for build, FORBIDDEN otherwise
 * @param cadence   REQUIRED for run, FORBIDDEN otherwise
 * @param provisioningRunId  only meaningful for provision; FORBIDDEN for build
 */
export async function createAccountPipeline(
  tx, { tenantId, accountId, kind, stage = null, cadence = null, provisioningRunId = null,
        state = "active", actorUserId = null }
) {
  if (!PIPELINE_KINDS.includes(kind)) {
    throw invalid(`kind must be one of ${PIPELINE_KINDS.join(", ")} — got ${JSON.stringify(kind)}`);
  }
  if (!PIPELINE_STATES.includes(state)) {
    throw invalid(`state must be one of ${PIPELINE_STATES.join(", ")} — got ${JSON.stringify(state)}`);
  }

  // ★★★ THE THREE SHAPES, STATED ONE AT A TIME AND REFUSED ONE AT A TIME.
  //     ★ Each branch says what is MISSING or what is SURPLUS, rather than "invalid pipeline" — the
  //       whole value of having three kinds is lost if the error does not say which rule was broken.
  //     ★★ AND NOTHING IS DEFAULTED IN. Supplying a stage for a `run` because the caller forgot to,
  //        or dropping a cadence that was passed to a `build`, would be the collapse §A3 forbids,
  //        performed quietly by this function on the caller's behalf.
  if (kind === "build") {
    if (!stage) throw invalid("a BUILD pipeline needs a stage — that is what makes it a sequence");
    if (cadence) throw invalid("a BUILD pipeline cannot have a cadence — a sequence does not recur (§A3)");
    if (provisioningRunId) throw invalid("a BUILD pipeline cannot reference a provisioning run (§A3)");
  } else if (kind === "run") {
    if (!cadence) throw invalid("a RUN pipeline needs a cadence — that is what makes it recurring");
    if (stage) throw invalid("a RUN pipeline cannot have a stage — recurring work has no position in a sequence (§A3)");
  } else { // provision
    if (stage) throw invalid("a PROVISION pipeline cannot have a stage (§A3)");
    if (cadence) throw invalid("a PROVISION pipeline cannot have a cadence — it happens once (§A3)");
  }

  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  try {
    await run(tx, db
      .insertInto("keystone.account_pipeline")
      .values({
        id: id ?? null,
        tenant_id: tenantId ?? null,
        account_id: accountId ?? null,
        kind: kind ?? null,
        stage: stage ?? null,
        cadence: cadence ?? null,
        provisioning_run_id: provisioningRunId ?? null,
        state: state ?? null,
      })
    );
  } catch (e) {
    if (e.code === CHECK_VIOLATION) {
      // ★ If this fires, the checks above and `pipeline_shape` disagree — which is a defect in THIS
      //   file, not caller error. Say so, and name the constraint that had the last word.
      throw invalid(
        `the database refused this pipeline shape (${e.constraint ?? e.message}) — the module's own ` +
        `checks and the constraint disagree, which is a bug here, not in the request`);
    }
    throw e;
  }

  await emit(tx, {
    tenantId,
    topic: "accounts.pipeline.created",
    emittedBy: SECTION,
    subjectType: "account_pipeline",
    subjectId: id,
    // ★ FIX ROUND 1, I1.
    actor: userActor(actorUserId),
    // ★ `kind` is the load-bearing field for every consumer: a RUN pipeline means recurring delivery
    //   and therefore recurring billing, and a BUILD one does not.
    payload: { kind, account_id: accountId, stage, cadence, state },
  });
  return { id, kind, stage, cadence, state };
}

/**
 * Advance a BUILD pipeline to its next stage.
 * ★★★ BUILD ONLY, AND THE PREDICATE SAYS SO. `kind = 'build'` is in the WHERE clause rather than an
 *     `if` above it: a `run` pipeline has no stage to advance, and a read-then-write would leave a
 *     gap. A non-build pipeline matches zero rows and is refused below.
 */
export async function advanceStage(tx, { tenantId, pipelineId, stage, actorUserId = null }) {
  if (typeof stage !== "string" || !stage.trim()) throw invalid("a stage is required");

  const { rows, rowCount } = await run(tx, db
    .updateTable("keystone.account_pipeline")
    .set({ stage: stage.trim() ?? null })
    .where("id", "=", pipelineId)
    .where("kind", "=", "build")
    .where("state", "=", "active")
    .returning(["account_id", "stage"])
  );

  if (rowCount === 0) {
    // ★ One message for four conditions — unknown id, other tenant, not a build, not active. The
    //   caller is staff, so this is not an oracle; distinguishing them would still describe rows RLS
    //   is deliberately hiding.
    throw notFound("no active build pipeline with that id in this organisation");
  }

  await emit(tx, {
    tenantId,
    topic: "accounts.pipeline.advanced",
    emittedBy: SECTION,
    subjectType: "account_pipeline",
    subjectId: pipelineId,
    // ★ FIX ROUND 1, I1.
    actor: userActor(actorUserId),
    payload: { account_id: rows[0].account_id, stage: rows[0].stage },
  });
  return { id: pipelineId, stage: rows[0].stage };
}
