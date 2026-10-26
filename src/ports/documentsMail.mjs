// src/ports/documentsMail.mjs — PLATFORM'S IMPLEMENTATION OF THE DOCUMENTS ISLAND'S MAIL PORT (QUEUE §23.3.4). Everything provider-specific lives here, never in the island: the platform's Resend account,
// the environment backstop (a non-production process never mails a real recipient), and the Resend Domains API an organisation uses to send from its own domain.
//
//   send({to, subject, html, text, attachments?, identity})   one email through the platform's provider, from the identity's From line (platform "<Org> via the platform" or the verified own domain)
//   routeRecipient({to, subject})                              where an email to `to` may actually go in THIS environment (throws when it may not) — the island applies it before an SMTP send too
//   platformSender()                                           the platform's own address
//   domains.create(domain) / verify(ref) / get(ref)            the sending domain: Resend's records to add, and whether Resend sees them yet
import { sendViaResend, emailIsConfigured, resendApiKey } from "../email/resend.mjs";
import { redirectForEnvironment } from "../email/redirect.mjs";
import { fromLineFor, platformAddress } from "../email/signLinkEmail.mjs";
import { callOutside } from "../http/outside.mjs";

export const platformSender = () => ({ name: "Workbench", address: platformAddress() });

export const routeRecipient = ({ to, subject }) => redirectForEnvironment({ to, subject }, process.env);

export async function send({ to, subject, html, text, attachments = null, identity = null, orgName = "" }) {
  if (!emailIsConfigured()) return { status: "skipped", providerMessageId: null, error: "RESEND_API_KEY is not set" };
  let routed;
  try { routed = redirectForEnvironment({ to, subject }, process.env); } catch (e) { return { status: "skipped", providerMessageId: null, error: e.message }; }
  const { from, replyTo } = fromLineFor(identity, { practiceName: orgName });
  const out = await sendViaResend({ to: routed.to, from, subject: routed.subject, text, html, ...(replyTo ? { replyTo } : {}), ...(attachments ? { attachments } : {}) });
  return out.ok ? { status: "sent", providerMessageId: out.providerMessageId, error: null } : { status: "failed", providerMessageId: null, error: out.error };
}

// ── the Resend Domains API ────────────────────────────────────────────────────────────────────
const API = "https://api.resend.com";
const call = (method, path, body) => callOutside("resend", `${API}${path}`, {
  method, headers: { authorization: `Bearer ${resendApiKey()}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}),
}, { timeoutMs: 15_000 });

const asState = (status) => (status === "verified" ? "verified" : status === "failed" || status === "temporary_failure" ? "failed" : "pending");
const shape = (d) => ({
  ref: d?.id ?? null, status: asState(d?.status),
  records: (d?.records ?? []).map((r) => ({ record: r.record ?? null, name: r.name ?? "", type: r.type ?? "", value: r.value ?? "", priority: r.priority ?? null, ttl: r.ttl ?? "Auto", status: r.status ?? "not_started" })),
});
function failure(r, what) {
  const msg = r.status === null ? `could not reach the email provider (${r.timedOut ? "timed out" : "no reply"})` : (r.body?.message ?? `the email provider answered ${r.status}`);
  const e = new Error(`${what}: ${msg}`); e.status = r.status; return e;
}

export const domains = {
  async create(domain) {
    const r = await call("POST", "/domains", { name: domain });
    if (r.ok) return shape(r.body);
    if (r.status === 409 || /already/i.test(r.body?.message ?? "")) {   // the platform account already has this domain: find it
      const list = await call("GET", "/domains");
      const found = list.ok ? (list.body?.data ?? []).find((d) => d.name === domain) : null;
      if (found) return domains.get(found.id);
    }
    throw failure(r, "adding the sending domain");
  },
  async verify(ref) {
    const r = await call("POST", `/domains/${encodeURIComponent(ref)}/verify`);
    if (!r.ok) throw failure(r, "asking the provider to verify the domain");
    return domains.get(ref);
  },
  async get(ref) {
    const r = await call("GET", `/domains/${encodeURIComponent(ref)}`);
    if (!r.ok) throw failure(r, "reading the sending domain");
    return shape(r.body);
  },
};
