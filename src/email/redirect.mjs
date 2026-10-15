// ★★★ 08 §4/§7 — WHERE AN EMAIL MAY GO DEPENDS ON WHERE THIS PROCESS RUNS. Staging holds seeded fake
//     people whose addresses can still be real inboxes; local can hold anything. The ONE sender calls this
//     immediately before the provider, so no caller can forget it.
import { EmailConfigError } from "./resend.mjs";
import { captureTarget } from "./capture.mjs";

const list = (v) => String(v ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

export function redirectForEnvironment({ to, subject }, env = process.env) {
  const environment = env.KEYSTONE_ENVIRONMENT;
  if (captureTarget(env)) return { to, subject, redirectedFrom: null };   // captured mail cannot leave: any address is safe
  const allowed = list(env.KEYSTONE_EMAIL_ALLOWLIST).includes(String(to).toLowerCase());
  if (environment === "production") return { to, subject, redirectedFrom: null };
  if (environment === "staging") {
    if (allowed) return { to, subject: `[STAGING] ${subject}`, redirectedFrom: null };
    const inbox = env.KEYSTONE_STAGING_INBOX;
    if (!inbox || !inbox.includes("@")) throw new EmailConfigError("staging has no KEYSTONE_STAGING_INBOX, so it will not send to a real recipient");
    return { to: inbox, subject: `[STAGING] (to ${to}) ${subject}`, redirectedFrom: to };
  }
  if (environment === "local") {
    if (allowed) return { to, subject: `[LOCAL] ${subject}`, redirectedFrom: null };
    throw new EmailConfigError("local never sends real email (address not in KEYSTONE_EMAIL_ALLOWLIST)");
  }
  throw new EmailConfigError(`KEYSTONE_ENVIRONMENT is ${JSON.stringify(environment ?? null)}; refusing to send`);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ CT-094 (Stage 7 task 9.11, from CC-3) — THE SANDBOX REWRITE, A SECOND AND SEPARATE FUNCTION.
//
//     `redirectForEnvironment` above answers "where does this PROCESS run" — production, staging or
//     local — from `KEYSTONE_ENVIRONMENT`. A sandbox is a TENANT (`keystone.tenant.sandbox_of`,
//     0049), not a process: a sandbox practice on production is still production, so
//     `redirectForEnvironment` sees `environment === "production"` and returns `{ to, subject,
//     redirectedFrom: null }` — it cannot see a sandbox at all, and it is not asked to (08 §6's own
//     table keys sandbox behaviour on the tenant flag, "checked in the credential loader and send
//     endpoint", never on the environment). Hence Q9-7 and this second function, applied AFTER
//     `redirectForEnvironment` in the send path (`src/email/send.mjs:114` already calls the first).
//
// ★★ CT-068 IS UNCHANGED. Nothing above this comment was touched by this task — same signature,
//    same four branches, same three environment variables it reads.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ★ When `isSandbox`, prefixes the subject `[SANDBOX] ` and rewrites `to` to the sandbox owner's
 *   own address — a sandbox holds no client data (`src/sandbox/writes.mjs` COPY_REFUSES), so there
 *   is no real client address to protect, and the owner is the only person who should ever see a
 *   sandbox's mail. Returns the same `{ to, subject, redirectedFrom }` shape
 *   `redirectForEnvironment` does, so a caller need not branch on which one ran.
 * ★ A non-sandbox tenant passes through UNCHANGED — this function adds nothing when `isSandbox` is
 *   false, which is what proves the rewrite above is doing something rather than always relabelling.
 * ★ Fails loud rather than silently mailing the wrong address: a sandbox with no known owner email
 *   is a caller that forgot to look one up, not a case to guess through.
 */
export function redirectForSandbox({ to, subject }, { isSandbox, ownerEmail } = {}) {
  if (!isSandbox) return { to, subject, redirectedFrom: null };
  if (typeof ownerEmail !== "string" || !ownerEmail.includes("@")) {
    throw new EmailConfigError(
      "this is a sandbox practice, so its mail must be rewritten to the sandbox owner's own " +
      "address — but no ownerEmail was given, and there is no real client address to fall back to");
  }
  return { to: ownerEmail, subject: `[SANDBOX] ${subject}`, redirectedFrom: to };
}
