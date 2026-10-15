// Part 30 item 5 — WHAT A SIGNER MAY AND MUST DO, read live from the organisation's settings so a change applies to documents already sent.
// One function; the signing page gets the answer in the view (`policy`) to draw itself, and the server enforces the same answer where the action happens (sign, decline, delegate) —
// the page is never the only guard.
import { getDocumentSettings } from "./settings.mjs";

export async function signingPolicy(tx) {
  const s = await getDocumentSettings(tx);
  return Object.freeze({
    requireReason: s["signing.require_reason"] === true,
    allowTyped: s["signing.allow_typed"] !== false,
    allowDecline: s["signing.allow_decline"] !== false,
    allowDelegate: s["signing.allow_delegate"] === true,
    allowResubmit: s["signing.allow_resubmit"] === true,
    rememberSignature: s["signing.remember_signature"] === true,
    showSignatureId: s["signing.show_signature_id"] === true,
  });
}

/** The ID printed beside a signature and on the certificate: the first 12 hex characters of the signature record's own hash, in three groups of four (e.g. 9F3A-0C1B-77D2). Anyone can recompute it from the record. */
export const signatureIdOf = (rowHash) => (typeof rowHash === "string" && rowHash.length >= 12 ? rowHash.slice(0, 12).toUpperCase().replace(/(.{4})(?=.)/g, "$1-") : null);
