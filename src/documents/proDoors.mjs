// The core's doors to the Pro add-on's modules (playbooks, bulk send). With the add-on present each is the real function; without it a
// reader returns "nothing" and every writer refuses with the upgrade message. Callers never import the add-on.
import { proPart, needsAddon, addonReady } from "./addon.mjs";

const refuse = (item) => () => { throw needsAddon(item); };
const door = (ns, name, item, fallback) => async (...a) => { await addonReady; const p = proPart(ns); return p ? p[name](...a) : fallback ? fallback(...a) : refuse(item)(); };

// ── playbooks (Pro `playbooks`)
const pb = (name, fallback) => door("playbooks", name, "playbooks", fallback);
export const flowTemplates = pb("flowTemplates", async () => []);
export const listFlows = pb("listFlows", async () => []);
export const getFlow = pb("getFlow");
export const saveFlow = pb("saveFlow");
export const setFlowEnabled = pb("setFlowEnabled");
export const archiveFlow = pb("archiveFlow");
export const testFlow = pb("testFlow");
export const playbooksToStart = pb("playbooksToStart", async () => []);
export const playbookRunActor = pb("playbookRunActor", async () => null);
export const startPlaybookRun = pb("startPlaybookRun");
export const resumePlaybookRun = pb("resumePlaybookRun");
export const playbookTitles = pb("playbookTitles", async () => new Map());
export const playbookNoticeFacts = pb("playbookNoticeFacts", async (tx, { tenantId, instanceId }) => { const { documentNoticeFacts } = await import("./api.mjs"); return { ...(instanceId ? await documentNoticeFacts(tx, { tenantId, instanceId }) : {}), playbookTitle: null }; });
export const PLAYBOOK_WAIT_DUE_FACT = Object.freeze({
  key: "document_playbook_wait_due", why: "an automation run's wait is over",
  find: async (tx, a) => { await addonReady; const p = proPart("playbooks"); return p ? p.PLAYBOOK_WAIT_DUE_FACT.find(tx, a) : { rows: [] }; },
  act: (tx, a) => proPart("playbooks").PLAYBOOK_WAIT_DUE_FACT.act(tx, a),
});

// ── bulk send (Pro `bulk_send`)
export const BULK_MAX_ROWS = 50;
export const bulkSend = door("bulk", "bulkSend", "bulk_send");
