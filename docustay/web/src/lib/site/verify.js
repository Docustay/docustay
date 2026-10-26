// Checks a signed PDF's own embedded signature IN THE BROWSER (nothing is uploaded). Same test as the server's verifier: the digest the signer signed must equal the digest of the file's signed byte ranges, so a byte changed
// anywhere outside the signature itself fails. This proves consistency of this signature over this file; it does not say who the signer is (the seal is Docustay's own certificate).
import forge from "node-forge";
import { KNOWN_SEAL_CERTIFICATES } from "./sealCertificates.js";

const latin = (u8, a, b) => { let s = ""; for (let i = a; i < b; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, Math.min(b, i + 0x8000))); return s; };
const hexToBytes = (h) => { const out = new Uint8Array(h.length / 2); for (let i = 0; i < out.length; i += 1) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16); return out; };
const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");

const norm = (x) => x.replace(/\s+/g, " ").trim();
/** True only when everything after `reach` is Docustay's own validation material: object definitions that are (a) the catalogue exactly as it was plus a /DSS entry, (b) the DSS dictionary itself, (c) its plain certificate / OCSP / CRL streams, then a cross-reference section and trailer. Anything else (a comment, a page, an annotation, an object stream, a changed catalogue) is false. */
export function tailIsValidationOnly(text, reach) {
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


const DIGEST = { "2.16.840.1.101.3.4.2.1": "SHA-256", "2.16.840.1.101.3.4.2.2": "SHA-384", "2.16.840.1.101.3.4.2.3": "SHA-512", "1.3.14.3.2.26": "SHA-1" };
const binToU8 = (s) => Uint8Array.from(s, (ch) => ch.charCodeAt(0));
/** Checks the CMS signature itself: RSA PKCS#1 v1.5 over the DER of the signed attributes, with the public key of the signer's certificate (forge parses; the maths is the browser's own WebCrypto, not forge's). Never throws. */
async function checkCmsSignature(p7) {
  try {
    const rc = p7.rawCapture ?? {}; const attrs = rc.authenticatedAttributes; if (!attrs?.length || !rc.signature) return { ok: false, error: "no signed attributes or signature value" };
    const hash = DIGEST[forge.asn1.derToOid(rc.digestAlgorithm)]; if (!hash) return { ok: false, error: "an unsupported digest algorithm" };
    const serial = rc.serial ? forge.util.bytesToHex(rc.serial).replace(/^0+/, "") : null;
    const cert = (p7.certificates ?? []).find((c) => serial !== null && c.serialNumber.replace(/^0+/, "").toLowerCase() === serial.toLowerCase()) ?? p7.certificates?.[0]; if (!cert) return { ok: false, error: "the signer's certificate is not in the file" };
    if (!cert.publicKey?.n) return { ok: false, error: "the signer's key is not an RSA key, which this page cannot check", cert };
    const set = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, attrs);   // the signature covers the attributes as a DER SET, not as the [0] they are stored in
    const signedBytes = binToU8(forge.asn1.toDer(set).getBytes());
    const spki = binToU8(forge.asn1.toDer(forge.pki.publicKeyToAsn1(cert.publicKey)).getBytes());
    const key = await crypto.subtle.importKey("spki", spki, { name: "RSASSA-PKCS1-v1_5", hash }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, binToU8(rc.signature), signedBytes);
    return { ok, cert };
  } catch (e) { return { ok: false, error: String(e?.message ?? e).slice(0, 120) }; }
}
const certFingerprint = async (cert) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", binToU8(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes()))));

/** @returns {{ signed:boolean, valid:boolean, reason?:string, signer?:string|null, timestamped:boolean, coversWholeFile?:boolean, sha256?:string }} */
export async function verifyPdfBytes(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const text = latin(u8, 0, u8.length);
  if (!text.startsWith("%PDF")) return { signed: false, valid: false, reason: "That does not look like a PDF.", timestamped: false };
  const dicts = [...text.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)];
  const timestamped = /\/Type\s*\/DocTimeStamp/.test(text);
  if (dicts.length === 0) return { signed: false, valid: false, reason: "No digital signature was found in this file.", timestamped };
  let last = null;
  for (const m of dicts) {
    const after = text.slice(m.index, m.index + 400000), c = /\/Contents\s*<([0-9A-Fa-f]+)>/.exec(after);
    if (!c) continue;
    const near = text.slice(Math.max(0, m.index - 600), m.index + 600);
    if (/ETSI\.RFC3161/.test(near)) continue;       // the timestamp, not the seal
    last = { range: m.slice(1).map(Number), contents: c[1] };
  }
  if (!last) return { signed: false, valid: false, reason: "No document seal was found (only a timestamp).", timestamped };
  const [a, b, c2, d] = last.range;
  const signedData = new Uint8Array(b + d); signedData.set(u8.subarray(a, a + b), 0); signedData.set(u8.subarray(c2, c2 + d), b);
  let p7;
  try {
    const trimmed = last.contents.replace(/(00)+$/, "");
    p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(latin(hexToBytes(trimmed), 0, trimmed.length / 2), { strict: false }));
  } catch (e) { return { signed: true, valid: false, reason: `The embedded signature could not be read (${e.message}).`, timestamped }; }
  const sha = new Uint8Array(await crypto.subtle.digest("SHA-256", signedData));
  const attrs = p7.rawCapture?.authenticatedAttributes ?? [];
  const md = attrs.find((x) => { try { return forge.asn1.derToOid(x.value[0].value) === forge.pki.oids.messageDigest; } catch { return false; } });
  const signedDigest = md ? md.value?.[1]?.value?.[0]?.value : null;
  const digestMatches = Boolean(signedDigest) && forge.util.bytesToHex(signedDigest) === hex(sha);
  const sigCheck = await checkCmsSignature(p7);
  const valid = digestMatches && sigCheck.ok;
  const cert = sigCheck.cert ?? p7.certificates?.[0];
  const certSha256 = cert ? await certFingerprint(cert).catch(() => null) : null;
  const sealer = certSha256 && KNOWN_SEAL_CERTIFICATES.some((k) => k.sha256 === certSha256) ? "known" : "unknown";
  const signer = cert ? (cert.subject.getField("CN")?.value ?? null) : null;
  // A file Docustay seals is a chain of revisions: the document and its seal, then the Certificate of Completion page with a trusted timestamp that covers it, then (for long-term validation) a last revision that only adds the timestamp authority's certificates and revocation answers (a DSS).
  // That last revision is the only thing allowed after the last signed range, and it is checked by what it IS (an allow-list of objects), not by what it lacks: a deny-list can be walked around, and stream contents (where an update could hide) are not readable by it.
  const reach = Math.max(...dicts.map((m) => Number(m[3]) + Number(m[4])));
  const coversWholeFile = reach >= u8.length || tailIsValidationOnly(text, reach);
  const reason = valid ? undefined : digestMatches ? `The seal itself is damaged or was not made by the certificate it names: its signature does not check (${sigCheck.error ?? "signature mismatch"}).` : "The file no longer matches what was signed: it was changed after sealing, or the seal is damaged.";
  return { signed: true, valid, reason, signer, timestamped, coversWholeFile, signatureChecked: sigCheck.ok === true || sigCheck.error === undefined, certSha256, sealer, sha256: hex(new Uint8Array(await crypto.subtle.digest("SHA-256", u8))) };
}
