// src/health/publicStatus.mjs — FP-I: what the public status page shows. A coarse, safe view of /readyz: component names and up/down, never a detail string, an address or a count.
// Cached for 15 seconds so a page that is refreshed (or a crawler) cannot turn the health checks into load.
import { readyz } from "./index.mjs";

const COMPONENTS = [
  { key: "api", name: "App and API", checks: ["database", "migrations"] },
  { key: "storage", name: "Signed documents storage", checks: ["storage"] },
  { key: "sealing", name: "Sealing finished documents", checks: ["signing_certificate"] },
];
let cache = null;

export async function publicStatus(deps, { now = Date.now(), ttlMs = 15_000, check = readyz } = {}) {
  if (cache && now - cache.at < ttlMs) return cache.body;
  let checks = {};
  // ★ D-065: readyz() answers { status, body: { status, checks } } — the checks live under `body`. Reading `.checks` off the top gave {} every time, so every component read as an outage.
  try { const r = await check(deps); checks = r?.body?.checks ?? r?.checks ?? {}; } catch { checks = {}; }
  const components = COMPONENTS.map((c) => ({ key: c.key, name: c.name, status: c.checks.every((k) => checks[k]?.ok === true) ? "operational" : "outage" }));
  const body = { status: components.every((c) => c.status === "operational") ? "operational" : "degraded", checkedAt: new Date(now).toISOString(), components };
  cache = { at: now, body };
  return body;
}
export const _resetStatusCache = () => { cache = null; };
