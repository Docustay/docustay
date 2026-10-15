// A throwaway signing certificate that a test or gate MAKES ITSELF, so nothing that needs to seal a PDF can silently skip for want of DOCUMENT_SIGNING_CERT_P12.
// (The sealing bug hid for weeks because the d4/d6 tests said "UNRUN — requires DOCUMENT_SIGNING_CERT_P12" and passed.)
// Call useOwnSigningCert() BEFORE importing src/documents/pdf.mjs.
import forge from "node-forge";

export function makeP12Base64(pass = "own-cert") {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey; cert.serialNumber = "01";
  cert.validity.notBefore = new Date(Date.now() - 86400000); cert.validity.notAfter = new Date(Date.now() + 86400000 * 30);
  const attrs = [{ name: "commonName", value: "Docustay" }];
  cert.setSubject(attrs); cert.setIssuer(attrs); cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], pass, { algorithm: "3des" });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary").toString("base64");
}

/** Sets the three env vars the sealer reads. The timestamp authority is pointed at a dead port: no network in a test, and "sealed without a timestamp" is allowed. */
export function useOwnSigningCert(env = process.env) {
  env.DOCUMENT_SIGNING_CERT_P12 = makeP12Base64("own-cert");
  env.DOCUMENT_SIGNING_CERT_PASSPHRASE = "own-cert";
  env.DOCUMENT_TSA_URL = "http://127.0.0.1:9";
}
