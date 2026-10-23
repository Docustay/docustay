// The ribbon is derived from true data only: every stage and label below comes from a fact the document has (COMBINED-STYLE-SPEC sections 4 and 7).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ribbonOf } from "../docustay/web/src/lib/ui/ribbon.js";
const tr = (s, v) => (v ? s.replace(/\{(\w+)\}/g, (_, k) => v[k]) : s);
test("a draft shows no stage and says Draft", () => {
  const r = ribbonOf({ state: "draft" }, tr); assert.equal(r.kind, "draft"); assert.equal(r.label, "Draft"); assert.ok(r.stages.every((s) => s.state === "todo"));
});
test("sent and not opened: Sent is done, and it says who it waits on", () => {
  const r = ribbonOf({ state: "sent", sentAt: "2026-10-18T10:00:00Z", totalCount: 2, nextName: "Maple Street Office" }, tr);
  assert.equal(r.reached, 1); assert.equal(r.label, "Waiting on Maple Street Office"); assert.equal(r.stages[0].state, "done"); assert.equal(r.stages[1].state, "current");
});
test("opened by someone: Opened is done and the label names them when known", () => {
  const r = ribbonOf({ state: "sent", sentAt: "2026-10-18T10:00:00Z", openedCount: 1, totalCount: 2, openedBy: "Priya Nair" }, tr);
  assert.equal(r.reached, 2); assert.equal(r.label, "Priya Nair opened it"); assert.equal(r.stages[1].state, "done"); assert.equal(r.stages[2].state, "current");
});
test("partly signed says how many of how many, and Signed is the stage in progress", () => {
  const r = ribbonOf({ state: "partially_signed", sentAt: "2026-10-18T10:00:00Z", openedCount: 2, signedCount: 1, totalCount: 2 }, tr);
  assert.equal(r.reached, 3); assert.equal(r.label, "1 of 2 signed"); assert.equal(r.stages[2].state, "current"); assert.equal(r.stages[3].state, "todo");
});
test("executed is sealed: all four done, the date in the label, the seal flag set", () => {
  const r = ribbonOf({ state: "executed", sentAt: "2026-10-17T10:00:00Z", executedAt: "2026-10-18T19:00:00Z", signedCount: 2, totalCount: 2 }, tr);
  assert.equal(r.kind, "sealed"); assert.equal(r.sealed, true); assert.equal(r.label, "Sealed Oct 18"); assert.ok(r.stages.every((s) => s.state === "done"));
});
test("declined, expired and cancelled show the nearest true stage and a plain word, never a made-up stage", () => {
  assert.equal(ribbonOf({ state: "declined", sentAt: "2026-10-18T10:00:00Z", openedCount: 1 }, tr).label, "Declined");
  const e = ribbonOf({ state: "expired", sentAt: "2026-10-18T10:00:00Z" }, tr); assert.equal(e.label, "Expired"); assert.equal(e.reached, 1); assert.equal(e.current, -1);
  assert.equal(ribbonOf({ state: "voided", sentAt: "2026-10-18T10:00:00Z" }, tr).label, "Cancelled");
});
test("a signature with no recorded open still counts as opened (you cannot sign what you did not open)", () => {
  assert.equal(ribbonOf({ state: "partially_signed", sentAt: "2026-10-18T10:00:00Z", signedCount: 1, totalCount: 3 }, tr).reached, 3);
});
