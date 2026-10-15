// ═══════════════════════════════════════════════════════════════════════════════════════════════
// S4.3 — WHO MAY ARCHIVE, AND WHAT IS ARCHIVABLE. PLAIN JS, SO A GATE CAN ASSERT IT WITH NO DOM.
//
// ★ Both are rules about the world rather than about rendering, which is why they live outside the
//   `.svelte` file — the same reason `phaseOf` and `blockedResolver` do.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** The nine, from the server's own map (`src/records/archive.mjs` ARCHIVABLE).
 *  ★ Kept as a LIST rather than re-described as prose: a type that is archivable server-side and
 *    missing here would silently lose its control, and silence is the failure mode. */
export const ARCHIVABLE_TYPES = Object.freeze([
  "person", "account", "network_party", "booking", "invoice",
  "service", "plan", "subscription", "document",
]);

/** ★ The rank comparison lives in lib/permissions (gate K6b); this name is the gate-entry contract (p7). */
export { mayArchiveByRank as mayArchive } from "@/lib/permissions/rank.js";
