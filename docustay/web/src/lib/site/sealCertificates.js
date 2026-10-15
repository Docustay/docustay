// The sealing certificates Docustay's own hosted service uses, by the SHA-256 of the certificate (DER). The Verify page compares the certificate inside a file's signature with this list:
// on the list = "sealed by Docustay's hosted service"; not on the list = "sealed by a certificate we do not recognise" (a self-hosted install uses its own, which is normal; so is a copy forged by anyone who names a certificate "Docustay").
// A new hosted certificate is added here (and the old one kept, so files sealed before the change still verify as known). Public data only: fingerprints of public certificates.
export const KNOWN_SEAL_CERTIFICATES = [
  { sha256: "644f7423d83bb69a052647bce716b7a5be7ce6352669a8cfeb5d06e303e6e8ed", label: "Docustay hosted service", validUntil: "2036-10-05" },
];
