// Run 10 R10-38: a Docustay workspace's keys carry document-side scopes only; the CRM, money, booking and internal scopes are neither listed nor accepted. the platform's list is whole.
import test from "node:test";
import assert from "node:assert/strict";
import { GRANTABLE_SCOPES } from "../src/developer/scopes.mjs";
import { docustayScopes } from "../src/routes/developer.mjs";

test("the Docustay scope set is the document side only, and a positive control shows the full list still holds the rest", () => {
  const d = docustayScopes([...GRANTABLE_SCOPES]);
  for (const s of ["documents:read", "documents:write", "templates:read", "webhooks:write", "reports:read", "embedded:write", "drafts:write", "plays:read", "account:read", "people:read"]) assert.ok(d.includes(s), `${s} stays`);
  for (const s of ["booking:write", "money:write", "growth:read", "items:write", "lead:write", "network:read", "platform:write", "records:write", "settings:write", "accounts:write", "people:write", "notifications:write"]) { assert.ok(!d.includes(s), `${s} is Workbench's`); assert.ok(GRANTABLE_SCOPES.includes(s), `${s} still exists for Workbench`); }
  assert.ok(d.length >= 10 && d.length < GRANTABLE_SCOPES.length);
});
