// P13.2 / P13.3 — FIREBASE TOKEN VERIFICATION, AND THE CLAIM READING THAT FOLLOWS IT.
//
// ★★ THE RULING SURVIVES; ITS STATED BASIS DOES NOT. §D2 kept Firebase because "app_user is keyed
// on Firebase UIDs already". [MEAS] FALSE — there was no uid column until migration 0019. The
// two bases that DO survive and are enough on their own: the accounts, password hashes and OAuth
// links live in Firebase Auth and there is no migration off them that does not force a re-auth
// event for every user; and the maintainer ruled it in session.
//
// ★ verifyIdToken needs only a projectId, NOT a service account. `applicationDefault()` with an
//   explicit projectId ships NO PRIVATE KEY AT ALL — one fewer secret to rotate, store or leak.
//   A service account is required only for MINTING tokens and for the Admin user-management API,
//   and this process does neither.

import { isLocalToken, verifyLocalToken } from "./localIdentity.mjs";
import { initializeApp, applicationDefault, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { unauthenticated, forbidden, internal } from "../http/errors.mjs";

let authInstance = null;

export function getFirebaseAuth() {
  if (authInstance) return authInstance;
  const projectId = process.env.KEYSTONE_FIREBASE_PROJECT_ID;
  if (!projectId) {
    // ★ Fail loud, never a default. A verifier with no project id would accept a token issued for
    //   ANY Firebase project — see the aud/iss note below, which is the whole boundary.
    throw internal("KEYSTONE_FIREBASE_PROJECT_ID is not set — refusing to guess a Firebase project");
  }
  if (getApps().length === 0) {
    const raw = process.env.KEYSTONE_FIREBASE_SERVICE_ACCOUNT_JSON;
    initializeApp({
      projectId,
      credential: raw ? cert(JSON.parse(raw)) : applicationDefault(),
    });
  }
  authInstance = getAuth();
  return authInstance;
}

/** For the gate: drive the whole path with a stub verifier and no network. */
export function __setAuthForTests(a) { authInstance = a; }

// ─────────────────────────────────────────────────────────────────────────────
// ★★★ THE CLAIM KEY. NAME IT AS A LITERAL — THIS IS WHERE THE TRAP IS.
// ─────────────────────────────────────────────────────────────────────────────
// [MEAS, the live claim-minting code] a real token carries:
//     { role: 'pir', orgId: 'example', tenantId: 'consumer' }
// ★★ THERE IS A CLAIM LITERALLY CALLED `tenantId` AND IT IS THE WRONG ONE. Its value is the
// hardcoded string 'consumer' FOR EVERY USER. An implementer told "the org claim becomes
// tenant_id" reaches for the key of that name and sets EVERY USER TO ONE CONTEXT — a total
// collapse of tenancy that would look like it was working, because one tenant's users would all
// see one tenant's data.
// ★ The org key is `orgId`, and it is named here as a literal constant so the wrong one cannot be
//   reached for by autocomplete.
export const ORG_CLAIM_KEY = "orgId";
export const WRONG_CLAIM_KEY = "tenantId"; // ★ named so the gate can assert it is NEVER read

/**
 * Pull the org slug out of a decoded token.
 * ★★ ASSERTS typeof === 'string'. `orgId` HAS BEEN OBSERVED AS AN ARRAY — `["example"]` — on real
 *    production records. `String(["example"])` is `"example"`, so a lenient coercion would appear to
 *    work and would then fail, or worse succeed wrongly, on `["a","b"]`.
 */
export function orgSlugFromClaims(decoded) {
  const raw = decoded?.[ORG_CLAIM_KEY];
  if (raw === undefined || raw === null || raw === "") {
    // ★★★ NEVER DEFAULT. A signature-valid token with no org claim is REFUSED (P13.7d). Falling
    //     through to "the first tenant" or "the platform tenant" is the `|| signerByRole.client`
    //     failure class: one party's credential quietly catching another's branch.
    throw unauthenticated("token carries no org claim");
  }
  if (typeof raw !== "string") {
    throw unauthenticated(
      `org claim is ${Array.isArray(raw) ? "an array" : typeof raw}, not a string — refusing to coerce it`
    );
  }
  return raw;
}

/**
 * ★ Verify, and map every failure to ONE ErrorKind.
 *
 * ★★★ ERROR CLASSIFICATION, MEASURED: only expiry gets its own code (`auth/id-token-expired`).
 * A FORGED SIGNATURE, an UNKNOWN kid, the WRONG FIREBASE PROJECT and an alg substitution ALL
 * collapse to `auth/argument-error`, separable only by substring-matching the message — which
 * errors.mjs:1-9 exists specifically to forbid ("that decision cannot be made by pattern-matching
 * on a message string").
 * ★★ So they are ALL mapped to a single UNAUTHENTICATED, and no attempt is made to tell them
 *    apart in logs by message. The gate asserts each case reaches 401 through its OWN SDK path;
 *    it does not assert we can name which.
 *
 * ★ `verifyIdToken` FAILS CLOSED when Google's key endpoint is unreachable and the cache has
 *   lapsed (max-age measured at ~5h45m). That is correct. ★ Known hazard: a `kid` present but
 *   absent from the cached set errors WITHOUT REFETCHING, and the message says "Most likely the
 *   ID token is expired" — a misleading message on a condition the operator did not cause.
 */
export async function verifyIdToken(idToken, { checkRevoked = false } = {}) {
  if (typeof idToken !== "string" || idToken.length === 0) {
    throw unauthenticated("no id token presented");
  }
  // a token the built-in identity issued (only accepted when that identity is switched on — see src/auth/localIdentity.mjs)
  if (isLocalToken(idToken)) return verifyLocalToken(idToken);
  try {
    return await getFirebaseAuth().verifyIdToken(idToken, checkRevoked);
  } catch (err) {
    // ★ The code is kept on the error for the GATE to assert (so a vendor reword is caught), and
    //   is deliberately NOT used to vary the response. The client is told one thing: 401.
    const e = unauthenticated("invalid credential");
    e.detail = { code: err?.code ?? "unknown" };
    throw e;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// P13.6 — THE ROLE, AND WHERE IT COMES FROM.
// ─────────────────────────────────────────────────────────────────────────────
// ★★★ THE RANK IS READ FROM THE DATABASE ROW, NEVER FROM THE TOKEN. A token claim is Google's
// assertion about IDENTITY. `role` and `staff_role` are OUR statements about what a person may
// do, and they live in `app_user` where a tenant admin can change them and where RLS applies.
// A token-carried role is a permission the holder can keep for an hour after we revoke it, and
// — since claims are set by us and cached by them — one we cannot see.
//
// ★★ MEASURED: the live claim carries `role: 'pir'`. 'pir' is NOT in app_user's CHECK set
// ('staff','adult_client','adolescent_client','parent') and is NOT on authorise.mjs's RANK
// ladder — so `effectiveRank({role:'pir'})` returns NULL and refuses that user EVERY section.
//
// ★★★ THE MAPPING, NAMED RATHER THAN LEFT AS A SURPRISE:
export const LEGACY_ROLE_CLAIM_MAP = Object.freeze({
  // 'pir' = person in recovery. In Keystone's vocabulary that is a CLIENT, and the adult/
  // adolescent split is a property of the PERSON, not of the claim — a token cannot know a date
  // of birth. So the claim alone CANNOT decide it.
  pir: null,
});

/**
 * ★★ WHAT HAPPENS TO A 'pir' CLAIM IN THE MEANTIME, STATED SO IT IS NOT DISCOVERED:
 * NOTHING. The claim's `role` is never consulted for authorisation. The person's row in
 * `app_user` carries the real role, and a legacy user who has no row in the resolved tenant is
 * REFUSED (P13.7d) rather than admitted with a guessed rank.
 * ★ This function exists only so the gate can assert the claim role is IGNORED — it is not a
 *   translation layer, and building one would be inventing an authorisation source.
 */
export function claimRoleIsAuthoritative() { return false; }
