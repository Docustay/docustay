// THE ONE PLACE THAT NAMES A MODEL, ITS PRICE AND WHICH ONES A HOSTED WORKSPACE MAY USE (AI-COST-AND-USAGE-SPEC §3, §5).
// Nothing else in the application may hard-code a model id: callers ask `modelFor()` in modelPolicy.mjs, and test/docustay_fix2_models.test.mjs fails if an id appears anywhere else.
// Prices are US dollars per MILLION tokens. Last verified against the published price lists: 17 Oct 2026. A model that is in use but missing here is a test failure (costing a call needs its row).
// Pure: no imports.

const PRICES_VERIFIED = "2026-10-17";

/** The one model every hosted person gets (Sonnet 5.5, high effort), the cheap internal model and its fallback. */
export const DEFAULT_MODEL = "claude-sonnet-5-5";
export const INTERNAL_MODEL = "claude-haiku-5-5";
export const INTERNAL_FALLBACK = "claude-haiku-4-5-20251001";
export const DEFAULT_EFFORT = "high";

/** in/out per million tokens, cacheRead/cacheWrite per million; `tiers` (optional) switches the in/out rate when one call's input is over `above` tokens. */
export const PRICES = Object.freeze({
  [DEFAULT_MODEL]: Object.freeze({ in: 2, out: 10, cacheRead: 0.1, cacheWrite: 2.5, label: "Claude Sonnet 5.5" }),
  [INTERNAL_MODEL]: Object.freeze({ in: 0.1, out: 0.5, cacheRead: 0.01, cacheWrite: 0.125, label: "Claude Haiku 5.5", tiers: Object.freeze([{ above: 100_000, in: 0.5, out: 2.5 }]) }),
  [INTERNAL_FALLBACK]: Object.freeze({ in: 1, out: 5, cacheRead: 0.1, cacheWrite: 1.25, label: "Claude Haiku 4.5" }),
  "claude-fable-5-1": Object.freeze({ in: 10, out: 50, cacheRead: 0.25, cacheWrite: 12.5, label: "Claude Fable 5.1" }),
});

/** What a hosted workspace may use (v1 item 18: ONE model for everyone, no picker; the cheap internal model only runs internal jobs). Fable and anything not priced above are for self-host and own-key workspaces only. */
export const HOSTED_MODELS = Object.freeze([DEFAULT_MODEL]);

export const isPriced = (model) => Object.prototype.hasOwnProperty.call(PRICES, model);
export const isHostedModel = (model) => HOSTED_MODELS.includes(model);

/** Cost of one call in MICRO-dollars (a whole number). Unknown model → 0 and `known: false` (the caller records it; the guard test makes an unpriced model in use a failure). */
export function costOf({ model, input = 0, output = 0, cacheRead = 0, cacheWrite = 0 }) {
  const p = PRICES[model];
  if (!p) return { micro: 0, known: false };
  const tier = p.tiers?.filter((t) => input > t.above).at(-1);
  const rin = tier?.in ?? p.in, rout = tier?.out ?? p.out;
  const micro = Math.round(Math.max(0, input) * rin + Math.max(0, output) * rout + Math.max(0, cacheRead) * p.cacheRead + Math.max(0, cacheWrite) * p.cacheWrite);   // $/M × tokens = micro-dollars
  return { micro, known: true };
}
