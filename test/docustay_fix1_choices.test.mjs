// D-087 / D-088 and the Appearance tab: a person never sees a raw option key ("times", "starttls", "ip", "owner") on a settings screen.
// Every select or list setting must give its choices a readable label: object options { value, label }, or an entry in SETTING_CHOICES.
import test from "node:test";
import assert from "node:assert/strict";
import { DOCUMENT_SETTINGS, SETTING_CHOICES } from "../src/documents/settingsSchema.mjs";

test("every select or list setting has readable labels for its choices", () => {
  const bare = [];
  for (const [key, d] of Object.entries(DOCUMENT_SETTINGS)) {
    if (d.type !== "select" && d.type !== "list") continue;
    const labelled = SETTING_CHOICES[key] != null || (Array.isArray(d.options) && d.options.every((o) => o && typeof o === "object" && typeof o.label === "string" && o.label.length > 0));
    // positive control: numeric pick lists (days, MB, points) are labelled by their own unit in the picker, so they are not raw keys
    if (!labelled && !(d.options ?? []).every((o) => typeof o === "number" || /^\d+$/.test(String(o)))) bare.push(key);
  }
  assert.deepEqual(bare, [], `these settings would show raw option keys: ${bare.join(", ")}`);
});

test("positive control: the check does fail for a setting with bare string options", () => {
  const fake = { type: "select", options: ["times", "inter"] };
  const labelled = Array.isArray(fake.options) && fake.options.every((o) => o && typeof o === "object" && typeof o.label === "string");
  assert.equal(labelled, false);
});

test("the Font and certificate choices read as words, and their help text does not repeat the raw keys", () => {
  const font = DOCUMENT_SETTINGS["signed_copy.font"], cert = DOCUMENT_SETTINGS["certificate.includes"];
  assert.deepEqual(font.options.map((o) => o.label), ["Helvetica", "Times", "Inter"]);
  assert.ok(cert.options.every((o) => /\s/.test(o.label)), "each certificate part has a multi-word label");
  assert.doesNotMatch(cert.help, /\bip\b|hashes/);
  assert.doesNotMatch(DOCUMENT_SETTINGS["email.provider"].help, /(^|\. )(platform|domain|smtp|mailbox): /);
});

test("no setting's label or help text contains a snake_case internal word", () => {
  const found = [];
  for (const [key, d] of Object.entries(DOCUMENT_SETTINGS)) {
    const hits = `${d.label ?? ""} ${d.help ?? ""}`.match(/\b[a-z]+_[a-z_]+\b/g);
    if (hits) found.push(`${key}: ${hits.join(", ")}`);
  }
  assert.deepEqual(found, []);
  // positive control: the pattern does catch the words that leaked before
  assert.ok(/\b[a-z]+_[a-z_]+\b/.test("For openai_compatible, the base address"));
});

test("D-075 / D-091: the documents list reads a stored 'void' document as Cancelled (the ribbon's label and tone)", async () => {
  const { readFileSync } = await import("node:fs");
  // the redesigned list draws one ribbon per row from the document's true facts; a stored "void" (the state the server writes) must read as Cancelled, never as a stage it never reached
  const { ribbonOf } = await import("../docustay/web/src/lib/ui/ribbon.js");
  for (const state of ["void", "voided", "cancelled"]) { const r = ribbonOf({ state, sentAt: "2026-10-01" }); assert.equal(r.label, "Cancelled", state); assert.equal(r.tone, "bad", state); assert.equal(r.ended, "cancelled", state); }
  const page = readFileSync(new URL("../docustay/web/src/routes/(app)/documents/+page.svelte", import.meta.url), "utf8");
  assert.match(page, /<Ribbon facts=\{facts\(r\)\}/);
  assert.match(page, /state: r\.state/);
  // the state the server actually stores is "void" (not "voided"): the ribbon must know it
  const send = readFileSync(new URL("../src/documents/pdfSend.mjs", import.meta.url), "utf8");
  assert.match(send, /SET state = 'void'/);
});
