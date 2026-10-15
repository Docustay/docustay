// S5 / 5F-22 (F559) — THE ONE PLACE A CLIENT MINTS AN Idempotency-Key FOR A SUBMIT.
//
// ★★★ THE RULE THIS FILE SERVES (the maintainer, 21 Sep 2026): every client call that mutates sends an
//     `Idempotency-Key`, generated ONCE per submit/user action and REUSED on a retry of that same
//     action. A double-click or a network retry must send the SAME key; a new user action gets a new one.
// ★★ THE ONCE-PER-SUBMIT RULE IS ENFORCED BY WHERE THE KEY IS STORED, NOT BY THIS FUNCTION. The caller
//    keeps the key in a variable that OUTLIVES one call (component scope on a page; the argument on an
//    `api.js` method), mints it with `??=` on the first attempt, and clears it only when the action
//    reached a definitive end. A helper that stored the key itself would hide that decision from the one
//    place that knows whether the action is over.
//
// The server reads the header at `src/http/idempotency.mjs` `requireIdempotencyKey`: a string of 8–200
// characters, no character set. A UUID is 36.

/** A key for ONE submit. 36 chars — inside src/http/idempotency.mjs's 8–200 window. */
export function newIdempotencyKey() { return crypto.randomUUID(); }
