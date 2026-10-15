// src/ports/documents.mjs — PLATFORM'S side of the Documents island's ports (see src/documents/ports.mjs). the platform plugs its own email registry + Resend, branding,
// people, booking/money facts, price authority, usage metering and agreement requirements in here, once, at startup.
import { liveHostname } from "../domains/proDomains.mjs";
import { assertAiEnvironment } from "../documents/engine/ai/gateway.mjs";
import { installDocumentsPorts } from "../documents/ports.mjs";
import { documentEventReference } from "../documents/frontDoor.mjs";
import { registerEventEnricher } from "../webhooks/enrich.mjs";
import { templateIdsInLineage } from "../documents/api.mjs";
import { sendSigningEmail } from "../email/signLinkEmail.mjs";
import { getSetting } from "../settings/writes.mjs";
import { APP_DOMAIN_VAR } from "../auth/tenantFromHost.mjs";
import { bookingFactsFor, invoiceFactsFor, subscriptionFactsFor } from "../booking/facts.mjs";
import { recordUsage } from "../billing/usage.mjs";
import { renderSigningEmail } from "../email/signLinkEmail.mjs";
import { aiPolicy as planAiPolicy, assertMaySend as planAssertMaySend, sendAllowance as planSendAllowance, assertMayCreateTemplate as planAssertMayCreateTemplate, noteTemplateCreated as planNoteTemplateCreated, assertEntitled as planAssertEntitled, currentPlan as planCurrent , communityRefuses } from "../product/docustay.mjs";
import { entitled as planEntitled } from "../product/docustayPlans.mjs";
import * as documentsMail from "./documentsMail.mjs";
import { renderTemplate } from "../email/templates.mjs";
import { sealSecret, openSecret, CURRENT_KEK_VERSION } from "../secrets/envelope.mjs";
import { assertMay } from "../permissions/assertMay.mjs";
import { files, converter } from "./documentsFiles.mjs";
import { payments } from "./documentsPayments.mjs";
import { demoRow, aiMode, refundAiPrompt, checkUpload } from "../product/demo.mjs";
import { trackOnce } from "../product/analytics.mjs";
// Launch step 8/6 (both OPTIONAL ports: Docustay lifted out may omit them): the public demo's limits and the product's usage events. The island asks; the host answers.
const demo = { isDemo: async (tx) => Boolean(await demoRow(tx)), aiMode, refundAiPrompt, checkUpload };
const events = { firstDocumentSent: async (tx, { tenantId }) => { if (!(await demoRow(tx))) await trackOnce(tx, tenantId, "first_document_sent").catch(() => {}); } };

const appDomain = () => process.env[APP_DOMAIN_VAR] || "example.com";
// a workspace is reached at <slug>.<app domain> (wildcard DNS). A Railway-provided domain (*.up.railway.app) cannot have a wildcard, so there the bare host is the public base.
// a self-hosted install is one organisation on one address: KEYSTONE_PUBLIC_URL (https://sign.example.com) is the base of every link it emails
const publicBaseFor = (slug) => process.env.KEYSTONE_PUBLIC_URL ? process.env.KEYSTONE_PUBLIC_URL.replace(/\/+$/, "") : (/\.up\.railway\.app$/i.test(appDomain()) ? `https://${appDomain()}` : `https://${slug ?? ""}.${appDomain()}`);

/** Which address carries a workspace's links (sign, reminder, signed-copy download, verify). D-010 / D-101: a Docustay workspace belongs on Docustay's signing host (KEYSTONE_DOCUSTAY_SIGN_URL). The worker builds
 *  the signed-copy and reminder links, and a worker started without that variable used to fall back to the APP host in silence — every emailed link then pointed at the wrong site. The fallback still happens
 *  (a dead link is no worse than a failed send) but it is loud: one error line per process says which variable is missing. */
let warnedMissingDocustayBase = false;
export function chooseDocumentsBase({ own, docustay, docustayBase, fallback, warn = (m) => console.error(m) }) {
  if (own) return `https://${own}`;
  if (docustay && docustayBase) return docustayBase;
  if (docustay && !warnedMissingDocustayBase) { warnedMissingDocustayBase = true; warn("KEYSTONE_DOCUSTAY_SIGN_URL is not set on this service: links in emails for Docustay workspaces fall back to the app address and will not open the signing site. Set it to the same value the app uses."); }
  return fallback();
}
export const _resetMissingBaseWarning = () => { warnedMissingDocustayBase = false; };

// the mail port: the signing email (with the organisation's sending identity), a plain `send` for anything else the island mails, the environment backstop, and the sending-domain API (Resend)
const mailer = {
  sendSigningEmail, renderSigningEmail,
  // the host's template renderer (tenant overrides from Run → Templates win): the island asks for its own wordings by key
  renderTemplate: (tx, { tenantId, key, vars }) => renderTemplate(key, vars, {}, { tx, tenantId }),
  send: documentsMail.send, routeRecipient: documentsMail.routeRecipient, platformSender: documentsMail.platformSender, domains: documentsMail.domains,
};

// who may do what: the host's permission check
const access = {
  assertMay: (tx, principal, check, args) => assertMay(tx, principal, check, args),
};

// the host's encrypted-secret store (envelope encryption, closed purpose list, KEK rotation) — the island keeps the envelopes in its own table
const secrets = {
  seal: ({ tenantId, purpose, plaintext }) => { const e = sealSecret({ plaintext, tenantId, purpose }); return { envelope: e, fingerprint: e.fingerprint, kekVersion: CURRENT_KEK_VERSION }; },
  open: ({ envelope, tenantId, purpose, kekVersion }) => openSecret(envelope, { tenantId, purpose, kekVersion }),
};

const brand = {
  async get(tx, { tenantId }) {
    const { rows } = await tx.query(`SELECT name, slug, timezone, product FROM keystone.tenant WHERE id = $1`, [tenantId]);
    const t = rows[0] ?? {};
    // the practice's PUBLIC brand name (an example organisation), not the legal tenant name — the sign-link email is brand-facing
    const practiceName = (await getSetting(tx, "practice.name", null)) || t.name || "";
    const logoUrl = await getSetting(tx, "branding.logo_url", null);
    // §25.4: a workspace's own live hostname carries its sign / verify links; otherwise the default workspace address
    const own = await liveHostname(tx).catch(() => null);
    // ★ Part 29 (D1/D5): a Docustay workspace is Docustay everywhere a person can see — its links live on Docustay's signing host (KEYSTONE_DOCUSTAY_SIGN_URL, e.g. https://sign.docustay.app), and
    //   its pages and documents carry "Sent with Docustay" unless the workspace is on Pro and chose to hide it (the island makes that choice; it owns the setting).
    const docustay = t.product === "docustay" || process.env.KEYSTONE_PRODUCT === "docustay";
    const docustayBase = process.env.KEYSTONE_DOCUSTAY_SIGN_URL ? process.env.KEYSTONE_DOCUSTAY_SIGN_URL.replace(/\/+$/, "") : null;
    const publicBase = chooseDocumentsBase({ own, docustay, docustayBase, fallback: () => publicBaseFor(t.slug) });
    return { practiceName, logoUrl, tenantName: t.name ?? "", slug: t.slug ?? "", timezone: t.timezone ?? "UTC", publicBase, productName: docustay ? "Docustay" : "Workbench", ...(docustay ? { footerBrand: "Sent with Docustay" } : {}) };
  },
};

const people = {
  async byIds(tx, ids) {
    if (!ids?.length) return [];
    const { rows } = await tx.query(`SELECT id, display_name, email, role, staff_role FROM keystone.app_user WHERE id = ANY($1::uuid[])`, [ids]);
    return rows;
  },
  async guardianOf(tx, childId) {
    // the subject's guardian(s) from keystone.guardian — first with an email, ordered so the choice is deterministic
    const { rows } = await tx.query(
      `SELECT u.id, u.email, u.display_name FROM keystone.guardian g JOIN keystone.app_user u ON u.id = g.guardian_user_id
        WHERE g.child_user_id = $1 AND u.email IS NOT NULL AND btrim(u.email) <> '' ORDER BY g.created_at ASC, u.id ASC LIMIT 1`, [childId]);
    return rows[0] ?? null;
  },
  // pick a recipient: people in this practice by name or email (the viewer's own visibility applies — the directory view is tenant-scoped)
  async search(tx, { q = "", limit = 20 } = {}) {
    const like = `%${String(q).trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const { rows } = await tx.query(
      `SELECT id, display_name, email, role FROM keystone.person_directory WHERE (display_name ILIKE $1 OR email ILIKE $1) ORDER BY display_name LIMIT $2`, [like, Math.min(Number(limit) || 20, 50)]);
    return rows;
  },
  // the practice's owner (CLAUDE.md: every practice has one) — the author of documents made from a public self-serve link
  async practiceOwner(tx) {
    const { rows } = await tx.query(`SELECT id FROM keystone.app_user WHERE role = 'staff' AND staff_role = 'owner' ORDER BY created_at, id LIMIT 1`);
    return rows[0]?.id ?? null;
  },
  async ownerOf(tx, personId) {
    const { rows } = await tx.query(`SELECT owner_user_id FROM keystone.app_user WHERE id = $1`, [personId]);
    return rows[0]?.owner_user_id ?? null;
  },
};

const facts = {
  async gather(tx, { tenantId, personId, subjectId, bookingId, invoiceId, audience = "admin" }) {
    const out = {};
    if (tenantId) {
      const { rows: [tenant] } = await tx.query(
        // tenant has no address or booking-link column and no setting holds either (F-R2-5)
        `SELECT id, name, timezone, NULL::text AS address, NULL::text AS "bookingLink",
                to_char(now() AT TIME ZONE timezone, 'FMDD Month YYYY') AS sent_on FROM keystone.tenant WHERE id = $1`, [tenantId]);
      out.tenant = tenant;
      const { rows: settingRows } = await tx.query(`SELECT key, value FROM keystone.tenant_setting WHERE tenant_id = $1`, [tenantId]);
      out.settings = Object.fromEntries(settingRows.map((r) => [r.key, r.value]));
    }
    const pid = personId || subjectId;
    if (pid) {
      const { rows: [person] } = await tx.query(
        `SELECT id, first_name, display_name, email, mobile_phone AS phone, role,
                CASE WHEN firebase_uid IS NOT NULL THEN 'active' ELSE 'not signed in yet' END AS portal_status, lifecycle_status AS stage
           FROM keystone.app_user WHERE id = $1 AND tenant_id = $2`, [pid, tenantId]);
      out.person = person;
    }
    const timeZone = out.tenant?.timezone;
    if (bookingId) { const b = await bookingFactsFor(tx, { tenantId, bookingId, timeZone }); if (b) out.nextBooking = b; }
    // money facts only for an audience that may see money (a staff-audience render issues ZERO money queries)
    if (invoiceId && audience !== "staff") out.invoice = await invoiceFactsFor(tx, { tenantId, invoiceId, timeZone });
    if (tenantId && pid && audience !== "staff") out.subscription = await subscriptionFactsFor(tx, { tenantId, subjectId: pid, timeZone });
    return out;
  },
  async gatherBatch(tx, tenantId, personIds) {
    const { rows: list } = await tx.query(
      `SELECT id, first_name, display_name, email, mobile_phone AS phone, role,
              CASE WHEN firebase_uid IS NOT NULL THEN 'active' ELSE 'not signed in yet' END AS portal_status, lifecycle_status AS stage
         FROM keystone.app_user WHERE id = ANY($1)`, [personIds]);
    const { rows: [tenant] } = await tx.query(
      `SELECT id, name, timezone, NULL::text AS address, NULL::text AS "bookingLink" FROM keystone.tenant WHERE id = $1`, [tenantId]);
    const { rows: settingRows } = await tx.query(`SELECT key, value FROM keystone.tenant_setting WHERE tenant_id = $1`, [tenantId]);
    return { tenant, settings: Object.fromEntries(settingRows.map((r) => [r.key, r.value])), people: new Map(list.map((p) => [p.id, p])) };
  },
};

const price = {
  async current(tx, { tenantId, subjectType, subjectId }) {
    const { rows } = await tx.query(
      `SELECT id, amount_minor, currency, effective_from FROM keystone.price
        WHERE tenant_id = $1 AND subject_type = $2 AND subject_id = $3 AND effective_to IS NULL ORDER BY effective_from DESC LIMIT 1`,
      [tenantId, subjectType, subjectId]);
    return rows[0] ?? null;
  },
};

const usage = {
  // metered when an instrument with at least one signature is executed
  async recordEsign(tx, { tenantId, instanceId }) {
    await recordUsage(tx, { tenantId, metric: "esign", provider: "internal", providerRef: instanceId });
  },
};

const items = {
  async repointAgreementRequirements(tx, { tenantId, templateId, name, builder }) {
    const old = await templateIdsInLineage(tx, { tenantId, templateId, name, builder });
    if (!old.length) return;
    await tx.query(`UPDATE keystone.item_agreement_requirement SET template_id = $2 WHERE tenant_id = $1 AND template_id = ANY($3::uuid[])`, [tenantId, templateId, old]);
  },
};

const notices = {
  async sentToEmails(db, { instanceId }) {
    const { rows } = await db.query(
      `SELECT DISTINCT u.email FROM keystone.notification n JOIN keystone.event e ON e.id = n.event_id JOIN keystone.app_user u ON u.id = n.recipient_id
        WHERE e.subject_type = 'document' AND e.subject_id = $1 AND e.topic = 'documents.document.sent' AND u.email IS NOT NULL`, [instanceId]);
    return rows.map((r) => r.email);
  },
};

// the hosted plan's monthly document limit (Docustay workspaces); organisations on no Docustay plan are never limited
const entitlements = {
  assertMaySend: (tx, a) => planAssertMaySend(tx, a),
  // Run 8 R8-64: read-only, for the Check step — this month's sends against the plan's limit (null = no limit)
  sendAllowance: (tx, a) => planSendAllowance(tx, a),
  // Run 8: the Free plan's 5 new templates a month (the island calls it before every NEW template, and the notice after)
  assertMayCreateTemplate: (tx, a) => planAssertMayCreateTemplate(tx, a),
  noteTemplateCreated: (tx, a) => planNoteTemplateCreated(tx, a),
  // the six Pro items (Part 29): one question and one refusal, both answered by the plan; a workspace on no Docustay plan is never limited
  assertEntitled: (tx, a) => planAssertEntitled(tx, a),
  // the biggest upload the plan allows (Free 25 MB, Pro 100 MB); null for an organisation on no Docustay plan, which the island's own setting then limits
  maxUploadMb: async (tx, { tenantId }) => (await planCurrent(tx, { tenantId }))?.uploadMb ?? null,
  aiPolicy: (tx, a) => planAiPolicy(tx, a),
  aiDraftsPerMonth: async (tx, { tenantId }) => (await planCurrent(tx, { tenantId }))?.aiDraftsPerMonth ?? null,
  isEntitled: async (tx, { tenantId, item }) => { const plan = await planCurrent(tx, { tenantId }); return plan ? planEntitled(plan, item) : !communityRefuses(item); },
};
// the web process cannot reach the queue (it holds only the app_rw identity), so the sealed copy is made in the signing process itself, as the sender, in its own transaction
const queue = {
  runAs: async ({ tenantId, userId }, fn) => { const { withTenant } = await import("../db/index.mjs"); return withTenant(tenantId, fn, userId ? { userId } : undefined); },
};
// the host's email template store: a workspace's own wording for the emails the host sends (completed copy, declined, expired) is a new ACTIVE version of that template (the older ones stay, as Run → Templates keeps them)
const templates = {
  async override(tx, { tenantId, key, subject, text, userId = null }) {
    const { rows: [prev] } = await tx.query(`SELECT max(version) AS v, (array_agg(family))[1] AS family FROM keystone.email_template WHERE tenant_id = $1 AND key = $2`, [tenantId, key]);
    await tx.query(`UPDATE keystone.email_template SET active = false WHERE tenant_id = $1 AND key = $2 AND active`, [tenantId, key]);
    await tx.query(`INSERT INTO keystone.email_template (tenant_id, key, family, subject, text_body, html_body, version, origin, active, created_by) VALUES ($1,$2,$3,$4,$5,'',$6,'edited',true,$7)`,
      [tenantId, key, prev?.family ?? key.split(".")[0], subject, text, (prev?.v ?? 0) + 1, userId]);
  },
  async clear(tx, { tenantId, key }) { await tx.query(`UPDATE keystone.email_template SET active = false WHERE tenant_id = $1 AND key = $2 AND active`, [tenantId, key]); },
};
const hostDocumentsPorts = Object.freeze({ queue, entitlements, mailer, brand, people, facts, price, usage, items, notices, access, secrets, files, converter, payments, templates, demo, events });
// a document's webhooks carry the developer's own reference (metadata, externalId, and per-seat refs) beside the ordinary payload
// Run 7: every document webhook says where the document came from — `source: "form"` with the form ({ id, name }) for a form response, `source: "sent"` otherwise
// FP-C1 — what a document webhook carries besides the event. Read through the viewer-free lookup: the delivery job has no viewer, and the old read (documentReference + formOfDocument) saw no row, so no delivery ever carried these (11 Oct 2026, migration 0713).
const documentEventExtra = async (tx, event) => { if (!event.subject_id) return null; const r = await documentEventReference(tx, { instanceId: event.subject_id }); if (!r) return null; return { externalId: r.externalId, metadata: r.metadata, parties: r.parties, test: r.test, source: r.source, form: r.form, $omit: PRIVATE_EVENT_KEYS }; };
// what a receiver outside the workspace cannot use and should not see: the workspace's own internal person ids (who sent, who finished, who archived). They stay in the event for the workspace's own listeners.
const PRIVATE_EVENT_KEYS = ["sent_by", "executed_by", "archive_actor_id", "appUserId"];
export function installHostDocumentsPorts() { assertAiEnvironment(); /* the test AI provider must never be on in production: refuse to start */ installDocumentsPorts(hostDocumentsPorts); registerEventEnricher("document", documentEventExtra); }
