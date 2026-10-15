// src/product/demoHold.mjs — the import-free half of the demo (Launch step 8): is this workspace a demo, and "hold this email instead of sending it". The mail layers use this; nothing here imports anything.
export async function demoRow(tx) {
  const { rows: [r] } = await tx.query(`SELECT tenant_id, owner_user_id, created_at, expires_at, seeded_at, ai_prompts, uploads, converted_at FROM keystone.docustay_demo WHERE converted_at IS NULL`);
  return r ?? null;
}
const URL_IN = /https?:\/\/[^\s"'<>)]+/g;
const signLinkOf = (text) => (String(text ?? "").match(URL_IN) ?? []).find((u) => /\/sign\b|\/s\/|[?&]t=/.test(u)) ?? null;
const id = () => `demo-${globalThis.crypto.randomUUID()}`;
/**
 * If this workspace is a demo, record what would have been sent and answer "sent" (so the product carries on exactly as if it had). `message` is { to, subject, text, html } or a function returning one (called only for a demo).
 * Returns null for a real workspace. The seed's own sends are recorded too, so the inbox opens with the sample signing emails and the visitor can sign as the sample signer straight away.
 */
export async function holdMail(tx, message) {
  const d = await demoRow(tx); if (!d) return null;
  const m = typeof message === "function" ? await message() : message;
  const body = String(m.text ?? "") || String(m.html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const pid = id();
  await tx.query(`INSERT INTO keystone.docustay_demo_mail (tenant_id, created_at, to_addr, subject, body_text, link) VALUES (keystone.current_tenant_id(), clock_timestamp(), $1, $2, $3, $4)`, [String(m.to).slice(0, 320), String(m.subject ?? "").slice(0, 300), body.slice(0, 6000), signLinkOf(m.text ?? m.html)]);
  return { status: "sent", providerMessageId: pid, error: null, held: true };
}
