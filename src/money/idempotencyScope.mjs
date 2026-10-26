// T1.7a — Every Stripe write carries an Idempotency-Key by default (route writes)
//
// `stripeConnectedRequest` derives a key from the request's scope when the caller passes none
// (F790; ruling: one design, not 35 hand-picked keys). The scope is the inbound request's own
// `Idempotency-Key` header (or null when absent), set once per request in `writes.mjs`'s row
// runner via `runWithScope`. Each Stripe call made while inside that scope gets the next key in
// sequence: `${scope}:${purpose}:${seq}`.

import { AsyncLocalStorage } from "node:async_hooks";

const als = new AsyncLocalStorage();

export const runWithScope = (scope, fn) => als.run({ scope, seq: 0 }, fn);

export const nextScopedKey = (purpose) => {
  const s = als.getStore();
  if (!s?.scope) return null;
  s.seq += 1;
  return `${s.scope}:${purpose}:${s.seq}`;
};
