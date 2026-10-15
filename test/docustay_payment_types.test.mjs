// FINAL PUSH Stage 5: payment types in the text tag and in the saved field (signer-chosen, deposit, installments, subscription).
import test from "node:test";
import assert from "node:assert/strict";
import { parseTag } from "../src/documents/textTags.mjs";
import { pdfFieldSchema } from "../src/documents/pdfBody.mjs";

const tag = (extra) => parseTag(`Pay;type=payment;${extra}`);
test("text tags: ask, deposit, installments, subscription parse to the field's own properties", () => {
  assert.deepEqual(tag("amount=ask;min=5;max=500;suggested=25").spec.amount_ask, { min_minor: 500, max_minor: 50000, suggested_minor: 2500 });
  assert.deepEqual(tag("amount=ask").spec.amount_ask, {});
  assert.deepEqual(tag("amount=500;deposit=25%").spec.deposit, { percent: 25 });
  assert.deepEqual(tag("amount=500;deposit=100").spec.deposit, { amount_minor: 10000 });
  assert.deepEqual(tag("amount=100;every=month;count=6").spec.plan, { every: "month", count: 6 });
  assert.deepEqual(tag("amount=25;every=week").spec.plan, { every: "week" });
  assert.equal(tag("amount=100").spec.plan, undefined, "positive control: a plain payment has none of them");
});
test("text tags: refusals", () => {
  for (const bad of ["amount=ask;min=9;max=5", "amount=ask;min=0.1", "amount=ask;every=month", "amount=100;every=day", "amount=100;every=month;count=1", "amount=100;every=month;count=61", "amount=100;deposit=10;every=week", "formula=1;deposit=25%", "amount=500;deposit=0.10", "amount=ask;deposit=25%"]) assert.ok(tag(bad).error, bad);
});
const f = (extra) => pdfFieldSchema.safeParse({ id: "p1", type: "payment", role: "signer_1", page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.05, required: true, currency: "usd", ...extra });
const bad = (extra) => !f(extra).success;
test("saved field schema: the new kinds validate, the combinations that make no sense do not", () => {
  assert.ok(f({ amount_ask: { min_minor: 500, max_minor: 50000, suggested_minor: 2500 } }).success);
  assert.ok(f({ amount_minor: 50000, deposit: { percent: 25 } }).success);
  assert.ok(f({ amount_minor: 10000, plan: { every: "month", count: 6 } }).success);
  assert.ok(f({ amount_minor: 10000 }).success, "positive control: a plain fixed payment is fine");
  assert.ok(bad({ amount_minor: 10000, amount_ask: {} }), "two ways to set the amount");
  assert.ok(bad({ amount_ask: { min_minor: 900, max_minor: 500 } }), "min above max");
  assert.ok(bad({ amount_ask: { min_minor: 500, max_minor: 900, suggested_minor: 1000 } }), "suggested outside the bounds");
  assert.ok(bad({ amount_minor: 10000, deposit: { percent: 10 }, plan: { every: "week" } }), "deposit and plan together");
  assert.ok(bad({ amount_formula: "1", plan: { every: "week" } }), "a plan needs a fixed amount");
  assert.ok(bad({ amount_minor: 10000, deposit: { amount_minor: 10000 } }), "deposit equal to the total");
  assert.ok(bad({ amount_minor: 300, deposit: { percent: 5 } }), "a deposit under 0.50");
  assert.ok(bad({ amount_minor: 10000, plan: { every: "day" } }), "an unknown period");
  assert.ok(pdfFieldSchema.safeParse({ id: "t1", type: "text", role: "signer_1", page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.05, required: true, plan: { every: "week" } }).success === false, "only a payment carries a plan");
});
