// MCP tools reviewed against the key scopes (Final Push Stage 8): every tool's scopes are DERIVED from the server's own route table, the committed table is current, nothing a tool calls is unscoped,
// and no read-only tool needs a write scope (positive control: the write tools do).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { derive, table } from "../scripts/scopes.mjs";
import { GRANTABLE_SCOPES } from "../../../src/developer/scopes.mjs";

const rows = await derive();
test("SCOPES.md is current: re-deriving gives the committed table", () => {
  assert.equal(readFileSync(new URL("../SCOPES.md", import.meta.url), "utf8"), table(rows));
});
test("every tool calls at least one route, every route has a scope, and every scope is one a key can be given", () => {
  for (const r of rows) {
    assert.ok(r.routes.length > 0, `${r.name} called no route (${r.error})`);
    assert.ok(r.scopes.length > 0, `${r.name} hits ${r.routes.join()} which has no scope`);
    for (const s of r.scopes) assert.ok(GRANTABLE_SCOPES.includes(s), `${r.name}: ${s} is not a grantable scope`);
  }
});
test("read tools need no write scope; writing tools do (control)", () => {
  for (const r of rows.filter((x) => !x.write && !x.routes.some((q) => q.startsWith("POST")))) assert.ok(r.scopes.every((s) => /:read$/.test(s) || /^(account|embedded)/.test(s)), `${r.name} reads but needs ${r.scopes}`);
  assert.ok(rows.filter((x) => x.write).every((r) => r.scopes.some((s) => /:write$/.test(s))), "a write tool with no write scope");
});
