// FP-K1/K2 — a workspace's own wording for its document emails: the eight types, the variables each may use, and what is refused.
import test from "node:test";
import assert from "node:assert/strict";
import { MESSAGE_KINDS, messageKind, variablesIn, fill, render, sampleVars } from "../src/documents/emailMessages.mjs";

test("there are nine message types, each with the variables it may use and standard wording that uses only those", () => {
  assert.deepEqual(MESSAGE_KINDS.map((k) => k.kind), ["invitation", "reminder", "completed", "declined", "voided", "expired", "code", "receipt", "hold_lapsed"]);   // Run 7: the owner's "new response" email (0709); Run 9 Part 3.7: the signer's "payment not received" (0724)
  for (const k of MESSAGE_KINDS) {
    for (const f of ["subject", "preview", "body"]) { const bad = variablesIn(k[f]).filter((v) => !k.vars.includes(v)); assert.deepEqual(bad, [], `${k.kind}.${f} uses ${bad}`); }
    assert.equal(k.button, ["invitation", "reminder"].includes(k.kind), `${k.kind}: only the two signing emails carry the sign button`);
  }
});

test("variables are filled from values and never run as code; unknown or missing ones become nothing", () => {
  assert.equal(fill("Hi {{signer.name}} — {{ document.title }}{{nope}}", { "signer.name": "Alex", "document.title": "NDA" }), "Hi Alex — NDA");
  assert.equal(fill("{{signer.name}}", {}), "");
  assert.equal(fill("{% assign x = 1 %}{{signer.name}}", { "signer.name": "A" }), "{% assign x = 1 %}A");   // fill never interprets anything else; checkDraft is what refuses such text
  assert.deepEqual(variablesIn("{{a.b}} {{a.b}} {{ c }}"), ["a.b", "c"]);
});

test("a message renders with sample values; standard wording fills the fields a workspace left blank", () => {
  const vars = sampleVars("Acme");
  const r = render({ kind: "invitation", subject: "Sign {{document.title}} for {{org.name}}", body: null }, vars, { standard: true });
  assert.equal(r.subject, "Sign Services agreement for Acme");
  assert.match(r.body, /Jordan Example at Acme has sent you a document/);
  assert.equal(render({ kind: "invitation", subject: null }, vars).subject, null);                                       // without `standard`, an unset field stays unset
  assert.equal(messageKind("receipt").vars.includes("amount"), true);
});
