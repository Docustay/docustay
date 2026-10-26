// src/product/docustayIntegrity.mjs — THE SMALL RULES THAT KEEP THE FREE PLAN FREE AND THE PAID PLANS PAID (the maintainer, 21 Oct 2026; specs/v1/PRICING-INTEGRITY-SPEC.md).
//   canonicalEmail          — one person, one address: lower case, +tags removed where the provider honours them, dots removed for Gmail. Used ONLY to compare people; the real address is what is stored and shown.
//                             (The sign-in lookup, auth/emailCode.mjs normalizedEmailOf, must NOT use it: a dotted Gmail address is a different sign-in identity.)
//   isThrowawayEmail        — a known temporary-mail service (src/product/data/disposableDomains.json: the public-domain disposable-email-domains list, a data file, never fetched at run time)
//   signupRefusal           — may this address start a new FREE workspace? One per person; no throwaway addresses. Asked before a code is sent, before the workspace is made, and again when it is switched on.
//   flagForReview           — the internal review list. Review only: nothing reads it to block anyone.
//   recordSignupIdentity    — remembers who made a workspace (canonical address) so the next sign-up can be compared.
import { readFileSync } from "node:fs";
import { invalid } from "../http/errors.mjs";

/** Providers that ignore a +tag in the part before the @ (kept in step with keystone.canonical_email in migration 0769). */
const PLUS_TAG = new Set(["outlook.com", "hotmail.com", "live.com", "msn.com", "icloud.com", "me.com", "mac.com", "proton.me", "protonmail.com", "pm.me", "fastmail.com", "hey.com", "zoho.com"]);

export function canonicalEmail(email) {
  const e = String(email ?? "").trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1) return e;
  const loc = e.slice(0, at), dom = e.slice(at + 1);
  if (dom === "gmail.com" || dom === "googlemail.com") return `${loc.split("+")[0].replace(/\./g, "") || loc}@gmail.com`;
  if (PLUS_TAG.has(dom)) return `${loc.split("+")[0] || loc}@${dom}`;
  return `${loc}@${dom}`;
}

let throwaway = null;
const throwawaySet = () => { if (!throwaway) { try { throwaway = new Set(JSON.parse(readFileSync(new URL("./data/disposableDomains.json", import.meta.url), "utf8")).domains); } catch { throwaway = new Set(); } } return throwaway; };
/** True for a known temporary-mail domain, or any sub-domain of one (a.b.mailinator.com). */
export function isThrowawayEmail(email) {
  const dom = String(email ?? "").trim().toLowerCase().split("@").pop() ?? "";
  if (!dom) return false;
  const set = throwawaySet(), parts = dom.split(".");
  for (let i = 0; i < parts.length - 1; i += 1) if (set.has(parts.slice(i).join("."))) return true;
  return false;
}

/** TEST ENVIRONMENTS ONLY (the maintainer, 21 Oct 2026: Run 13 makes many beta accounts on QA Gmail plus-addresses, which are one person to the rule below). DOCUSTAY_ONE_FREE_EXEMPT is a comma list of addresses that may each start a Free workspace:
 *  an exact address, or a pattern with * ; an entry beginning with ! takes addresses back out (so the rows that TEST the rule can use addresses that stay covered). Production never sets it (checked at every release). Throwaway domains stay refused. */
const globRe = (g) => new RegExp("^" + g.trim().toLowerCase().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
export function isOneFreeExempt(email, env = process.env) {
  const raw = String(env.DOCUSTAY_ONE_FREE_EXEMPT ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!raw.length) return false;
  const addr = String(email ?? "").trim().toLowerCase();
  const yes = raw.filter((x) => !x.startsWith("!")).some((x) => globRe(x).test(addr));
  return yes && !raw.filter((x) => x.startsWith("!")).some((x) => globRe(x.slice(1)).test(addr));
}

export const THROWAWAY_MESSAGE = "That looks like a temporary email address. Use your own address, so you can always get back into your workspace.";
export const SECOND_FREE_MESSAGE = "You already have a Free workspace under this address. Sign in to it, or choose a paid plan there. Each person gets one Free workspace.";

/** The internal review list. `run(sql, params)` is any query function (a tenant transaction, the signup connection). Once per open flag (the same kind and subject only add up in one row). Never throws: a review note must never stop a sign-up. */
export async function flagForReview(run, { kind, subject, workspaceId = null, detail = {} }) {
  try {
    await run(`SELECT keystone.docustay_review_flag_add($1, $2, $3, $4::jsonb)`, [kind, String(subject).slice(0, 200), workspaceId, JSON.stringify(detail)]);   // a function, not a bare INSERT ... ON CONFLICT: the application may write the list but never read it (R13-D497)
    return true;
  } catch (e) { console.error(`docustay review flag (${kind}) not written: ${e?.message ?? e}`); return false; }
}

/** May this address start a new Free workspace? → null when yes, or { message, code }.
 *  `alias`: true before a code is sent (the exact same address is simply someone coming back, so only a DIFFERENT spelling of an address that already has a Free workspace is refused);
 *  false when a workspace is about to be made (any Free workspace of the same person refuses it). */
export async function signupRefusal(run, { email, alias = false }) {
  const addr = String(email ?? "").trim().toLowerCase();
  if (isThrowawayEmail(addr)) return { code: "throwaway_email", message: THROWAWAY_MESSAGE };
  if (isOneFreeExempt(addr)) return null;
  const { rows: [r] } = await run(`SELECT keystone.docustay_free_workspace_exists($1, $2) AS yes`, [canonicalEmail(addr), alias ? addr : null]);
  if (!r?.yes) return null;
  await flagForReview(run, { kind: "repeat_free_workspace", subject: canonicalEmail(addr), detail: { tried: addr.replace(/^(.).*(@.*)$/, "$1…$2") } });   // the address is hidden but for its first letter and its domain
  return { code: "second_free_workspace", message: SECOND_FREE_MESSAGE };
}
export const assertMayStartFree = async (run, a) => { const x = await signupRefusal(run, a); if (x) throw invalid(x.message, { field: "email", code: x.code }); };

/** Remember who made this workspace. Idempotent. Called when a Docustay workspace is switched on, in the new workspace's own transaction. */
export async function recordSignupIdentity(tx, { tenantId, email }) {
  const addr = String(email ?? "").trim().toLowerCase();
  if (!addr) return;
  await tx.query(`INSERT INTO keystone.docustay_signup_identity (tenant_id, canonical_email, email) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [tenantId, canonicalEmail(addr), addr]);
}
