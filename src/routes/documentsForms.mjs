// PEOPLE OVER HTTP. Signed-in routes (the People list, add, edit, delete, CSV, a person's page, and search). Nothing here knows a document table: it all goes through the Documents front door.
import { forbidden, invalid, notFound } from "../http/errors.mjs";
import { authoriseSection } from "../nav/authorise.mjs";
import { assertMay } from "../permissions/assertMay.mjs";
import { noteAccess } from "../documents/frontDoor.mjs";
import { listContacts, getContact, addContact, updateContact, deleteContact, contactsCsv, personTimeline, searchWorkspace } from "../documents/frontDoor.mjs";

const SECTION = "/documents";
const need = (v, name) => { if (typeof v !== "string" || !v.trim()) throw invalid(`${name} is required`, { field: name }); return v; };

const addPerson = (tx, a) => addContact(tx, { tenantId: a.tenantId, firstName: a.firstName, lastName: a.lastName, email: a.email, language: a.language ?? null });
const editPerson = (tx, a) => updateContact(tx, { contactId: need(a.contactId, "contactId"), firstName: a.firstName, lastName: a.lastName, email: a.email, language: a.language });
const dropPerson = (tx, a) => deleteContact(tx, { contactId: need(a.contactId, "contactId") });

export const PEOPLE_WRITES = Object.freeze([
  { path: "/api/documents/people", section: SECTION, fn: addPerson, object: "document", action: "edit", subject: null },
  { path: "/api/documents/people/update", section: SECTION, fn: editPerson, object: "document", action: "edit", subject: null },
  // deleting a person is a privacy act: the delete verb, an admin's (a signed document of theirs is NOT deleted)
  { path: "/api/documents/people/delete", section: SECTION, fn: dropPerson, object: "document", action: "delete", subject: null },
]);

export function registerPeopleReads(app, { runTenantScoped, tenantIsPlatform }) {
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
  read("/api/documents/people", "edit", ({ db, c }) => listContacts(db, { q: c.req.query("q") ?? "", limit: c.req.query("limit"), offset: c.req.query("offset"), source: ["form", "signer"].includes(c.req.query("source")) ? c.req.query("source") : "" }));
  csv("/api/documents/people.csv", "delete", "people.csv", ({ db }) => contactsCsv(db));
  read("/api/documents/people/:id", "edit", ({ db, c }) => getContact(db, { contactId: c.req.param("id") }));
  // Run 9: the person page and ⌘K search (Free; the same "documents" reader as the People list)
  read("/api/documents/people/:id/timeline", "edit", ({ db, c }) => personTimeline(db, { contactId: c.req.param("id"), limit: c.req.query("limit") }));
  read("/api/documents/search", "edit", ({ db, c }) => searchWorkspace(db, { q: c.req.query("q") ?? "", per: c.req.query("per") }));
}

