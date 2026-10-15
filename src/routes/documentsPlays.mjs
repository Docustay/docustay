// FINAL PUSH STAGE 4 — PLAYS (skills), PLAYBOOKS (packs) AND AUTOMATIONS OVER HTTP (signed-in; Run 9 Part 4R names). Reading and using plays is for anyone who may author a template; making the workspace's own is Pro (the store asks the plan).
import { forbidden, invalid } from "../http/errors.mjs";
import { authoriseSection } from "../nav/authorise.mjs";
import { assertMay } from "../permissions/assertMay.mjs";
import { flowTemplates, listFlows, getFlow, saveFlow, setFlowEnabled, archiveFlow, testFlow } from "../documents/frontDoor.mjs";
import { listPlays, getPlay, savePlay, publishPlay, archivePlay, duplicatePlay, playVersions, testPlaySource, exportPlay, importPlay, listPlaybooks, savePlaybook, archivePlaybook, setPlaybookEnabled, setPlayOn, isPro } from "../documents/plays/store.mjs";

const SECTION = "/documents";
const need = (v, name) => { if (typeof v !== "string" || !v.trim()) throw invalid(`${name} is required`, { field: name }); return v; };
const save = (tx, a) => savePlay(tx, { tenantId: a.tenantId, actorUserId: a.actorUserId ?? null, source: need(a.source, "source") });
const publish = (tx, a) => publishPlay(tx, { tenantId: a.tenantId, name: need(a.name, "name"), version: Number.isInteger(a.version) ? a.version : null });
const archive = (tx, a) => archivePlay(tx, { tenantId: a.tenantId, name: need(a.name, "name"), archived: a.archived !== false });
const duplicate = (tx, a) => duplicatePlay(tx, { tenantId: a.tenantId, actorUserId: a.actorUserId ?? null, name: need(a.name, "name"), as: a.as });
const test = async (_tx, a) => testPlaySource(need(a.source, "source"));
const importZip = (tx, a) => importPlay(tx, { tenantId: a.tenantId, actorUserId: a.actorUserId ?? null, bytes: Buffer.from(need(a.data, "data"), "base64") });
const bookSave = (tx, a) => savePlaybook(tx, { tenantId: a.tenantId, actorUserId: a.actorUserId ?? null, name: a.name, title: a.title, description: a.description, plays: a.plays ?? [], templates: a.templates ?? [] });
const bookEnable = (tx, a) => setPlaybookEnabled(tx, { tenantId: a.tenantId, name: need(a.name, "name"), on: a.on === true });
const playOn = (tx, a) => setPlayOn(tx, { tenantId: a.tenantId, name: need(a.name, "name"), on: a.on === true });
const bookArchive = (tx, a) => archivePlaybook(tx, { tenantId: a.tenantId, name: need(a.name, "name") });
// Run 9 Part 3.6 — an AUTOMATION (Part 4R: the "playbook that runs", renamed) (Pro; the store asks the plan). Made and changed by whoever may author templates; it then runs as the person who made it.
const flowSave = (tx, a) => saveFlow(tx, { tenantId: a.tenantId, actorUserId: a.actorUserId ?? null, id: a.id ?? null, title: a.title, flow: a.flow });
const flowEnable = (tx, a) => setFlowEnabled(tx, { tenantId: a.tenantId, id: need(a.id, "id"), on: a.on === true });
const flowArchive = (tx, a) => archiveFlow(tx, { id: need(a.id, "id") });
const flowTest = (tx, a) => testFlow(tx, { tenantId: a.tenantId, id: a.id ?? null, flow: a.flow ?? null });

export const PLAYS_WRITES = Object.freeze([
  { path: "/api/documents/plays/save", section: SECTION, fn: save, object: "document", action: "template.author" },
  { path: "/api/documents/plays/publish", section: SECTION, fn: publish, object: "document", action: "template.author" },
  { path: "/api/documents/plays/archive", section: SECTION, fn: archive, object: "document", action: "template.author" },
  { path: "/api/documents/plays/duplicate", section: SECTION, fn: duplicate, object: "document", action: "template.author" },
  { path: "/api/documents/plays/test", section: SECTION, fn: test, object: "document", action: "template.author" },
  { path: "/api/documents/plays/import", section: SECTION, fn: importZip, object: "document", action: "template.author" },
  { path: "/api/documents/plays/on", section: SECTION, fn: playOn, object: "document", action: "template.author" },
  { path: "/api/documents/playbooks/save", section: SECTION, fn: bookSave, object: "document", action: "template.author" },
  { path: "/api/documents/playbooks/archive", section: SECTION, fn: bookArchive, object: "document", action: "template.author" },
  { path: "/api/documents/playbooks/enable", section: SECTION, fn: bookEnable, object: "document", action: "template.author" },
  { path: "/api/documents/automations/save", section: SECTION, fn: flowSave, object: "document", action: "template.author" },
  { path: "/api/documents/automations/enable", section: SECTION, fn: flowEnable, object: "document", action: "template.author" },
  { path: "/api/documents/automations/archive", section: SECTION, fn: flowArchive, object: "document", action: "template.author" },
  { path: "/api/documents/automations/test", section: SECTION, fn: flowTest, object: "document", action: "template.author" },
]);

export function registerPlayReads(app, { runTenantScoped, tenantIsPlatform }) {
  const guard = async ({ db, principal, tenantId }) => {
    const decision = authoriseSection(principal.user, SECTION, { tenantIsPlatform: await tenantIsPlatform(db, tenantId) });
    if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
    await assertMay(db, principal, { object: "document", action: "template.author" });
  };
  const read = (path, fn) => app.get(path, (c) => runTenantScoped(c, async (rc) => { await guard(rc); return { data: await fn({ ...rc, c }) }; }, { bucket: "documents" }).then((r) => c.json(r)));
  read("/api/documents/plays", async ({ db, tenantId }) => ({ plays: await listPlays(db, { includeArchived: false }), custom: await isPro(db, tenantId, "custom_plays"), playbooks: await listPlaybooks(db) }));
  read("/api/documents/automations", async ({ db, tenantId }) => ({ ...(await listFlows(db)), pro: await isPro(db, tenantId, "playbooks") }));
  read("/api/documents/automations/templates", async ({ db }) => flowTemplates(db));
  read("/api/documents/automations/:id", async ({ db, tenantId, c }) => ({ ...(await getFlow(db, { id: c.req.param("id") })), pro: await isPro(db, tenantId, "playbooks") }));
  read("/api/documents/plays/:name", async ({ db, c }) => { const g = await getPlay(db, { name: c.req.param("name"), draft: true }); if (!g) throw invalid("That play was not found.", { field: "name" }); return { play: g.play, ref: g.ref, builtin: g.builtin, version: g.version ?? null, published: g.published ?? true, source: g.source ?? null }; });
  read("/api/documents/plays/:name/versions", async ({ db, c }) => ({ versions: await playVersions(db, { name: c.req.param("name") }) }));
  app.get("/api/documents/plays/:name/export.zip", async (c) => {
    const bytes = await runTenantScoped(c, async (rc) => { await guard(rc); return exportPlay(rc.db, { name: c.req.param("name") }); }, { bucket: "documents" });
    return c.body(bytes, 200, { "content-type": "application/zip", "content-disposition": `attachment; filename="${c.req.param("name").replace(/[^a-z0-9-]/g, "")}.zip"`, "cache-control": "private, no-store" });
  });
}
