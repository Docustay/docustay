// D-020 — a refused API call (validation 400, a key without the route's scope) still belongs to its key in the developer's call log.
import test from "node:test";
import assert from "node:assert/strict";
import { installApiTokenResolver, recognizeApiToken } from "../src/paths/index.mjs";

test("a real key is recognised without needing any scope; the resolver is asked for NO scope", async () => {
  let asked = null;
  installApiTokenResolver(async (token, scope) => { asked = { token, scope }; return token === "ks_live_GOOD.secret" ? { tenantId: "T1", tokenId: "K1" } : null; });
  assert.deepEqual(await recognizeApiToken("Bearer ks_live_GOOD.secret"), { tenantId: "T1", tokenId: "K1" });
  assert.equal(asked.scope, null);
});
test("positive control for the negatives: a wrong key, no header, a non-Bearer header and a resolver that throws all give null (nothing to name)", async () => {
  installApiTokenResolver(async (token) => { if (token === "boom") throw new Error("db down"); return token === "ok" ? { tenantId: "T1", tokenId: "K1" } : null; });
  assert.ok(await recognizeApiToken("Bearer ok"), "control: the right key IS recognised in this same test");
  assert.equal(await recognizeApiToken("Bearer nope"), null);
  assert.equal(await recognizeApiToken(undefined), null);
  assert.equal(await recognizeApiToken("Basic abc"), null);
  assert.equal(await recognizeApiToken("Bearer boom"), null);
});
