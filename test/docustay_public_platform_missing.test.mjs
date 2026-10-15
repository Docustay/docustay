// D-020 — the public Docustay doors (licence check, ping, self-host checkout, usage report) answered a bare 500 when the deployment had no platform organisation. A missing setting is a plain 503 with a fixed sentence, not an internal error. Run: node test/docustay_public_platform_missing.test.mjs
import assert from "node:assert/strict";
const { requirePlatformTenant } = await import("../src/routes/publicDocustay.mjs");
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log("  ok", name); };
await t("no platform organisation: a 503 configuration statement that names no internal detail", async () => {
  let err; try { await requirePlatformTenant(async () => null, "foundry"); } catch (e) { err = e; }
  assert.ok(err, "it refused"); assert.equal(err.statusCode, 503); assert.equal(err.retryable, false); assert.match(err.message, /no platform organisation/i); assert.doesNotMatch(err.message, /foundry|slug|sql|undefined/i);
});
await t("positive control: with a platform organisation the id comes back unchanged", async () => {
  assert.equal(await requirePlatformTenant(async (slug) => (slug === "foundry" ? "tenant-1" : null), "foundry"), "tenant-1");
});
console.log(`ok — ${n} checks`);
