// R13-D025 / R13-D026 — a detected person is put on a seat that EXISTS before a suggestion becomes a box. The detector numbers people by the order the words appear on the page (Landlord, Tenant,
// Witness → signer_1, signer_2, signer_3); the people the sender added are different. Every "put on a seat" assertion has a control: with enough seats the same suggestions land on different ones.
import test from "node:test";
import assert from "node:assert/strict";
import { mapSuggestionSeats, fromSuggestion } from "../docustay/web/src/lib/editor/fields.js";
import { detectFields } from "../src/documents/detect/engine.mjs";
import { suggestionsFrom } from "../src/documents/detect/toBody.mjs";
import { ocrWords, stopOcr } from "../src/documents/detect/ocr.mjs";
import { buildFixture } from "../scripts/detect/fixtures.mjs";

test.after(async () => { await stopOcr(); });

const box = (id, type, role, page, x, y) => ({ id, type, role, page, x, y, w: 0.25, h: 0.03, confidence: 0.9 });
const LABELS = { signer_1: "Landlord", signer_2: "Tenant", signer_3: "Witness" };
const labelOf = (k) => LABELS[k] ?? "";
// a lease: landlord block, tenant block, witness line
const lease = [
  box("a1", "signature", "signer_1", 1, 0.1, 0.55), box("a2", "date_signed", "signer_1", 1, 0.6, 0.55),
  box("b1", "signature", "signer_2", 1, 0.1, 0.7), box("b2", "date_signed", "signer_2", 1, 0.6, 0.7),
  box("w1", "signature", "signer_3", 1, 0.1, 0.85),
];

test("D025: a witness is not a seat — the signer's own signature and date go to the signer, the witness line gets no seat, and nothing lands on a seat nobody fills", () => {
  const seats = ["signer_1"];                                                    // Greta, with "a witness signs straight after them"
  const m = mapSuggestionSeats(lease, { seats, labelOf });
  assert.deepEqual([...m.witness], ["w1"], "the witness line is recognised as the witness's");
  for (const s of lease.filter((x) => x.id !== "w1")) assert.ok(seats.includes(m.role.get(s.id)), `${s.id} is on a seat that exists (got ${m.role.get(s.id)})`);
  assert.equal(m.role.has("w1"), false, "the witness line is given no seat");
  // the box a click on the witness line makes is not left on the detector's internal key either
  assert.equal(fromSuggestion({ ...lease[4], role: null }, "signer_1", null).role, "signer_1");
  // control: with the landlord and the tenant both added, the two blocks land on two different seats
  const two = mapSuggestionSeats(lease, { seats: ["signer_1", "signer_2"], labelOf });
  assert.equal(two.role.get("a1"), "signer_1"); assert.equal(two.role.get("b1"), "signer_2"); assert.equal(two.role.get("b2"), "signer_2");
  assert.deepEqual([...two.witness], ["w1"]);
});

test("D026: one signer on a two-party lease — every detected block lands on that one signer; two signers — in order, each with their date", () => {
  const two = [lease[0], lease[1], lease[2], lease[3]];
  const one = mapSuggestionSeats(two, { seats: ["signer_1"], labelOf });
  assert.deepEqual([...one.role.values()], ["signer_1", "signer_1", "signer_1", "signer_1"], "no signer_2 is invented");
  const both = mapSuggestionSeats(two, { seats: ["signer_1", "signer_2"], labelOf });
  assert.deepEqual(["a1", "a2", "b1", "b2"].map((id) => both.role.get(id)), ["signer_1", "signer_1", "signer_2", "signer_2"], "control: two people, two seats");
  // more detected people than people added: the extra ones share the last seat, never a seat that is not there
  const three = mapSuggestionSeats([...two, box("c1", "signature", "signer_3", 2, 0.1, 0.2)], { seats: ["signer_1", "signer_2"], labelOf: (k) => (k === "signer_3" ? "Guarantor" : labelOf(k)) });
  assert.equal(three.role.get("c1"), "signer_2");
  // nobody added yet: nothing to map onto, nothing is changed
  const none = mapSuggestionSeats(two, { seats: [], labelOf }); assert.equal(none.role.size, 0); assert.equal(none.witness.size, 0);
});

test("D026: two tenants, one 'Tenant' printed twice on a page — the first block is the first tenant's, the second block and its date are the second tenant's", () => {
  const sug = [box("t1", "signature", "signer_1", 1, 0.1, 0.6), box("d1", "date_signed", "signer_1", 1, 0.6, 0.6), box("t2", "signature", "signer_1", 1, 0.1, 0.75), box("d2", "date_signed", "signer_1", 1, 0.6, 0.75)];
  const m = mapSuggestionSeats(sug, { seats: ["signer_1", "signer_2"], labelOf: () => "Tenant" });
  assert.deepEqual(["t1", "d1", "t2", "d2"].map((id) => m.role.get(id)), ["signer_1", "signer_1", "signer_2", "signer_2"]);
  // control: the same person signing once on each of two pages is ONE person, whatever the number of seats
  const pages = [box("p1", "signature", "signer_1", 1, 0.1, 0.8), box("p2", "signature", "signer_1", 2, 0.1, 0.8)];
  const same = mapSuggestionSeats(pages, { seats: ["signer_1", "signer_2"], labelOf: () => "Tenant" });
  assert.deepEqual([same.role.get("p1"), same.role.get("p2")], ["signer_1", "signer_1"]);
});

test("D026 on the real engine: a three-person form read from a PDF, with one signer and with two, lands only on seats that exist and keeps each person's date with their signature", async () => {
  const fx = await buildFixture("consentHighlight"), r = await detectFields(fx.bytes, { ocr: ocrWords });
  const body = suggestionsFrom(r), sug = body.suggestions, labels = Object.fromEntries(body.roles.map((x) => [x.key, x.label]));
  assert.ok(body.roles.length >= 3 && sug.length >= 6, `the form was read (${body.roles.length} people, ${sug.length} boxes)`);
  const one = mapSuggestionSeats(sug, { seats: ["signer_1"], labelOf: (k) => labels[k] ?? "" });
  assert.equal(one.role.size, sug.length); assert.ok([...one.role.values()].every((k) => k === "signer_1"), "everything is on the one signer");
  assert.ok(sug.some((s) => s.role === "signer_2" || s.role === "signer_3"), "control: the detector DID name more people than one");
  const two = mapSuggestionSeats(sug, { seats: ["signer_1", "signer_2"], labelOf: (k) => labels[k] ?? "" });
  assert.ok([...two.role.values()].every((k) => ["signer_1", "signer_2"].includes(k)));
  for (const k of body.roles.map((x) => x.key)) { const seatsOf = new Set(sug.filter((s) => s.role === k).map((s) => two.role.get(s.id))); assert.equal(seatsOf.size, 1, `${k}: a signature and its date share a seat`); }
  assert.notEqual(two.role.get(sug.find((s) => s.role === "signer_1").id), two.role.get(sug.find((s) => s.role === "signer_2").id), "control: two people, two seats");
});
