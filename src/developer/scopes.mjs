// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE GRANTABLE API SCOPES. **THE CLOSED SET A KEY MAY CARRY.**
//
// ★★★ SPLIT OUT OF `routes/developer.mjs` AT A8 — the fourth vocabulary extraction in this build
//     (F406 topics · A3.2 people · A5.1 variables · this), and for the same reason every time: the
//     parent is a ROUTE file, unloadable in a browser, and the key-minting surface has to offer
//     exactly what the server will accept.
//   ★★★ AND ON THIS SET THE STAKES ARE HIGHER THAN A 400. The route refuses an unknown scope by
//       name — but a picker holding a STALE copy would silently omit a scope that exists, leaving a
//       capability ungrantable with nothing on screen to say so. **Minting an API key grants
//       standing programmatic access to a tenant's entire dataset**; the list of what a key may do
//       is not a thing to keep two copies of.
//
// ★★ THIS IS THE VOCABULARY, NOT THE POLICY. `P0.5 / F101` — "you cannot grant what you do not
//    hold" — is enforced server-side against the CALLER's own authority, and is deliberately not
//    re-implemented here. A screen may show a scope the caller is then refused; that refusal is the
//    server's to make and to explain.
//
// ★ NOTHING IS IMPORTED HERE, ON PURPOSE.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// ★★★ STAGE 7 TASK 7.21 (21 Sep 2026) — CT-100 (`STAGE-5-PLAN.md §9`). 7 → 23. Every name below is
//    transcribed from §9.1 (CT-015's table), 11 read + 12 write, in this exact order; nothing here is
//    re-derived and nothing is added. ★ Four read scopes below open NO route in this stage —
//    `accounts:read`, `network:read`, `items:read`, `money:read` — they are DEFERRED VOCABULARY with a
//    named consumer, the per-view `/api/list/*` split (Q7-17). Do not delete them for being unused.
// ★ The shape is fixed by the database, not by taste: `api_token_scopes_shape` CHECK
//    (`db/migrations/0045_api_token_and_webhook_source.sql:79-80`) allows only `<name>:read` or
//    `<name>:write` — there is no third verb, so an "admin capability" is a route only an Owner may
//    switch on (7.22), never a scope named `*:admin`.
export const GRANTABLE_SCOPES = Object.freeze([
  "accounts:read", "accounts:write", "booking:read", "booking:write", "documents:read",
  "documents:write", "growth:read", "growth:write", "items:read", "items:write", "lead:write", "money:read", "money:write",
  "network:read", "network:write", "notifications:read", "notifications:write", "people:read",
  "people:write", "platform:read", "platform:write", "records:read", "records:write",
  "settings:read", "settings:write",
  // FINAL PUSH Stage 4 (7 Oct 2026): plays, playbooks and drafts. `drafts:write` makes drafts only; nothing in it sends.
  "plays:read", "plays:write", "drafts:write",
  // FINAL PUSH Stage 6 (FP-F1, 7 Oct 2026): narrower scopes. The database allows only <name>:read|write, so the report's `webhooks:manage` and `embedded:sign` are spelled webhooks:write and embedded:write.
  // `documents:*` keeps working on every route it did before; a narrow scope is an ALTERNATIVE way in (NARROW_ROUTE_SCOPES), so a key can be made that reads templates and does nothing else.
  "templates:read", "templates:write", "webhooks:read", "webhooks:write", "reports:read", "account:read", "embedded:write",
]);

/**
 * The narrower scope that ALSO opens a /api/v1 route (FP-F1). The route's entry in ROUTE_SCOPES is tried first; when the key does not hold it, this one is tried. A route absent here accepts only its ROUTE_SCOPES scope.
 * Every credential failure is still the same single 401.
 */
export const NARROW_ROUTE_SCOPES = Object.freeze({
  "GET /api/v1/documents/templates": "templates:read",
  "GET /api/v1/templates/:id": "templates:read",
  "GET /api/v1/templates/library": "templates:read",
  "GET /api/v1/templates/library/:slug": "templates:read",
  "POST /api/v1/templates/library/:slug/documents": "templates:write",
  "POST /api/v1/templates/library/:slug/customize": "templates:write",
  "POST /api/v1/templates/html": "templates:write",
  "POST /api/v1/templates/file": "templates:write",
  "POST /api/v1/templates/source": "templates:write",
  "POST /api/v1/templates/:id/defaults": "templates:write",
  "GET /api/v1/reports": "reports:read",
  "GET /api/v1/forms/templates": "templates:read",
  "GET /api/v1/email-templates": "templates:read",
  "PUT /api/v1/email-templates/:kind": "templates:write",
  "DELETE /api/v1/email-templates/:kind": "templates:write",
  "POST /api/v1/email-templates/:kind/preview": "templates:write",
  "GET /api/v1/usage": "account:read",
  "GET /api/v1/ai/usage": "account:read",
  "POST /api/v1/documents/detect-fields": "templates:read",
  "GET /api/v1/payments/status": "account:read",
  "GET /api/v1/teams": "account:read",
  "POST /api/v1/documents/:id/embed-session": "embedded:write",
});

/**
 * ★★★ A "FROZEN" SET THAT ISN'T. `Object.freeze(new Set(...))` does not stop `.add`/`.delete`/`.clear`
 *    — a Set's contents are internal slots, not own properties, so `Object.freeze` alone is a no-op
 *    against them (MEASURED 21 Sep 2026, `node -e "Object.freeze(new Set(['a'])).add('b')"` succeeds).
 *    This wraps a Set with own-property mutators that throw, THEN freezes it, so `NEVER_DELEGABLE` and
 *    `SCOPED_BUT_CLOSED` are actually immutable, not just decorated with a property nobody reads.
 */
function frozenSet(values) {
  const s = new Set(values);
  const refuse = () => { throw new TypeError("this Set is frozen and cannot be mutated"); };
  Object.defineProperty(s, "add", { value: refuse });
  Object.defineProperty(s, "delete", { value: refuse });
  Object.defineProperty(s, "clear", { value: refuse });
  return Object.freeze(s);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE ROUTE-TO-SCOPE MAP (CT-016 · Q0-9 · Stage 5 task 5.8; widened at Stage 7 task 7.21 — CT-100).
//    WHICH SCOPE A KEY MUST HOLD TO CALL A ROUTE.
//
// Keys are `"<METHOD> <path>"`, **exactly as the router registers the route** (Q7-12 / CCR-14 — §9.2's
// form wins over CT-016's `/api/v1`-prefixed example; the two `/api/v1` entries below keep that prefix
// only because that is genuinely how they are mounted, `src/routes/developer.mjs:315`, `:338`).
// A value is a scope from GRANTABLE_SCOPES, the sentinel `"PER_VIEW"` (Q7-17 — `/api/list/*` serves 45
// views and is ALSO in SCOPED_BUT_CLOSED, so no key reaches it in this stage), or `null` for a route
// that needs a VALID KEY BUT NO SCOPE (`whoami` — a key may always identify itself).
//
// ★★★ `null` AND `undefined` MEAN DIFFERENT THINGS. `null` is an explicit "no scope needed";
//    `undefined` (a path with no entry) is an UNDECIDED route, and the caller must fail closed on it
//    rather than let it through.
// ★ 55 mutating (all POST, §9.2) + 27 read (all GET, §9.3) = 82. Nothing here grants anything to
//    anybody — this is the vocabulary; 7.22 is the policy and 7.23 is the boundary.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
export const ROUTE_SCOPES = Object.freeze({
  // ── mutating — 55, §9.2 ──────────────────────────────────────────────────────────────────────
  // accounts:write (6)
  "POST /api/accounts": "accounts:write",
  "POST /api/accounts/update": "accounts:write",
  "POST /api/accounts/pipeline": "accounts:write",
  "POST /api/accounts/pipeline/advance": "accounts:write",
  "POST /api/accounts/run/pause": "accounts:write",
  "POST /api/accounts/run/resume": "accounts:write",
  // documents:write (13)
  "POST /api/documents/categories": "documents:write",
  "POST /api/documents/types": "documents:write",
  "POST /api/documents/instances": "documents:write",
  "POST /api/documents/send": "documents:write",
  "POST /api/documents/sign": "documents:write",
  "POST /api/documents/decline": "documents:write",
  "POST /api/documents/execute": "documents:write",
  "POST /api/documents/contracts/templates": "documents:write",
  "POST /api/documents/forms/templates": "documents:write",
  "POST /api/documents/templates/version": "documents:write",
  "POST /api/documents/templates/body": "documents:write",
  "POST /api/documents/disclosure/accept": "documents:write",
  "POST /api/documents/disclosure/withdraw": "documents:write",
  "POST /api/v1/documents/send": "documents:write",
  "POST /api/v1/templates/html": "documents:write",
  "POST /api/v1/documents/:id/embed-session": "documents:write",
  "POST /api/v1/embedded/builder-session": "embedded:write",
  "POST /api/v1/embedded/scribe-session": "embedded:write",
  "POST /api/v1/documents/:id/remind": "documents:write",
  "POST /api/v1/templates/file": "documents:write",
  "POST /api/v1/templates/source": "documents:write",
  "POST /api/v1/documents/ai/draft": "documents:write",
  "GET /api/v1/documents/ai/jobs/:id": "documents:read",
  "GET /api/v1/usage": "documents:read",
  "GET /api/v1/ai/usage": "documents:read",
  "POST /api/v1/documents/detect-fields": "documents:read",
  "POST /api/v1/documents": "documents:write",
  "POST /api/v1/documents/check": "documents:read",
  "GET /api/v1/documents/:id/source": "documents:read",
  "POST /api/v1/documents/:id/revise": "documents:write",
  "POST /api/v1/documents/:id/send": "documents:write",
  "POST /api/v1/templates/:id/documents": "documents:write",
  "POST /api/v1/templates/:id/defaults": "documents:write",
  "GET /api/v1/templates/library": "documents:read",
  "GET /api/v1/templates/library/:slug": "documents:read",
  "POST /api/v1/templates/library/:slug/documents": "documents:write",
  "POST /api/v1/templates/library/:slug/customize": "documents:write",
  "POST /api/v1/documents/ai/edit": "documents:write",
  "POST /api/v1/documents/ai/jobs/:id/cancel": "documents:write",
  "GET /api/v1/ai/wizard": "documents:read",
  "GET /api/v1/payments/status": "documents:read",
  // FINAL PUSH Stage 6 (FP-D1/D4/F5): webhooks over the API. 174 -> 182.
  "GET /api/v1/webhooks/topics": "webhooks:read",
  "GET /api/v1/webhooks": "webhooks:read",
  "POST /api/v1/webhooks": "webhooks:write",
  "DELETE /api/v1/webhooks/:id": "webhooks:write",
  "POST /api/v1/webhooks/:id/test": "webhooks:write",
  "POST /api/v1/webhooks/:id/rotate": "webhooks:write",
  "GET /api/v1/webhooks/:id/deliveries": "webhooks:read",
  "GET /api/v1/webhooks/:id/relay": "webhooks:read",
  // Run 7: forms (a form is a document template with one link; its responses are documents)
  "GET /api/v1/forms": "documents:read",
  "GET /api/v1/forms/templates": "documents:read",
  "GET /api/v1/forms/:id": "documents:read",
  "GET /api/v1/forms/:id/responses": "documents:read",
  "POST /api/v1/forms/publish": "documents:write",
  "POST /api/v1/forms/:id/open": "documents:write",
  "POST /api/v1/forms/:id/unpublish": "documents:write",
  "GET /api/v1/plays": "plays:read",
  "GET /api/v1/plays/:name": "plays:read",
  "POST /api/v1/plays/test": "plays:read",
  "POST /api/v1/plays": "plays:write",
  "POST /api/v1/plays/:name/publish": "plays:write",
  "POST /api/v1/plays/:name/duplicate": "plays:write",
  "DELETE /api/v1/plays/:name": "plays:write",
  "GET /api/v1/playbooks": "plays:read",
  "POST /api/v1/playbooks": "plays:write",
  "POST /api/v1/playbooks/:name/enable": "plays:write",
  "POST /api/v1/drafts": "drafts:write",
  // Run 9: search, the contract repository and key dates, payments taken while signing, automations
  "GET /api/v1/search": "documents:read",
  "GET /api/v1/contracts": "documents:read",
  "POST /api/v1/contracts/:id/dates": "documents:write",
  "GET /api/v1/payments": "documents:read",
  "POST /api/v1/payments/:id/refund": "documents:write",
  "GET /api/v1/automations": "plays:read",
  "POST /api/v1/automations/:id/enable": "plays:write",
  "POST /api/v1/drafts/:draftRef/answers": "drafts:write",
  "POST /api/v1/documents/:id/void": "documents:write",
  "POST /api/v1/documents/:id/test-sign": "documents:write",
  "GET /api/v1/email-templates": "documents:read",
  "PUT /api/v1/email-templates/:kind": "documents:write",
  "DELETE /api/v1/email-templates/:kind": "documents:write",
  "POST /api/v1/email-templates/:kind/preview": "documents:write",
  "GET /api/v1/emails": "documents:read",
  // growth:write (23)
  "POST /api/growth/campaigns": "growth:write",
  "POST /api/growth/campaigns/send": "growth:write",
  "POST /api/growth/campaigns/schedule": "growth:write",
  "POST /api/growth/campaigns/test": "growth:write",
  "POST /api/growth/campaign-groups": "growth:write",
  "POST /api/growth/campaign-groups/attach": "growth:write",
  "POST /api/growth/campaign-groups/detach": "growth:write",
  "POST /api/growth/campaign-groups/update": "growth:write",
  "POST /api/growth/campaign-groups/delete": "growth:write",
  "POST /api/growth/campaign-groups/:id/pause": "growth:write",
  "POST /api/growth/forms": "growth:write",
  "POST /api/growth/forms/:id": "growth:write",
  "POST /api/growth/pages": "growth:write",
  "POST /api/growth/pages/delete": "growth:write",
  "POST /api/growth/pages/draft": "growth:write",
  "POST /api/growth/pages/publish": "growth:write",
  "POST /api/growth/pages/update": "growth:write",
  "POST /api/growth/segments": "growth:write",
  "POST /api/growth/templates": "growth:write",
  "POST /api/growth/templates/:key/activate": "growth:write",
  "POST /api/growth/templates/:key/test-send": "growth:write",
  // items:write · coupons and promotion codes (5, Stage 20)
  "POST /api/items/coupons": "items:write",
  "POST /api/items/coupons/update": "items:write",
  "POST /api/items/coupons/active": "items:write",
  "POST /api/items/promotion-codes": "items:write",
  "POST /api/items/promotion-codes/deactivate": "items:write",
  // money:write · coupons and payments (3, Stage 20)
  "POST /api/money/coupons/:couponId/apply-to-person": "money:write",
  "POST /api/money/coupons/:couponId/remove-from-person": "money:write",
  "POST /api/money/payments/attach": "money:write",
  // booking:write (11)
  "POST /api/engagements/availability": "booking:write",
  "POST /api/engagements/availability/end": "booking:write",
  "POST /api/engagements/date-overrides": "booking:write",
  "POST /api/engagements/booking-policy": "booking:write",
  "POST /api/engagements/bookings": "booking:write",
  "POST /api/engagements/bookings/cancel": "booking:write",
  "POST /api/engagements/bookings/reschedule": "booking:write",
  "POST /api/engagements/participants": "booking:write",
  "POST /api/engagements/attendance": "booking:write",
  "POST /api/bookings/:id/check-in": "booking:write",
  "POST /api/bookings/:id/complete": "booking:write",
  // items:write (5)
  "POST /api/items/services": "items:write",
  "POST /api/items/packages": "items:write",
  "POST /api/items/plans": "items:write",
  "POST /api/items/prices": "items:write",
  "POST /api/items/contracted-prices": "items:write",
  // money:write (6)
  "POST /api/money/invoices": "money:write",
  "POST /api/money/line-items": "money:write",
  "POST /api/money/subscriptions": "money:write",
  "POST /api/money/payment-methods": "money:write",
  "POST /api/money/entitlements": "money:write",
  // network:write (2)
  "POST /api/network": "network:write",
  "POST /api/network/update": "network:write",
  // notifications:write (3)
  "POST /api/notifications": "notifications:write",
  "POST /api/notifications/preferences": "notifications:write",
  "POST /api/notifications/read": "notifications:write",
  // people:write (2)
  "POST /api/people": "people:write",
  "POST /api/people/update": "people:write",
  // lead:write (1)
  "POST /api/people/stage": "lead:write",
  // records:write (2)
  "POST /api/records/archive": "records:write",
  "POST /api/records/restore": "records:write",
  // settings:write (3)
  "POST /api/settings": "settings:write",
  "POST /api/settings/branding/logo": "settings:write",
  "POST /api/settings/email/routing": "settings:write",
  // platform:write (3) — also in SCOPED_BUT_CLOSED
  "POST /api/platform/provisioning/advance": "platform:write",
  "POST /api/jobs/retry": "platform:write",
  "POST /api/jobs/give-up": "platform:write",

  // ── read — 27, §9.3 ──────────────────────────────────────────────────────────────────────────
  // people:read (1)
  "GET /api/v1/people": "people:read",
  // no scope — a key may always identify itself
  "GET /api/v1/whoami": null,
  // documents:read (1)
  "GET /api/documents/:id/pdf": "documents:read",
  // ★ §23.5.8 — the Documents REST API (src/routes/developerDocuments.mjs)
  "GET /api/v1/documents": "documents:read",
  "GET /api/v1/documents/templates": "documents:read",
  "GET /api/v1/templates/:id": "documents:read",
  "GET /api/v1/documents/:id/audit-log.csv": "documents:read",
  "GET /api/v1/reports": "documents:read",
  "GET /api/v1/teams": "documents:read",
  "GET /api/v1/documents/:id": "documents:read",
  "GET /api/v1/documents/:id/signed.pdf": "documents:read",
  // booking:read (2)
  "GET /api/engagements/attendance-policy": "booking:read",
  "GET /api/engagements/slots": "booking:read",
  // notifications:read (2)
  "GET /api/notifications": "notifications:read",
  "GET /api/notifications/unread-count": "notifications:read",
  // records:read (2)
  "GET /api/records/:type/:id": "records:read",
  "GET /api/search": "records:read",
  // platform:read (3) — also in SCOPED_BUT_CLOSED
  "GET /api/platform/health": "platform:read",
  "GET /api/platform/provisioning": "platform:read",
  "GET /api/platform/tenants": "platform:read",
  // settings:read (14)
  "GET /api/settings/billing": "settings:read",
  // ★★★ Task 17.18 — `GET /api/settings/usage` (src/routes/settings.mjs), same scope as billing.
  "GET /api/settings/usage": "settings:read",
  "GET /api/settings/branding": "settings:read",
  "GET /api/settings/branding/logo/:kind": "settings:read",
  "GET /api/settings/client-app": "settings:read",
  "GET /api/settings/documents": "settings:read",
  "GET /api/settings/email": "settings:read",
  "GET /api/settings/integrations": "settings:read",
  "GET /api/settings/money": "settings:read",
  "GET /api/settings/notifications": "settings:read",
  "GET /api/settings/practice": "settings:read",
  "GET /api/settings/practice/slug-available": "settings:read",
  "GET /api/settings/roles": "settings:read",
  "GET /api/settings/terminology": "settings:read",
  "GET /api/tasks/automations": "settings:read",
  "GET /api/tasks/automations/:key": "settings:read",
  "GET /api/settings/email/health": "settings:read",
  // money:read (3 active report routes; 5 stale routes removed 2026-09-25)
  "GET /api/reports/hub": "money:read",
  "GET /api/reports/receipt": "money:read",
  "GET /api/reports/:name/export.csv": "money:read",
  // growth:read (7)
  "GET /api/growth/audience": "growth:read",
  "GET /api/growth/campaign-groups/:id/results": "growth:read",
  "GET /api/growth/campaigns/:id": "growth:read",
  "GET /api/growth/forms": "growth:read",
  "GET /api/growth/forms/:id": "growth:read",
  "GET /api/growth/templates": "growth:read",
  "GET /api/growth/templates/:key": "growth:read",
  // money:read (1 lead route)
  "GET /api/people/lead-board": "money:read",
  "GET /api/run/gtm": "money:read",
  // PER_VIEW (1) — one mount serving 45 views (`src/records/lists.mjs:36`), Q7-17. Also in
  // SCOPED_BUT_CLOSED, so no key reaches it in this stage.
  "GET /api/list/*": "PER_VIEW",
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ NEVER_DELEGABLE — a frozen Set of 67 keys (§9.2's 17 + §9.3's 24 + Task 20.17's 1 + Stage 18's 23 + 7.25's 1 + ...). No scope, no toggle and no
//    role opens any of these to a key, ever. Four reason classes (§9.4 item 4), carried against each
//    block below. ★★ `POST /api/developer/api-keys`, `POST /api/developer/api-keys/:id/revoke` and
//    `POST /api/settings/roles/permission` being in this set IS Q5-10's ruling made mechanical: a key
//    may never mint a key, re-scope a key or change a role. 7.25's new scopes-edit route joins this
//    set, written by 7.25 itself (its own field 4) — this task only leaves the comment saying so.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
export const NEVER_DELEGABLE = frozenSet([
  // credential (11) — Task 20.17 adds automation callback
  "POST /api/auth/login",
  "POST /api/auth/logout",
  "POST /api/webhooks/:provider",
  "POST /api/automations/callback",
  "POST /api/developer/webhook-endpoints",
  "GET /api/developer/api-keys",
  "GET /api/developer/audit-log",
  "GET /api/developer/webhook-endpoints",
  "GET /api/settings/developer/sandbox",
  "GET /api/auth/branding/logo",
  "GET /api/auth/config",
  // privilege escalation (7 — Q5-10)
  "POST /api/developer/api-keys",
  "POST /api/developer/api-keys/:id/revoke",
  "POST /api/people/invite",
  "POST /api/people/staff-role",
  "POST /api/settings/roles/permission",
  "POST /api/signup",
  "POST /api/settings/practice/slug",
  // consent and personal acts (15) — a key authenticates a PRACTICE, never a person
  "POST /api/app/booking",
  "POST /api/app/documents/disclosure",
  "POST /api/app/documents/sign",
  "POST /api/app/notifications/preference",
  "POST /api/app/notifications/read",
  "GET /api/app/activity",
  "GET /api/app/booking",
  "GET /api/app/documents",
  "GET /api/app/documents/:id",
  "GET /api/app/notifications",
  "GET /api/app/payments",
  "GET /api/app/profile",
  "GET /api/app/sessions",
  "GET /api/app/surfaces",
  "GET /api/app/working-on",
  // UI shell and pre-authentication (8)
  "GET /api/capabilities",
  "GET /api/help",
  "GET /api/home",
  "GET /api/nav",
  // ★★★ Task 17.25 — `GET /api/whats-new` (src/routes/index.mjs), staff-visible system status
  //     surface, same class as `/api/capabilities` — both are UI shell routes never delegable to keys.
  "GET /api/whats-new",
  "GET /api/section/*",
  "GET /api/auth/branding",
  "GET /api/auth/practices",
  "GET /api/signup/slug-available",
  // privilege escalation (1 — Q5-10, 7.25's own field 4): a key may never re-scope a key.
  "POST /api/developer/api-keys/:id/scopes",
  // FINAL PUSH Stage 6 (FP-F4): a key may never change which addresses a key can be used from.
  "POST /api/developer/api-keys/:id/allowlist",
  // settings and reports — stage 16
  "POST /api/tasks/automations/:key",
  // Stage 18 (F13/F14/F15) — operator, client-app and self-device routes are never delegable to an API key
  // operator platform access (12 routes)
  "POST /api/platform/practices/:tenantId/access-requests",
  "POST /api/platform/practices/:tenantId/access/end",
  "GET /api/platform/practices/:tenantId/look",
  "GET /api/platform/overview",
  "GET /api/platform/practices",
  "GET /api/platform/practices/:tenantId",
  "GET /api/platform/prompts",
  "POST /api/platform/prompts/dismiss",
  "GET /api/platform/provisioning/:runId/steps",
  "GET /api/platform/usage",
  "POST /api/platform/usage/tell",
  "GET /api/platform/jobs",
  // operator support access and configuration (4 routes)
  "POST /api/platform/jobs/run-now",
  "GET /api/settings/support-access",
  "POST /api/settings/support-access/:requestId/answer",
  "POST /api/settings/support-access/:grantId/end",
  // self-device management (3 routes)
  "POST /api/me/devices",
  "POST /api/me/devices/forget",
  "GET /api/me/push-config",
  // client-app exclusive actions (3 routes)
  "GET /api/app/home",
  "POST /api/app/payments/pay",
]);

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ SCOPED_BUT_CLOSED — a frozen Set of 7 keys (Q7-14 and Q7-17): the six platform routes above
//    (`platform:read` × 3, `platform:write` × 3) plus `GET /api/list/*`. They are IN `ROUTE_SCOPES` so
//    the map stays complete and the coverage gate stays honest, and SIMULTANEOUSLY refused to every key
//    by 7.23's request path with the ordinary "this key is not permitted" answer. A route may be in
//    `ROUTE_SCOPES` and in `SCOPED_BUT_CLOSED`; it may NEVER be in `ROUTE_SCOPES` and in
//    `NEVER_DELEGABLE` — those two are disjoint (asserted below, at load time).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
export const SCOPED_BUT_CLOSED = frozenSet([
  "POST /api/platform/provisioning/advance",
  "POST /api/jobs/retry",
  "POST /api/jobs/give-up",
  "GET /api/platform/health",
  "GET /api/platform/provisioning",
  "GET /api/platform/tenants",
  "GET /api/list/*",
]);

/**
 * ★★★ A TYPO IN THIS MAP IS A BOOT FAILURE, NOT AN ENDPOINT THAT LETS EVERYONE THROUGH.
 *    Every value must be `null`, `"PER_VIEW"`, or a member of `grantable`. `undefined`, an empty
 *    string, a number or a scope nobody can grant all throw. Exported so a test can feed it a
 *    deliberately bad map; the real map is checked by the call directly below, at load time.
 */
export function assertRouteScopes(map, grantable = GRANTABLE_SCOPES) {
  if (map === null || typeof map !== "object") {
    throw new TypeError("ROUTE_SCOPES must be an object mapping \"<METHOD> <path>\" to a scope or null");
  }
  for (const [route, scope] of Object.entries(map)) {
    if (scope === null || scope === "PER_VIEW") continue;
    if (typeof scope !== "string" || !grantable.includes(scope)) {
      throw new TypeError(
        `ROUTE_SCOPES["${route}"] is ${JSON.stringify(scope)}, which is neither null, "PER_VIEW", nor a ` +
        `grantable scope (${grantable.join(", ")}). A route with a mistyped scope would authorise ` +
        `nobody or, worse, be read as "no scope required" — refuse to boot instead.`);
    }
  }
  return map;
}

/**
 * ★★★ A ROUTE CANNOT BE BOTH DELEGABLE AND NEVER-DELEGABLE. Exported so a test can feed it a
 *    deliberately overlapping pair; the real pair is checked by the call directly below, at load time.
 */
export function assertNeverDelegableDisjoint(map, neverDelegable) {
  const overlap = Object.keys(map).filter((k) => neverDelegable.has(k));
  if (overlap.length) {
    throw new TypeError(
      `ROUTE_SCOPES and NEVER_DELEGABLE both claim: ${overlap.join(", ")} — a route must be exactly one.`);
  }
  return true;
}

/**
 * ★★★ EVERY SCOPED_BUT_CLOSED MEMBER MUST BE A DECIDED, MAPPED ROUTE. Exported so a test can feed it a
 *    deliberately fabricated member outside the map; the real pair is checked by the call directly
 *    below, at load time.
 */
export function assertScopedButClosedSubset(map, scopedButClosed) {
  const missing = [...scopedButClosed].filter((k) => !(k in map));
  if (missing.length) {
    throw new TypeError(`SCOPED_BUT_CLOSED names routes not in ROUTE_SCOPES: ${missing.join(", ")}`);
  }
  return true;
}

/**
 * ★★★ THE FOUR COUNTS §9 STATES, AND "EXACTLY ONE PER_VIEW". Exported so a test can feed it a
 *    deliberately wrong shape; the real vocabulary is checked by the call directly below, at load time.
 */
export function assertVocabularyCounts({
  grantable = GRANTABLE_SCOPES, routeScopes = ROUTE_SCOPES,
  neverDelegable = NEVER_DELEGABLE, scopedButClosed = SCOPED_BUT_CLOSED,
} = {}) {
  // ★ [FINAL PUSH Stage 4, 7 Oct 2026] 25 → 28: plays:read, plays:write, drafts:write.
  // ★ [FINAL PUSH Stage 6, 7 Oct 2026] 28 → 35: templates:read/write, webhooks:read/write, reports:read, account:read, embedded:write.
  if (grantable.length !== 35 || new Set(grantable).size !== 35) {
    throw new TypeError(`GRANTABLE_SCOPES must hold exactly 35 distinct scopes, holds ${grantable.length} (${new Set(grantable).size} distinct)`);
  }
  const routeCount = Object.keys(routeScopes).length;
  // ★ [TY, 2 Oct 2026] 129 → 128: "GET /api/reports/accountant" removed along with the whole
  //   accountant pack feature.
  // ★ [3 Oct 2026, QUEUE §23.5.8] 128 → 134: the six Documents REST API routes (src/routes/developerDocuments.mjs), four reads and two writes.
  // ★ [Part 30 item 7] 134 → 136: POST /api/v1/templates/html and /file (make a template from text tags).
  // ★ [Part 30 item 2] 136 → 141: remind, template read, audit-log CSV, reports, teams — the rest of the customer-facing document operations a key may use.
  // ★ [Part 30 item 4] 141 → 142: POST /api/v1/documents/:id/embed-session (a one-hour embedded signing session for a seat the integrator sent as embedded).
  // ★ [Shared engine, 6 Oct 2026] 142 → 145: POST /api/v1/templates/source, POST /api/v1/documents/ai/draft, GET /api/v1/documents/ai/jobs/:id; 145 → 146: GET /api/v1/usage.
  // ★ [B10, 7 Oct 2026] 146 → 157: the v2 flow for a key — create from words and people, check, read a draft's source, revise, send a draft, use a template, template defaults, AI edit, cancel an AI job, the wizard's questions, Stripe status.
  // ★ [FINAL PUSH Stage 4, 7 Oct 2026] 157 → 168: the plays, playbooks and drafts routes (src/routes/developerPlays.mjs).
  // ★ [FINAL PUSH Stage 6, 7 Oct 2026] 168 → 174: test-sign, four email-template routes, GET /emails.
  // [FINAL PUSH Stage 6, 7 Oct 2026] 174 → 182: the webhook routes; 182 → 183: the embedded builder session; 183 → 184: the embedded Scribe session; 184 → 185: GET /api/v1/ai/usage; 185 → 186: POST /api/v1/documents/detect-fields.
  // [Run 7, 11 Oct 2026] 186 → 193: the seven /api/v1/forms routes.
  // [Run 9, 12 Oct 2026] 193 → 200: search, contracts (list, correct a date), payments (list, refund), playbook flows (list, switch on/off).
  // [Run 9 Part 4R, 12 Oct 2026] 200 → 205: the template library (list, one, draft from, customize) and switching a pack on or off; the flows are /api/v1/automations now (renamed, not added).
  // [Run 9 Part 4.3, 12 Oct 2026] 205 → 204: POST /api/money/subscriptions/cancel named a route that no longer exists (F1031's gate found it).
  if (routeCount !== 204) {
    throw new TypeError(`ROUTE_SCOPES must hold exactly 204 entries, holds ${routeCount}`);
  }
  // ★★★ 7.25 — 40 → 41. 7.21 shipped 40; this module's OWN load-time check must accept the 41st
  //     member 7.25 adds above, or the module (and everything that imports it, including
  //     `src/routes/developer.mjs`) never loads. `test/s7_capability_vocabulary.test.mjs` (7.21's)
  //     still asserts 40 and goes red until it is updated — a report item for step 3/4, not this task's
  //     to touch (HARD RULES: never edit an existing test).
  // ★★★ Stage 18 added 22 new entries to NEVER_DELEGABLE (task 18.49: 12 operator overview/usage/jobs/prompts
  //     routes, 4 operator support-access routes, 3 self-device management routes, 3 client-app exclusive routes),
  //     taking it from 44 to 66. The count was already 44 before Stage 18 (earlier stages had updated from 41).
  // ★ [TY, 2 Oct 2026] 67 → 66: "POST /api/reports/accountant/send" removed along with the whole
  //   accountant pack feature.
  // ★ [FINAL PUSH Stage 6, 7 Oct 2026] 66 → 67: POST /api/developer/api-keys/:id/allowlist.
  // [Run 9 Part 4.3, 12 Oct 2026] 67 → 66: POST /api/app/booking/waitlist named a route that no longer exists (F1031's gate found it).
  if (neverDelegable.size !== 66) {
    throw new TypeError(`NEVER_DELEGABLE must hold exactly 66 entries, holds ${neverDelegable.size}`);
  }
  if (scopedButClosed.size !== 7) {
    throw new TypeError(`SCOPED_BUT_CLOSED must hold exactly 7 entries, holds ${scopedButClosed.size}`);
  }
  const perViewCount = Object.values(routeScopes).filter((v) => v === "PER_VIEW").length;
  if (perViewCount !== 1) {
    throw new TypeError(`ROUTE_SCOPES must map exactly one key to "PER_VIEW", maps ${perViewCount}`);
  }
  return true;
}

assertRouteScopes(ROUTE_SCOPES);
assertNeverDelegableDisjoint(ROUTE_SCOPES, NEVER_DELEGABLE);
assertScopedButClosedSubset(ROUTE_SCOPES, SCOPED_BUT_CLOSED);
assertVocabularyCounts();
