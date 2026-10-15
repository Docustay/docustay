// Stage 14 task 14.25 — GIFT CARDS, THE WIRE.
//
// §0.4 B: writes are table rows, not `app.post` — `GIFT_CARD_WRITES` is spread into
// `src/routes/writes.mjs`'s `ROUTES` table and mounted by task 14.41
// (`registerItemsAndDocumentsRoutes`), which is what actually calls `registerWriteRoutes` over the
// combined table. Reads are a register function this file owns and 14.41 mounts directly. The
// bulk list itself (`GET /api/list/items/gift-cards`, field 8's test) is task 14.22's generic list
// infrastructure, not built here.
//
// ★★★ NOT MOUNTED BY THIS TASK. `src/routes/writes.mjs` and `src/http/app.mjs` are not in 14.25's
//     file list. `registerGiftCardReads` below is inert until 14.41 calls it, and
//     `GIFT_CARD_WRITES` is inert until 14.41 spreads it into `ROUTES` — same shape as
//     `src/routes/itemsCatalogue.mjs`'s own header for `CATALOGUE_WRITES`/`registerCatalogueReads`.
//     Reported in the task summary, not silently left unwired.
//
// ★ CALLERS, once mounted: 14.41's UI (issue/void/resend/nudge buttons on the GiftCards screen,
//   14.62); the nudge job is `src/time/due.mjs`'s `gift_card_never_opened` DUE_FACT (task 14.28),
//   which calls `nudgeGiftCard` directly as a function, never through this HTTP route.

import { forbidden } from "../http/errors.mjs";
import { authoriseSection } from "../nav/authorise.mjs";
import { assertMay } from "../permissions/assertMay.mjs";
import {
  issueGiftCard, voidGiftCard, resendGiftCard, nudgeGiftCard, giftCardSummary,
} from "../items/giftCards.mjs";

// ★ The same nav section every other `/items/*` write/read route in this family authorises against
//   (`itemsCatalogue.mjs`, `itemsImages.mjs`, `itemsOptions.mjs`, `itemsModifiers.mjs` — all four
//   measured at `SECTION = "/items/services"`; there is no separate "/items/gift-cards" section).
const SECTION = "/items/services";

/**
 * `GIFT_CARD_WRITES` — `src/routes/writes.mjs:157-...`'s row shape. `object: "item", action:
 * "gift_card.manage"` on every row, exactly as field 4 states: `gift_card.manage` is a
 * NAMED_ACTIONS entry (owner/admin only, migration 0416 + task 14.15 — see `giftCards.mjs`'s
 * header for the measured gap that 14.15 has not landed yet). A NAMED_ACTIONS row is a flat
 * capability check with no owner to resolve, so no `subject` key is declared at all — only a
 * view/edit/delete route resolves an owner (`writes.mjs`'s own `assertVerbRoutesDeclareASubject`
 * forbids naming one on a NAMED_ACTIONS row).
 */
export const GIFT_CARD_WRITES = Object.freeze([
  { path: "/api/items/gift-cards",        section: SECTION, fn: issueGiftCard,
    object: "item", action: "gift_card.manage" },
  { path: "/api/items/gift-cards/void",   section: SECTION, fn: voidGiftCard,
    object: "item", action: "gift_card.manage" },
  { path: "/api/items/gift-cards/resend", section: SECTION, fn: resendGiftCard,
    object: "item", action: "gift_card.manage" },
  { path: "/api/items/gift-cards/nudge",  section: SECTION, fn: nudgeGiftCard,
    object: "item", action: "gift_card.manage" },
]);

/**
 * GET routes — `src/routes/tasks.mjs:20-60`'s authorise-then-act shape, returning `{ data }`.
 * `GET /api/items/gift-cards/summary` → `assertMay {object:"item", action:"gift_card.manage"}` —
 * a Coach gets 403 (field 8), which is what the screen's no-permission band keys on (field 4).
 */
export function registerGiftCardReads(app, { runTenantScoped, tenantIsPlatform }) {
  app.get("/api/items/gift-cards/summary", (c) =>
    runTenantScoped(c, async ({ db, principal, tenantId }) => {
      const isPlatform = await tenantIsPlatform(db, tenantId);
      const decision = authoriseSection(principal.user, SECTION, { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
      await assertMay(db, principal, { object: "item", action: "gift_card.manage" });

      const data = await giftCardSummary(db, { tenantId });
      return { data };
    }, { bucket: "records" }).then((r) => c.json(r)));
}
