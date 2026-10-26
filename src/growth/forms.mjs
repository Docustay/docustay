// @ts-check
// src/growth/forms.mjs — Form definition, validation, and submission pipeline.
//
// Form definitions are stored in landing_page.body as JSON.
// On submit: person upsert (dedupe by email) + consent_record + funnel_event + task + segment tag.
// Enumeration safety: POST /go/f/:formSlug and POST /go/subscribe/:tenantSlug return 200 with
// byte-identical bodies whether the email is known or unknown.

import { findPossibleDuplicate, createPerson } from "../people/writes.mjs";
import { emit } from "../events/outbox.mjs";
import { notFound } from "../http/errors.mjs";
import { db as kdb, run } from "../db/kysely.mjs";
import { sql } from "kysely";

/**
 * Validate and parse a form definition from landing_page.body JSON.
 * The form definition object must include:
 *   - fields: array of { key, label, type, required }
 *   - consentRequired: boolean (marketing forms require marketing consent)
 *
 * @param {object} formDef - The form definition from landing_page.body
 * @returns {object} Validated form definition, or throws
 */
function validateFormDefinition(formDef) {
  if (!formDef || typeof formDef !== "object") {
    throw new Error("form definition is not an object");
  }

  if (!Array.isArray(formDef.fields)) {
    throw new Error("form.fields must be an array");
  }

  // Validate each field
  for (const field of formDef.fields) {
    if (!field.key || typeof field.key !== "string") {
      throw new Error("form field must have a key");
    }
    if (!field.label || typeof field.label !== "string") {
      throw new Error("form field must have a label");
    }
    if (!["text", "email", "phone", "custom"].includes(field.type)) {
      throw new Error(`form field type must be one of: text, email, phone, custom`);
    }
  }

  return formDef;
}

/**
 * Submit a form: upsert person by email, create consent_record, funnel_event, and emit events.
 *
 * ★★★ ENUMERATION SAFETY: This function must NOT leak whether the email was found or created.
 *      The HTTP layer returns the same 200 response body regardless.
 *
 * ★★ CONSENT BARRIER (C4.1): The consent_record is written FIRST. If consent is not checked,
 *     the request returns 400 and NO lead data (funnel_event) is stored at all.
 *
 * @param {object} tx - Database transaction
 * @param {string} tenantId - Tenant UUID
 * @param {string} formSlug - Form slug (for consent detail)
 * @param {object} data - Submitted form data { email, firstName, ...customFields }
 * @param {boolean} consent - Whether marketing consent was checked
 * @param {string} ip - Client IP address
 * @param {string} userAgent - Client User-Agent
 * @returns {object} { personId, consentId, personIsNew, success }
 */
export async function submitForm(tx, tenantId, formSlug, data, consent, ip, userAgent) {
  // ★ CONSENT IS REQUIRED — fail early, before any database writes
  if (consent !== true) {
    const error = new Error("consent is required");
    error.statusCode = 400;
    throw error;
  }

  // ★ Normalize and validate data
  const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
  const firstName = typeof data.firstName === "string" ? data.firstName.trim() : "";
  // ★★★ [TY, RULED 2 Oct 2026] EMAIL AND PHONE ARE BOTH REQUIRED FOR EVERY PERSON — createPerson
  //   (src/people/writes.mjs) now enforces this unconditionally. Same flat-key convention this
  //   function already uses for `data.email`/`data.firstName` (this function has never looked up a
  //   form's own field-key mapping — it was never built to).
  const phone = typeof data.phone === "string" ? data.phone.trim() : "";

  if (!email || !email.includes("@")) {
    const error = new Error("email is required and must be valid");
    error.statusCode = 400;
    throw error;
  }
  if (!phone) {
    const error = new Error("phone is required");
    error.statusCode = 400;
    throw error;
  }

  // ★★★ RECORD CONSENT FIRST — This is the transactional barrier.
  //      If anything after this fails, the consent_record still exists.
  const consentDetail = `form ${formSlug} — ${email}`;
  const consentResult = await run(tx, kdb
    .insertInto("keystone.consent_record")
    .values({
      tenant_id: tenantId ?? null,
      consent_type: "marketing",
      ip_address: ip ?? null,
      user_agent: userAgent ?? null,
      consent_method: "web_form",
      is_active: true,
      detail: consentDetail ?? null,
      created_at: sql`now()`
    })
    .returning(["id"])
  );

  const consentId = consentResult.rows[0].id;

  // ★ Find or create the person (person upsert, dedupe by email)
  const possibleDuplicate = await findPossibleDuplicate(tx, {
    tenantId,
    displayName: firstName,
    email,
    mobilePhone: phone,
  });

  let personId;
  let personIsNew = false;

  if (possibleDuplicate) {
    personId = possibleDuplicate.id;
    // If the person exists, emit a merge-suggestion event
    // (handled by the event listener, not here)
  } else {
    const person = await createPerson(tx, {
      tenantId,
      email,
      displayName: firstName,
      firstName,
      mobilePhone: phone,
      role: "adult_client",
      lifecycleStatus: "lead",
      source: `form:${formSlug}`,
      actorUserId: null,
    });
    personId = person.id;
    personIsNew = true;
  }

  // ★ Link the consent_record to the person
  await run(tx, kdb
    .updateTable("keystone.consent_record")
    .set({ person_id: personId ?? null })
    .where("id", "=", consentId)
  );

  // ★ Record funnel event (NO PII in metadata)
  await run(tx, kdb
    .insertInto("keystone.funnel_event")
    .values({
      tenant_id: tenantId ?? null,
      event_type: "conversion",
      person_id: personId ?? null,
      metadata: JSON.stringify({}) ?? null,
      created_at: sql`now()`
    })
  );

  // ★ Emit forms.form.submitted event
  await emit(tx, {
    tenantId,
    topic: "forms.form.submitted",
    emittedBy: "forms",
    subjectType: "person",
    subjectId: personId,
    actor: "system", // RUN-2: was { type: "public" } — not an actor shape emit() accepts (anonymous = "system", publicBooking.mjs:708)
    payload: { person_id: personId, form_slug: formSlug },
  });

  // ★ Task 20.48: Emit growth.subscribe.joined when someone agrees to marketing consent via form
  await emit(tx, {
    tenantId,
    topic: "growth.subscribe.joined",
    emittedBy: "growth",
    subjectType: "person",
    subjectId: personId,
    actor: "system", // RUN-2: was { type: "public" } — not an actor shape emit() accepts (anonymous = "system", publicBooking.mjs:708)
    payload: { person_id: personId, form_slug: formSlug, consent_id: consentId },
  });

  // ★ RUN-2 (26 Sep 2026): a second `people.person.created` emit stood here, as section "growth" —
  //   emit() refuses a section emitting another's topic, so every form submission that created a
  //   person threw and rolled back. createPerson (src/people/writes.mjs:404) already emits it, once.

  return {
    personId,
    consentId,
    personIsNew,
    success: true,
  };
}

/**
 * Generic response body for form submission.
 * This is byte-identical whether the email was known or unknown (enumeration safety).
 * @returns {object}
 */
export function getFormSubmitResponse() {
  return {
    success: true,
    message: "Check your inbox — we'll send a confirmation link if this email is new.",
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// FORM TEMPLATE PERSISTENCE (F20 / Task 20.47) — Coach builds and saves marketing form definitions.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Create a new form template.
 * @param {object} db - Database connection
 * @param {string} tenantId - Tenant UUID
 * @param {object} form - { title, slug, fields, consentRequired }
 * @param {string} actorUserId - Coach's user ID
 * @returns {object} { id, title, slug, fields, consentRequired, createdAt }
 */
export async function createFormTemplate(db, tenantId, form, actorUserId) {
  const { title, slug, fields, consentRequired } = form;

  if (!title || !slug) {
    const error = new Error("title and slug are required");
    error.statusCode = 400;
    throw error;
  }

  if (!Array.isArray(fields)) {
    const error = new Error("fields must be an array");
    error.statusCode = 400;
    throw error;
  }

  // ★ Validate each field
  validateFormDefinition({ fields, consentRequired });

  const { rows: [result] } = await db.query(
    `INSERT INTO keystone.growth_form_template
     (tenant_id, title, slug, fields, consent_required, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now(), now())
     RETURNING id, title, slug, fields, consent_required as "consentRequired", created_at as "createdAt"`,
    [tenantId, title, slug, JSON.stringify(fields), consentRequired !== false, actorUserId]
  );

  return result;
}

/**
 * Update a form template.
 * @param {object} db - Database connection
 * @param {string} tenantId - Tenant UUID
 * @param {string} formId - Form template UUID
 * @param {object} updates - { title?, slug?, fields?, consentRequired? }
 * @returns {object} Updated form template
 */
export async function updateFormTemplate(db, tenantId, formId, updates) {
  const { title, slug, fields, consentRequired } = updates;

  // ★ Validate fields if provided
  if (fields !== undefined) {
    if (!Array.isArray(fields)) {
      const error = new Error("fields must be an array");
      error.statusCode = 400;
      throw error;
    }
    validateFormDefinition({ fields, consentRequired: consentRequired !== false });
  }

  // Build dynamic update query
  const setClauses = [];
  const params = [tenantId, formId];
  let paramIndex = 3;

  if (title !== undefined) {
    setClauses.push(`title = $${paramIndex++}`);
    params.push(title);
  }
  if (slug !== undefined) {
    setClauses.push(`slug = $${paramIndex++}`);
    params.push(slug);
  }
  if (fields !== undefined) {
    setClauses.push(`fields = $${paramIndex++}`);
    params.push(JSON.stringify(fields));
  }
  if (consentRequired !== undefined) {
    setClauses.push(`consent_required = $${paramIndex++}`);
    params.push(consentRequired !== false);
  }

  if (setClauses.length === 0) {
    const error = new Error("no fields to update");
    error.statusCode = 400;
    throw error;
  }

  setClauses.push(`updated_at = now()`);

  const query = `UPDATE keystone.growth_form_template
                 SET ${setClauses.join(", ")}
                 WHERE tenant_id = $1 AND id = $2
                 RETURNING id, title, slug, fields, consent_required as "consentRequired", updated_at as "updatedAt"`;

  const { rows: [result] } = await db.query(query, params);
  if (!result) throw notFound("no form with that id");
  return result;
}

/**
 * Get a single form template by ID.
 * @param {object} db - Database connection
 * @param {string} tenantId - Tenant UUID
 * @param {string} formId - Form template UUID
 * @returns {object} Form template
 */
export async function getFormTemplate(db, tenantId, formId) {
  const { rows: [result] } = await db.query(
    `SELECT id, title, slug, fields, consent_required as "consentRequired",
            created_at as "createdAt", updated_at as "updatedAt"
     FROM keystone.growth_form_template
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, formId]
  );

  if (!result) {
    const error = new Error("form not found");
    error.statusCode = 404;
    throw error;
  }

  return result;
}

/**
 * List all form templates for a tenant.
 * @param {object} db - Database connection
 * @param {string} tenantId - Tenant UUID
 * @returns {array} Array of form templates
 */
export async function listFormTemplates(db, tenantId) {
  const { rows: results } = await db.query(
    `SELECT id, title, slug, consent_required as "consentRequired",
            created_at as "createdAt", updated_at as "updatedAt"
     FROM keystone.growth_form_template
     WHERE tenant_id = $1
     ORDER BY created_at DESC`,
    [tenantId]
  );

  return results || [];
}
