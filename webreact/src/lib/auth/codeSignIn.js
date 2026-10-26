// webui/src/lib/auth/codeSignIn.js — TASK 8.16: the two network calls the "code" stage of
// `webui/src/routes/login/+page.svelte` needs, plus the Firebase custom-token exchange, kept in
// ONE place so the page itself carries no network code beyond what it already has.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ REVISED 21 Sep 2026, F633 — THE FAILURE COPY, EXACT. `verifyEmailCode`
//     (`src/auth/emailCode.mjs:208-213`, task 8.7) deliberately collapses its outcomes into only
//     TWO messages for `code/verify` (CCR-10, the enumeration defence): `WRONG` gets its own
//     message; `EXPIRED`, `TOO_MANY` (the 5-attempt ceiling) and `NO_CODE` are all collapsed into
//     the SAME message. Both are 4xx (`forbidden`, 403), so `src/http/errors.mjs`'s `AppError`
//     passes the message straight through unchanged on the wire (only a 5xx is replaced with the
//     generic sentence). `verifyCode` below therefore surfaces `error.message` VERBATIM rather than
//     inventing a third distinction the server never signals — see STAGE-8-PLAN.md §8.16 field 4
//     and FINDINGS.md F633 for the full reasoning.
// ★★ `requestCode` is different: `code/request`'s 429 (`kind: "rate_limited"`,
//    `takeCodeRequestBudget`, `emailCode.mjs:96-111`) carries the SERVER'S OWN retry-budget wording
//    ("Too many code requests. Try again later."), not the screen's copy. The screen's fixed
//    sentence is chosen HERE, by `kind`, not by relaying the server's literal text — the same
//    "screen owns its own copy" pattern `+page.svelte`'s `handlePassword` already uses for
//    Firebase's TOO_MANY_ATTEMPTS/BLOCKED codes.
// ★ Neither `code/request` nor `code/verify`'s failure copy says whether the address has an
//   account — `code/request` is 200 either way (8.12), and this module must not undo that by
//   wording.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const RATE_LIMITED_MESSAGE = "Too many attempts for that address. Try again in a few minutes.";

/**
 * `POST /api/auth/code/request` — always resolves `{ expiresAt }` on 200, for a registered address
 * and an unregistered one alike (8.7's enumeration defence). Only a 429 gets its own copy here;
 * anything else falls back to the server's own message.
 * @param {string} email
 * @returns {Promise<{ expiresAt: string }>}
 */
export async function requestCode(email) {
  const res = await fetch("/api/auth/code/request", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body?.error?.kind === "rate_limited"
        ? RATE_LIMITED_MESSAGE
        : (body?.error?.message ?? "Sign-in by code is not available right now.");
    throw new Error(message);
  }
  return { expiresAt: body?.expiresAt };
}

/**
 * `POST /api/auth/code/verify` — redeems the 6-digit code and mints a Firebase custom token. No
 * session, no cookie — the caller exchanges the custom token for an id token at Google's own
 * endpoint (`exchangeCustomToken` below) and posts THAT to `/api/auth/login`.
 * @param {string} email
 * @param {string} code
 * @returns {Promise<{ customToken: string }>}
 */
export async function verifyCode(email, code) {
  const res = await fetch("/api/auth/code/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, code }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    // ★★ VERBATIM — see header. The server's own message IS the screen's copy for this call.
    throw new Error(body?.error?.message ?? "That code was not accepted.");
  }
  return { customToken: body?.customToken };
}

/**
 * Exchange a Firebase custom token for an id token — the SAME REST style
 * `webui/src/routes/login/+page.svelte`'s `handlePassword` already uses at
 * `accounts:signInWithPassword`, deliberately, so this screen does not introduce the Firebase JS
 * SDK (Q8-5, recommended NOT in Stage 8) as a second way of talking to Firebase.
 * @param {string} customToken
 * @param {string} apiKey
 * @returns {Promise<{ idToken: string }>}
 */
export async function exchangeCustomToken(customToken, apiKey) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error("Sign-in by code is not available right now.");
  }
  return { idToken: payload?.idToken };
}
