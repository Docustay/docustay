// D-004 / D-050 — the sentences about email at the Send step and after sending follow who is really emailed.
import test from "node:test";
import assert from "node:assert/strict";
import { sendPlan, nextLine, sentLine } from "../docustay/web/src/lib/flow/sendPlan.js";

const t = (s) => s;
const emailed = { role: "a", email: "a@x.test" }, noMail = { role: "b", email: null }, here = { role: "c", email: "c@x.test" };
test("everyone has an address: the old sentences are true", () => {
  const p = sendPlan([emailed, { role: "d", email: "d@x.test" }], [], false);
  assert.equal(p.kind, "all"); assert.match(nextLine(p, t), /Each person gets an email/); assert.match(sentLine(p, t), /Everyone on it has been emailed/);
});
test("everyone signs on this device: no email is claimed (D-050)", () => {
  const p = sendPlan([here], ["c"], false);
  assert.equal(p.kind, "none"); assert.match(nextLine(p, t), /No email is sent/); assert.match(sentLine(p, t), /Nobody is emailed/);
});
test("a mix: only the people with an address and not on this device are said to be emailed", () => {
  const p = sendPlan([emailed, here, noMail], ["c"], false);
  assert.equal(p.kind, "some"); assert.equal(p.emailed, 1); assert.doesNotMatch(sentLine(p, t), /Everyone/);
});
test("test mode wins over everything: the email goes only to the sender (D-004)", () => {
  const p = sendPlan([emailed, { role: "d", email: "d@x.test" }], [], true);
  assert.equal(p.kind, "test"); assert.match(nextLine(p, t), /only email goes to you/); assert.match(sentLine(p, t), /only to you/);
});
test("one after another: only the first person is said to be emailed (R8-29), and everyone-at-once still says everyone (control)", () => {
  const two = [emailed, { role: "d", email: "d@x.test" }];
  const turn = sendPlan(two, [], false, "sequential");
  assert.equal(turn.inTurn, true); assert.doesNotMatch(sentLine(turn, t), /Everyone/); assert.match(sentLine(turn, t), /first person has been emailed/);
  const all = sendPlan(two, [], false, "all");
  assert.equal(all.inTurn, false); assert.match(sentLine(all, t), /Everyone on it has been emailed/);
  assert.match(sentLine(sendPlan(two, [], true, "sequential"), t), /only to you/);   // test mode still wins
});

test("Run 8 J6: one person on the send is told about as one person (control: two people keep 'Each person' and 'Everyone')", () => {
  const one = sendPlan([emailed], [], false);
  assert.equal(one.kind, "all"); assert.match(nextLine(one, t), /^The person on it gets an email/); assert.match(sentLine(one, t), /The person on it has been emailed/);
  const two = sendPlan([emailed, { role: "d", email: "d@x.test" }], [], false);
  assert.match(nextLine(two, t), /^Each person gets an email/); assert.match(sentLine(two, t), /Everyone on it has been emailed/);
});
