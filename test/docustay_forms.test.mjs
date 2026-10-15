// Stage 2 (7 Oct 2026): the pure parts of Forms and People.
import test from "node:test";
import assert from "node:assert/strict";
import { cleanFormSettings, closedReason, FORM_DEFAULTS } from "../src/documents/forms.mjs";
import { splitName, csvCell, upsertContact } from "../src/documents/contacts.mjs";

test("cleanFormSettings: valid values, clearing, and refusals", () => {
  const s = cleanFormSettings({ verifyEmail: true, copyTo: " Records@Example.com ", responseLimit: "25", expiresAt: "2026-12-01T00:00:00Z", intro: "  Welcome  " });
  assert.deepEqual(s, { ...FORM_DEFAULTS, verifyEmail: true, copyTo: "records@example.com", expiresAt: "2026-12-01", responseLimit: 25, intro: "Welcome" });   // Run 7: every other key keeps its default
  assert.deepEqual(cleanFormSettings(null), FORM_DEFAULTS);
  // clearing with null / empty keeps the rest
  const base = cleanFormSettings({ responseLimit: 5, copyTo: "a@b.co" });
  assert.equal(cleanFormSettings({ responseLimit: null }, base).responseLimit, null);
  assert.equal(cleanFormSettings({ responseLimit: null }, base).copyTo, "a@b.co");
  // refusals
  for (const bad of [{ verifyEmail: "yes" }, { copyTo: "not-an-address" }, { responseLimit: 0 }, { responseLimit: 1.5 }, { responseLimit: 100001 }, { expiresAt: "tomorrow-ish" }, { intro: "x".repeat(1001) }, { nonsense: 1 }]) {
    assert.throws(() => cleanFormSettings(bad), (e) => e.status === 400 || e.statusCode === 400 || /400|invalid|validation/i.test(String(e.kind ?? e.name ?? e.message)), JSON.stringify(bad));
  }
});

test("closedReason: expired and full, with a control that an open form is open", () => {
  const now = Date.parse("2026-10-07T12:00:00Z");
  assert.equal(closedReason({ expiresAt: "2026-10-07T11:59:59Z" }, 0, now), "expired");
  assert.equal(closedReason({ expiresAt: "2026-10-08T00:00:00Z" }, 0, now), null);
  assert.equal(closedReason({ responseLimit: 3 }, 3, now), "full");
  assert.equal(closedReason({ responseLimit: 3 }, 2, now), null);
  assert.equal(closedReason({}, 99999, now), null);
  assert.equal(closedReason({ expiresAt: "2026-10-07T11:00:00Z", responseLimit: 1 }, 5, now), "expired");
});

test("splitName and csvCell", () => {
  assert.deepEqual(splitName("Mary Ann Smith"), ["Mary Ann", "Smith"]);
  assert.deepEqual(splitName("Dana"), ["Dana", ""]);
  assert.deepEqual(splitName("   "), ["", ""]);
  assert.equal(csvCell('He said "hi", then left'), '"He said ""hi"", then left"');
  assert.equal(csvCell("=HYPERLINK(\"x\")"), `"'=HYPERLINK(""x"")"`);   // a spreadsheet formula is defused
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell(null), "");
});

test("upsertContact: a bad address saves nothing; a good one is lower-cased and keeps the first spelling", async () => {
  const calls = [];
  const tx = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [{ id: "c1" }] }; } };
  assert.equal(await upsertContact(tx, { tenantId: "t", name: "X", email: "not-an-email" }), null);
  assert.equal(calls.length, 0);
  assert.equal(await upsertContact(tx, { tenantId: "t", name: "Dana Reyes", email: " Dana@Example.COM " }), "c1");
  assert.deepEqual(calls[0].params.slice(1, 4), ["Dana", "Reyes", "dana@example.com"]);
  assert.match(calls[0].sql, /ON CONFLICT \(tenant_id, email\)/);
});
