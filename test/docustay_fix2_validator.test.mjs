// D-082 and the validator (AI-COST-AND-USAGE-SPEC §7): the draft the fake provider makes in "nosig" mode is flagged; the good one passes (positive control).
import test from "node:test";
import assert from "node:assert/strict";
import { validateDraft, retryInstruction, definedParties } from "../src/documents/engine/ai/draftValidator.mjs";
import { fakeDraft, fakeCall, parseMarkers } from "../src/documents/engine/ai/fake.mjs";

test("a complete two-party draft passes with no blocking problem (positive control)", () => {
  const d = fakeDraft("Photo release for a kitchen project");
  assert.deepEqual(validateDraft(d).blocking, []);
});
test("D-082: the text says both sign but only one party is on the list → flagged, naming the missing party", () => {
  const d = fakeDraft("Photo release for a kitchen project", { nosig: true });
  const v = validateDraft(d);
  assert.equal(v.blocking.length, 1);
  assert.match(v.blocking[0], /Provider/); assert.match(v.blocking[0], /no signature field/);
  assert.match(retryInstruction(v.blocking), /Fix every one/);
});
test("defined parties are read from the (the “X”) pattern", () => {
  assert.deepEqual(definedParties('This is between A (the “Homeowner”) and B (the "Studio").').sort(), ["Homeowner", "Studio"]);
});
test("an unmarked placeholder, a wrong total, a backwards date and a missing section are each caught; the same text fixed is clean", () => {
  const bad = { document: "## One\n\nFee: $100\nExtras: $50\nTotal: $200\n\nThe work starts 10 June 2026 and ends 1 June 2026. See Section 9. Sign here [name].", people: [{ role: "Client", action: "signer" }] };
  const v = validateDraft(bad);
  assert.ok(v.blocking.some((x) => /does not add up/.test(x)), "total");
  assert.ok(v.blocking.some((x) => /before the start date/.test(x)), "dates");
  assert.ok(v.blocking.some((x) => /section 9/.test(x)), "section");
  assert.ok(v.blocking.some((x) => /placeholder/.test(x)), "placeholder");
  const good = { document: "## One\n\nFee: $100\nExtras: $50\nTotal: $150\n\nThe work starts 1 June 2026 and ends 10 June 2026. See Section 1.", people: [{ role: "Client", action: "signer" }] };
  assert.deepEqual(validateDraft(good).blocking, []);
});
test("a blank for a role that is not on the list is flagged", () => {
  const v = validateDraft({ document: "## A\n\n{{Name;type=text;role=Witness}}", people: [{ role: "Client", action: "signer" }] });
  assert.ok(v.blocking.some((x) => /Witness/.test(x)));
});
test("fake provider: markers set the usage, the model and the error mode; the draft is a real schema answer", async () => {
  const m = parseMarkers("hello [usage:in=3000,out=4000] [fake:model=claude-haiku-5-5] [fake:error=nosig]");
  assert.deepEqual([m.in, m.out, m.model, m.error], [3000, 4000, "claude-haiku-5-5", "nosig"]);
  const r = await fakeCall({ system: "x", user: "A lease [usage:in=3000,out=4000]", schema: { properties: { document: {} } } });
  assert.equal(r.ok, true); assert.equal(r.usage.input, 3000); assert.equal(r.usage.output, 4000);
  const j = JSON.parse(r.text); assert.ok(j.document && Array.isArray(j.people));
  assert.equal((await fakeCall({ user: "[fake:error=429]" })).status, 429);
  assert.equal((await fakeCall({ user: "[fake:error=toolong]" })).kind, "length");
  assert.equal((await fakeCall({ user: "[fake:error=malformed]", schema: { properties: { document: {} } } })).text.startsWith("this is not json"), true);
});
