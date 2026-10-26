// ★★★ ONE CANONICAL JSON STRING, BECAUSE THIS PROJECT HAS NOW BEEN BITTEN BY KEY ORDER TWICE.
//
//   1 · P9.3 — `sendInstance` compared a frozen body against its template with `JSON.stringify` and
//       marked an instrument as having DEPARTED FROM ITS TEMPLATE when nothing had changed but the
//       order the keys were written in. That mark is a statement about a legal instrument.
//   2 · THE P10 CLOSE — `db/gates/p21c_idempotency_all_routes.mjs` compared two response BODIES as
//       raw text and reported `★★★ the same key produced TWO DIFFERENT SUCCESSES` on
//       `/api/accounts/run/pause` and `/api/accounts/run/resume`. The bodies were
//       `{"paused":0,"items":[]}` and `{"items":[],"paused":0}` — **the same answer**. The second
//       was the idempotent REPLAY, read back out of a `jsonb` column, and **`jsonb` does not
//       preserve key insertion order**: it stores keys sorted by length then bytewise. The product
//       was correct and the gate accused it of the most serious failure it knows how to report.
//
// ★★★ AND THE 61 ROUTES THAT PASSED THAT CHECK PASSED BY LUCK, NOT BY CORRECTNESS. Their bodies
//     happened to be written in an order `jsonb` agreed with — one key, or short keys first. A guard
//     whose green depends on the alphabet is not measuring what it claims to measure, in either
//     direction.
//
// ★★ SO IT LIVES HERE RATHER THAN BEING COPIED. A second hand-written copy of this function IS the
//    DUPLICATE-TRUTH class (F345): two implementations of "do these mean the same thing" that can
//    disagree is worse than none, because each caller believes it has the answer.
//
// ★ ARRAY ORDER IS PRESERVED AND THAT IS DELIBERATE, NOT AN OVERSIGHT. The order of sections and
//   blocks IS the document; the order of keys in an object is not. Sorting arrays here would make
//   `canonicalJson` say two genuinely different documents were identical, which is the failure this
//   function exists to prevent, arriving from the other side.
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * ★ "Do these two JSON documents mean the same thing?" — the question callers actually have.
 *   Exposed as its own name so a call site reads as the question rather than as a string compare,
 *   and so neither side can forget to canonicalise only one of the two.
 */
export const sameJson = (a, b) => canonicalJson(a) === canonicalJson(b);
