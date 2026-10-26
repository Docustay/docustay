// FP-C1 — the developer's own reference: what is accepted, what is refused with the field named, and how a list filter becomes SQL.
import test from "node:test";
import assert from "node:assert/strict";
import { cleanMetadata, cleanExternalId, cleanReference, referenceFilter } from "../src/documents/reference.mjs";

test("metadata keeps short text, turns numbers and booleans into text, refuses everything else", () => {
  assert.deepEqual(cleanMetadata({ crmDealId: "D-1", seats: 3, vip: true }), { crmDealId: "D-1", seats: "3", vip: "true" });
  assert.deepEqual(cleanMetadata(undefined), {});
  assert.throws(() => cleanMetadata({ a: { b: 1 } }), /must be text/);
  assert.throws(() => cleanMetadata(["x"]), /object/);
  assert.throws(() => cleanMetadata({ "bad key": "x" }), /key/);
  assert.throws(() => cleanMetadata({ k: "x".repeat(501) }), /500/);
  assert.throws(() => cleanMetadata(Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, "v"]))), /at most 20/);
  // the positive control: exactly 20 keys and a 500-character value pass
  assert.equal(Object.keys(cleanMetadata(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, "v".repeat(500)])))).length, 20);
});

test("externalId is text up to 200 characters, or nothing", () => {
  assert.equal(cleanExternalId("contract-1"), "contract-1");
  assert.equal(cleanExternalId(""), null);
  assert.equal(cleanExternalId(undefined), null);
  assert.throws(() => cleanExternalId("x".repeat(201)), /200/);
  assert.throws(() => cleanExternalId(42), /text/);
});

test("a reference carries the document's own and one per named seat", () => {
  const r = cleanReference({ metadata: { a: "1" }, externalId: "E1", people: [{ seat: "signer_1", externalId: "P1", metadata: { tier: "gold" } }, { seat: "signer_2" }] });
  assert.equal(r.externalId, "E1");
  assert.deepEqual(r.partyRefs, { signer_1: { externalId: "P1", metadata: { tier: "gold" } } });
  assert.throws(() => cleanReference({ people: [{ seat: "s", metadata: { "no good": "x" } }] }), /parties\[0\]\.metadata/);
});

test("a list filter becomes parameterised SQL, never text pasted into it", () => {
  const f = referenceFilter({ externalId: "E1", "metadata[crm]": "D-1", state: "sent" }, 5);
  assert.deepEqual(f.where, ["i.external_id = $5", "i.metadata @> $6::jsonb"]);
  assert.deepEqual(f.params, ["E1", JSON.stringify({ crm: "D-1" })]);
  assert.deepEqual(referenceFilter({ state: "sent" }, 5), { where: [], params: [] });
  assert.throws(() => referenceFilter({ "metadata[bad key]": "x" }, 5), /key/);
});
