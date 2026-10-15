// @ts-check
// C3.2 — LANDING PAGES CRUD + AI DRAFT ROUTE.
// ★ AI output is a DRAFT; a human publishes. The AI draft route writes to `growth_ai_request`
//   only (storing the AI draft), never directly to `landing_page.body` (published content).
//   The `publishLandingPage` function is the ONLY thing that can move a page from draft to
//   published, and it must be called explicitly by a person action, never automatically.
// ★ Every function takes `tx` and emits in the same transaction (§X4.1 / P15B.2).

import { emit, userActor } from "../events/outbox.mjs";
import { invalid, notFound } from "../http/errors.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

const SECTION = "growth";
const FOREIGN_KEY_VIOLATION = "23503";

/**
 * Create a landing page with required fields: slug and title.
 */
export async function createLandingPage(
  tx, {
    tenantId,
    slug,
    title,
    body = null,
    purpose = null,
    // ★ RUN-2 T19 — was `null`, INSERTed explicitly, which overrides the column's DEFAULT 'lead_form'
    //   (0445) and violates its NOT NULL — every create 400'd "a required field was missing: cta_type".
    ctaType = "lead_form",
    bookingServiceId = null,
    endedAt = null,
    actorUserId = null,
  }
) {
  if (!slug || typeof slug !== "string" || !slug.trim()) {
    throw invalid("slug is required and cannot be blank");
  }
  if (!title || typeof title !== "string" || !title.trim()) {
    throw invalid("title is required and cannot be blank");
  }

  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;

  try {
    await run(tx, db
      .insertInto("keystone.landing_page")
      .values({
        id,
        tenant_id: tenantId ?? null,
        slug: slug.trim() ?? null,
        title: title.trim() ?? null,
        body: (body ? body.trim() : null) ?? null,
        is_published: false,
        published_at: null,
        purpose: purpose ?? null,
        cta_type: ctaType ?? null,
        booking_service_id: bookingServiceId ?? null,
        ended_at: endedAt ?? null,
      }));
  } catch (e) {
    if (e.code === FOREIGN_KEY_VIOLATION) {
      throw invalid(`invalid reference: ${e.constraint ?? e.message}`);
    }
    if (e.code === "23505") { // unique violation
      throw invalid("a landing page with this slug already exists in this practice");
    }
    throw e;
  }

  await emit(tx, {
    tenantId,
    topic: "growth.landing_page.created",
    emittedBy: SECTION,
    subjectType: "landing_page",
    subjectId: id,
    actor: userActor(actorUserId),
    payload: { is_published: false },
  });

  return {
    id,
    tenant_id: tenantId,
    slug: slug.trim(),
    title: title.trim(),
    body: body ? body.trim() : null,
    is_published: false,
    published_at: null,
    purpose,
    cta_type: ctaType,
    booking_service_id: bookingServiceId,
    ended_at: endedAt,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Update a landing page's title, body, slug, or other fields.
 */
export async function updateLandingPage(
  tx, {
    tenantId,
    landingPageId,
    slug,
    title,
    body,
    purpose,
    ctaType,
    bookingServiceId,
    endedAt,
    actorUserId = null,
  }
) {
  const sets = [];
  const args = [landingPageId];
  const changed = [];

  if (slug !== undefined) {
    if (typeof slug !== "string" || !slug.trim()) throw invalid("slug cannot be blank");
    args.push(slug.trim());
    sets.push(`slug = $${args.length}`);
    changed.push("slug");
  }
  if (title !== undefined) {
    if (typeof title !== "string" || !title.trim()) throw invalid("title cannot be blank");
    args.push(title.trim());
    sets.push(`title = $${args.length}`);
    changed.push("title");
  }
  if (body !== undefined) {
    args.push(body ? body.trim() : null);
    sets.push(`body = $${args.length}`);
    changed.push("body");
  }
  if (purpose !== undefined) {
    args.push(purpose);
    sets.push(`purpose = $${args.length}`);
    changed.push("purpose");
  }
  if (ctaType !== undefined) {
    args.push(ctaType);
    sets.push(`cta_type = $${args.length}`);
    changed.push("cta_type");
  }
  if (bookingServiceId !== undefined) {
    args.push(bookingServiceId);
    sets.push(`booking_service_id = $${args.length}`);
    changed.push("booking_service_id");
  }
  if (endedAt !== undefined) {
    args.push(endedAt);
    sets.push(`ended_at = $${args.length}`);
    changed.push("ended_at");
  }

  if (sets.length === 0) throw invalid("nothing to update");

  sets.push("updated_at = now()");

  try {
    const r = await tx.query(
      `UPDATE keystone.landing_page
       SET ${sets.join(", ")}
       WHERE id = $1 AND tenant_id = $${args.length + 1}
       RETURNING id`,
      [...args, tenantId]
    );

    if (r.rowCount === 0) throw notFound("no such landing page in this organisation");
  } catch (e) {
    if (e.code === "23505") { // unique violation on slug
      throw invalid("a landing page with this slug already exists in this practice");
    }
    throw e;
  }

  await emit(tx, {
    tenantId,
    topic: "growth.landing_page.updated",
    emittedBy: SECTION,
    subjectType: "landing_page",
    subjectId: landingPageId,
    actor: userActor(actorUserId),
    payload: { fields: changed },
  });

  return { id: landingPageId, fields: changed };
}

/**
 * Delete a landing page.
 */
export async function deleteLandingPage(
  tx, {
    tenantId,
    landingPageId,
    actorUserId = null,
  }
) {
  const r = await run(tx, db
    .deleteFrom("keystone.landing_page")
    .where("id", "=", landingPageId)
    .where("tenant_id", "=", tenantId));

  if (r.rowCount === 0) throw notFound("no such landing page in this organisation");

  await emit(tx, {
    tenantId,
    topic: "growth.landing_page.deleted",
    emittedBy: SECTION,
    subjectType: "landing_page",
    subjectId: landingPageId,
    actor: userActor(actorUserId),
    payload: {},
  });

  return { id: landingPageId };
}

/**
 * List landing pages for a tenant.
 */
export async function listLandingPages(tx, tenantId) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.landing_page")
    .select(["id", "tenant_id", "slug", "title", "body", "is_published", "published_at", "created_at", "updated_at"])
    .where("tenant_id", "=", tenantId)
    .orderBy("created_at", "desc"));

  return rows;
}

/**
 * Create or update an AI-generated draft in growth_ai_request.
 * ★ This writes to `growth_ai_request` only, never directly to `landing_page.body`.
 * ★ The AI draft is stored in `growth_ai_request.response_text` and must be
 *   explicitly published by calling `publishLandingPage`.
 */
export async function draftLandingPageCopy(
  tx, {
    tenantId,
    landingPageId,
    prompt,
    responseText,
    requestedById,
    actorUserId = null,
  }
) {
  if (!prompt || typeof prompt !== "string") {
    throw invalid("prompt is required");
  }
  if (!responseText || typeof responseText !== "string") {
    throw invalid("response text is required");
  }

  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;

  try {
    await run(tx, db
      .insertInto("keystone.growth_ai_request")
      .values({
        id,
        tenant_id: tenantId ?? null,
        landing_page_id: landingPageId ?? null,
        requested_by: requestedById ?? null,
        prompt: prompt ?? null,
        response_text: responseText ?? null,
        request_status: "completed",
        completed_at: sql`now()`,
      }));
  } catch (e) {
    if (e.code === FOREIGN_KEY_VIOLATION) {
      throw invalid(`invalid reference: ${e.constraint ?? e.message}`);
    }
    throw e;
  }

  // ★★ RUN-2 T19 (26 Sep 2026) — was topic "growth.ai_draft_created": two segments, so it failed the
  //   event table's `section.object.verb` CHECK as well as the catalogue — every AI draft request threw.
  //   The subject is the landing page the draft is FOR; the request row id travels in the payload.
  await emit(tx, {
    tenantId,
    topic: "growth.landing_page.drafted",
    emittedBy: SECTION,
    subjectType: "landing_page",
    subjectId: landingPageId,
    actor: userActor(actorUserId),
    payload: { ai_request_id: id, status: "completed" },
  });

  return {
    id,
    tenant_id: tenantId,
    landing_page_id: landingPageId,
    requested_by: requestedById,
    prompt,
    response_text: responseText,
    request_status: "completed",
    error_message: null,
    created_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  };
}

/**
 * Publish a landing page by moving a draft (from growth_ai_request) to published content.
 * ★★★ THIS IS THE ONLY FUNCTION THAT CAN MOVE A PAGE FROM DRAFT TO PUBLISHED.
 * ★ It must be called explicitly by a person action, never automatically.
 * ★ Takes the content from `growth_ai_request.response_text` and writes it to
 *   `landing_page.body`, sets `is_published = true`, and sets `published_at = now()`.
 */
export async function publishLandingPage(
  tx, {
    tenantId,
    landingPageId,
    aiRequestId,
    actorUserId = null,
  }
) {
  // Verify the AI request exists and belongs to this landing page + tenant
  const aiReq = await run(tx, db
    .selectFrom("keystone.growth_ai_request")
    .select(["response_text"])
    .where("id", "=", aiRequestId)
    .where("landing_page_id", "=", landingPageId)
    .where("tenant_id", "=", tenantId));

  if (aiReq.rowCount === 0) {
    throw notFound("no such AI draft for this landing page in this organisation");
  }

  const responseText = aiReq.rows[0].response_text;

  // Update the landing page: set body, is_published, and published_at
  const r = await run(tx, db
    .updateTable("keystone.landing_page")
    .set({
      body: responseText ?? null,
      is_published: true,
      published_at: sql`now()`,
      updated_at: sql`now()`,
    })
    .where("id", "=", landingPageId)
    .where("tenant_id", "=", tenantId)
    .returning(["id"]));

  if (r.rowCount === 0) throw notFound("no such landing page in this organisation");

  await emit(tx, {
    tenantId,
    topic: "growth.landing_page.published",
    emittedBy: SECTION,
    subjectType: "landing_page",
    subjectId: landingPageId,
    actor: userActor(actorUserId),
    payload: { ai_request_id: aiRequestId, is_published: true },
  });

  return { id: landingPageId, is_published: true };
}
