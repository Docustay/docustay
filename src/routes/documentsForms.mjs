// FINAL PUSH STAGE 2 — FORMS AND PEOPLE OVER HTTP. Signed-in routes (publish a form, change its controls, switch it off, responses, CSV; the People list, add, edit, delete, CSV) and the PUBLIC routes a visitor uses (read a form,
// start a response: those are in publicForms.mjs, the host's side). Nothing here knows a document table: it all goes through the Documents front door.
import { forbidden, invalid, notFound } from "../http/errors.mjs";
import { authoriseSection } from "../nav/authorise.mjs";
import { assertMay } from "../permissions/assertMay.mjs";
import { noteAccess } from "../documents/frontDoor.mjs";
import { publishForm, setFormOpen, removeForm, listForms, getForm, listResponses, responsesCsv, listContacts, getContact, addContact, updateContact, deleteContact, contactsCsv, personTimeline, searchWorkspace, listContracts, keyDatesForEmail, correctKeyDate } from "../documents/frontDoor.mjs";

const SECTION = "/documents";
const need = (v, name) => { if (typeof v !== "string" || !v.trim()) throw invalid(`${name} is required`, { field: name }); return v; };

const publish = (tx, a) => publishForm(tx, { tenantId: a.tenantId, templateId: need(a.templateId, "templateId"), slug: a.slug, settings: a.settings, enabled: a.enabled !== false });
const open = (tx, a) => setFormOpen(tx, { tenantId: a.tenantId, templateId: need(a.templateId, "templateId"), open: a.open === true });
const remove = (tx, a) => removeForm(tx, { templateId: need(a.templateId, "templateId") });
const addPerson = (tx, a) => addContact(tx, { tenantId: a.tenantId, firstName: a.firstName, lastName: a.lastName, email: a.email, language: a.language ?? null });
const editPerson = (tx, a) => updateContact(tx, { contactId: need(a.contactId, "contactId"), firstName: a.firstName, lastName: a.lastName, email: a.email, language: a.language });
const dropPerson = (tx, a) => deleteContact(tx, { contactId: need(a.contactId, "contactId") });
// Run 9 Part 3.4 (R9-h): a person corrects a key date of a signed document; the correction is what is shown from then on
const correctDate = (tx, a) => correctKeyDate(tx, { tenantId: a.tenantId, instanceId: need(a.instanceId, "instanceId"), kind: need(a.kind, "kind"), date: a.date ?? null, amountMinor: a.amountMinor ?? null, currency: a.currency ?? null, actorUserId: a.actorUserId ?? null });

export const FORMS_WRITES = Object.freeze([
  { path: "/api/documents/forms/publish", section: SECTION, fn: publish, object: "document", action: "edit", subject: null },
  { path: "/api/documents/forms/open", section: SECTION, fn: open, object: "document", action: "edit", subject: null },
  { path: "/api/documents/forms/remove", section: SECTION, fn: remove, object: "document", action: "edit", subject: null },
  { path: "/api/documents/people", section: SECTION, fn: addPerson, object: "document", action: "edit", subject: null },
  { path: "/api/documents/people/update", section: SECTION, fn: editPerson, object: "document", action: "edit", subject: null },
  // deleting a person is a privacy act: the delete verb, an admin's (a signed document of theirs is NOT deleted)
  { path: "/api/documents/people/delete", section: SECTION, fn: dropPerson, object: "document", action: "delete", subject: null },
  { path: "/api/documents/key-dates/correct", section: SECTION, fn: correctDate, object: "document", action: "edit", subject: "instanceId" },
]);

export function registerFormReads(app, { runTenantScoped, tenantIsPlatform }) {
  const read = (path, verb, fn) => app.get(path, (c) => runTenantScoped(c, async ({ db, principal, tenantId }) => {
    const decision = authoriseSection(principal.user, SECTION, { tenantIsPlatform: await tenantIsPlatform(db, tenantId) });
    if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
    await assertMay(db, principal, { object: "document", action: verb });
    return { data: await fn({ db, tenantId, c }) };
  }, { bucket: "documents" }).then((r) => c.json(r)));
  const csv = (path, verb, name, fn) => app.get(path, async (c) => {
    const text = await runTenantScoped(c, async ({ db, principal, tenantId }) => {
      const decision = authoriseSection(principal.user, SECTION, { tenantIsPlatform: await tenantIsPlatform(db, tenantId) });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
      await assertMay(db, principal, { object: "document", action: verb });
      const out = await fn({ db, tenantId, c });
      await noteAccess(db, { tenantId, action: "export", what: name, userId: principal.appUserId ?? null, ip: c.get("clientIp") ?? null });   // Run 7 part 6: the access log (always on)
      return out;
    }, { bucket: "documents" });
    return c.body(text, 200, { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "private, no-store" });
  });
  read("/api/documents/forms", "edit", async ({ db }) => ({ forms: await listForms(db) }));
  read("/api/documents/forms/:id", "edit", ({ db, tenantId, c }) => getForm(db, { templateId: c.req.param("id"), tenantId }));
  read("/api/documents/forms/:id/responses", "edit", ({ db, c }) => listResponses(db, { templateId: c.req.param("id"), limit: c.req.query("limit"), offset: c.req.query("offset") }));
  csv("/api/documents/forms/:id/responses.csv", "edit", "responses.csv", ({ db, c }) => responsesCsv(db, { templateId: c.req.param("id") }));
  read("/api/documents/people", "edit", ({ db, c }) => listContacts(db, { q: c.req.query("q") ?? "", limit: c.req.query("limit"), offset: c.req.query("offset"), source: ["form", "signer"].includes(c.req.query("source")) ? c.req.query("source") : "" }));
  csv("/api/documents/people.csv", "delete", "people.csv", ({ db }) => contactsCsv(db));
  read("/api/documents/people/:id", "edit", ({ db, c }) => getContact(db, { contactId: c.req.param("id") }));
  // Run 9: the person page and ⌘K search (Free; the same "documents" reader as the People list)
  read("/api/documents/people/:id/timeline", "edit", ({ db, c }) => personTimeline(db, { contactId: c.req.param("id"), limit: c.req.query("limit") }));
  read("/api/documents/search", "edit", ({ db, c }) => searchWorkspace(db, { q: c.req.query("q") ?? "", per: c.req.query("per") }));
  // Run 9 Part 3.4: the contract repository (Free) and a person's key dates
  read("/api/documents/contracts", "edit", ({ db, c }) => listContracts(db, { q: c.req.query("q") ?? null, limit: c.req.query("limit") }));
  read("/api/documents/key-dates", "edit", async ({ db, c }) => { const id = c.req.query("person"); if (!id) throw invalid("person is required", { field: "person" }); const p = await getContact(db, { contactId: id }); return { dates: await keyDatesForEmail(db, { email: p.email }) }; });
}

