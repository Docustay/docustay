// P10.6 / CT-085 — ONE CLIENT-SIDE TERM HELPER, WIRED TO THE MAP THE APPLICATION ALREADY SENDS.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THIS FILE DOES NOT RESOLVE ANYTHING. `src/terminology/resolve.mjs` (server-side) is the
//     resolver — it reads the tenant's stored overrides and merges them with the English fallback.
//     `src/routes/app.mjs:156` already puts that resolved map on the wire on every `/api/app/**`
//     load. This module is the ONE place a Svelte component reads it back, so the two hand-rolled
//     copies this task found (`ClientApp.svelte`'s `terms?.[...] ?? {...}` and
//     `ClientSurfaces.svelte`'s `word()`) stop being two places a lookup can drift.
//
// ★★★ AND A MISS IS LOUD, NEVER A DOTTED TOKEN. `src/terminology/keys.mjs`'s own header records why
//     this whole layer is allowed to exist: the sibling project's i18next echoed the raw key on a
//     miss (`t('userType.pir')` printed literally). `term()` below can only return an override, the
//     English fallback, or a THROW — a key with no fallback is impossible (every `TERM_KEYS` entry
//     carries one, proven by `db/gates/p10_6_one_vocabulary_one_resolver.mjs` §1), and a key that is
//     not in `TERM_KEYS` at all is refused rather than silently rendered.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { TERM_KEYS, TERM_FALLBACKS } from "@keystone/terminology/keys.mjs";

/** ★ ONE LIST, imported rather than copied — the server's `TERM_KEYS` and this array are the same
 *  frozen array, by identity (proven in `test/e10a_5_client_terms.test.mjs`). */
export const TERM_KEYS_CLIENT = TERM_KEYS;

// ★★ MODULE-LEVEL STATE, NOT A STORE. `setTerms` is called once per portal load, by the ONE
//    component that receives the map from the server (`ClientApp.svelte`'s `$effect`); every other
//    component reads through `term()` rather than receiving the map as a prop of its own — which is
//    exactly the duplication this task exists to end. Starts empty so `term()` still answers with
//    the English fallback before the first `setTerms()` call lands.
let current = {};

/**
 * Record this tenant's resolved terminology map. Idempotent — calling it again with the same map
 * (or the same reference) leaves `term()`'s answers unchanged.
 * @param {Record<string,string>|null|undefined} map
 */
export function setTerms(map) {
  current = (map && typeof map === "object") ? map : {};
}

/**
 * The word this practice uses for `key`: the tenant's override if one is set, else the English
 * fallback. Never the key itself — an unknown key THROWS rather than rendering a dotted token.
 * @param {string} key  one of `TERM_KEYS`
 * @returns {string}
 */
export function term(key) {
  if (!TERM_KEYS.includes(key)) {
    throw new Error(`unknown terminology key: ${key}`);
  }
  return current[key] ?? TERM_FALLBACKS[key];
}
