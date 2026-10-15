// What happens after the last signature, as the sender should see it before sending: the sealed PDF and the email every person gets with it (standard wording; the workspace's own edits live in Settings → Email).
// Pure. The attachment name follows the same rule the sender uses (src/email/signedCopyEmail.mjs): letters, digits, space, _ and - only.
export const attachmentName = (title) => `${(String(title ?? "document").replace(/[^a-zA-Z0-9 _-]/g, "").trim() || "document")}.pdf`;
export function signedCopyEmail({ title, practiceName, recipientName }) {
  const t = String(title ?? "document");
  return { subject: `Your signed copy of ${t}`, body: `Hello ${recipientName || "there"},\n\n${t} was fully signed. Your copy is attached to this email.\n\n— ${practiceName || "Your organisation"}`, attachment: attachmentName(t) };
}
