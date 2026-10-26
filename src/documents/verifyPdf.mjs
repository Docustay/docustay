// src/documents/verifyPdf.mjs — the checker: re-parses an uploaded PDF's own embedded PKCS#7 signature and reports
// whether the file still is what was signed. Behind the public `POST /api/documents/verify` and several tests.
//
// ★ S-1 (security audit, run 5, 10 Oct 2026): this used to compare ONLY the CMS `messageDigest` attribute with the
//   digest of the signed ranges. A forger could embed a CMS carrying the right digest and a garbage signature value and be
//   told `valid: true`, and an incremental update appended after a genuine seal was still `valid: true`. It now does the
//   SAME THREE checks the browser verifier (docustay/web/src/lib/site/verify.js) does:
//     1. the digest the signer signed equals the digest of the file's signed byte ranges;
//     2. the RSA signature value over the signed attributes verifies with the public key of the signer's certificate
//        (node:crypto, synchronous — this function stays synchronous because tests call it that way);
//     3. the last signed range reaches the end of the file, or what follows is Docustay's own validation material
//        (`tailIsValidationOnly`, copied byte for byte from verify.js; test/r3_sec_verify_api.test.mjs compares the two verifiers).
//   It also says whose certificate sealed the file (`signer`, `certSha256`, `sealer` known | unknown).
//
// CRYPTOGRAPHIC CONSISTENCY ONLY: "this exact signature, by the key of the certificate inside the file, was produced over
// this exact file". Never "a certificate authority vouches for who signed it" — the seal is a self-signed certificate;
// `sealer: "known"` is the only statement about whose it is (its fingerprint is on Docustay's published list).
import crypto from "node:crypto";
import forge from "node-forge";

/** The sealing certificates Docustay's own hosted service uses, by SHA-256 of the certificate (DER). MUST equal docustay/web/src/lib/site/sealCertificates.js (test/r3_sec_verify_api.test.mjs checks it). Public data only. */
// ★ Run 8 (F970): EXPORTED on purpose — the parity test compares it with the Verify page's own list. Run 6's dead-export sweep un-exported it (its only importer was that test), and the check went red without anyone seeing.
export const KNOWN_SEAL_CERTIFICATES = [
  { sha256: "644f7423d83bb69a052647bce716b7a5be7ce6352669a8cfeb5d06e303e6e8ed", label: "Docustay hosted service", validUntil: "2036-10-05" },
];

const hexToBytes = (h) => Buffer.from(h, "hex");
const norm = (x) => x.replace(/\s+/g, " ").trim();

/** True only when everything after `reach` is Docustay's own validation material: object definitions that are (a) the catalogue exactly as it was plus a /DSS entry, (b) the DSS dictionary itself, (c) its plain certificate / OCSP / CRL streams, then a cross-reference section and trailer. Anything else (a comment, a page, an annotation, an object stream, a changed catalogue) is false. */
function tailIsValidationOnly(text, reach) {
  let pos = reach; const objs = []; const ws = /[ \t\r\n\f\0]/;
  const skip = () => { while (pos < text.length && ws.test(text[pos])) pos += 1; };
  for (;;) {
    skip(); if (pos >= text.length) break;
    const rest = text.slice(pos, pos + 64);
    let m = /^(\d+)\s+(\d+)\s+obj\b/.exec(rest);
    if (m) {
      const bodyStart = pos + m[0].length; const endObj = text.indexOf("endobj", bodyStart); if (endObj < 0) return false;
      const streamAt = text.indexOf("stream", bodyStart); const hasStream = streamAt >= 0 && streamAt < endObj;
      let dictText, next;
      if (hasStream) {
        dictText = text.slice(bodyStart, streamAt); const len = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dictText); if (!len) return false;
        let ds = streamAt + 6; if (text[ds] === "\r") ds += 1; if (text[ds] !== "\n") return false; ds += 1;
        const de = ds + Number(len[1]); const tail = /^\s*endstream\s*endobj/.exec(text.slice(de, de + 40)); if (!tail) return false;
        next = de + tail[0].length;
      } else { dictText = text.slice(bodyStart, endObj); next = endObj + 6; }
      objs.push({ num: Number(m[1]), dict: norm(dictText), stream: hasStream }); pos = next; continue;
    }
    if (rest.startsWith("xref")) { const tr = text.indexOf("trailer", pos); if (tr < 0) return false; pos = tr + 7; skip(); const d = /^<<[\s\S]*?>>/.exec(text.slice(pos, pos + 2000)); if (!d) return false; pos += d[0].length; skip(); const se = /^startxref\s+\d+\s+%%EOF/.exec(text.slice(pos, pos + 64)); if (!se) return false; pos += se[0].length; continue; }
    return false;                                   // a comment, a bare keyword, anything that is not an object or the cross-reference section
  }
  if (objs.length === 0) return false;
  let sawDss = false;
  for (const o of objs) {
    if (/\/Type\s*\/DSS\b/.test(o.dict) && !o.stream) { const keys = [...o.dict.matchAll(/\/([A-Za-z0-9]+)/g)].map((k) => k[1]).filter((k) => !/^(\d+)$/.test(k)); if (keys.some((k) => !["Type", "DSS", "Certs", "OCSPs", "CRLs", "VRI"].includes(k))) return false; sawDss = true; continue; }
    if (/\/Type\s*\/Catalog\b/.test(o.dict) && !o.stream) {
      const before = [...text.slice(0, reach).matchAll(new RegExp(`(?:^|[\\s>])${o.num}\\s+0\\s+obj\\b([\\s\\S]*?)endobj`, "g"))].pop(); if (!before) return false;
      const strip = (x) => norm(x).replace(/\s*\/DSS\s+\d+\s+0\s+R/, "").replace(/\s+/g, " "); if (!/\/DSS\s+\d+\s+0\s+R/.test(o.dict) || strip(o.dict) !== strip(before[1])) return false; continue;
    }
    if (o.stream && /^<<\s*\/Length\s+\d+\s*>>$/.test(o.dict)) continue;       // a plain certificate / OCSP / CRL stream: no filter, no type, nothing it could decode into
    if (/\/Type\s*\/XRef\b/.test(o.dict) && o.stream) continue;
    return false;
  }
  return sawDss;
}


const DIGEST = { "2.16.840.1.101.3.4.2.1": "sha256", "2.16.840.1.101.3.4.2.2": "sha384", "2.16.840.1.101.3.4.2.3": "sha512", "1.3.14.3.2.26": "sha1" };
const bin = (s) => Buffer.from(s, "latin1");

/** The CMS signature itself: RSA PKCS#1 v1.5 over the DER of the signed attributes (as a SET), with the public key of the signer's certificate. Never throws. */
function checkCmsSignature(p7) {
  try {
    const rc = p7.rawCapture ?? {}; const attrs = rc.authenticatedAttributes;
    if (!attrs?.length || !rc.signature) return { ok: false, error: "no signed attributes or signature value" };
    const hash = DIGEST[forge.asn1.derToOid(rc.digestAlgorithm)]; if (!hash) return { ok: false, error: "an unsupported digest algorithm" };
    const serial = rc.serial ? forge.util.bytesToHex(rc.serial).replace(/^0+/, "") : null;
    const cert = (p7.certificates ?? []).find((c) => serial !== null && c.serialNumber.replace(/^0+/, "").toLowerCase() === serial.toLowerCase()) ?? p7.certificates?.[0];
    if (!cert) return { ok: false, error: "the signer's certificate is not in the file" };
    if (!cert.publicKey?.n) return { ok: false, error: "the signer's key is not an RSA key", cert, hash };
    const set = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, attrs);   // the signature covers the attributes as a DER SET, not as the [0] they are stored in
    const signedBytes = bin(forge.asn1.toDer(set).getBytes());
    const key = crypto.createPublicKey({ key: bin(forge.asn1.toDer(forge.pki.publicKeyToAsn1(cert.publicKey)).getBytes()), format: "der", type: "spki" });
    const ok = crypto.verify(hash, signedBytes, { key, padding: crypto.constants.RSA_PKCS1_PADDING }, bin(rc.signature));
    return { ok, cert, hash };
  } catch (e) { return { ok: false, error: String(e?.message ?? e).slice(0, 120) }; }
}

const certFingerprint = (cert) => crypto.createHash("sha256").update(bin(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes())).digest("hex");

/**
 * @param {Buffer|Uint8Array} pdfBuffer
 * @returns {{ signed:boolean, valid:boolean, reason:string|null, byteRange?:number[], signer?:string|null, timestamped?:boolean, coversWholeFile?:boolean, signatureChecked?:boolean, certSha256?:string|null, sealer?:"known"|"unknown", sha256?:string }}
 */
export function verifySignedPdf(pdfBuffer) {
  const buf = Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer);
  const text = buf.toString("latin1");
  if (!text.startsWith("%PDF")) return { signed: false, valid: false, reason: "no embedded signature found (that does not look like a PDF)" };
  const dicts = [...text.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)];
  const timestamped = /\/Type\s*\/DocTimeStamp/.test(text);
  if (dicts.length === 0) return { signed: false, valid: false, reason: "no embedded signature found (no ByteRange)", timestamped };
  let last = null;
  for (const m of dicts) {
    const after = text.slice(m.index, m.index + 400000), c = /\/Contents\s*<([0-9A-Fa-f]+)>/.exec(after);
    if (!c) continue;
    const near = text.slice(Math.max(0, m.index - 600), m.index + 600);
    if (/ETSI\.RFC3161/.test(near)) continue;       // the timestamp, not the seal
    last = { range: m.slice(1).map(Number), contents: c[1] };
  }
  if (!last) return { signed: false, valid: false, reason: "no embedded signature found (only a timestamp)", timestamped };
  const [a, b, c2, d] = last.range;
  if (a !== 0 || a + b > c2 || c2 + d > buf.length) return { signed: true, valid: false, reason: "the signed byte range is not valid for this file — the file has been altered", byteRange: last.range, timestamped };
  const signedData = Buffer.concat([buf.subarray(a, a + b), buf.subarray(c2, c2 + d)]);
  let p7;
  try {
    const trimmed = last.contents.replace(/(00)+$/, "");
    p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(hexToBytes(trimmed).toString("latin1"), { strict: false }));
  } catch (err) {
    return { signed: true, valid: false, reason: `could not parse the embedded signature (${err.message})`, byteRange: last.range, timestamped };
  }
  // 1. the digest that was signed (the `messageDigest` signed attribute) against the digest of the signed ranges, in the algorithm the signature names
  const sigCheck = checkCmsSignature(p7);
  const attrs = p7.rawCapture?.authenticatedAttributes ?? [];
  const mdAttr = attrs.find((x) => { try { return forge.asn1.derToOid(x.value[0].value) === forge.pki.oids.messageDigest; } catch { return false; } });
  const signedDigest = mdAttr ? mdAttr.value?.[1]?.value?.[0]?.value : null;
  let digestMatches = false;
  try {
    const alg = DIGEST[forge.asn1.derToOid(p7.rawCapture.digestAlgorithm)];
    digestMatches = Boolean(signedDigest && alg) && forge.util.bytesToHex(signedDigest) === crypto.createHash(alg).update(signedData).digest("hex");
  } catch { digestMatches = false; }
  // 2. the signature value (sigCheck.ok); 3. the seal reaches the whole file
  const reach = Math.max(...dicts.map((m) => Number(m[3]) + Number(m[4])));
  const coversWholeFile = reach >= buf.length || tailIsValidationOnly(text, reach);
  const valid = digestMatches && sigCheck.ok === true && coversWholeFile;
  const cert = sigCheck.cert ?? p7.certificates?.[0];
  let certSha256 = null; try { certSha256 = cert ? certFingerprint(cert) : null; } catch { certSha256 = null; }
  const sealer = certSha256 && KNOWN_SEAL_CERTIFICATES.some((k) => k.sha256 === certSha256) ? "known" : "unknown";
  const signer = cert ? (cert.subject.getField("CN")?.value ?? null) : null;
  let reason = null;
  if (!valid) {
    if (!digestMatches) reason = "the signed content does not match its digest — the file has been altered";
    else if (sigCheck.ok !== true) reason = `the seal itself is damaged or was not made by the certificate it names: its signature does not check (${sigCheck.error ?? "signature mismatch"})`;
    else reason = "the file has been changed since it was signed — content was added after the seal (altered after signing)";
  }
  return {
    signed: true, valid, reason, byteRange: last.range, signer, timestamped, coversWholeFile,
    signatureChecked: sigCheck.ok === true || sigCheck.error === undefined,
    certSha256, sealer, sha256: crypto.createHash("sha256").update(buf).digest("hex"),
  };
}
