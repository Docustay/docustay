// QUEUE §23.2.2 — the Documents island's OWN settings, over HTTP. GET returns the typed schema + current values grouped for the screen; POST changes ONE key.
// Same shape as documentsClauses.mjs: a write ROW spread into writes.mjs's ROUTES (via itemsAndDocuments.mjs) and a read register function.
import { forbidden, invalid } from "../http/errors.mjs";
import { authoriseSection } from "../nav/authorise.mjs";
import { assertMay } from "../permissions/assertMay.mjs";
import { describeDocumentSettings, setDocumentSetting } from "../documents/settings.mjs";
import { chromeInputsFor } from "../documents/chromeInputs.mjs";
import { fakeAllowed } from "../documents/engine/ai/gateway.mjs";
import { isHostedModel } from "../documents/engine/ai/prices.mjs";
import { sampleSignedCopy } from "../documents/signedCopySample.mjs";
import { buildDocumentView } from "../documents/documentView.mjs";
import { renderPreviewPdf } from "../documents/pdf.mjs";
import { emailIdentityStatus, startEmailDomain, verifyEmailDomain, saveSmtpPassword, sendTestEmail, startEmailMailbox, removeEmailMailbox } from "../documents/frontDoor.mjs";

const SECTION = "/documents/settings";

async function saveDocumentSetting(tx, { tenantId, key, value, actorUserId = null }) {
  if (typeof key !== "string" || !key) throw invalid("key is required — name the document setting to change", { field: "key" });
  // AI-COST-AND-USAGE-SPEC §3 and §8: the test provider only where the environment allows it, and a hosted workspace without a key of its own only the approved models
  if (key === "ai.provider" && (value === "fake" || value === "test_double") && !fakeAllowed()) throw invalid("The test provider is not available here.", { field: "value" });
  if (key === "ai.model" && typeof value === "string" && value && process.env.KEYSTONE_SELF_HOST !== "1" && !isHostedModel(value)) {
    const ownKey = (await tx.query(`SELECT 1 FROM keystone.document_ai_secret WHERE tenant_id = $1 LIMIT 1`, [tenantId])).rowCount > 0;
    if (!ownKey) throw invalid("That model is not available on the hosted service. Pick Claude Sonnet 5.5 or Claude Haiku 5.5, or add your own provider key to use another.", { field: "value" });
  }
  const r = await setDocumentSetting(tx, { tenantId, key, value: value === undefined ? null : value, updatedBy: actorUserId });
  return { saved: true, key: r.key, value: r.value, changed: r.changed };
}

// ── QUEUE §23.3.4 — email sending: the sending domain, the SMTP password, a test email. Same permission as changing any other document setting. ──
const need = (v, name) => { if (typeof v !== "string" || !v.trim()) throw invalid(`${name} is required`, { field: name }); return v; };
const addEmailDomain = (tx, { tenantId, domain }) => startEmailDomain(tx, { tenantId, domain: need(domain, "domain") });
const verifyEmailDomainNow = (tx, { tenantId }) => verifyEmailDomain(tx, { tenantId });
const setSmtpPassword = (tx, { tenantId, password, actorUserId = null }) => saveSmtpPassword(tx, { tenantId, password: password ?? null, updatedBy: actorUserId });
const testEmail = (tx, { tenantId, to }) => sendTestEmail(tx, { tenantId, to: need(to, "to") });
const connectMailbox = (tx, { tenantId, provider, actorUserId = null }) => startEmailMailbox(tx, { tenantId, userId: actorUserId, provider: need(provider, "provider") });
const disconnectMailbox = (tx, { tenantId, actorUserId = null }) => removeEmailMailbox(tx, { tenantId, updatedBy: actorUserId });

/** `setting` is an ownerless permission object (ownership.mjs), so `subject: null` is the real answer. */
export const DOCUMENT_SETTINGS_WRITES = Object.freeze([
  { path: "/api/documents/settings", section: SECTION, fn: saveDocumentSetting, object: "setting", action: "edit", subject: null },
  { path: "/api/documents/email/domain", section: SECTION, fn: addEmailDomain, object: "setting", action: "edit", subject: null },
  { path: "/api/documents/email/domain/verify", section: SECTION, fn: verifyEmailDomainNow, object: "setting", action: "edit", subject: null },
  { path: "/api/documents/email/smtp-password", section: SECTION, fn: setSmtpPassword, object: "setting", action: "edit", subject: null },
  { path: "/api/documents/email/test", section: SECTION, fn: testEmail, object: "setting", action: "edit", subject: null },
  { path: "/api/documents/email/mailbox/connect", section: SECTION, fn: connectMailbox, object: "setting", action: "edit", subject: null },
  { path: "/api/documents/email/mailbox/disconnect", section: SECTION, fn: disconnectMailbox, object: "setting", action: "edit", subject: null },
]);

export function registerDocumentSettingsReads(app, { runTenantScoped, tenantIsPlatform }) {
  app.get("/api/documents/settings", (c) =>
    runTenantScoped(c, async ({ db, principal, tenantId }) => {
      const isPlatform = await tenantIsPlatform(db, tenantId);
      const decision = authoriseSection(principal.user, SECTION, { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
      const view = await describeDocumentSettings(db);
      // the workspace's own name, for the sidebar (the island never reads the tenant; the brand port does)
      const { brand } = await chromeInputsFor(db, { tenantId });
      // which edition this is (the hosted service or a self-hosted install), so a screen that differs between them asks once here and never hits a route the hosted service does not have
      return { ...view, organisation: brand?.practiceName ?? brand?.tenantName ?? null, selfHost: process.env.KEYSTONE_SELF_HOST === "1" };
    }, { bucket: "settings" }).then((r) => c.json(r)));

  // the screen's view of email sending: the identity in force, the domain's DNS records and status, whether an SMTP password is set (never the password)
  app.get("/api/documents/email", (c) =>
    runTenantScoped(c, async ({ db, principal, tenantId }) => {
      const isPlatform = await tenantIsPlatform(db, tenantId);
      const decision = authoriseSection(principal.user, SECTION, { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
      return emailIdentityStatus(db, { tenantId });
    }, { bucket: "settings" }).then((r) => c.json(r)));

  // ★ QUEUE §23.2.8 — "Preview a signed copy": the REAL signed-copy view (mode `signed`) with made-up signatures and a made-up certificate, drawn with this practice's CURRENT settings.
  //   JSON for the screen, and the same view as a PDF (never signed, never sealed, never stored).
  async function sampleInputs(db, tenantId) {
    const chrome = await chromeInputsFor(db, { tenantId });
    const sample = sampleSignedCopy();
    return { chrome, sample };
  }
  const guardSettings = async (db, principal, tenantId) => {
    const isPlatform = await tenantIsPlatform(db, tenantId);
    const decision = authoriseSection(principal.user, SECTION, { tenantIsPlatform: isPlatform });
    if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
  };
  app.get("/api/documents/settings/signed-copy-preview", (c) =>
    runTenantScoped(c, async ({ db, principal, tenantId }) => {
      await guardSettings(db, principal, tenantId);
      const { chrome, sample } = await sampleInputs(db, tenantId);
      const view = buildDocumentView({
        mode: "signed", sample: true, title: sample.title, documentId: "SAMPLE-0000", documents: [{ title: sample.title, builder: "contract", body: sample.body }],
        signatures: sample.signatures, settings: chrome.settings, brand: chrome.brand, zone: chrome.zone, executedAt: sample.executedAt, certificate: sample.certificate, verifyUrl: "https://example.com/verify",
      });
      return { view };
    }, { bucket: "settings" }).then((r) => c.json(r)));

  app.get("/api/documents/settings/signed-copy-preview.pdf", async (c) => {
    const out = await runTenantScoped(c, async ({ db, principal, tenantId }) => {
      await guardSettings(db, principal, tenantId);
      const { chrome, sample } = await sampleInputs(db, tenantId);
      return renderPreviewPdf({ title: sample.title, body: sample.body, settings: chrome.settings, brand: chrome.brand, logoBytes: chrome.logoBytes, zone: chrome.zone, signedSample: true, signatures: sample.signatures, certificate: sample.certificate });
    }, { bucket: "settings" });
    return c.body(out.bytes, 200, { "content-type": "application/pdf", "content-disposition": 'inline; filename="sample-signed-copy.pdf"', "cache-control": "no-store" });
  });
}
