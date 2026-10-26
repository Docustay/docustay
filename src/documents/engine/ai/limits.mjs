// THE LIMITS THAT PROTECT THE BILL (AI-COST-AND-USAGE-SPEC §4). One pure function: given the policy the host's plan produced and what the ledger says has been used, may this call run?
// The order matters: the platform's own pause first (nothing the customer can fix), then the abuse pause, then the request-rate limits, then the allowance (credits, then dollars; the allowance belongs to the workspace, not to a person). A paid plan past its allowance may go on at the plan's per-draft price (the answer carries `overage`); Free stops.
// A workspace using ITS OWN provider key skips the allowance, the dollar cap and the platform pause (it costs the platform nothing) but never the abuse and rate limits. Pure: no imports.

export const MSG = Object.freeze({
  allowance: "Your AI allowance for this month is used.",
  upgrade: "Switch to Pay as you go to keep drafting at $0.30 a draft.",
  minute: "That is a lot of requests in a minute. Wait a moment and try again.",
  hour: "This workspace has made a lot of AI requests this hour. Try again a little later.",
  day: "This workspace has used its AI requests for today. They reset at midnight UTC.",
  abuse: "AI is paused for this workspace for a few minutes because of a run of failed or refused requests. It resumes by itself.",
  platform: "AI is paused for everyone right now. Your documents are safe, and the guided builder still works. It will be back soon.",
});

/** The message a person reads when the allowance is used: what to do about it depends on the plan. */
const allowanceMessage = (policy, resetsOnText = null) => `${MSG.allowance} ${policy?.plan === "free" ? MSG.upgrade : resetsOnText ? `It resets on ${resetsOnText}.` : ""}`.trim();

const refuse = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
const ABUSE_WINDOW_MS = 10 * 60_000, ABUSE_PAUSE_MS = 15 * 60_000, ABUSE_MAX = 10;

/**
 * @param {object} a
 * @param {object|null} a.policy   null = no hosted limits (a self-host, or an organisation on no Docustay plan)
 * @param {object} a.usage         { creditsUsed, usdMicroUsed, userCreditsUsed, perMinute, perHour, perDay, failuresInWindow, lastFailureAt (ms|null) }
 * @param {number} a.weight        the credits this call would cost
 * @param {boolean} [a.own]        the workspace uses its own provider key
 * @param {{paused:boolean, ceilingReached:boolean}} [a.platform]
 * @param {number} [a.now]         ms
 * @param {string|null} [a.resetsOnText]
 */
export function decide({ policy, usage, weight, own = false, platform = { paused: false, ceilingReached: false }, now = Date.now(), resetsOnText = null }) {
  if (!own && policy && (platform.paused || platform.ceilingReached)) return refuse("ai_platform_paused", MSG.platform, { event: "refused_ceiling" });
  const u = usage ?? {};
  if ((u.failuresInWindow ?? 0) > ABUSE_MAX && u.lastFailureAt && now - u.lastFailureAt < ABUSE_PAUSE_MS) return refuse("ai_abuse_pause", MSG.abuse, { event: "refused_limit", retryAfterSeconds: Math.ceil((ABUSE_PAUSE_MS - (now - u.lastFailureAt)) / 1000) });
  if (!policy) return { ok: true };
  if (policy.perMinute && (u.perMinute ?? 0) >= policy.perMinute) return refuse("ai_rate_minute", MSG.minute, { event: "refused_limit", retryAfterSeconds: 60 });
  if (policy.perHour && (u.perHour ?? 0) >= policy.perHour) return refuse("ai_rate_hour", MSG.hour, { event: "refused_limit", retryAfterSeconds: 3600 });
  if (policy.perDay && (u.perDay ?? 0) >= policy.perDay) return refuse("ai_rate_day", MSG.day, { event: "refused_limit" });
  if (own) return { ok: true };
  const credits = u.creditsUsed ?? 0;
  let overage = false;
  if (policy.creditsPerMonth != null && weight > 0 && credits + weight > policy.creditsPerMonth + 1e-9) {
    if (policy.draftOverMinor == null) return refuse("ai_limit_credits", allowanceMessage(policy, resetsOnText), { event: "refused_limit" });
    overage = true;   // billed at the plan's price per extra draft; the host shows the price before use and meters it when the draft succeeds
  }
  if (policy.usdCapMicro != null && (u.usdMicroUsed ?? 0) >= policy.usdCapMicro) return refuse("ai_limit_usd", allowanceMessage(policy, resetsOnText), { event: "refused_limit" });
  return overage ? { ok: true, overage: true, overageMinor: policy.draftOverMinor } : { ok: true };
}

/** 0 → 1 of the allowance used, for the bar; null when there is no allowance to measure against. */
export const fractionUsed = (policy, creditsUsed, usdMicroUsed = 0) => {
  if (!policy || policy.creditsPerMonth == null) return null;
  const byCredits = policy.creditsPerMonth > 0 ? creditsUsed / policy.creditsPerMonth : 1;
  const byUsd = policy.usdCapMicro ? usdMicroUsed / policy.usdCapMicro : 0;
  return Math.min(1, Math.max(byCredits, byUsd));
};
/** calm < 80 percent, low from 80 (amber), used at 100 (red). */
export const stateOf = (fraction) => (fraction == null ? "none" : fraction >= 1 - 1e-9 ? "used" : fraction >= 0.8 - 1e-9 ? "low" : "calm");
