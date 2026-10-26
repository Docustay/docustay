// src/documents/signingCert.mjs — reads the signing certificate BY NAME, never by shape. Swapping a
// self-signed bundle for a CA-issued one later is changing what DOCUMENT_SIGNING_CERT_P12 holds in
// Secret Manager, never a code change here.
class SigningCertError extends Error {
  constructor(message) { super(message); this.name = "SigningCertError"; }
}

/** @returns {Buffer} the PKCS#12 bundle, decoded from its base64 secret-manager form. */
export function signingCertP12(env = process.env) {
  const b64 = env.DOCUMENT_SIGNING_CERT_P12;
  if (typeof b64 !== "string" || b64.trim() === "") {
    throw new SigningCertError(
      "DOCUMENT_SIGNING_CERT_P12 is not set, so no PDF can be sealed. ★ There is deliberately NO " +
      "fallback: an unsealed 'signed' document would be worse than a clear refusal. Generate one " +
      "with scripts/generate-signing-cert.mjs and store it in Secret Manager (example-project).");
  }
  return Buffer.from(b64, "base64");
}

/** The passphrase the bundle was created with, or empty string (this project's own default). */
export function signingCertPassphrase(env = process.env) {
  return env.DOCUMENT_SIGNING_CERT_PASSPHRASE ?? "";
}
