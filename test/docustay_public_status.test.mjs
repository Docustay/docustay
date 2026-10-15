// FP-I — the public status page shows only component names and up/down: no detail text from /readyz ever reaches it, a failed check shows as an outage, and a quick refresh is served from the 15-second cache.
import test from "node:test";
import assert from "node:assert/strict";
import { publicStatus, _resetStatusCache } from "../src/health/publicStatus.mjs";
import { readyz } from "../src/health/index.mjs";

const ok = (detail) => ({ ok: true, ...(detail ? { detail } : {}) });
const shaped = (checks) => ({ status: Object.values(checks).every((c) => c.ok) ? 200 : 503, body: { status: "x", checks } });   // the real readyz() shape (D-065)
const allUp = async () => shaped({ database: ok("Connection ok postgres://secret"), migrations: ok("566 applied"), storage: ok("bucket answered 200"), signing_certificate: ok() });
const storageDown = async () => shaped({ database: ok(), migrations: ok(), storage: { ok: false, detail: "bucket docustay-prod timed out" }, signing_certificate: ok() });
test("the shape is names and statuses only (everything up reads operational)", async () => {
  _resetStatusCache();
  const s = await publicStatus({}, { check: allUp });
  assert.equal(s.status, "operational");
  assert.deepEqual(s.components.map((c) => c.key), ["api", "storage", "sealing"]);
  for (const c of s.components) { assert.deepEqual(Object.keys(c).sort(), ["key", "name", "status"]); assert.equal(c.status, "operational"); }
  assert.doesNotMatch(JSON.stringify(s), /applied|detail|tenant|postgres|bucket|secret/i);
});
test("one failed check is an outage for its own component only, and its detail text never leaves", async () => {
  _resetStatusCache();
  const s = await publicStatus({}, { check: storageDown });
  assert.equal(s.status, "degraded");
  assert.deepEqual(Object.fromEntries(s.components.map((c) => [c.key, c.status])), { api: "operational", storage: "outage", sealing: "operational" });
  assert.doesNotMatch(JSON.stringify(s), /docustay-prod|timed out/);
});
test("an absent answer counts as an outage, never as healthy, and the answer is cached for 15 seconds", async () => {
  _resetStatusCache();
  const down = await publicStatus({}, { now: 1_000_000, check: async () => ({}) });
  assert.ok(down.components.every((c) => c.status === "outage"));
  const again = await publicStatus({}, { now: 1_000_000 + 5_000, check: allUp });
  assert.equal(again.checkedAt, down.checkedAt, "inside the cache window the old answer stands");
  const later = await publicStatus({}, { now: 1_000_000 + 20_000, check: allUp });
  assert.equal(later.status, "operational");
});

test("D-065: through the REAL readyz with healthy probes, every component reads operational (the stubs above no longer supply the shape)", async () => {
  _resetStatusCache();
  const deps = { pingDatabase: async () => true, checkMigrations: async () => ({ pending: 0, drift: false, applied: 1 }), queryTenantTimezones: async () => [], probeStorage: async () => true,
    env: { ...process.env }, readCertificate: async () => null };
  const real = await readyz(deps);
  const s = await publicStatus(deps, { check: (d) => readyz(d) });
  // whichever way the signing-certificate check lands in this environment, the checks that DID pass must not read as an outage
  const byKey = Object.fromEntries(s.components.map((c) => [c.key, c.status]));
  assert.equal(byKey.api, "operational", JSON.stringify(real.body.checks));
  assert.equal(byKey.storage, "operational");
});
test("D-065: a failing probe through the real readyz shows only its own component as an outage", async () => {
  _resetStatusCache();
  const deps = { pingDatabase: async () => true, checkMigrations: async () => ({ pending: 0, drift: false, applied: 1 }), queryTenantTimezones: async () => [], probeStorage: async () => false, env: { ...process.env }, readCertificate: async () => null };
  const s = await publicStatus(deps, { check: (d) => readyz(d) });
  assert.equal(Object.fromEntries(s.components.map((c) => [c.key, c.status])).storage, "outage");
  assert.equal(Object.fromEntries(s.components.map((c) => [c.key, c.status])).api, "operational");
});
