// Fix pass 1 — mail: D-013 a test email that was not sent is refused in plain words.
import test from "node:test";
import assert from "node:assert/strict";
import { assertTestSent } from "../src/mail/index.mjs";

test("D-013: limit_reached, skipped and failed are refusals that carry the plain reason", () => {
  assert.throws(() => assertTestSent({ status: "limit_reached", error: "This organisation has reached its daily sending limit (600). It resets at midnight UTC." }), /daily sending limit/);
  assert.throws(() => assertTestSent({ status: "skipped", error: "email isn't set up: no provider key" }), /isn't set up/);
  assert.throws(() => assertTestSent({ status: "failed", error: "connect ECONNREFUSED" }), /ECONNREFUSED/);
});
test("D-013 positive control: a sent test passes through unchanged", () => {
  const out = { status: "sent", mode: "platform", error: null };
  assert.equal(assertTestSent(out), out);
});
