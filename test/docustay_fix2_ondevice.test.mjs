// D-051: a self-hosted install without email may still send when nobody needs an email (everyone signs on this device).
import test from "node:test";
import assert from "node:assert/strict";
process.env.KEYSTONE_SELF_HOST = "1";
const { assertMaySend } = await import("../src/product/docustay.mjs");
const tx = { query: async () => ({ rows: [] }) };
test("no email needed: the send is not refused for missing email", async () => {
  await assert.doesNotReject(assertMaySend(tx, { tenantId: "00000000-0000-0000-0000-000000000001", needsEmail: false }));
});
test("positive control: an email is needed and none is set up: refused with the Settings → Email sentence", async () => {
  await assert.rejects(assertMaySend(tx, { tenantId: "00000000-0000-0000-0000-000000000001", needsEmail: true }), /Settings → Email|Email isn't set up/);
});
