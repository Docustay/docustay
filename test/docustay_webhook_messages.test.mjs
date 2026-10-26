// D-024 — the sentences a developer reads when Docustay refuses a webhook address: plain words, no internal jargon, and each says what to do. Run: node test/docustay_webhook_messages.test.mjs
import assert from "node:assert/strict";
const { assertPublicDestination } = await import("../src/webhooks/outbound.mjs");
const refuse = async (url, resolve) => { try { await assertPublicDestination(url, resolve ? { resolve } : undefined); } catch (e) { return e.message; } return null; };
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log("  ok", name); };
const JARGON = /SCHEMA|HMAC|\bRLS\b|undefined|\bnull\b/;
await t("an http:// address is refused in plain words that say what to use instead", async () => {
  const m = await refuse("http://example.com/hook", async () => ["93.184.216.34"]); assert.ok(m, "it was refused"); assert.doesNotMatch(m, JARGON); assert.match(m, /https:\/\//); assert.match(m, /start with/i);
});
await t("a private address is refused with advice for a developer working on a laptop", async () => {
  const m = await refuse("https://example.com/hook", async () => ["127.0.0.1"]); assert.ok(m); assert.match(m, /private network/); assert.doesNotMatch(m, JARGON); assert.match(m, /public/i);
});
await t("positive control: a public https address passes", async () => { assert.equal(await refuse("https://example.com/hook", async () => ["93.184.216.34"]), null); });
console.log(`ok — ${n} checks`);
