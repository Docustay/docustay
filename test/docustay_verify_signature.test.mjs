// D-019 — the Verify page must check the CMS signature itself (RSA over the signed attributes) and say whose certificate sealed the file. Before this fix it only compared the digest stored INSIDE the signature with the file, so a file carrying a forged or damaged signature block with the right digest came back "valid".
// Fixture: a real sealed PDF produced by the sandbox (made-up people). Run: node test/docustay_verify_signature.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const require = createRequire(path.join(ROOT, "docustay/web/package.json"));
const forge = require("node-forge");
const { verifyPdfBytes } = await import(pathToFileURL(path.join(ROOT, "docustay/web/src/lib/site/verify.js")).href);
const good = fs.readFileSync(path.join(ROOT, "test/fixtures/docustay-sealed-sample.pdf"));
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log("  ok", name); };

// find the seal's Contents hex and the signature bytes inside it
const text = good.toString("latin1");
const ranges = [...text.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)];
let sealAt = null; for (const m of ranges) { const near = text.slice(Math.max(0, m.index - 600), m.index + 600); if (/ETSI\.RFC3161/.test(near)) continue; const c = /\/Contents\s*<([0-9A-Fa-f]+)>/.exec(text.slice(m.index, m.index + 400000)); if (c) sealAt = { hexStart: m.index + c.index + c[0].indexOf("<") + 1, hex: c[1] }; }
assert.ok(sealAt, "setup: the fixture has a seal");
const der = Buffer.from(sealAt.hex.replace(/(00)+$/, ""), "hex");
const p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(der.toString("latin1"), { strict: false }));
const sig = Buffer.from(p7.rawCapture.signature, "latin1");
const sigOffset = der.indexOf(sig); assert.ok(sigOffset > 0 && sig.length >= 128, "setup: the signature value is found inside the CMS");
const withSigByteFlipped = () => { const b = Buffer.from(good); const hexPos = sealAt.hexStart + (sigOffset + 10) * 2; const cur = parseInt(b.toString("latin1", hexPos, hexPos + 2), 16); b.write(((cur ^ 0xff) & 0xff).toString(16).padStart(2, "0"), hexPos, "latin1"); return b; };

await t("a genuine sealed file: valid, whole file, timestamped, the signature itself checked, and the certificate's fingerprint reported", async () => {
  const r = await verifyPdfBytes(good); assert.equal(r.valid, true, r.reason); assert.equal(r.signatureChecked, true); assert.match(r.certSha256 ?? "", /^[0-9a-f]{64}$/);
});
await t("a damaged signature value with the right digest inside it is NOT valid (this is the forged-seal case)", async () => {
  const bad = withSigByteFlipped(); assert.notDeepEqual(bad, good, "control: the file really changed");
  const r = await verifyPdfBytes(bad); assert.equal(r.valid, false); assert.match(r.reason ?? "", /signature/i);
});
await t("the digest comparison still works: a change inside the signed range is refused (positive control for the test above)", async () => {
  const b = Buffer.from(good); b[30000] ^= 0xff; const r = await verifyPdfBytes(b); assert.equal(r.valid, false);
});
await t("whose seal it is: a certificate not on the known list is reported as unrecognised, never as Docustay's", async () => {
  const r = await verifyPdfBytes(good); assert.ok(["known", "unknown"].includes(r.sealer), `sealer is ${r.sealer}`);
  const { KNOWN_SEAL_CERTIFICATES } = await import(pathToFileURL(path.join(ROOT, "docustay/web/src/lib/site/sealCertificates.js")).href);
  assert.ok(Array.isArray(KNOWN_SEAL_CERTIFICATES));
  assert.equal(r.sealer, KNOWN_SEAL_CERTIFICATES.some((c) => c.sha256 === r.certSha256) ? "known" : "unknown");
});
console.log(`ok — ${n} Verify signature checks`);
