// src/documents/signedCopySample.mjs — made-up data for "Preview a signed copy" (QUEUE §23.2.8). The preview draws the REAL signed-copy view (mode `signed`) with these sample signatures and a sample
// certificate, using the practice's CURRENT settings — so what the practice sees is exactly what a real signed copy will look like. Nothing here is stored or sent.
export function sampleSignedCopy() {
  const body = {
    kind: "contract", schema_version: 1,
    sections: [
      { key: "intro", title: "Agreement", owner: "client", requires_signature: false, blocks: [
        { type: "prose", text: "This agreement is between " }, { type: "prose", text: "Example Practice", marks: ["bold"] },
        { type: "prose", text: " and the client named below. It shows how a signed copy will look: the letterhead, the header and footer, the signatures and the certificate." }] },
      { key: "terms", title: "1. What you agree to", owner: "client", requires_signature: false, blocks: [
        { type: "prose", text: "You agree to the following:" }, { type: "paragraphBreak" },
        { type: "list", ordered: false, items: [[{ type: "prose", text: "To attend sessions " }, { type: "prose", text: "on time", marks: ["bold"] }], [{ type: "prose", text: "To give 24 hours' notice to cancel" }], [{ type: "prose", text: "To keep your sign-in details private" }]] },
        { type: "paragraphBreak" }, { type: "prose", text: "Either of us may end this agreement at any time, in writing." }] },
      { key: "signatures", title: "Signatures", owner: "client", requires_signature: true, blocks: [
        { type: "signature", key: "client_sig", label: "Client signature", owner: "client" },
        { type: "signature", key: "coach_sig", label: "Coach, for Example Practice", owner: "coach" }] },
    ],
  };
  const signatures = [
    { role: "client", signerName: "Alex Example", signedAt: "2026-01-15T17:30:00.000Z", signerTimezone: "America/Los_Angeles", signedLocalDate: "2026-01-15", markImage: null, signerEmail: "alex@example.com", signerIp: "203.0.113.7" },
    { role: "coach", signerName: "Sam Coach", signedAt: "2026-01-15T18:05:00.000Z", signerTimezone: "America/Los_Angeles", signedLocalDate: "2026-01-15", markImage: null, signerEmail: "sam@example.com", signerIp: "203.0.113.20" },
  ];
  const certificate = {
    completedAt: "2026-01-15T18:05:00.000Z",
    sender: { name: "Sam Coach", email: "sam@example.com" },
    contentSha256: "0".repeat(64),
    parties: [
      { name: "Alex Example", email: "alex@example.com", role: "client", sentAt: "2026-01-15T16:00:00.000Z", viewedAt: "2026-01-15T17:20:00.000Z", viewedIp: "203.0.113.7", viewedUserAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1", consentedAt: "2026-01-15T17:25:00.000Z", consentVersion: "2026-08-15.1", signedAt: "2026-01-15T17:30:00.000Z", signedIp: "203.0.113.7", signedUserAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1" },
      { name: "Sam Coach", email: "sam@example.com", role: "coach", sentAt: "2026-01-15T16:00:00.000Z", viewedAt: "2026-01-15T18:00:00.000Z", viewedIp: "203.0.113.20", viewedUserAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36", consentedAt: "2026-01-15T18:01:00.000Z", consentVersion: "2026-08-15.1", signedAt: "2026-01-15T18:05:00.000Z", signedIp: "203.0.113.20", signedUserAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36" },
    ],
    timeline: [
      { kind: "sent", at: "2026-01-15T16:00:00.000Z", role: null }, { kind: "opened", at: "2026-01-15T17:20:00.000Z", role: "client" },
      { kind: "consented", at: "2026-01-15T17:25:00.000Z", role: "client" }, { kind: "signed", at: "2026-01-15T17:30:00.000Z", role: "client" },
      { kind: "signed", at: "2026-01-15T18:05:00.000Z", role: "coach" }, { kind: "executed", at: "2026-01-15T18:05:00.000Z", role: null },
    ],
  };
  return { title: "Sample coaching agreement", body, signatures, certificate, executedAt: "2026-01-15T18:05:00.000Z" };
}
