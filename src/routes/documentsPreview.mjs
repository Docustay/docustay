// FIX, 30 Sep 2026 (documents preview brief) — THE STAFF PREVIEW ROUTE. `DocPreview.jsx`'s own
// subtitle said "no staff preview route exists yet" — this is that route, for both shapes a preview
// needs: the JSON snapshot (rendered client-side with the same block reader signing/the PDF use) and
// the PDF itself (`renderPreviewPdf`, src/documents/pdf.mjs — never signed, never sealed, never
// written into `template_snapshot`).
//
// ★ Same guard shape as `documentsPublish.mjs`'s `publish-preview` (the pattern every read in this
//   file follows): `authoriseSection` for the section floor, then `assertMay(... "template.author")`
//   for the object/verb check — a preview shows the exact words a client would be asked to sign, so
//   it is gated the same as authoring the template it previews, not left open to anyone who can read
//   the document list.

import { invalid, forbidden } from "../http/errors.mjs";
import { authoriseSection } from "../nav/authorise.mjs";
import { assertMay } from "../permissions/assertMay.mjs";
import { fetchTemplatePreview, templateViewFor } from "../documents/preview.mjs";
import { renderPreviewPdf } from "../documents/pdf.mjs";
import { chromeInputsFor } from "../documents/chromeInputs.mjs";

const SECTION = "/documents";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function guard(db, principal, tenantId, tenantIsPlatform) {
  const isPlatform = await tenantIsPlatform(db, tenantId);
  const decision = authoriseSection(principal.user, SECTION, { tenantIsPlatform: isPlatform });
  if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
  await assertMay(db, principal, { object: "document", action: "template.author" });
}

export function registerPreviewReads(app, { runTenantScoped, tenantIsPlatform } = {}) {
  // GET /api/documents/templates/:id/preview?personId=<uuid> — the JSON snapshot.
  app.get("/api/documents/templates/:id/preview", (c) => {
    const templateId = c.req.param("id");
    if (!UUID_RE.test(templateId)) {
      const e = invalid("template id must be a UUID", { field: "id" });
      return c.json(e.toResponse().body, e.statusCode);
    }
    const personId = c.req.query("personId") || null;
    if (personId !== null && !UUID_RE.test(personId)) {
      const e = invalid("personId must be a UUID", { field: "personId" });
      return c.json(e.toResponse().body, e.statusCode);
    }
    return runTenantScoped(c, async ({ db, principal, tenantId }) => {
      await guard(db, principal, tenantId, tenantIsPlatform);
      const { snapshot } = await fetchTemplatePreview(db, { tenantId, templateId, personId });
      return { data: snapshot };
    }, { bucket: "documents" }).then((r) => c.json(r));
  });

  // GET /api/documents/templates/:id/view?mode=signing|signed&personId=<uuid> — the ONE document view for the two preview tabs ("as the client sees it" / "as the signed copy").
  app.get("/api/documents/templates/:id/view", (c) => {
    const templateId = c.req.param("id");
    if (!UUID_RE.test(templateId)) {
      const e = invalid("template id must be a UUID", { field: "id" });
      return c.json(e.toResponse().body, e.statusCode);
    }
    const personId = c.req.query("personId") || null;
    if (personId !== null && !UUID_RE.test(personId)) {
      const e = invalid("personId must be a UUID", { field: "personId" });
      return c.json(e.toResponse().body, e.statusCode);
    }
    const mode = c.req.query("mode") || "signing";
    return runTenantScoped(c, async ({ db, principal, tenantId }) => {
      await guard(db, principal, tenantId, tenantIsPlatform);
      return templateViewFor(db, { tenantId, templateId, personId, mode });
    }, { bucket: "documents" }).then((r) => c.json(r));
  });

  // GET /api/documents/templates/:id/preview.pdf?personId=<uuid> — the PDF, unsigned.
  app.get("/api/documents/templates/:id/preview.pdf", async (c) => {
    const templateId = c.req.param("id");
    if (!UUID_RE.test(templateId)) {
      const e = invalid("template id must be a UUID", { field: "id" });
      return c.json(e.toResponse().body, e.statusCode);
    }
    const personId = c.req.query("personId") || null;
    if (personId !== null && !UUID_RE.test(personId)) {
      const e = invalid("personId must be a UUID", { field: "personId" });
      return c.json(e.toResponse().body, e.statusCode);
    }
    const out = await runTenantScoped(c, async ({ db, principal, tenantId }) => {
      await guard(db, principal, tenantId, tenantIsPlatform);
      const { snapshot, body, builder, title } = await fetchTemplatePreview(db, { tenantId, templateId, personId });
      const chrome = await chromeInputsFor(db, { tenantId, templateId });
      const { bytes } = await renderPreviewPdf({ builder, title, body, values: snapshot.variables, settings: chrome.settings, brand: chrome.brand, logoBytes: chrome.logoBytes, zone: chrome.zone });
      return { bytes };
    }, { bucket: "documents" });
    return c.body(out.bytes, 200, {
      "content-type": "application/pdf",
      // ★ inline + a real filename that says PREVIEW — never "executed-…", which is P18.9's route for
      //   an instrument somebody actually signed.
      "content-disposition": `inline; filename="preview-${templateId}.pdf"`,
      // ★ A live template can change between two previews — never cached as if it were frozen.
      "cache-control": "no-store",
    });
  });
}
