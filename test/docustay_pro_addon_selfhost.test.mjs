// Self-hosted Pro key behaviour for the add-on: a valid note loads Pro, an expired / tampered / other-install note falls back to Community; delivery needs a valid key.
import { test } from "node:test"; import assert from "node:assert/strict"; import { spawnSync } from "node:child_process";
import { generateKeyPairSync, sign, createHash } from "node:crypto"; import { mkdtempSync, writeFileSync } from "node:fs"; import { tmpdir } from "node:os"; import path from "node:path";
const root = new URL("..", import.meta.url).pathname;
const { publicKey, privateKey } = generateKeyPairSync("ed25519"); const other = generateKeyPairSync("ed25519");
const b64u = (b) => Buffer.from(b).toString("base64url");
const note = (priv, over = {}) => { const n = { v: 1, plan: "pro", installId: "11111111-1111-4111-8111-111111111111", issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString(), ...over }; const p = b64u(JSON.stringify(n)); return { entitlement: p, signature: b64u(sign(null, Buffer.from(p), priv)) }; };
function probe(entitlement) {
  const dir = mkdtempSync(path.join(tmpdir(), "ds-ent-")); writeFileSync(path.join(dir, "install-id"), "11111111-1111-4111-8111-111111111111\n");
  if (entitlement) writeFileSync(path.join(dir, "entitlement.json"), JSON.stringify(entitlement));
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", `const a = await import(${JSON.stringify(new URL("../src/documents/addon.mjs", import.meta.url).href)}); console.log("R:" + JSON.stringify(a.selfHostProNote()));`],
    { cwd: root, encoding: "utf8", env: { ...process.env, KEYSTONE_SELF_HOST: "1", KEYSTONE_DATA_DIR: dir, DOCUSTAY_PRO_ADDON: "", DOCUSTAY_LICENSE_PUBLIC_KEY: publicKey.export({ type: "spki", format: "pem" }) } });
  assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout.split("\n").find((l) => l.startsWith("R:")).slice(2));
}
test("a valid, current note for this install is Pro", () => assert.equal(probe(note(privateKey)).ok, true));
test("an expired note falls back to Community", () => assert.equal(probe(note(privateKey, { expiresAt: new Date(Date.now() - 1000).toISOString() })).reason, "expired"));
test("a tampered note is rejected", () => { const n = note(privateKey); const bad = { ...n, entitlement: b64u(JSON.stringify({ ...JSON.parse(Buffer.from(n.entitlement, "base64url")), expiresAt: "2099-01-01T00:00:00Z" })) }; assert.equal(probe(bad).reason, "bad_signature"); });
test("a note signed by someone else's key is rejected", () => assert.equal(probe(note(other.privateKey)).reason, "bad_signature"));
test("a note for another install (a second install needs its own key) is rejected", () => assert.equal(probe(note(privateKey, { installId: "22222222-2222-4222-8222-222222222222" })).reason, "other_install"));
test("no note at all is Community", () => assert.equal(probe(null).ok, false));

const { deliverAddon } = await import("../src/product/docustayAddonDelivery.mjs");
const hash = (k) => createHash("sha256").update(k).digest("hex");
process.env.KEYSTONE_DOCUSTAY_LICENSE_SIGNING_KEY = privateKey.export({ type: "pkcs8", format: "pem" });
const mkTx = (lic) => ({ query: async (sql) => (/FOR UPDATE/.test(sql) ? { rows: lic ? [lic] : [] } : { rows: [], rowCount: 1 }) });
const ID = "11111111-1111-4111-8111-111111111111", KEY = "dsl_" + "a".repeat(28);
const get = async ({ key }) => key.endsWith("latest.tgz") ? { ok: true, body: Buffer.from("BUNDLE"), sha256: "x" } : { ok: false, status: 404 };
const good = { key_hash: hash(KEY), install_id: null, expires_at: new Date(Date.now() + 864e5), revoked_at: null };
test("delivery: a valid key gets the bundle (positive control)", async () => { const r = await deliverAddon(mkTx(good), { tenantId: "t", key: KEY, installId: ID }, { get }); assert.equal(r.body.toString(), "BUNDLE"); });
test("delivery: unknown, revoked, expired and other-install keys all get the same refusal and no bytes", async () => {
  for (const lic of [null, { ...good, revoked_at: new Date() }, { ...good, expires_at: new Date(Date.now() - 1000) }, { ...good, install_id: "22222222-2222-4222-8222-222222222222" }])
    await assert.rejects(deliverAddon(mkTx(lic), { tenantId: "t", key: KEY, installId: ID }, { get }), /not valid/);
});
test("delivery: no key at all is refused", async () => assert.rejects(deliverAddon(mkTx(good), { tenantId: "t", key: "", installId: ID }, { get }), /not valid/));
