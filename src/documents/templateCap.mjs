// THE MONTHLY TEMPLATE CAP, island side (Run 8, the maintainer 11 Oct 2026; specs/proofs/stage-t/run8/TEMPLATE-CAP.md). The island does not know plans: it asks the host through the entitlements port
// (`assertMayCreateTemplate`) before a NEW template is made, and writes one line in its own insert-only ledger after. The ONLY three functions that insert a new template family
// (savePdfTemplate, clonePdfTemplate, createTemplate) call these two, so every path — screens, API, SDKs, CLI, MCP, plays, Scribe — passes the same check.
// A host with no plans (self-hosted, an organisation on no Docustay plan) supplies no check: nothing is limited. A new VERSION never comes here.
import { ports } from "./ports.mjs";
import { emit, userActor } from "../events/outbox.mjs";

/** Refuses (403 `plan_template_limit`, with the count and the reset) when the workspace's plan has used its new templates this month. Call BEFORE anything is stored. */
export async function beforeNewTemplate(tx, { tenantId }) {
  const P = await ports();
  await P.entitlements?.assertMayCreateTemplate?.(tx, { tenantId });
}

/** One ledger line for the template just made (deleting the template never removes it), then the host's 4-of-5 / 5-of-5 notices. */
export async function afterNewTemplate(tx, { tenantId, templateId, kind = "document", how = null, actorUserId = null, emitCreated = true }) {
  // R13-D444: one line per template FAMILY. Customize-then-Save stored a second row of the same family and counted it again (5 of 5 after three templates).
  const { rowCount } = await tx.query(
    `INSERT INTO keystone.document_template_creation (tenant_id, template_id, kind, how)
       SELECT $1, $2, $3, $4 WHERE NOT EXISTS (SELECT 1 FROM keystone.document_template_creation c JOIN keystone.document_template o ON o.id = c.template_id
                                               JOIN keystone.document_template n ON n.id = $2 WHERE o.family_id = n.family_id)
       ON CONFLICT (tenant_id, template_id) DO NOTHING`,
    [tenantId, templateId, kind === "form" ? "form" : "document", how ? String(how).slice(0, 40) : null]);
  // Run 8 S6: every NEW template is announced (documents.template.created) — before, only the contract builder's createTemplate emitted it, so a webhook never heard of an uploaded, written,
  // AI-made or duplicated template. createTemplate keeps its own richer event (emitCreated: false). No name in the payload (it goes to webhook endpoints).
  if (rowCount && emitCreated) await emit(tx, { tenantId, topic: "documents.template.created", emittedBy: "documents", subjectType: "document_template", subjectId: templateId,
    actor: actorUserId ? userActor(actorUserId) : "system", payload: { builder: "pdf", version: 1, kind: kind === "form" ? "form" : "document", how: how ? String(how).slice(0, 40) : null } });
  const P = await ports();
  await P.entitlements?.noteTemplateCreated?.(tx, { tenantId });
}

/** New templates made in [periodStart, periodEnd) in the current workspace (row security scopes it). */
export async function templateCreationsInPeriod(tx, { periodStart, periodEnd }) {
  const { rows: [r] } = await tx.query(`SELECT count(*)::int AS n FROM keystone.document_template_creation WHERE created_at >= $1 AND created_at < $2`, [periodStart, periodEnd]);
  return r?.n ?? 0;
}

/** A form counts as a document in the month it is FIRST published: true when this call is that first time (a row is written), false after. */
export async function markFormFirstPublished(tx, { tenantId, familyId }) {
  const { rowCount } = await tx.query(`INSERT INTO keystone.document_form_publication (tenant_id, family_id) VALUES ($1, $2) ON CONFLICT (tenant_id, family_id) DO NOTHING`, [tenantId, familyId]);
  return rowCount > 0;
}
export async function formEverPublished(tx, { familyId }) {
  const { rows } = await tx.query(`SELECT 1 FROM keystone.document_form_publication WHERE family_id = $1`, [familyId]);
  return rows.length > 0;
}
