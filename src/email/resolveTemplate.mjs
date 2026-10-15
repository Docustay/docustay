// @ts-check
import { TEMPLATE_REGISTRY_BY_KEY } from "./registry.mjs";
import { renderLiquidSide } from "./liquidRenderer.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

/**
 * ★★★ RESOLVE A TEMPLATE TO USE — ACTIVE TENANT OVERRIDE OR SHIPPED DEFAULT.
 *
 * ONE RESOLVER used by renderTemplate (queue), the callback (n8n), and campaign sends.
 * Resolution applies terminology at render time (the server-side resolver rule, F18.31), and a
 * send freezes what it resolved to.
 *
 * ★★ PART 2 (worker-failures brief, 1 Oct 2026) — BOTH branches now render through
 *    `src/email/liquidRenderer.mjs`, the ONE renderer Run → Templates / test-send / (Part 3) the
 *    invoice editor's Email tab also use. The tenant-override branch used to be `{name}`
 *    single-brace mustache text with its own hand-rolled `fill()`; the shipped branch used to be
 *    a JS template-literal function from `defaultTemplates/index.mjs` — two different formats for
 *    one fact, which is the exact thing the maintainer's brief named ("default content in the SAME FORMAT as
 *    tenant edits"). MEASURED before changing it: zero `keystone.email_template` rows were active
 *    anywhere in production (every real tenant still runs the shipped default) — there was
 *    nothing to migrate, so this is a clean cutover to Liquid for both, not a data migration.
 *
 * @param {Object} tx — the withTenant handle (exposes `query`)
 * @param {string} tenantId — tenant UUID
 * @param {string} key — template key (e.g. 'booking.reminder')
 * @returns {Promise<{version, origin, subject, text, html}>} template object with subject/text/html functions
 * @throws when the key is not in the template registry
 */
export async function resolveTemplate(tx, tenantId, key) {
  if (!TEMPLATE_REGISTRY_BY_KEY[key]) {
    throw new Error(
      `"${key}" is not a template key. Known keys are in src/email/registry.mjs. ` +
      `Custom keys must start with 'custom.'.`
    );
  }

  // ★ TRY TENANT OVERRIDE FIRST — active row, one per key (database-enforced). `tx` is the
  //   withTenant handle, which exposes `query` only. Stored as Liquid source now, same format as
  //   the shipped default — `subject`/`text_body` columns hold `{{ var }}` syntax, not `{var}`.
  const { rows } = await run(tx, db
    .selectFrom("keystone.email_template")
    .select(["subject", "text_body", "html_body", "version", "origin"])
    .where("tenant_id", "=", tenantId)
    .where("key", "=", key)
    .where("active", "=", true));
  const override = rows[0];

  const liquidOverride = override
    ? { subjectSrc: override.subject, bodySrc: override.text_body }
    : undefined;

  // ★ RETURN SHAPE MATCHES TEMPLATES IN src/email/templates.mjs — subject/text/html are plain
  //   SYNCHRONOUS functions (LiquidJS's `parseAndRenderSync`, no async filters anywhere in this
  //   project's templates) — `renderTemplate()`'s existing `tpl.subject(vars, t)` /
  //   `tpl.text(vars, t)` calling convention is unchanged, so this is a drop-in replacement for
  //   both branches, not a caller-side migration.
  return {
    version: override?.version ?? 1,
    origin: override?.origin ?? "shipped",
    subject: (vars, t) => renderLiquidSide(key, "subject", vars, t, liquidOverride),
    text: (vars, t) => renderLiquidSide(key, "body", vars, t, liquidOverride),
    html: () => "", // ★ unchanged — dead weight since F834 wraps every send in a branded HTML frame
  };
}

// ◆ 20.55 ALIASES — legacy email template variable names map to catalogue names
export const EMAIL_ALIASES = Object.freeze({
  recipientName: 'person.first_name',
  invoiceNumber: 'money.invoice.number',
  amount: 'money.invoice.amount',
  serviceName: 'booking.next.service',
  practiceName: 'practice.name',
  documentTitle: 'document.title',
});

export const DIRECT_CONTEXT = Object.freeze(new Set([
  'acceptUrl', 'answerBy', 'body', 'code', 'creditStanding', 'daysPastDue', 'dueLocal',
  'duration', 'expiresOn', 'hostName', 'inviterName', 'link', 'minutes', 'month',
  'outstandingAmount', 'paymentCount', 'personalLine', 'reason', 'reasonLine',
  'refundAmount', 'remaining', 'revenue', 'reviewLink', 'senderName', 'sessionsRemaining',
  'subject', 'toldOthers', 'timeZone', 'unsubscribeUrl', 'what', 'when', 'whenLocal', 'why',
]));
