// ═══════════════════════════════════════════════════════════════════════════════════════════════
// A12.2 — THE `?new=1` SURFACE REGISTRY. **ONE DECISION, TWENTY-SIX LINKS.**
//
// ★★★ 26 LIST SCREENS' EMPTY STATES PROMISE A BUTTON. Each carries
//     `action: { label, href: "<path>?new=1" }`, and until this file existed **`Screen.svelte`
//     answered exactly two of them** — `CAN_ADD_PERSON` and the webhook path I added at A12.1.
//     Every other one navigated to a URL that changed nothing (F401): the screen told you to do the
//     thing and then did not do it.
//
// ★★ THE DESCRIPTORS ALREADY CARRY THE LABEL AND THE DESTINATION — that is why this is ONE decision
//    and not 26. The only thing missing was the map from a path to the surface that answers it.
//
// ★★★ AND THE HONEST HALF: A PATH WITH NO SURFACE YET IS NAMED HERE WITH A REASON, NOT OMITTED.
//     An omitted entry is a silent no-op — precisely F401 again, one layer in. An entry with
//     `notBuilt` renders a sentence saying what is missing, which is the `SectionNotBuilt` rule
//     applied to an action instead of to a screen.
//   ★ So every one of the 26 appears below. None of them can quietly do nothing.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * `component` — the key of a surface `Screen.svelte` knows how to render.
 * `notBuilt`  — a sentence for a promise the product cannot yet keep. Mutually exclusive.
 * ★ `tier` is deliberately absent: `refresh.js#tierFor` already owns that, keyed by the same path.
 */
export const NEW_SURFACES = Object.freeze({
  // ── people — one form, five entry points ────────────────────────────────────────────────────
  "/people/all":          { component: "person" },
  "/people/clients":      { component: "person" },
  "/people/adolescents":  { component: "person" },
  "/people/parents":      { component: "person" },
  "/people/leads":        { component: "person" },

  // ── accounts — R2-A: the 1-field SectionActions drawer is retired for the full sectioned
  //    CreateSheet form, same pattern as `/people/*` above.
  "/accounts":            { component: "account" },
  // ★★★ TASK 12.36 — `/accounts/all` is now the dedicated AccountsList screen (12.32); its own
  //     create surface is `NewAccountSheet`, named `payerGroup` here to stay distinct from the
  //     plain `/accounts` path's `AccountForm` ("account"), unchanged above. ★ AccountsList.svelte
  //     already opens `NewAccountSheet` itself, self-contained, over its own "New account" button
  //     and empty-state (`#new-account:<kind>` hash, intercepted locally) — this entry is a second,
  //     independently reachable deep link (`/accounts/all?new=1`), same shape as `/account/security`
  //     or `/settings/booking-link`: reachable by URL, not surfaced by the screen's own UI.
  "/accounts/all":        { component: "payerGroup" },

  // ── the section controls. ★ `SectionActions` already renders its own button in the list header;
  //    the `?new=1` link opens the SAME surface, so a deep link and the button agree.
  "/network":             { component: "section" },
  "/items/services":      { component: "section" },
  "/items/packages":      { component: "section" },
  "/items/plans":         { component: "section" },

  // ── engagements ─────────────────────────────────────────────────────────────────────────────
  // ★★★ TASK 13.44 — the two `availability` entries below (component `AvailabilityActions`, which
  //     13.44/13.45 retire) are REMOVED: `/engagements/booking` and `/engagements/booking/settings`
  //     now have their own dedicated Screen.svelte branches (OnlineBookingScreen,
  //     BookingSettingsHub) instead of a `?new=1` create surface.

  // ── documents ───────────────────────────────────────────────────────────────────────────────
  // ★ Square Contracts rebuild, 29 Sep 2026 — the real "New document" button now lives on DocsHome
  //   (the new /documents list) and opens the stepped wizard (§3 of the rebuild ruling): pick a
  //   template, pick up to 20 recipients, preview, send. The three retired paths below keep their
  //   OWN old sendDocument surface for any internal caller that still reaches them directly with
  //   `?new=1` already in the URL (their own list screens are gone from routing, but the surface
  //   mapping costs nothing to leave in place and breaks nothing by staying).
  "/documents":                    { component: "newDocument" },
  "/documents/pipeline":           { component: "sendDocument" },
  "/documents/contracts/all":      { component: "sendDocument" },
  "/documents/forms/all":          { component: "sendDocument" },
  // ★★★ CORRECTED, 29 Sep 2026 — this comment previously claimed these two rows had been removed
  //   ("resolves to null … Screen.jsx's newSurfaceSlot renders nothing"), but the two entries above
  //   still read `{ component: "sendDocument" }`, unchanged. MEASURED: they were never edited. The
  //   comment described a fix that was never made — CLAUDE.md's "closed with a flag" pattern.
  //   ★ Kept as `sendDocument` DELIBERATELY, now that it has been checked: these three paths are
  //     LIST screens, and their generic "New" button sending someone to "send an existing document"
  //     is the right verb for a list of things already sent, same as Pipeline's own big "Send a
  //     document" button. It is a *different* action from creating a template, which is
  //     `DocTemplateEditor.jsx` at `/documents/templates/new` — reached from DocsList's own "New
  //     document" button, not through this `?new=1` mechanism at all.
  //   ★ When a practice has zero templates for that builder, `SendDocumentDrawer` says "No
  //     templates yet — create one under Documents" with no link — that is honest (there genuinely
  //     is nothing to send), if not the friendliest possible dead end. `DocTemplateEditor.jsx`'s own
  //     "New document" flow (fixed the same day, F822) is what actually creates one.
  // ★★★ EXECUTED IS A **RESULT**, NOT A THING YOU CREATE. An instrument becomes executed by being
  //     signed and executed; there is no "new executed document". The empty state's action is
  //     wrong at the descriptor level, and saying so is better than opening a surface that would
  //     pretend otherwise.
  "/documents/executed": {
    notBuilt: "An executed document is one that has been signed and executed — it is not something " +
              "you create here. Send a document for signature instead.",
  },

  // ── money ───────────────────────────────────────────────────────────────────────────────────
  // ★ the maintainer, 28 Sep 2026 — "invoiceEditor" named no real surface (NEW_SURFACE_COMPONENTS in routes.js
  //   has no such key; this line predates the React port and was never updated to match what was
  //   actually built). The real, working invoice-creation surface is InvoiceDrawer.jsx, keyed
  //   "invoice" — already used by AccountRecord.jsx's own /money/invoices?new=1&for=… deep link.
  "/money/invoices":      { component: "invoice" },
  // ★ "subscriptionEditor" has the same problem and no known-working real surface to repoint it
  //   at yet — left named rather than silently working now, so a future pass finds it via grep,
  //   not by someone hitting a dead "New subscription" button the way "New invoice" was tonight.
  "/money/subscriptions": { component: "subscriptionEditor" },

  // ── the three the product genuinely cannot do yet ───────────────────────────────────────────
  // ★★ NAMED, NOT OMITTED. These paths promise a button in their empty state and there is no
  //    surface behind them. A sentence is the honest answer; an omission would be a dead link.
  "/growth/campaigns": {
    notBuilt: "Campaigns are sent from Listmonk, and Workbench cannot create one yet. " +
              "Nothing has been lost — your lists and subscribers are intact.",
  },
  "/growth/lists": {
    notBuilt: "Mailing lists are managed in Listmonk for now. Workbench cannot create one yet.",
  },
  "/tasks/mine": {
    notBuilt: "Tasks can be assigned and completed, and there is no form to create one yet.",
  },
  "/tasks/team": {
    notBuilt: "Tasks can be assigned and completed, and there is no form to create one yet.",
  },

  // ── developer ───────────────────────────────────────────────────────────────────────────────
  "/settings/developer/webhooks": { component: "webhookEndpoint" },
});

/** ★ One predicate, so no consumer writes its own membership test (the `isStillOnReact` pattern). */
export const surfaceFor = (path) => NEW_SURFACES[String(path ?? "")] ?? null;

/**
 * ★★★ THE GUARD THIS FILE EXISTS TO MAKE POSSIBLE: every descriptor that PROMISES `?new=1` must
 *     have an entry here. Exported so a gate can assert it against `LIST_VIEWS` rather than against
 *     a hand-kept list — **which is what let 24 of the 26 rot unnoticed in the first place.**
 */
export const answeredPaths = () => Object.keys(NEW_SURFACES);
