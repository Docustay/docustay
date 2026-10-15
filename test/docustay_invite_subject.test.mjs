// Run 10 R10-36: a Docustay invitation's subject names who invited and to what (as its body does); the platform's subject is unchanged.
import test from "node:test";
import assert from "node:assert/strict";
import { TEMPLATES } from "../src/email/templates.mjs";
import { Liquid } from "liquidjs";
import { TEMPLATE_REGISTRY_BY_KEY } from "../src/email/registry.mjs";

const v = (productName) => ({ acceptUrl: "https://x/invite?token=t", expiresOn: "October 21, 2026", inviterName: "Riley Owner", personalLine: "", practiceName: "Acme", productName });
test("the code subject: Docustay says who invited and to what; Workbench is as before (positive control in the same test)", () => {
  const s = TEMPLATES["auth.invite"].subject;
  assert.equal(s(v("Docustay")), "Riley Owner invited you to join Acme on Docustay");
  assert.equal(s(v("Workbench")), "Acme invited you to join on Workbench");
  assert.equal(s(v(undefined)), "Acme invited you to join on Workbench");
});
test("the stored (liquid) subject renders the same two ways", async () => {
  const entry = TEMPLATE_REGISTRY_BY_KEY["auth.invite"];
  assert.ok(entry?.liquid?.subject, "registry entry found");
  const e = new Liquid();
  assert.equal(await e.parseAndRender(entry.liquid.subject, v("Docustay")), "Riley Owner invited you to join Acme on Docustay");
  assert.equal(await e.parseAndRender(entry.liquid.subject, v("Workbench")), "Acme invited you to join on Workbench");
});
