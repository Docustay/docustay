// P19.11 — THE DEVELOPER ROUTES, AND THE FIRST ROUTE IN THIS PROJECT THAT AUTHENTICATES BY TOKEN.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ MEASURED BEFORE WRITING THIS: `handleApiTokenRequest` was IMPORTED by src/http/app.mjs and
//     **never called** — zero call sites. So P1.10's "one of the four entry paths" had a function, a
//     Y1 assertion and no route: nothing in the product could be reached with an API key. An entry
//     path with no route is the same shape as F5 (a queue with no producer): it passes every check
//     and moves nothing.
//
// ★★★ TWO AUTH REGIMES IN ONE FILE, DELIBERATELY, AND NEVER MIXED ON ONE ROUTE:
//   · `/api/developer/api-keys*` — SESSION auth. Managing keys is a staff action by a logged-in
//     human, and a key must never be able to mint another key. **That is the privilege-escalation
//     shape**: one leaked key would otherwise become permanent access.
//   · `/api/v1/*` — BEARER auth. This is what a key is FOR.
//   ★ They are separate handlers with separate wrappers. A single handler with
//     `if (bearer) … else …` is one refactor from letting a token reach the management routes.
//
// ★★ AND THE KEY IS SHOWN ONCE (P19.4). The create response is the ONLY place `presented` exists. It
//    is not logged, not stored in the idempotency record (the route returns it OUTSIDE the replayed
//    body — see the comment at the write), and there is no route that can produce it again.

import { replayDelivery } from "../webhooks/subscribers.mjs";
import { handleApiTokenRequest, recognizeApiToken } from "../paths/index.mjs";   // recognizeApiToken: D-020
// ★★★ F688 — the ONE new import this fix adds, for `/settings/developer`'s own landing route
//     below. The children list is READ from `SETTINGS_CHILDREN`'s own `set-developer` row, never
//     hand-typed a second time — the same "resolved against the nav, not retyped" discipline
//     `SettingsHome` (`src/routes/settings.mjs`) already uses for its own card list.
import { SETTINGS_CHILDREN } from "../nav/sections.mjs";
import { apiKeyFirst } from "../http/apiKeyFirst.mjs";
import { createApiToken, revokeApiToken, listApiTokens, TokenError, TokenConfigError } from "../auth/apiToken.mjs";
import { listAuditEvents, auditSummary } from "../audit/queries.mjs";
import { unauthenticated, forbidden, invalid, notFound } from "../http/errors.mjs";
import { specMethodIndex, allowHeader } from "../http/methodGuard.mjs";
import { authoriseSection } from "../nav/authorise.mjs";
// ★★★ 7.12b / F594, RULED 21 Sep 2026 — the `assertRank` import is GONE and NOTHING replaced it.
//     7.12b field 4 claimed this file's one call site "becomes `keystone.caller_is_platform()` (the
//     super_admin_1 floor)". That was WRONG: MEASURED, every `session(...)` call site in this file
//     passes `minRank: "admin"` (`:161`, `:163`, `:216`, `:223`, `:274`, `:297`) and all three nav
//     rows it names — `/settings/developer/api-keys`, `/webhooks`, `/audit-log` — carry
//     `minRole: 'admin'`. Converting to the operator floor would have refused every practice admin
//     their own API keys, webhooks and audit log. Q7-5's "operator grant alone" covers the three
//     `platform: true` routes in `writes.mjs` and `/api/platform/*`, and nothing here.
//   ★★ WHY THE CALL IS DELETED RATHER THAN TRANSLATED, AND THE PROOF IS ALREADY IN THE REPO:
//      `db/gates/p0_developer_authorisation.mjs:157-161` records it MEASURED BY MUTATION
//      (2026-09-14) — *"Removing `assertRank` ALSO left the coach at 403 (message: 'refused:
//      requires_admin' — `authoriseSection` caught it)"*. The two guards are redundant here, and
//      that gate's LIVE assertion (`:166-172`) asserts the refusal carries `authoriseSection`'s
//      words, not `assertRank`'s — so it is this deletion's positive control, not its casualty.
//      `minRank` stays in the signature as an inert residual, the same treatment
//      `src/routes/platform.mjs:37` got by ruling; retiring the parameter is a later cleanup.
import { emit, ALL_TOPICS, TOPICS, userActor } from "../events/outbox.mjs";
import { DOCUSTAY_WEBHOOK_TOPICS } from "../developer/webhookTopics.mjs";
import { createWebhookEndpoint, sendTestEvent, recordTestSend, rotateEndpointSecret } from "../webhooks/outbound.mjs";
import { randomBytes } from "node:crypto";
import { effectiveGrants } from "../permissions/resolve.mjs";

/** ★ The scopes a caller may ask for. A closed list — a typo becomes a 400, never a silent no-op. */
// ★★★ THE SCOPE VOCABULARY LIVES IN `developer/scopes.mjs` AND IS RE-EXPORTED HERE — A MOVE, NOT A
//     FORK (A8). Split so the key-minting surface can import it in a BROWSER; this is a route file
//     and cannot be loaded there. Every existing importer resolves unchanged.
export { GRANTABLE_SCOPES } from "../developer/scopes.mjs";
import { GRANTABLE_SCOPES } from "../developer/scopes.mjs";
// Run 10 (R10-38): a Docustay workspace is a document product. Its keys may carry the Documents-side scopes only (and reading people, which the signer list needs): the CRM, money, booking and
// internal scopes exist for the platform and were being listed, and accepted, for a Docustay workspace too. the platform is untouched.
const DOCUSTAY_SCOPE = /^(documents|templates|webhooks|reports|account|embedded|plays|drafts):/;
export const docustayScopes = (all) => all.filter((x) => DOCUSTAY_SCOPE.test(x) || x === "people:read");
async function scopesFor(db, tenantId) {
  const { rows: [t] } = await db.query(`SELECT product FROM keystone.tenant WHERE id = $1`, [tenantId]);
  return t?.product === "docustay" ? docustayScopes([...GRANTABLE_SCOPES]) : [...GRANTABLE_SCOPES];
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ P0.5 — YOU CANNOT GRANT WHAT YOU DO NOT HOLD. [F101]
//     [MEASURED 2026-09-14] `keystone.create_api_token()` (`db/migrations/0046_…:50-73`) does two
//     things well — the tenant comes from `current_tenant_id()` with a hard RAISE if null, and
//     there is no `p_tenant_id` argument to get wrong — and then **INSERTs `p_scopes` verbatim**.
//     Nothing anywhere compared the requested scopes against the caller's own authority. The route
//     checked them against `GRANTABLE_SCOPES`, which is a VOCABULARY check, not an AUTHORITY one:
//     it catches a typo and waves through an escalation.
//
// ★★★ WHY THIS IS HERE AND NOT IN SQL YET — A DECISION, RECORDED. The policy "which scopes may
//     this principal grant" is a function of the ROLE MODEL, and the role model does not exist
//     until P1.2 (`role` · `role_permission` · `user_role`, with scope as a non-nullable axis).
//     Writing it into `create_api_token()` today would encode a policy that has no tables behind
//     it and would have to be migrated a second time three phases later. So:
//       · the check is enforced HERE, at the server boundary, today — a real boundary, not a
//         payload decision;
//       · it is ONE named function, so P1.2 re-points it at `role_permission` and changes nothing
//         else;
//       · the DATABASE-level enforcement lands in P1.2's migration, beside the axis it depends on.
//     ★★ HARMLESS TODAY AND THAT IS THE POINT OF DOING IT NOW: only `admin` and above can reach
//        this route (P0.4), and admins hold everything, so the check is currently inert. It stops
//        being inert the moment a Coach role is scoped "Owned only" — and at that moment a coach
//        minting `people:read` would read the whole practice through `/api/v1/people`.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ 7.22 — WHO MAY GRANT WHICH TOGGLE, AND THE FOUR A KEY MAY NEVER BE GIVEN.
//     `scopesGrantableBy` answers a VOCABULARY question (does the role model let this caller mint
//     at all?) with SUBTRACTION-ONLY narrowing applied after: the function can never return a scope
//     the old code would have returned, which is what makes this change safe to ship beside 7.21's
//     widening from 7 to 23 scopes.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
/** ★ Owner-only toggles. A leaked Admin-minted key must not be able to move money or change settings. */
export const OWNER_ONLY_SCOPES = Object.freeze(new Set([
  "money:write", "settings:write", "platform:read", "platform:write",
]));
/** ★ …and the two platform scopes need the platform practice as well as the Owner rank. */
export const PLATFORM_TENANT_SCOPES = Object.freeze(new Set(["platform:read", "platform:write"]));

export function scopesGrantableBy(user, grants = null, { tenantIsPlatform = false } = {}) {
  // ★ FAIL CLOSED. An unrecognised shape grants nothing, rather than falling through to a default
  //   that happens to be permissive.
  if (!user || user.role !== "staff") return [];

  // ★ SUBTRACTION ONLY, applied uniformly to whatever the role model already allowed below — never
  //   an independent grant. Owner-only first (rank), platform-only second (tenant practice).
  const narrow = (scopes) => {
    let out = user.staff_role === "owner" ? scopes : scopes.filter((s) => !OWNER_ONLY_SCOPES.has(s));
    if (!tenantIsPlatform) out = out.filter((s) => !PLATFORM_TENANT_SCOPES.has(s));
    return out;
  };

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ P1.7 — THE CUTOVER. This now reads the ROLE MODEL, which is what P0.5 said it eventually
  //     would. Minting a live API key is a SETTINGS-level act, so the authority for it is the
  //     `setting` object at `edit` or above, at tenant-wide scope — the same axis `/settings/*`
  //     is governed by, rather than a second policy invented here.
  //   ★★ `setting` is ownerless (0066's `role_permission_setting_scope`), so "everything" is the
  //      only scope that can carry it — which is why this reads as a simple rank question again
  //      once the model is in place. The DIFFERENCE is that the answer now comes from a row an
  //      operator can change in `/settings/roles`, not from a literal in this file.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  if (grants && Object.keys(grants).length > 0) {
    // ★★★ ANY SETTINGS ACCESS ABOVE `none`, NOT `edit`. The first version of this required
    //     edit-or-delete, and `db/gates/p1_scope_wired.mjs §5` immediately went red: the SHIPPED
    //     Admin role holds `setting: view/everything` — *"everything except changing practice
    //     settings"* — so requiring `edit` would have silently stripped every admin of key minting
    //     and left them a route they can reach and can never use. A dead control by another name.
    //   ★★ A CUTOVER MOVES THE AUTHORITY SOURCE; IT DOES NOT CHANGE WHO HAS THE AUTHORITY. Deciding
    //      that only Super Admins may mint keys is a real product question, and it now has a real
    //      place to be answered — `/settings/roles` (P6.62), by setting `setting: none` on a role.
    //      Answering it here, as a side effect of a refactor, would be deciding it by accident.
    //   ★ `setting` is ownerless (0066's `role_permission_setting_scope`), so `everything` is the
    //     only scope it can carry — the check reads as a rank question because the object has no
    //     other shape available to it.
    const may = (grants.setting ?? []).some((g) => g.verb !== "none" && g.scope === "everything");
    return may ? narrow([...GRANTABLE_SCOPES]) : [];
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ THE TRANSITIONAL FALLBACK, AND WHY IT IS NOT A FAIL-OPEN.
  //     `grants` is EMPTY only when the caller holds no role at all — which, after
  //     `scripts/backfill-roles.mjs` has run, happens to nobody. Before it has run it is true of
  //     EVERY existing user, and cutting over without this would lock every current admin out of a
  //     feature that works today.
  //   ★★ IT CANNOT WIDEN ANYTHING. It returns exactly what this function returned before the
  //      cutover — the same `staff_role` test, the same answer — so the worst case is today's
  //      behaviour, never more than it. A fallback that can only reproduce the status quo is a
  //      migration aid; one that can exceed it is a hole.
  //   ★ `db/gates/p1_scope_wired.mjs` asserts BOTH halves: that a user WITH roles is answered from
  //     `role_permission` (the fallback is not consulted), and that a user with none still gets the
  //     old answer. **Delete this branch once every deployment has been backfilled**; the gate's
  //     first assertion is what proves it is safe to.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ 7.22 / F593-adjacent — THE RANK LITERAL, CORRECTED TO 7.7's VOCABULARY. After 0188 no row
  //     carries `super_admin` or `super_admin_1`: `keystone.app_user.staff_role` is narrowed to
  //     `('owner','admin','coach')` (`src/permissions/defaults.mjs:117`). Leaving the old literal
  //     here would make this fallback grant nothing to anybody on a deployment whose roles are not
  //     yet backfilled — a silent lock-out of key minting, not a cosmetic rename.
  const rank = user.staff_role;
  return (rank === "admin" || rank === "owner")
    ? narrow([...GRANTABLE_SCOPES])
    : [];
}

/** ★ The nav rows these routes belong to. The rank floor comes from `sections.mjs` through
 *  `authoriseSection`, so it is declared in ONE place and not as a second literal here. */
// ★★★ F688 — the PARENT row's own path. Its 3 children (`api-keys`, `audit-log`, `sandbox`) were
//     already route-backed; the parent itself had no read route and stood `no_read_path` in
//     `src/nav/buildState.mjs` despite being reachable in the sidebar. This is that route's floor.
const DEVELOPER_ROW = "/settings/developer";
const KEYS_ROW = "/settings/developer/api-keys";
// ★ P8.5 — its own nav row, so the section authorisation is the one a reader expects.
const WEBHOOKS_ROW = "/settings/developer/webhooks";
const AUDIT_ROW = "/settings/developer/audit-log";

// ★ `scoped` is gone from this signature: it was declared and never passed by `src/http/app.mjs`,
//   and never used in the body — a declared-and-unused parameter, which is the class this phase is
//   about. Removed rather than left to look load-bearing.
export function registerDeveloperRoutes(app, { runTenantScoped, tenantIsPlatform } = {}) {
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ P0.4 — AUTHENTICATION IS NOT AUTHORISATION, AND FOR FOUR ROUTES THIS FILE HAD ONLY THE
  //     FIRST. [MEASURED 2026-09-14] `runTenantScoped` (`src/http/app.mjs:282-361`) authenticates,
  //     resolves the tenant and loads `role`/`staff_role` — then returns the handler. It never
  //     calls `authoriseSection` and never calls `assertRank`. `src/routes/writes.mjs:172-174`
  //     calls BOTH, on every one of its 44 routes. There is no `/api/developer/*` prefix guard;
  //     the only prefix guards on the app are `/api/*` (principal) and `/api/platform/*`.
  //     ★★ So any authenticated principal in a tenant — a coach, and on the evidence a parent or a
  //     client — could mint a LIVE secret key carrying every grantable scope, revoke anyone else's,
  //     and read the audit log. The header at :11-12 already stated the rule: "Managing keys is a
  //     staff action by a logged-in human … that is the privilege-escalation shape." [F100]
  // ★★★ THE GUARD IS IN THE WRAPPER, NOT COPIED INTO FOUR HANDLERS, SO A FIFTH ROUTE ADDED TO THIS
  //     FILE CANNOT FORGET IT. A check you must remember to write is a check that will be missed.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★ `status` defaults to 200 for reads. A POST that CREATES returns **201**, because that is this
  //   project's own convention everywhere else — `src/routes/writes.mjs:192` returns 201 on all 44
  //   write routes and `src/routes/signup.mjs:165,175` does the same. [MEASURED 2026-09-14] these
  //   two POSTs returned 200, and were the only creating routes in the app that did. Nothing
  //   consumed it: `web/src/lib/api.js` has no developer method at all.
  // ★ `bucket: "write"` for the mutating pair for the same reason — minting a credential is a write
  //   and belongs in the write rate-limit bucket, not the default read one.
  const session = (navPath, minRank, fn, { status = 200, ...opts } = {}) => (c) =>
    runTenantScoped(c, async (ctx) => {
      const isPlatform = await tenantIsPlatform(ctx.db, ctx.tenantId);
      const decision = authoriseSection(ctx.principal.user, navPath, { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
      // ★★★ 7.12b / F594 — the `assertRank(ctx.principal.user, minRank, navPath)` that stood here
      //     is DELETED, not translated: `authoriseSection` above enforces the SAME `admin` floor
      //     from the SAME nav row, MEASURED by mutation in 2026-09-14 (see the import comment).
      //     `minRank` is now inert. Read that comment before adding a check back here.
      return fn(ctx);
    }, { ...opts, status }).then((r) => c.json(r, status));

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // ★★★ F688 — THE LANDING ROW. `/settings/developer` itself had no read route: its 5 children
  //     (`SETTINGS_CHILDREN`'s own `set-developer` row — api keys, webhooks, embeds, audit log,
  //     sandbox, all already route-backed) were reachable directly, but the parent stood
  //     `no_read_path` in `src/nav/buildState.mjs`. `specs/mockups/SetDeveloper.frame.html` draws
  //     the full key/webhook/embed/sandbox content inline on one page — but every one of those has
  //     its OWN dedicated screen and OWN writer already (api-keys' create/revoke/scopes, the
  //     webhook endpoint form, the audit log) and duplicating that content here would be a SECOND
  //     read of data a dedicated screen already owns, the same "two places that can drift" shape
  //     `src/permissions/audit.mjs`'s "ONE WRITER" comment warns against for writes. **Deviation
  //     from the frame, noted rather than guessed past**: this route/screen ports the frame's own
  //     header (breadcrumb, title, "Advanced" banner copy) and each section's own heading/subheading
  //     verbatim, but each section's BODY is a single link into its own already-built screen instead
  //     of the frame's inline table/form — the "simplest reasonable landing page" the item's own
  //     fallback instruction names for exactly this case.
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  app.get("/api/settings/developer", session(DEVELOPER_ROW, "admin", async () => {
    const row = SETTINGS_CHILDREN.find((r) => r.key === "set-developer");
    return {
      path: DEVELOPER_ROW,
      title: row?.label ?? "Developer",
      description: "API keys, webhooks and website embeds. For connecting other software — most " +
        "practices never need this.",
      children: (row?.children ?? []).map((c) => ({ key: c.key, path: c.path, label: c.label })),
    };
  }));

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // KEY MANAGEMENT — SESSION AUTH ONLY, AND NOW AUTHORISED.
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  app.get("/api/developer/scopes", session(KEYS_ROW, "admin", async ({ db, tenantId }) => ({ scopes: await scopesFor(db, tenantId) })));
  app.get("/api/developer/api-keys", session(KEYS_ROW, "admin", async ({ db }) => {
    // FP-F3/F4 — the list also carries where each key was last used from and which addresses may use it
    const keys = await listApiTokens(db), { rows } = await db.query(`SELECT * FROM keystone.list_api_token_details()`), more = new Map(rows.map((r) => [r.id, r])), policies = await policiesByKey(db);
    return { keys: keys.map((k) => { const d = more.get(k.id); return { ...k, key_id: d?.token_id ?? null, last_used_ip: d?.last_used_ip ?? null, last_used_agent: d?.last_used_agent ?? null, ip_allowlist: d?.ip_allowlist ?? [], policy: policies[d?.token_id] ?? { draftOnly: false, maxDraftsPerDay: null, maxSendsPerDay: null } }; }) };
  }));
  // FP-F4 — change the addresses a key may be used from (an empty list = anywhere). Admin, same gate as minting.
  app.post("/api/developer/api-keys/:id/allowlist", session(KEYS_ROW, "admin", async ({ db, body, c, tenantId, principal }) => {
    const id = c.req.param("id");
    let allow; try { allow = cleanAllowlist(body?.ipAllowlist); } catch (e) { throw invalid(e.message, { field: "ipAllowlist" }); }
    const { rows: [r] } = await db.query(`SELECT keystone.set_api_token_allowlist($1, $2::text[]) AS ok`, [id, allow]);
    if (!r?.ok) throw notFound("no such key");
    await emit(db, { tenantId, topic: "developer.api_key.allowlist_changed", emittedBy: "developer", subjectType: "api_token", subjectId: id, actor: userActor(principal?.appUserId ?? null), payload: { ranges: allow.length } });
    return { ok: true, ipAllowlist: allow };
  }, { status: 200 }));

  // FP-G1 — change a key's policy later (draft-only, daily limits). Admin, same gate as minting.
  app.post("/api/developer/api-keys/:id/policy", session(KEYS_ROW, "admin", async ({ db, body, c, tenantId, principal }) => {
    const { rows: [d] } = await db.query(`SELECT token_id FROM keystone.list_api_token_details() WHERE id = $1`, [c.req.param("id")]);
    if (!d?.token_id) throw notFound("no such key");
    const out = await saveKeyPolicy(db, { tenantId, tokenId: d.token_id, draftOnly: body?.draftOnly === true, maxDraftsPerDay: body?.maxDraftsPerDay, maxSendsPerDay: body?.maxSendsPerDay });
    await emit(db, { tenantId, topic: "developer.api_key.policy_changed", emittedBy: "developer", subjectType: "api_token", subjectId: c.req.param("id"), actor: userActor(principal?.appUserId ?? null), payload: { draftOnly: out.draftOnly } });
    return { ok: true, policy: out };
  }, { status: 200 }));

  app.post("/api/developer/api-keys", session(KEYS_ROW, "admin", async ({ db, body, principal, tenantId }) => {
    const name = String(body?.name ?? "").trim();
    const scopes = Array.isArray(body?.scopes) ? body.scopes : [];
    const environment = body?.environment === "live" ? "live" : "test";
    const tokenClass = body?.class === "publishable" ? "publishable" : "secret";
    // ★ VOCABULARY first — a typo is a 400, and it is a different answer from a refusal.
    const grantable = await scopesFor(db, tenantId);
    const bad = scopes.filter((s) => !grantable.includes(s));
    if (bad.length) {
      const e = new TokenError(`unknown scope(s): ${bad.join(", ")}. Grantable: ${grantable.join(", ")}`);
      e.statusCode = 400; throw e;
    }
    // ★★★ THEN AUTHORITY — P0.5. A known scope the caller does not hold is a 403, NOT a 400: the
    //     scope exists and they may not grant it, which is a refusal and must read as one.
    // ★ Resolved from `role_permission` for THIS caller, inside the same transaction as the write.
    const grants = await effectiveGrants(db, principal?.appUserId ?? null);
    // ★★★ 7.22 — THE THIRD, OPTIONAL ARGUMENT. `tenantIsPlatform` is already in scope inside this
    //     closure (`registerDeveloperRoutes(app, { runTenantScoped, tenantIsPlatform })`), the same
    //     helper `session()`'s own wrapper calls at `:193` — no new dependency is injected here.
    const held = scopesGrantableBy(principal.user, grants, { tenantIsPlatform: await tenantIsPlatform(db, tenantId) });
    const overreach = scopes.filter((s) => !held.includes(s));
    if (overreach.length) {
      throw forbidden(
        `refused: cannot grant scope(s) you do not hold: ${overreach.join(", ")}`);
    }
    // ★★★ 7.22 (Q7-20, option (a)) — THE CEILING VALUE, THREADED ONCE. `rankCeiling` is the
    //     minter's OWN authority — `principal.user.staff_role`, the `app_user` row this request
    //     already loaded inside the tenant transaction (`src/http/app.mjs:607-631`, P13.6) — never a
    //     token claim and never a body field. Who supplies "a minter cannot name a ceiling above its
    //     own": the APPLICATION, at this one call site (asserted by field 8 test (g) and by 7.28).
    // FP-F2 / F4 / F6 — an optional expiry, an optional list of addresses, and a Docustay workspace's keys carry the dsk_ prefix (older gl_ keys keep working)
    let expiresAt = null, allow = [];
    if (body?.expiresInDays !== undefined && body?.expiresInDays !== null && body?.expiresInDays !== "") {
      const n = Number(body.expiresInDays);
      if (!Number.isInteger(n) || n < 1 || n > 730) throw invalid("expiresInDays must be a whole number from 1 to 730, or left out for a key that does not expire", { field: "expiresInDays" });
      expiresAt = new Date(Date.now() + n * 86400000).toISOString();
    }
    try { allow = cleanAllowlist(body?.ipAllowlist); } catch (e) { throw invalid(e.message, { field: "ipAllowlist" }); }
    const { rows: [prod] } = await db.query(`SELECT product FROM keystone.tenant WHERE id = $1`, [tenantId]);
    const made = await createApiToken(db, {
      environment, tokenClass, name, scopes, createdBy: principal?.appUserId ?? null,
      rankCeiling: principal.user.staff_role, expiresAt, brand: prod?.product === "docustay" ? "dsk" : "gl" });
    if (allow.length) await db.query(`SELECT keystone.set_api_token_allowlist($1, $2::text[])`, [made.id, allow]);
    // FP-G1 — a draft-only key and/or daily limits, set at the moment of minting
    if (body?.draftOnly || body?.maxDraftsPerDay || body?.maxSendsPerDay) await saveKeyPolicy(db, { tenantId, tokenId: made.tokenId, draftOnly: body?.draftOnly === true, maxDraftsPerDay: body?.maxDraftsPerDay, maxSendsPerDay: body?.maxSendsPerDay });
    // ★★★ P0.6 / F96 — IN THE SAME TRANSACTION AS THE WRITE. `db` is the tenant transaction
    //     `runTenantScoped` opened, which is the whole contract of `emit(tx, …)`: emitting after
    //     the commit loses the event if the process dies; emitting before it fires for a grant that
    //     then rolls back. ★★ NEVER the token, the secret or the presented key in the payload —
    //     an audit row is read by people who may not hold the credential it describes.
    await emit(db, {
      tenantId, topic: "developer.api_key.created", emittedBy: "developer",
      subjectType: "api_token", subjectId: made.id,
      // ★ STAGE 3 TASK 1 — same fact as `createdBy` above, now also on the envelope.
      actor: userActor(principal?.appUserId ?? null),
      // ★★★ STAGE 3 TASK 3 — `name` DROPPED (§2.4 bans it outright — a key's label is exactly the
      //   kind of typed text the rule targets). A reader wanting the label reads the current
      //   `api_token.name` row by `subjectId`, the same id the audit screen already shows.
      payload: { environment, class: tokenClass, scopes, last_four: made.lastFour },
    });
    // ★★★ `key` IS RETURNED EXACTLY HERE AND NOWHERE ELSE. P19.4. A caller that loses it creates a
    //     new one; there is no recovery path, and that is the feature.
    return { id: made.id, key: made.presented, last_four: made.lastFour, shown_once: true };
  }, { status: 201, bucket: "write", redactReplayFields: ["key"] }));

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ P8.5 — OUTBOUND WEBHOOK ENDPOINTS. `createWebhookEndpoint` and `deliverEvent` existed with
  //     ZERO importers in `src/`: the tables were there (0047), the signing was there, the retry
  //     accounting was there, and **no route could create a subscription and no job read one**.
  //   ★★ ONCE ENDPOINTS CAN SUBSCRIBE, n8n IS JUST A URL — and so is Zapier, and so is a tenant's
  //      own server. That is KS-14's ruling that the subscriber is worth more than the integration
  //      it was requested for.
  //   ★ Same `session(...)` wrapper as the API keys, so the P0.4 authorisation fix covers these
  //     too: "a check you must remember to write is a check that will be missed."
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★ the maintainer, 28 Sep 2026 — the topic catalogue itself, for the "add endpoint" picker. The frontend
  //   cannot import `src/events/topics.mjs` directly (a backend-only module); this is that
  //   boundary's real fix, not a stale copy re-declared client-side (TOPICS is ~80 entries and
  //   changes whenever a new event ships).
  app.get("/api/developer/webhook-topics", session(WEBHOOKS_ROW, "admin", async ({ db, tenantId }) => {
    // R13-D230: a Docustay workspace is offered only the document events the product really sends
    const { rows: [ws] } = await db.query(`SELECT product FROM keystone.tenant WHERE id = $1`, [tenantId]);
    return { topics: ws?.product === "docustay" ? { documents: [...DOCUSTAY_WEBHOOK_TOPICS] } : TOPICS };
  }));

  app.get("/api/developer/webhook-endpoints", session(WEBHOOKS_ROW, "admin", async ({ db }) => ({
    endpoints: (await db.query(
      `SELECT id, url, name, event_types, status, disabled_reason, consecutive_failures,
              secret_fingerprint, kek_version, secret_rotated_at, created_at
         FROM keystone.webhook_endpoint
        WHERE NOT (status = 'disabled' AND disabled_reason IS NOT DISTINCT FROM 'removed')   -- R13-D423 (a disabled endpoint with no reason stays listed): a removed webhook is gone here too, as in GET /api/v1/webhooks
        ORDER BY created_at DESC`)).rows,
  })));

  app.post("/api/developer/webhook-endpoints", session(WEBHOOKS_ROW, "admin",
    async ({ db, body, tenantId, principal }) => {
      const url = String(body?.url ?? "").trim();
      const name = String(body?.name ?? "").trim();
      const eventTypes = Array.isArray(body?.event_types) ? body.event_types : [];

      // ★ VOCABULARY FIRST, exactly as the API-key route does — an unknown topic is a 400 naming it,
      //   not a constraint violation from Postgres. The schema's CHECK would refuse the shape; it
      //   would not tell the caller WHICH topic they misspelled.
      const unknown = eventTypes.filter((t) => !ALL_TOPICS.includes(t));
      if (unknown.length) {
        throw invalid(
          `unknown topic(s): ${unknown.join(", ")} — an endpoint subscribed to a topic that does ` +
          `not exist would receive nothing and look configured`);
      }

      // LAUNCH (G1 finding): a Docustay workspace is a document product. It may subscribe to document events only, never to the CRM, money, booking or internal developer topics (the picker already offers only these; this makes the server say the same).
      { const { rows: [ws] } = await db.query(`SELECT product FROM keystone.tenant WHERE id = $1`, [tenantId]);
        if (ws?.product === "docustay") { const outside = eventTypes.filter((t) => !DOCUSTAY_WEBHOOK_TOPICS.includes(String(t))); /* R13-D230: only events the product really sends */ if (outside.length) throw invalid(`a Docustay workspace can subscribe only to the document events it sends (the webhook topics list); not: ${outside.slice(0, 5).join(", ")}${outside.length > 5 ? ", …" : ""}`); } }

      // ★★★ THE SECRET IS GENERATED HERE AND RETURNED EXACTLY ONCE, like the API key at :191.
      //     A caller-supplied secret would mean the plaintext had already travelled somewhere we
      //     do not control; there is no recovery path, and that is the feature.
      const secret = `whsec_${randomBytes(24).toString("base64url")}`;
      const made = await createWebhookEndpoint(db, { tenantId, url, name, eventTypes, secret });

      await emit(db, {
        // ═══════════════════════════════════════════════════════════════════════════════════
        // ★★★ STAGE 3 TASK 4 — THE WRONG TOPIC, FIXED (02-event-catalogue.md §4). [MEASURED] this
        //     used to emit `developer.api_key.created` for a WEBHOOK ENDPOINT — the same topic the
        //     route above emits for an API key, a different subject entirely
        //     (`subjectType: "api_token"` there vs `"webhook_endpoint"` here). A listener that
        //     subscribed to "a key was minted" also fired for "an endpoint was registered", and the
        //     two could never be told apart by topic alone. `developer.webhook_endpoint.created` is
        //     the correct, separate topic — declared in `topics.mjs`, no migration needed (the
        //     `developer` section already exists, 0064).
        // ═══════════════════════════════════════════════════════════════════════════════════
        tenantId, topic: "developer.webhook_endpoint.created", emittedBy: "developer",
        subjectType: "webhook_endpoint", subjectId: made.id,
        // ★ STAGE 3 TASK 1.
        actor: userActor(principal?.appUserId ?? null),
        // ★★ NEVER the secret or the envelope in an audit payload — the fingerprint is precisely the
        //    value that lets two parties confirm they hold the same secret without revealing it.
        // ★★★ STAGE 3 TASK 3 — `name` AND `url` BOTH DROPPED (§2.4 names this exact call site: no
        //   titles or names, no URLs). A reader wanting either reads the current
        //   `webhook_endpoint` row by `subjectId` — never delivered to the endpoint itself either,
        //   since this event carries no subscriber-facing content at all now.
        payload: { event_types: eventTypes, fingerprint: made.fingerprint },
      });
      return {
        id: made.id, fingerprint: made.fingerprint, kek_version: made.kekVersion,
        secret, shown_once: true,
      };
    }, { status: 201, bucket: "write" }));

  // §25.5 — the delivery log of one endpoint (newest first), and REPLAY of one delivery by a person's click.
  app.get("/api/developer/webhook-endpoints/:id/deliveries", session(WEBHOOKS_ROW, "admin", async ({ db, c }) => ({
    deliveries: (await db.query(
      `SELECT d.id, d.event_id, ev.topic, ev.payload, d.attempt, d.status, d.response_status, d.error, d.attempted_at, d.completed_at, d.duration_ms,
              d.next_retry_at, d.dead_at, d.replay_of, d.replayed_by
         FROM keystone.webhook_delivery d JOIN keystone.event ev ON ev.id = d.event_id AND ev.tenant_id = d.tenant_id
        WHERE d.endpoint_id = $1 ORDER BY d.attempted_at DESC LIMIT 50`, [c.req.param("id")])).rows,
  })));
  // FP-D1 — send a sample signed event to one endpoint now; the answer comes straight back to the screen. A one-line record is kept for the API deliveries list (R13-D197); the endpoint's failure count is untouched.
  app.post("/api/developer/webhook-endpoints/:id/test", session(WEBHOOKS_ROW, "admin", async ({ db, c, body, tenantId }) => {
    const { rows: [endpoint] } = await db.query(`SELECT * FROM keystone.webhook_endpoint WHERE id = $1 AND tenant_id = $2`, [c.req.param("id"), tenantId]);
    if (!endpoint) throw notFound("no such endpoint");
    return recordTestSend(db, { tenantId, endpointId: endpoint.id, out: await sendTestEvent({ tenantId, endpoint, topic: typeof body?.topic === "string" ? body.topic : null, tx: db }) });
  }, { status: 200, bucket: "write" }));
  // R13-D107: an endpoint can be edited (its events), paused and resumed, and removed from Settings, the same ways the v1 API does. A removed endpoint keeps its row and its past deliveries (status disabled, reason removed), exactly as DELETE /api/v1/webhooks/{id}.
  app.patch("/api/developer/webhook-endpoints/:id", session(WEBHOOKS_ROW, "admin", async ({ db, c, body, tenantId }) => {
    const id = c.req.param("id");
    const { rows: [cur] } = await db.query(`SELECT id, status, disabled_reason FROM keystone.webhook_endpoint WHERE id = $1 AND tenant_id = $2 AND NOT (status = 'disabled' AND disabled_reason IS NOT DISTINCT FROM 'removed')`, [id, tenantId]);
    if (!cur) throw notFound("no such endpoint");
    const sets = [], vals = [id, tenantId];
    if (body?.event_types !== undefined) {
      const eventTypes = Array.isArray(body.event_types) ? body.event_types.map(String) : [];
      if (!eventTypes.length) throw invalid("choose at least one event");
      const unknown = eventTypes.filter((t) => !ALL_TOPICS.includes(t));
      if (unknown.length) throw invalid(`unknown topic(s): ${unknown.join(", ")}`);
      const { rows: [ws] } = await db.query(`SELECT product FROM keystone.tenant WHERE id = $1`, [tenantId]);
      if (ws?.product === "docustay") { const outside = eventTypes.filter((t) => !DOCUSTAY_WEBHOOK_TOPICS.includes(t)); if (outside.length) throw invalid(`a Docustay workspace can subscribe to document events only: ${outside.join(", ")}`); }
      vals.push(eventTypes); sets.push(`event_types = $${vals.length}`);
    }
    if (body?.paused !== undefined) {
      if (cur.status === "disabled") throw invalid("this endpoint was switched off after repeated failures; send a test event or add it again");
      sets.push(body.paused ? `status = 'paused'` : `status = 'active', consecutive_failures = 0`);
    }
    if (!sets.length) throw invalid("nothing to change: send event_types or paused");
    const { rows: [row] } = await db.query(`UPDATE keystone.webhook_endpoint SET ${sets.join(", ")}, updated_at = now() WHERE id = $1 AND tenant_id = $2 RETURNING id, url, name, event_types, status`, vals);
    return { endpoint: row };
  }, { status: 200, bucket: "write" }));
  app.delete("/api/developer/webhook-endpoints/:id", session(WEBHOOKS_ROW, "admin", async ({ db, c, tenantId }) => {
    const { rowCount } = await db.query(`UPDATE keystone.webhook_endpoint SET status = 'disabled', disabled_reason = 'removed', updated_at = now() WHERE id = $1 AND tenant_id = $2 AND NOT (status = 'disabled' AND disabled_reason IS NOT DISTINCT FROM 'removed')`, [c.req.param("id"), tenantId]);
    if (!rowCount) throw notFound("no such endpoint");
    return { removed: true };
  }, { status: 200, bucket: "write" }));
  // FP-F5 — a new secret, shown once; the old one keeps signing beside it for a window (default 24 hours) so the receiver can switch without a gap.
  app.post("/api/developer/webhook-endpoints/:id/rotate", session(WEBHOOKS_ROW, "admin", async ({ db, c, body, tenantId, principal }) => {
    const secret = `whsec_${randomBytes(24).toString("base64url")}`;
    const out = await rotateEndpointSecret(db, { tenantId, id: c.req.param("id"), secret, windowHours: body?.windowHours });
    if (!out) throw notFound("no such endpoint");
    await emit(db, { tenantId, topic: "developer.webhook_endpoint.secret_rotated", emittedBy: "developer", subjectType: "webhook_endpoint", subjectId: c.req.param("id"), actor: userActor(principal?.appUserId ?? null), payload: { fingerprint: out.fingerprint } });
    return { secret, fingerprint: out.fingerprint, previousValidUntil: out.previousValidUntil, shown_once: true };
  }, { status: 200, bucket: "write" }));
  app.post("/api/developer/webhook-deliveries/replay", session(WEBHOOKS_ROW, "admin",
    async ({ body, tenantId, principal }) => {
      const deliveryId = String(body?.deliveryId ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(deliveryId)) throw invalid("deliveryId is required", { field: "deliveryId" });
      const out = await replayDelivery({ tenantId, deliveryId, actorUserId: principal?.appUserId ?? null });
      if (out.outcome === "refused") throw invalid(`Replay refused: ${out.reason}`, { field: "deliveryId" });
      return { outcome: out.outcome, status: out.status ?? null, attempt: out.attempt ?? null, deliveryId: out.deliveryId ?? null, error: out.error ?? null, reason: out.reason ?? null };
    }, { status: 201, bucket: "write" }));

  app.post("/api/developer/api-keys/:id/revoke", session(KEYS_ROW, "admin", async ({ db, c, principal, tenantId }) => {
    const id = c.req.param("id");
    const revoked = await revokeApiToken(db, { id, revokedBy: principal?.appUserId ?? null });
    // ★ `null` means "no row matched" — already revoked, or not this tenant's. Both are reported the
    //   same way on purpose: a caller must not be able to tell "not yours" from "already done".
    // ★★ THE EVENT FIRES ONLY WHEN A ROW ACTUALLY CHANGED. `revokeApiToken` is idempotent by
    //    predicate (`revoked_at IS NULL`), so a replay matches nothing — and emitting on a no-op
    //    would put a revocation in the audit log that never happened.
    if (revoked !== null) {
      await emit(db, {
        tenantId, topic: "developer.api_key.revoked", emittedBy: "developer",
        subjectType: "api_token", subjectId: id,
        // ★ STAGE 3 TASK 1 — same fact as `revokedBy` above, now also on the envelope.
        actor: userActor(principal?.appUserId ?? null),
        payload: {},
      });
    }
    return { revoked: revoked !== null };
  }, { bucket: "write" }));

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ 7.25 — TOGGLES CHANGE WITHOUT THE SECRET CHANGING. `POST /api/developer/api-keys/:id/scopes`
  //     edits an existing key's capability toggles by the same authority that could have minted it,
  //     and never touches `secret_hash` — a live integration keeps working when a capability is
  //     removed. Same `session(...)` wrapper as mint and revoke, so P0.4's fix covers this route too.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  app.post("/api/developer/api-keys/:id/scopes", session(KEYS_ROW, "admin",
    async ({ db, c, body, principal, tenantId }) => {
      const id = c.req.param("id");
      const scopes = Array.isArray(body?.scopes) ? body.scopes : [];
      // ★★★ AN ALL-OFF KEY IS UNSTORABLE. `api_token_scopes_nonempty` (0045:78) refuses this at the
      //     table too (0201 keeps the CHECK live) — named here so the caller learns why without a
      //     second round trip. "Turn everything off" is revoke, not edit.
      if (scopes.length === 0) {
        const e = new TokenError(
          "scopes cannot be empty (api_token_scopes_nonempty) — a key with no scopes is unstorable; " +
          "revoke it instead of editing it down to nothing");
        e.statusCode = 400; throw e;
      }
      // ★ VOCABULARY first — the SAME shape as the mint route (:212-217): a typo is a 400, naming it.
      const grantable = await scopesFor(db, tenantId);
      const bad = scopes.filter((s) => !grantable.includes(s));
      if (bad.length) {
        const e = new TokenError(`unknown scope(s): ${bad.join(", ")}. Grantable: ${grantable.join(", ")}`);
        e.statusCode = 400; throw e;
      }
      // ★★★ THEN AUTHORITY — the SAME shape as the mint route (:218-230): a known scope the caller
      //     does not hold is a 403, naming it. An Admin can never edit a key into something they
      //     could not have minted (Q5-10) — `scopesGrantableBy` is 7.22's, unmodified here.
      const grants = await effectiveGrants(db, principal?.appUserId ?? null);
      const held = scopesGrantableBy(principal.user, grants, { tenantIsPlatform: await tenantIsPlatform(db, tenantId) });
      const overreach = scopes.filter((s) => !held.includes(s));
      if (overreach.length) {
        throw forbidden(`refused: cannot grant scope(s) you do not hold: ${overreach.join(", ")}`);
      }
      // ★ THE BEFORE LIST, READ INSIDE THE SAME TRANSACTION AS THE WRITE. `list_api_tokens()` is the
      //   existing read path for this table (0046:98-117) and already returns `scopes` per row — no
      //   new read function is written for this.
      const beforeRow = (await listApiTokens(db)).find((r) => r.id === id);
      const before = beforeRow ? beforeRow.scopes : [];
      // ★★★ THE TOGGLES CHANGE; THE SECRET DOES NOT (0201's `keystone.set_api_token_scopes`). It
      //     matches nothing — `RETURNING id` is NULL — when the id is not this tenant's, already
      //     revoked, or already holds this exact list, which is how "changed" is known without a
      //     second read.
      const { rows } = await db.query(`SELECT keystone.set_api_token_scopes($1, $2) AS id`, [id, scopes]);
      const changed = rows[0]?.id != null;
      // ★★ THE EVENT FIRES ONLY WHEN A ROW ACTUALLY CHANGED — same rule as the revoke handler above:
      //    a replay (identical scopes), a revoked key or another tenant's key must not put a
      //    capability change in the audit log that never happened.
      if (changed) {
        await emit(db, {
          tenantId, topic: "developer.api_key.scopes_changed", emittedBy: "developer",
          subjectType: "api_token", subjectId: id,
          actor: userActor(principal?.appUserId ?? null),
          // ★★★ NEVER the secret, the secret_hash or the key's name (Stage 3 task 3) — only the two
          //   scope lists that changed.
          payload: { before, after: scopes },
        });
      }
      return { changed, scopes };
    }, { bucket: "write" }));

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // THE AUDIT LOG — session auth. P19.9's read surface.
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // R13-D084: ?from=YYYY-MM-DD&to=YYYY-MM-DD (both days included, on the reader's clock: ?tz=Europe/London; UTC when none) narrows the log to a date range; anything else is refused plainly.
  const auditDay = (cc, v, name) => { if (v == null || v === "") return null; if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw invalid(`${name} must be a date like 2026-10-23`, { field: name }); return dayStartInZone(v, zoneOk(cc.req.query("tz"))); };
  app.get("/api/developer/audit-log", session(AUDIT_ROW, "admin", async ({ db, c }) => ({
    events: await listAuditEvents(db, { limit: Number(c.req.query("limit") ?? 100), since: auditDay(c, c.req.query("from"), "from"), until: ((d) => d && new Date(d.getTime() + 86400000))(auditDay(c, c.req.query("to"), "to")) }),
    summary: await auditSummary(db),
  })));

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // ★★★ THE TOKEN-AUTHENTICATED API. `/api/v1/*` — BEARER ONLY.
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // ★★ IT GOES THROUGH `handleApiTokenRequest`, WHICH IS ITS OWN FUNCTION — not handleBrowserRequest
  //    with a different lookup. Twenty's measured defect was that the token path skipped the
  //    predicate the session path applied; two functions and two gates is the structural answer.
  // ★★★ 5.10 — ONE ANSWER FOR EVERY CREDENTIAL FAILURE, INCLUDING A MISSING OR MALFORMED HEADER. This used
  //     to say "this endpoint requires an API token in the Authorization header" — a different sentence from
  //     "the API token is not valid", so "you sent nothing" was distinguishable from "you sent a wrong key".
  //     Every 401 on `/api/v1/*` now has the same status, the same kind, the same message, and differs only
  //     by `requestId`. The bodies come from CT-001's envelope: the error is THROWN and the app's error sink
  //     serialises it (the flat `{ error: "<string>" }` bodies this file used to build by hand are gone).
  // FP-C2 — the API-call log. tokenRoute notes WHICH key on the context once it has resolved; this runs after the answer and records the final status. A call that never authenticated has no workspace and is not logged.
  // Run 12 (the 77-operation check): a call with no Bearer header at all is refused with the one plain 401 BEFORE any route validates its path or body (13 routes answered 400 with the schema's complaints to a caller who had not authenticated).
  app.use("/api/v1/*", apiKeyFirst);   // R13-D191: the key before the body (src/http/apiKeyFirst.mjs)
  // Run 12 (Schemathesis): a method the PUBLISHED spec does not list for a path is 405 with Allow, even when a parameter route ("/documents/{id}") would otherwise have caught the literal path ("/documents/check") and answered 400.
  { const specMethods = specMethodIndex(app);
    app.use("/api/v1/*", async (c, next) => {
      if (c.req.path === "/api/v1/openapi.json" || c.req.path === "/api/v1/docs") return next();
      const allowed = await specMethods(c.req.path); const m = c.req.method === "HEAD" ? "GET" : c.req.method;
      if (allowed && !allowed.includes(m) && m !== "OPTIONS") { const { body } = invalid(`${c.req.method} is not supported here; use ${allowed.join(", ")}`).toResponse(); c.header("Allow", allowHeader(allowed)); return c.json({ ...body, error: { ...body.error, kind: "method_not_allowed", requestId: c.get("requestId") } }, 405); }
      await next();
    }); }
  app.use("/api/v1/*", idnBodyMiddleware);   // B-2: an address on an international domain reaches the schema as punycode
  app.use("/api/v1/*", async (c, next) => {
    const started = Date.now();
    await next();
    c.header("Docustay-Version", API_VERSION);
    const rl = c.get("rateLimit");
    if (rl) { c.header("RateLimit-Limit", String(rl.limit)); c.header("RateLimit-Remaining", String(rl.remaining)); c.header("RateLimit-Reset", String(rl.resetSeconds)); }
    // D-020: a refused call that never reached the key check (validation 400, a key without this route's scope) is still the developer's call: name the key if it is a real one
    const seen = c.get("apiCall") ?? (c.res.status >= 400 ? await recognizeApiToken(c.req.header("authorization")) : null);
    if (seen) void recordApiCall({ ...seen, method: c.req.method, path: c.req.path, status: c.res.status, durationMs: Date.now() - started, requestId: c.get("requestId") ?? null, ip: c.get("clientIp") ?? null, reason: c.get("apiRefusal") ?? null });
  });
  const INVALID_TOKEN_MESSAGE = "the API token is not valid";
  const bearer = (c) => {
    const h = c.req.header("authorization") ?? "";
    const m = /^Bearer\s+(.+)$/i.exec(h);
    if (!m) throw unauthenticated(INVALID_TOKEN_MESSAGE);
    return h;
  };

  // ★★★ 5.10 / CT-016 — THE ROUTE'S SCOPE IS READ FROM `ROUTE_SCOPES` ON EVERY REQUEST, BY THE ROUTE'S OWN
  //     "<METHOD> <path>". No test injects it, and nothing here defaults it: `null` is an explicit "a valid
  //     key, no scope needed" and `undefined` (a path with no entry) is an UNDECIDED route, which THROWS —
  //     a route added without a scope decision must fail closed, not run unscoped.
  const scopeFor = (c, method, path) => {
    const key = `${method} ${path}`;
    if (!Object.prototype.hasOwnProperty.call(ROUTE_SCOPES, key) || ROUTE_SCOPES[key] === undefined) {
      throw new AppError(ErrorKind.INTERNAL,
        `ROUTE_SCOPES has no entry for "${key}" — every /api/v1 route needs an explicit scope decision (a scope, or null)`,
        { requestId: c.get("requestId") });
    }
    return ROUTE_SCOPES[key];
  };

  // ★★ THE ONE PLACE A TOKEN-AUTHENTICATED ROUTE RUNS. Bearer check, scope lookup, `handleApiTokenRequest`
  //    (its own function, its own gate — see the note above), and the translation of every credential
  //    failure into the single 401 above. A key that lacks the route's scope is the SAME 401 as an unknown,
  //    revoked, expired or test-on-a-real-practice key — deliberately not a 403, so the endpoint is not an
  //    oracle for which scopes a key holds.
  const tokenRoute = async (c, method, path, fn) => {
    const authorization = bearer(c);
    const scope = scopeFor(c, method, path);
    try {
      const attempt = (needs) => handleApiTokenRequest({ authorization, scope: needs }, async (db, rate) => {
        if (rate) c.set("rateLimit", rate);
        const { rows: [who] } = await db.query(`SELECT keystone.current_tenant_id() AS t, nullif(current_setting('keystone.actor_api_key', true), '') AS k`);
        c.set("apiCall", { tenantId: who.t, tokenId: who.k });
        await guardKeyUse(db, { tenantId: who.t, tokenId: who.k, ip: c.get("clientIp") ?? null, agent: c.req.header("user-agent") ?? null }, () => { c.set("apiRefusal", "address_not_allowed"); return unauthenticated(INVALID_TOKEN_MESSAGE); });   // R2-8: the caller sees the one plain 401; the workspace's own log row carries the reason. FP-F4/F3/F2: address allowlist, last used, expiry warning
        return fn(db);
      });
      // FP-F1 — a narrower scope is an alternative way in: tried only when the key does not hold the route's own
      const narrow = scope ? NARROW_ROUTE_SCOPES[`${method} ${path}`] : undefined;
      if (!narrow) return await attempt(scope);
      try { return await attempt(scope); } catch (e) { if (e?.name === "NoTenantContext" || e instanceof TokenError) return await attempt(narrow); throw e; }
    } catch (e) {
      if (e?.name === "NoTenantContext" || e instanceof TokenError) throw unauthenticated(INVALID_TOKEN_MESSAGE);
      // ★ The server-side cause stays specific in the log; 5.1's envelope replaces a 5xx message with the
      //   generic sentence on the wire.
      if (e instanceof TokenConfigError) {
        throw new AppError(ErrorKind.INTERNAL, "developer API is not configured",
          { requestId: c.get("requestId"), cause: e });
      }
      throw e;
    }
  };

  // ★ CT-011 request bounds — `?limit=<1..200>`, default 50, anything else a 400 naming `limit`. `parseListLimit`
  //   in src/routes/index.mjs is module-private, and that file is not this task's, so the same three numbers
  //   are restated here; the CURSOR is not restated — `encodeCursor`/`decodeCursor` are imported (below).
  const PEOPLE_DEFAULT_LIMIT = 50;
  const PEOPLE_MAX_LIMIT = 200;
  const parsePeopleLimit = (raw) => {
    if (raw === undefined) return PEOPLE_DEFAULT_LIMIT;
    const n = /^[0-9]{1,6}$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > PEOPLE_MAX_LIMIT) {
      const message = `limit must be a whole number from 1 to ${PEOPLE_MAX_LIMIT}`;
      throw new AppError(ErrorKind.VALIDATION, message, { fields: { limit: message } });
    }
    return n;
  };

  // ★★ ONE ANSWER FOR EVERY CREDENTIAL FAILURE — enforced in `tokenRoute` above. "no such token", "revoked",
  //    "expired", "wrong class", "missing scope" and "test key on a real practice" must not be
  //    distinguishable from outside, or the endpoint is an oracle.
  app.get("/api/v1/people", async (c) => {
    const { people, page } = await tokenRoute(c, "GET", "/api/v1/people", async (db) => {
      // ★ Validated INSIDE the token scope, so a caller with no valid key learns nothing about the
      //   parameters — the 401 comes first. `decodeCursor` is 5.4's, imported: one encoder.
      const limit = parsePeopleLimit(c.req.query("limit"));
      const cursorRaw = c.req.query("cursor");
      const offset = cursorRaw === undefined ? 0 : decodeCursor(cursorRaw);
      const r = await db.query(
        // ★ No tenant predicate. Scoping is RLS — the same policy the browser path obeys, which is
        //   the whole point of routing both through withTenant().
        // ★ `id` breaks ties in `display_name`, so the order is total and two pages can neither overlap
        //   nor skip a row that shares a name with its neighbour.
        // ★ `$1 = limit + 1` — the extra row is how `hasMore` is known without a second query; it is
        //   dropped before serialising.
        `SELECT id, display_name, role FROM keystone.app_user ORDER BY display_name, id LIMIT $1 OFFSET $2`,
        [limit + 1, offset]);
      const hasMore = r.rows.length > limit;
      return {
        people: r.rows.slice(0, limit),
        page: { limit, nextCursor: hasMore ? encodeCursor(offset + limit) : null, hasMore },
      };
    });
    return c.json({ people, page });
  });

  /** ★ A tiny whoami, so an integrator can check a key without reading anybody's data. */
  app.get("/api/v1/whoami", async (c) => {
    const out = await tokenRoute(c, "GET", "/api/v1/whoami", async (db) => {
      const r = await db.query(`SELECT keystone.current_tenant_id() AS tenant_id`);
      return r.rows[0];
    });
    return c.json({ tenant_id: out.tenant_id, authenticated: true });
  });

  // ★ §23.5.8 — the Documents REST API (OpenAPI + Scalar), on the same key check and the same scope map
  registerDocumentsV1(app, { tokenRoute });
}

// ★★★ 5.10 — THE IMPORTS THIS BAND NEEDS, DECLARED HERE AND NOT WITH THE ONES AT THE TOP. The task's assigned
//     part of this file is `bearer` to the end, and the import block belongs to nobody's band while 5.11 edits
//     the middle of the file at the same time. ES imports are hoisted, so these bindings are live inside
//     `registerDeveloperRoutes` above exactly as if they sat at line 22; hoist them into the top block at
//     the next moment the file has a single editor.
import { AppError, ErrorKind } from "../http/errors.mjs";
import { registerDocumentsV1 } from "./developerDocuments.mjs";
import { idnBodyMiddleware } from "../http/idnBody.mjs";
import { recordApiCall } from "../developer/callLog.mjs";
import { guardKeyUse, cleanAllowlist } from "../developer/keyGuard.mjs";
import { ROUTE_SCOPES, NARROW_ROUTE_SCOPES } from "../developer/scopes.mjs";
import { encodeCursor, decodeCursor } from "./index.mjs";
import { saveKeyPolicy, policiesByKey } from "../documents/frontDoor.mjs";   // FP-G1
import { API_VERSION } from "../developer/openapiPolish.mjs";   // FP-F8 — the date-stamped version every /api/v1 answer reports (Docustay-Version)
import { dayStartInZone, zoneOk } from "../audit/dayInZone.mjs";   // R13-D468

