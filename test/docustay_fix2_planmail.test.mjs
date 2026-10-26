// D-102 (found on the localhost stack, 9 Oct 2026): a Docustay purchase emailed "Your the platform subscription was updated." A Docustay plan is named as Docustay and links to /billing; a the platform plan keeps its own words.
import test from "node:test";
import assert from "node:assert/strict";
import { GENERIC_NOTIFICATIONS } from "../src/queue/genericNotifications.mjs";

const n = GENERIC_NOTIFICATIONS["settings.subscription.updated"];
test("a Docustay plan change is told in Docustay's words and links to /billing", () => {
  const ev = { payload: { planKey: "docustay_pro" } };
  assert.equal(n.summary(ev), "Your Docustay plan was updated.");
  assert.equal(n.link(ev), "/billing");
  assert.doesNotMatch(n.summary(ev), /Workbench/);
});
test("a Workbench plan change keeps its own words (positive control)", () => {
  const ev = { payload: { planKey: "workbench_growth" } };
  assert.equal(n.summary(ev), "Your Workbench subscription was updated.");
  assert.equal(n.link(ev), "/settings/billing");
});
