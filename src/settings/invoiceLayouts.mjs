// P3.S13 — INVOICE PDF LAYOUTS: LIST, HIDE, SHOW.
//
// ★★★ A "LAYOUT" HERE IS A STRIPE `invoice_rendering_template` OBJECT — NOT A LOCAL ROW. Stripe
//     authors these (a practice builds them in the Stripe Dashboard); the platform only lists them,
//     and lets a practice hide (archive) or show (unarchive) one from the picker. There is no
//     migration and no local table — the list IS the Stripe list, live, every time it is asked for.
//
// WIRING-MAP rows W10 (this file's three functions) — GET /invoice_rendering_templates (NEW READ),
// POST …/{template}/archive and …/unarchive (NEW control), both `setting.edit`.
//
// Stripe reference: GET /v1/invoice_rendering_templates · POST …/{template}/archive · …/unarchive.

import { invalid, dependency } from "../http/errors.mjs";
import { stripeConnectedRequest } from "../money/stripeConnected.mjs";
import { emit, userActor } from "../events/outbox.mjs";

const SECTION = "settings";

/**
 * ★ LIST — every invoice rendering template Stripe holds for this practice's connected account,
 *   newest first, following `has_more` (`payouts.mjs`'s own pagination idiom — `limit: 100` plus
 *   `starting_after` until Stripe says there is no more).
 *
 * ★★ FIELD 8(c): THIS IS THE ONE READ THAT NEVER THROWS. A practice with no reachable Stripe
 *    account still gets a page — the picker falls back to "Default" only — so a Stripe outage
 *    does not blank the whole Money settings screen. Every OTHER failure in this file (archive,
 *    unarchive) is a real write attempt and DOES throw; only the list is softened, and only here.
 *
 * @param tx a tenant transaction
 * @param {tenantId} tenantId the practice's id
 * @param deps optional {fetchImpl, env} — same shape `stripeConnectedRequest` takes
 * @returns {Promise<{layouts: Array<{id, nickname, status}>, unavailable?: true}>}
 */
export async function listInvoiceLayouts(tx, { tenantId } = {}, deps = {}) {
  if (!tenantId) {
    throw invalid("tenantId is required");
  }

  try {
    let templates = [];
    let startingAfter = null;

    while (true) {
      const query = { limit: 100 };
      if (startingAfter) {
        query.starting_after = startingAfter;
      }

      const { body } = await stripeConnectedRequest(tx, {
        tenantId,
        method: "GET",
        path: "/invoice_rendering_templates",
        sdk: (s, o, form, query) => s.invoiceRenderingTemplates.list(query, o),
        query,
        movesMoney: false,
        purpose: "list_invoice_layouts",
        actorUserId: null,
      }, deps);

      const page = body.data || [];
      templates.push(...page);

      if (!body.has_more) break;
      if (page.length === 0) break;
      startingAfter = page[page.length - 1].id;
    }

    return {
      layouts: templates.map((t) => ({ id: t.id, nickname: t.nickname ?? null, status: t.status })),
    };
  } catch {
    // ★ Field 8(c) — a Stripe failure on the LIST is a read gone wrong, never a refused write.
    //   200, empty list, `unavailable: true` — the caller draws its own "Default only" fallback.
    return { layouts: [], unavailable: true };
  }
}

/**
 * ★ ARCHIVE (HIDE) — a layout leaves the picker. `settings.invoice_layout.archived`.
 *
 * @param tx a tenant transaction
 * @param {tenantId, templateId, actorUserId}
 * @param deps optional {fetchImpl, env}
 * @returns {Promise<{id, status}>}
 */
export async function archiveInvoiceLayout(tx, { tenantId, templateId, actorUserId = null } = {}, deps = {}) {
  if (!tenantId || !templateId) {
    throw invalid("tenantId and templateId are required");
  }

  let body;
  try {
    ({ body } = await stripeConnectedRequest(tx, {
      tenantId,
      method: "POST",
      path: `/invoice_rendering_templates/${templateId}/archive`,
      sdk: (s, o, form, query) => s.invoiceRenderingTemplates.archive(templateId, {}, o),
      movesMoney: false,
      purpose: "archive_invoice_layout",
      actorUserId,
    }, deps));
  } catch (e) {
    throw dependency(`Stripe refused this: ${e.message}`, e);
  }

  await emit(tx, {
    tenantId,
    topic: "settings.invoice_layout.archived",
    emittedBy: SECTION,
    actor: userActor(actorUserId),
    payload: { templateId },
  });

  return { id: body.id, status: body.status };
}

/**
 * ★ UNARCHIVE (SHOW) — a layout returns to the picker. `settings.invoice_layout.unarchived`.
 *
 * @param tx a tenant transaction
 * @param {tenantId, templateId, actorUserId}
 * @param deps optional {fetchImpl, env}
 * @returns {Promise<{id, status}>}
 */
export async function unarchiveInvoiceLayout(tx, { tenantId, templateId, actorUserId = null } = {}, deps = {}) {
  if (!tenantId || !templateId) {
    throw invalid("tenantId and templateId are required");
  }

  let body;
  try {
    ({ body } = await stripeConnectedRequest(tx, {
      tenantId,
      method: "POST",
      path: `/invoice_rendering_templates/${templateId}/unarchive`,
      sdk: (s, o, form, query) => s.invoiceRenderingTemplates.unarchive(templateId, {}, o),
      movesMoney: false,
      purpose: "unarchive_invoice_layout",
      actorUserId,
    }, deps));
  } catch (e) {
    throw dependency(`Stripe refused this: ${e.message}`, e);
  }

  await emit(tx, {
    tenantId,
    topic: "settings.invoice_layout.unarchived",
    emittedBy: SECTION,
    actor: userActor(actorUserId),
    payload: { templateId },
  });

  return { id: body.id, status: body.status };
}
