// P2.9 — RESEND SENDING DOMAIN + DNS CHECKLIST.
//
// ★★★ THIS STEP CAN NEVER BLOCK EMAIL. That is P2.13, and it is decided here rather than in the
// email sender, because this is where the temptation lives: the step "fails" (DNS not verified),
// and the obvious thing is to mark the tenant not-ready-to-send. That would mean a practice that
// signed up this morning cannot send a welcome email until their registrar propagates —
// potentially days, entirely outside their control and ours.
//
// ★ So the sending identity has TWO states and the fallback is ALWAYS available:
//     verified      → send as them:        hello@theirpractice.com
//     not verified  → send via the platform domain, with a VISIBLE banner
//
// ★★ THE BANNER IS NOT DECORATION. Without it the fallback becomes permanent and invisible:
// mail works, nobody chases the DNS, and six months later every client email is still coming
// from the platform domain with the tenant's name spoofed in the display name — which is exactly
// the pattern spam filters punish.
//
// ★ DNS propagation is NOT a failure. It is `awaiting_dns`, a pending state — the same SHAPE
// `awaiting_human` was for Documenso's step before it was retired (S2 Task 3, 01 default 9) — and
// it is polled — never retried with backoff as though the request had failed.

import { classify, Outcome, isSuccess } from "../classify.mjs";
import { callOutside } from "../../http/outside.mjs";
// ★★★ Task 9.13 — THE KILL SWITCH, read fresh every call, no cache (flags.mjs's own rule).
import { withTenant } from "../../db/index.mjs";
import { flagIsOn } from "../../platform/flags.mjs";

export const SendingState = Object.freeze({
  VERIFIED: "verified",
  AWAITING_DNS: "awaiting_dns",
  FAILED: "failed",
});

/** The platform's own verified domain — the fallback that makes email unblockable. */
export const PLATFORM_SENDING_DOMAIN = "mail.keystone.app";

export async function registerSendingDomain({ tenantId, domain }, deps = {}) {
  // ★★★ Task 9.13 — THE GUARD, routed through THIS MODULE'S OWN "resend is unavailable" shape
  //     (built for a real Resend outage, below) rather than a new one. P2.13's invariant — "THIS
  //     STEP CAN NEVER BLOCK EMAIL" — applies exactly as much to the flag being off as to Resend
  //     itself being down: `canSendNow` stays true and the platform-domain fallback still works.
  const resendEnabled = await withTenant(tenantId, (tx) => flagIsOn(tx, "resend_enabled", tenantId));
  if (!resendEnabled) {
    return {
      outcome: "service_disabled",
      sendingState: SendingState.FAILED,
      canSendNow: true,
      sendFrom: PLATFORM_SENDING_DOMAIN,
      banner: fallbackBanner(domain),
      error: {
        code: "resend_disabled",
        message: "resend_enabled is off for this practice — a platform operator turned it off. " +
          "Domain registration is refused until it is switched back on; email still sends from " +
          "the platform domain in the meantime.",
      },
    };
  }

  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const apiKey = deps.apiKey;
  if (!apiKey) throw new Error("resendDomain: no API key supplied (never a hardcoded fallback)");

  // ★ Task 9.6 (CT-064) — the transport moved onto `callOutside` (15 s default); `classify.mjs`
  //   still takes a `{status, message}` / `{code, message}` shaped `err` and is untouched. A
  //   transport failure gets a representative code from `classify.mjs`'s own `transport` set —
  //   `callOutside` does not hand back the provider's raw network error code.
  const result = await callOutside("resend", "https://api.resend.com/domains", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: domain }),
  }, { fetchImpl, timeoutMs: 15_000 });

  let err = null;
  if (result.status === null) {
    err = {
      code: result.timedOut ? "ETIMEDOUT" : "ECONNREFUSED",
      message: result.timedOut ? "resend did not respond within 15000ms" : "resend request failed (no reply)",
    };
  } else if (!result.ok) {
    const p = (result.body && typeof result.body === "object") ? result.body : {};
    err = { status: result.status, message: p?.message ?? p?.error?.message ?? `resend ${result.status}` };
  }

  const outcome = classify("resend", err);

  if (outcome === Outcome.ALREADY_EXISTS) {
    const found = await findSendingDomain(domain, { fetchImpl, apiKey });
    return buildResult(found, { outcome, resolvedByFind: true, domain });
  }
  if (!isSuccess(outcome)) {
    // ★ Even a FATAL registration failure does not stop the tenant sending — it falls back.
    return {
      outcome,
      sendingState: SendingState.FAILED,
      canSendNow: true,
      sendFrom: PLATFORM_SENDING_DOMAIN,
      banner: fallbackBanner(domain),
      error: err,
    };
  }

  const created = result.body;
  return buildResult(created, { outcome: Outcome.SUCCESS, resolvedByFind: false, domain });
}

function buildResult(payload, { outcome, resolvedByFind, domain }) {
  const verified = payload?.status === "verified";
  return {
    outcome,
    resolvedByFind,
    externalId: payload?.id ?? null,
    sendingState: verified ? SendingState.VERIFIED : SendingState.AWAITING_DNS,
    // ★★ TRUE IN EVERY BRANCH. There is no path through this module that returns false.
    canSendNow: true,
    sendFrom: verified ? domain : PLATFORM_SENDING_DOMAIN,
    banner: verified ? null : fallbackBanner(domain),
    dnsChecklist: verified ? [] : buildDnsChecklist(payload, domain),
  };
}

function fallbackBanner(domain) {
  return {
    severity: "warning",
    // ★ Says what works, what is degraded, and what to do. A banner that only says "DNS pending"
    // gets ignored; one that says "your clients see OUR domain" gets acted on.
    title: `Email is sending from ${PLATFORM_SENDING_DOMAIN}, not ${domain}`,
    body:
      `Your email is working — nothing is blocked. But until ${domain} is verified, messages to ` +
      `your clients show our domain as the sender, which looks less trustworthy and is more ` +
      `likely to land in spam. Add the DNS records below to fix it.`,
    action: { label: "Show DNS records", step: "resend_domain" },
  };
}

// ★ RECORD PURPOSES ARE MATCHED ON WHAT THE RECORDS ACTUALLY LOOK LIKE, not on the word.
// [Caught by a red test]: the first version matched /dkim/ against the record NAME — but a DKIM
// record is named `resend._domainkey`, which contains no "dkim" at all. Every DKIM record was
// therefore falling through to the SPF label. A DNS instruction with the WRONG explanation is
// worse than none: the reader adds it to the wrong place, or decides the checklist is unreliable
// and stops following it.
function describeRecord(r) {
  const name = String(r?.name ?? "");
  const value = String(r?.value ?? "");
  const type = String(r?.type ?? "").toUpperCase();

  if (/_domainkey/i.test(name) || /dkim/i.test(name) || /^p=/.test(value)) {
    return "DKIM — cryptographically signs your mail so receivers can prove it was not altered in transit";
  }
  if (/^_dmarc/i.test(name) || /v=DMARC1/i.test(value)) {
    return "DMARC — tells receiving servers what to do when a message fails SPF or DKIM, and where to report it";
  }
  if (/v=spf1/i.test(value) || (type === "TXT" && /^@?$/.test(name))) {
    return "SPF — authorises our servers to send email on your behalf";
  }
  if (type === "MX") {
    return "MX — routes bounce and reply handling for this sending domain";
  }
  // ★ Do NOT guess. An honest "unrecognised" beats a confident wrong label.
  return `${type || "record"} — required by Resend for this sending domain; add it exactly as shown`;
}

function buildDnsChecklist(payload, domain) {
  const records = payload?.records ?? [];
  if (records.length) {
    return records.map((r) => ({
      type: r.type, name: r.name, value: r.value, ttl: r.ttl ?? "auto",
      purpose: describeRecord(r),
      status: r.status ?? "pending",
    }));
  }
  // ★ Never return an empty checklist for an unverified domain — an empty list reads as
  // "nothing to do", which is the opposite of the truth.
  return [{
    type: "UNKNOWN", name: domain, value: "(fetch from Resend)", ttl: "auto",
    purpose: "Resend did not return records yet — re-check this step before telling the tenant they are done",
    status: "unknown",
  }];
}

async function findSendingDomain(domain, { fetchImpl, apiKey }) {
  const result = await callOutside("resend", "https://api.resend.com/domains",
    { headers: { Authorization: `Bearer ${apiKey}` } }, { fetchImpl, timeoutMs: 15_000 });
  if (!result.ok) return null;
  return (result.body?.data ?? []).find((d) => d.name === domain) ?? null;
}
