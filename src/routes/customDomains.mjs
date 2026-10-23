// QUEUE §25.4 — own-domain signing links over HTTP. Writes are ROWS spread into writes.mjs (via itemsAndDocuments.mjs); the list is a read register function.
// Same permission as any other workspace setting (admin and owner). GET also re-checks any address still waiting on DNS / TLS, so an open screen moves it forward until it is live.
import { forbidden, invalid } from "../http/errors.mjs";
import { authoriseSection } from "../nav/authorise.mjs";
import { listDomains, addDomain, checkDomain, removeDomain } from "../domains/proDomains.mjs";
import { notOnHostedDocustay } from "../documents/frontDoor.mjs";   // Docustay v1 item 9: the hosted service has no own signing address (a self-hoster keeps it)

const SECTION = "/settings/domains";
const need = (v, name) => { if (typeof v !== "string" || !v.trim()) throw invalid(`${name} is required`, { field: name }); return v; };

export const CUSTOM_DOMAIN_WRITES = Object.freeze([
  { path: "/api/domains", section: SECTION, fn: async (tx, a) => { await notOnHostedDocustay(tx); return addDomain(tx, { tenantId: a.tenantId, hostname: need(a.hostname, "hostname"), actorUserId: a.actorUserId ?? null }); }, object: "setting", action: "edit", subject: null },
  { path: "/api/domains/check", section: SECTION, fn: async (tx, a) => { await notOnHostedDocustay(tx); return checkDomain(tx, { id: need(a.id, "id") }); }, object: "setting", action: "edit", subject: null },
  { path: "/api/domains/remove", section: SECTION, fn: async (tx, a) => { await notOnHostedDocustay(tx); return removeDomain(tx, { id: need(a.id, "id") }); }, object: "setting", action: "edit", subject: null },
]);

export function registerCustomDomainReads(app, { runTenantScoped, tenantIsPlatform }) {
  app.get("/api/domains", (c) =>
    runTenantScoped(c, async ({ db, principal, tenantId }) => {
      const decision = authoriseSection(principal.user, SECTION, { tenantIsPlatform: await tenantIsPlatform(db, tenantId) });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
      await notOnHostedDocustay(db);
      let out = await listDomains(db);
      for (const d of out.domains.filter((x) => x.status === "pending" || x.status === "verifying")) {
        if (Date.now() - new Date(d.lastCheckedAt ?? 0).getTime() < 8_000) continue;
        try { await checkDomain(db, { id: d.id }); } catch { /* the screen shows the last known state */ }
      }
      out = await listDomains(db);
      return out;
    }, { bucket: "settings" }).then((r) => c.json(r)));
}
