// P2.2 — THE THREE FIELD LAYERS: FIXED · TEMPLATE · CUSTOM.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE MODEL IS WHAT LETS ONE SCHEMA SERVE SIXTEEN VERTICALS WITHOUT BECOMING GENERIC.
//     [DOC, keystone-spec-check Part 1B] most verticals differ by about FOUR fields — **the base
//     does the work**. A coaching practice and a driving instructor want the same thirty-odd things
//     about a person and four different ones. So:
//
//       FIXED     the canonical base. Every tenant, not removable. **CODE** — real columns,
//                 declared as panels in `src/records/shell.mjs`. ★ A row can be deleted; a column
//                 cannot. That is what "not removable" has to mean, and it is why this layer has no
//                 table.
//       TEMPLATE  the vertical add-ons. Also real columns (0076 shipped the recovery four), but a
//                 tenant SELECTS which packs apply. **One setting, not a table** — the set of packs
//                 is closed and shipped, like the topic catalogue.
//       CUSTOM    a tenant's own. Unbounded per-tenant shape, so it is **the only layer with
//                 storage** (0079).
//
// ★★ AND THIS IS WHY THE TERMINOLOGY SYSTEM IS SMALL [KS-1]. With a canonical schema, only a handful
//    of WORDS change per tenant — what they call a client, a coach, a session. Four or five terms,
//    not a translation layer. The FIELDS are where a vertical actually differs, and they are here.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { getSetting } from "../settings/writes.mjs";

/**
 * The shipped vertical packs. ★★ A CLOSED SET, like the topic catalogue and for the same reason:
 * each pack names PANEL KEYS that exist in `shell.mjs`, so a pack nobody implemented cannot be
 * selected — it would render nothing and look like a broken setting.
 *
 * ★ Only `recovery` has columns today (0076). The rest are declared as the SHAPE of the decision so
 *   that adding one is visibly "a migration plus a line here", not an open-ended invitation.
 */
const FIELD_TEMPLATES = Object.freeze({
  recovery: {
    label: "Recovery coaching",
    panels: ["recovery"],
    // ★ Named so a gate can assert the columns exist — a pack pointing at absent columns is F13.
    columns: ["sobriety_date", "recovery_programme", "sponsor_name", "support_network"],
  },
});

/** The pack keys a tenant may select. */
export const TEMPLATE_KEYS = Object.freeze(Object.keys(FIELD_TEMPLATES));

/**
 * Every panel key owned by ANY template — the panels conditional on a selection.
 * ★ NOT EXPORTED: `hiddenPanelKeys()` below is the only question anybody actually asks, and this was
 *   a convenience nobody called. The wiring gate caught it.
 */
const TEMPLATE_PANEL_KEYS = Object.freeze(
  [...new Set(Object.values(FIELD_TEMPLATES).flatMap((t) => t.panels))]);
// ★ Referenced here so the constant is not dead code as well as unexported — `hiddenPanelKeys`
//   returns a subset of it, and a future assertion about that relationship has a name to use.
void TEMPLATE_PANEL_KEYS;

/**
 * Which vertical packs this tenant has selected.
 * ★★ THE DEFAULT IS THE RECOVERY PACK, AND THAT IS A REAL DECISION RATHER THAN A LEFTOVER. Keystone
 *    is being built out of a recovery-coaching practice; a tenant that has chosen nothing is a
 *    tenant nobody has asked yet, and showing them the pack the product was shaped around is more
 *    useful than showing them nothing. ★ P11.3's signup step is where the question gets asked.
 */
async function selectedTemplates(tx) {
  const stored = await getSetting(tx, "fields.templates", null);
  if (!Array.isArray(stored)) return ["recovery"];
  return stored.filter((k) => TEMPLATE_KEYS.includes(k));
}

/**
 * The panel keys to HIDE for this tenant: every template panel whose pack is not selected.
 * ★ Returned as "hide" rather than "show" on purpose — the FIXED panels are the default and must
 *   never depend on a lookup succeeding. A failed read hides nothing; it cannot blank the card.
 */
export async function hiddenPanelKeys(tx) {
  const selected = new Set(await selectedTemplates(tx));
  return Object.entries(FIELD_TEMPLATES)
    .filter(([k]) => !selected.has(k))
    .flatMap(([, t]) => t.panels);
}
