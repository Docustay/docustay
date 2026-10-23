// ═══════════════════════════════════════════════════════════════════════════════════════════════
// P6.B12 — THE SETTINGS ROUTES. SIX FORM-SHAPED ROWS, AND **THE WRITE TAP THAT DID NOT EXIST**.
//
// ★★★ THE FINDING THIS FILE CLOSES, MEASURED FIRST. [MEASURED 2026-09-15] `setSetting`
//     (`src/settings/writes.mjs:29`) had **ZERO callers in `src/`** — its only call sites in the
//     whole repository were gates. There was no `POST /api/settings` in `WRITE_ROUTES` and none in
//     `src/routes/index.mjs`. So the store, the closed key catalogue, the ten validators, the
//     `SettingViolation` refusals and the RLS zero-rows check were all built and PROVEN, and
//     **not one of the ten tenant settings could be set from the product.** `F5`'s shape exactly:
//     a queue with no producer passes every check and moves nothing.
//
// ★★ WHY THE READS LIVE HERE AND NOT AS `LIST_VIEWS` DESCRIPTORS. Five settings rows ARE lists
//    (`src/records/lists/settings.mjs`). These six are FORMS: one shaped object with named fields,
//    a current value per field and a vocabulary to choose from. A list descriptor is one SQL
//    string and a column list; it cannot carry "here are the four tiers" or "this value is not
//    set and the fallback is 30 days".
//
// ★★★ THE SERVER DESCRIBES THE FORM — LABEL, HELP, TYPE AND OPTIONS — AND THE SCREEN RENDERS IT.
//     U16: "the server decides on every request." A field list in the browser would be a second
//     declaration of the settings catalogue, and the browser's copy is the one that drifts. So
//     every GET below returns `{ path, title, intro, fields[], writable, notice }` and
//     `web/src/screens/settings/SettingsForm.jsx` holds no key, no label and no option list.
//
// ★ `writable` IS ANSWERED BY THE SERVER TOO, and it is not decoration: a screen that drew a Save
//   button over a route that does not exist is the dead control this whole phase is about.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { createHash } from "node:crypto";
import { forbidden, invalid, dependency, conflict, notFound } from "../http/errors.mjs";
import { objectKey, putObject, getObject } from "../storage/s3.mjs";
import { validateSubdomain } from "../provisioning/subdomain.mjs";
import { APP_DOMAIN_VAR } from "../auth/tenantFromHost.mjs";
import { withCredentialLookup } from "../db/index.mjs";
import { authoriseSection, atLeastRank } from "../nav/authorise.mjs";
// ★★★ 7.12a / F595, RULED 21 Sep 2026 — RE-POINTED FROM `./writes.mjs`'s NOW-DELETED `assertRank`.
//     Three of this file's four former `assertRank` call sites were converted (by 7.12b) to
//     `assertMay(db, principal, { object: "setting", action: "edit" })` — the same object/action 7.1
//     declares for every OTHER settings-shaped write in `WRITE_ROUTES` (`/api/documents/categories`,
//     `/api/notifications`, …). The FOURTH — the `guarded()` wrapper below, shared by every route this
//     file registers — KEEPS a rank floor, because MEASURED it is load-bearing at exactly one site
//     (`read("/tasks/automations", …)` is admin-only SOLELY because of it) and no permission pair
//     exists that could carry it (`/settings/sign-in` shares the same wrapper with a Coach `setting`
//     grant seeded `none`/`none`). That floor now lives in `src/nav/authorise.mjs` as
//     `atLeastRank(user, minRole)` over the one surviving `RANK` ladder — imported here in its place.
import { assertMay } from "../permissions/assertMay.mjs";
import { ROLE_WORDS } from "../permissions/docustayRoleTable.mjs";
import { getSetting, getSettings, setSetting } from "../settings/writes.mjs";
import { SETTING_KEYS, SettingViolation, REACH_KEYS, LOCKED_KEYS } from "../settings/keys.mjs";
// ★★★ Task 11.23 (CT-F44) — the consequence engine `POST /api/settings` calls before any write.
import { assertReachConfirmed, announceChange, computeReach } from "../settings/reach.mjs";
// ★ F20.8 — push branding to connected Stripe account
import { pushBrandingToStripe } from "../money/connect.mjs";
import { metadataFor } from "../money/metadata.mjs";
import { TERM_KEYS, TERM_FALLBACKS } from "../terminology/keys.mjs";
import { SURFACES } from "../app/surfaces.mjs";
import { SHAPES, SHAPE_INFO } from "../nav/groups.mjs";
import { OBJECTS, VERBS, SCOPES, OWNERLESS_OBJECTS } from "../permissions/objects.mjs";
import { setRolePermission, setRoleAction, resetRoleToPreset, createCustomRole, renameCustomRole, deleteCustomRole, setMemberPermission, setMemberAction, resetMemberPermissions, propagateToPersonalRoles } from "../permissions/writes.mjs";
import { NAMED_ACTIONS } from "../permissions/assertMay.mjs";
import { effectiveRank } from "../nav/authorise.mjs";
// ★ `PermissionViolation` is defined in objects.mjs, not re-exported by writes.mjs — MEASURED by
//   printing that module's exports rather than assuming the import site implied the export site.
import { PermissionViolation } from "../permissions/objects.mjs";
// ★★★ 9.11 — the create path. `createSandboxTenant`/`copyConfigurationIntoSandbox` and their three
//     frozen return shapes are UNCHANGED by this task (field 5); this route only gains a caller.
import { sandboxInfo, createSandboxTenant, copyConfigurationIntoSandbox, SandboxRefused } from "../sandbox/writes.mjs";
// ★★★ 9.11 — THE SAME HELPER `platform.mjs` USES to decide "is this request a real platform
//     operator, not merely a request running inside the platform tenant's own context" (F594 / CCR
//     re-pointed at `src/db/index.mjs`, see that file's header). Reused here rather than duplicated.
import { callerIsPlatform } from "../db/index.mjs";
// ★★★ 9.11 — CT-043's ONE WRITER of `keystone.audit_entry`. The sandbox-create route uses the
//     frozen `operator.acted_as` action (see the route's own comment) — no other action in the 25
//     fits, and none is added by this task.
import { writeAudit } from "../permissions/audit.mjs";
// ★★★ A11.2 / F428 — the automations page had NO read route at all: `AutomationsPage.svelte` took
//     `settings` and `platform` as props from a caller that did not exist, and `n8n.mjs` had zero
//     importers anywhere in the repo. This import is the first one it has ever had.
import { AUTOMATIONS, automationSettingKey } from "../automations/catalogue.mjs";
import { workflowStates, N8nUnavailable } from "../automations/n8n.mjs";
import { setSenderRouting, SenderViolation, listEmailTemplates, getSampleVars } from "../email/writes.mjs";
import { renderTemplate } from "../email/templates.mjs";
// ★★★ Task 16.58 (CT-F43) — the ONE read behind the incident page, the hub chip and the Home
//     prompt, so the three surfaces cannot disagree about whether a practice's email is broken.
import { getEmailDomainHealth } from "../growth/emailDomainHealth.mjs";
// ★★★ Task 6.6 (spec 06 §2.8, §10 item 4) — the mailbox OAuth round trip. `googleClientCredentials`
//     is the SAME per-tenant Google client calendar connect already reads (§6: "reused, not new"),
//     imported from where it already lives rather than duplicated.
import { googleClientCredentials } from "../booking/calendarConnect.mjs";
import {
  signMailboxOAuthState, verifyMailboxOAuthState, buildMailboxAuthorizeUrl,
  exchangeMailboxCode, connectMailbox, disconnectMailbox,
} from "../email/mailboxConnect.mjs";
// ★★★ B1.2 — Stripe Connect via Account Links: a practice connects their own Stripe account.
import {
  createConnectAccount, createAccountLink, fetchConnectAccountStatus,
  connectAccount, disconnectAccount, getConnectAccountState,
} from "../money/connect.mjs";
// ★★★ 6.12 — the sign-in and devices routes. `db`-first signatures (6.6); the tenant is covered by
//     the SQL guard inside each of these, the person by `principal.appUserId` at the call site.
import { listSessionsForUser, revokeSessionById, revokeSessionsForUser } from "../auth/session.mjs";
// ★★★ STAGE 4 TASK 4 — F505. A practice's own slug change is a fact about ITS `settings` — see
//     the `settings.setting.changed` emit below, at the slug UPDATE. Same import shape as
//     `routes/developer.mjs` (`emit(db, {…})` called directly from a route, not through a
//     writes.mjs function, because a slug lives on `keystone.tenant`, not `keystone.tenant_setting`).
import { emit, userActor } from "../events/outbox.mjs";
// ★★★ Task 6.5 (spec 06 §2.7, §9) — the A11 billing/plans rebuild. Reads through `billing/
//     workbench.mjs` (never a raw query here — same "a writer writes, a route translates" rule the
//     file header already states); prices through `billing/plans.mjs` (code, not a table, per
//     migration 0334's own comment); `stripe_enabled` and the platform credential are the SAME two
//     locks `src/provisioning/steps/stripeCustomer.mjs` already uses, reused rather than duplicated.
import { getSubscription, getSeatStatus, getUsage } from "../billing/workbench.mjs";
import { OVERAGE_MINOR } from "../billing/usage.mjs";
import { PLANS, planByKey } from "../billing/plans.mjs";
// ★★★ Task 6.4 (spec 06 §2.5, §2.6) — SetImport + SetData export. Domain writers, same "a writer
//     writes, a route translates" rule as the billing import two lines above — see each module's own
//     header for why no background job / no multipart upload is used.
import {
  IMPORT_FIELD_OPTIONS, MAX_IMPORT_ROWS, csvToRecords, setImportMapping, checkImportRun,
  runImportRun, importRunStatus, undoImportRun,
} from "../settings/importCsv.mjs";
// ★★★ Task 12.16 — the source step's own list, rendered on GET /api/settings/import.
import { IMPORT_SOURCES } from "../people/importPresets.mjs";
import { requestDataExport, listDataExports, loadDataExportFile } from "../settings/dataExport.mjs";
// ★ P3.S13 — invoice PDF layouts: list (Stripe, live), archive/unarchive (hide/show in the picker).
import { listInvoiceLayouts, archiveInvoiceLayout, unarchiveInvoiceLayout } from "../settings/invoiceLayouts.mjs";
// ★ P3.S14 — ways to pay: which Stripe payment method types show on this practice's pay pages.
import { paymentMethodSettings, setPaymentMethodSettings } from "../settings/paymentMethods.mjs";
// ★ P3.S15 — wallet domains status: which domains are registered for Apple Pay/Google Pay.
import { walletDomains } from "../settings/paymentMethods.mjs";
import { requiredFor, unchangeableFor, missingCounts, REQUIRED_FIELD_REASONS } from "../records/fieldRules.mjs";
import { listAuditEvents } from "../audit/queries.mjs";
import { computePrompts } from "../prompts/engine.mjs";
import { usageForPeriod, ALLOWANCES } from "../billing/usage.mjs";
import { flagIsOn } from "../platform/flags.mjs";
import { callOutside } from "../http/outside.mjs";
import { createStripeCustomer } from "../provisioning/steps/stripeCustomer.mjs";
import { SECRET_KEY_VAR } from "../money/charge.mjs";
// ★★★ Task 6.2 — SettingsHome derives its card list from the SAME rows the sidebar renders, so the
//     two can never disagree about which settings pages exist (§2.1's own stated reason). This is
//     the ONE nav import a settings ROUTE file makes; every other file in this codebase that needs
//     "which settings pages exist" reads it from here rather than growing a second list.
import { SETTINGS_CHILDREN } from "../nav/sections.mjs";
import { TZDate } from "@date-fns/tz";
import { addMonths, format } from "date-fns";
import { found, publicOrigin } from "../http/redirect.mjs";

/**
 * ★★ WHICH NAV ROW GOVERNS WHICH KEY. Authorisation is per-ROW, not per-file, because a row is the
 *    unit `authoriseSection` rules on — and if a future ruling opens one settings row to a coach,
 *    a file-wide check would open all twelve.
 * ★ Unlisted prefixes fall back to `/settings`, which is `minRole: 'admin'` — the STRICTEST
 *   available answer, never the most permissive. Fail closed.
 */
const SECTION_FOR_PREFIX = Object.freeze({
  // ★★ `automations.*` FELL THROUGH TO `/settings`. The fallback is fail-closed and so the write
  //    WORKED — which is why nothing caught it: an `automations.<key>.enabled` write was authorised
  //    against the Settings section rather than against the row that owns it. Correct now that the
  //    row has a screen (A11.2 / F428).
  automations: "/tasks/automations",
  practice: "/settings/practice",
  branding: "/settings/branding",
  money: "/settings/money",
  terminology: "/settings/terminology",
  client_app: "/settings/client-app",
  billing: "/settings/billing",
  booking: "/engagements/booking/settings",
  fields: "/settings/practice",
});
const sectionForKey = (key) => SECTION_FOR_PREFIX[String(key).split(".")[0]] ?? "/settings";

/** ★ One field descriptor. `value` is `null` when unset — never a silently substituted default. */
// ★ TY, 2026-09-16 — a stored logo setting → the URL the browser loads it from.
//   `ks-object:` pointers are served by our own routes; a legacy https URL passes through.
const LOGO_POINTER = /^ks-object:(t\/[0-9a-f-]{36}\/brand_logo\/([A-Za-z0-9._-]{1,128}))$/i;
function logoSrc(kind, value) {
  if (typeof value !== "string" || value === "") return null;
  const m = LOGO_POINTER.exec(value);
  if (m) return `/api/settings/branding/logo/${kind}?v=${encodeURIComponent(m[2])}`;
  return /^https:\/\//.test(value) ? value : null;
}
// ★ TY, 2026-09-16 — the domain comes from the deployment's own config, never hardcoded.
const appDomain = () => process.env[APP_DOMAIN_VAR] || "example.com";

/** Is `raw` usable as THIS practice's acronym? { available, slug, reason } */
async function slugAvailability(raw, currentSlug) {
  const v = validateSubdomain(String(raw ?? "").trim().toLowerCase());
  if (!v.ok) return { available: false, slug: v.slug, reason: v.failures.map((f) => f.explain).join("; ") };
  if (currentSlug && v.slug === String(currentSlug).toLowerCase()) return { available: true, slug: v.slug, current: true };
  // ★ Other practices are invisible under RLS, so ask the pre-auth resolver — the same lookup the
  //   sign-in page uses. A suspended practice's name is still caught by the unique index on save.
  const rows = await withCredentialLookup(async (db) =>
    (await db.query("SELECT 1 FROM keystone.resolve_login_branding_by_slug($1)", [v.slug])).rows);
  if (rows.length) return { available: false, slug: v.slug, reason: "that acronym is already taken" };
  return { available: true, slug: v.slug };
}

const LOGO_KEY = { sidebar: "branding.sidebar_logo", login: "branding.logo_url" };
const LOGO_MAX_BYTES = 700 * 1024;
const sniffImage = (buf) =>
  buf.length > 12 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 ? { ext: "png", type: "image/png" }
  : buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff ? { ext: "jpg", type: "image/jpeg" }
  : buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP" ? { ext: "webp", type: "image/webp" }
  : null;

const field = (key, label, value, help, extra = {}) =>
  Object.freeze({ key, label, value: value ?? null, help, type: "text", ...extra });

// ═══════════════════════════════════════════════════════════════════════════════════════════
// ★★★ Task 6.2 / 06-settings.md §2.9, §3 — CT-105. THE ONE READ EVERY "Last changed by {name} on
//     {date}" LINE USES, INCLUDING SETTINGS HOME'S TENANT-WIDE ONE.
// ★★ `keystone.audit_entry`, NEVER the outbox `event` table `listAuditEvents` reads
//    (`src/audit/queries.mjs`) — two different mechanisms (§1): an event is a fact about the
//    DOMAIN, an audit_entry is a fact about WHO CHANGED A SETTING. Reading the wrong one would be
//    exactly the "two disagreeing tables" defect this file's own nav import above just avoided.
// ★ No `tenant_id = $1` predicate, on purpose — `keystone.audit_entry` is FORCE ROW LEVEL SECURITY
//   like every other tenant table here, and a predicate here would only invite a future reader to
//   trust it instead of the policy (same discipline `listAuditEvents` states for the same reason).
//   `tenantId` is accepted for call-site symmetry with every other reader in this file, not used
//   in the query itself.
// ★★★ `object: null` READS TENANT-WIDE, ACROSS EVERY `settings.changed` ROW — SettingsHome's own
//     case (§2.1: "the most recent keystone.audit_entry row across every settings.changed action
//     for the tenant"). A specific object string (e.g. `'billing.plan'`) narrows to one screen's
//     own line, the case every other settings screen (§2.2–§2.8) will use once it emits one.
// ★ Task 17.5 — accepts a string OR an array OR null. A STRING CALLER MUST KEEP WORKING.
//   `$1::text[]` casts whatever the driver sends; a bare string reaches Postgres as text and is
//   parsed as an ARRAY LITERAL → 22P02 malformed array literal. The two string call sites
//   (settings.mjs:808 billing, routes/index.mjs:1688 notifications) are not edited by this task,
//   so the array shape is built HERE or those two routes 500.
// ═══════════════════════════════════════════════════════════════════════════════════════════
export async function lastChangedBy(db, tenantId, object = null) {
  // ★★★ A STRING CALLER MUST KEEP WORKING. `$1::text[]` casts whatever the driver sends; a bare
  //     string reaches Postgres as text and is parsed as an ARRAY LITERAL → 22P02. The two
  //     string call sites (settings.mjs billing, index.mjs notifications) are not edited by this
  //     task, so the array shape is built HERE or those two routes 500.
  const objects =
    object === null || object === undefined ? null
    : Array.isArray(object) ? object
    : [String(object)];
  const { rows } = await db.query(
    `SELECT ae.at, ae.object, u.display_name
       FROM keystone.audit_entry ae
       LEFT JOIN keystone.app_user u ON u.id = ae.actor_user_id
      WHERE ae.action = 'settings.changed'
        AND ($1::text[] IS NULL OR ae.object = ANY($1))
      ORDER BY ae.at DESC
      LIMIT 1`,
    [objects]);
  if (!rows.length) return null;
  return { by: rows[0].display_name ?? "an operator", at: rows[0].at, object: rows[0].object };
}

/**
 * ★ Task 17.5 — read the recent settings.changed audit entries with before/after values,
 *   newest first. Used by 17.6 to render the Recently Changed rows in the settings hub.
 *
 * @param {{query: Function}} db a tenant transaction
 * @param {Object} options - { limit: 3 (default) }
 * @returns {Promise<Array>} [{object, by, at, before, after}] newest first
 */
export async function recentChanges(db, { limit = 3 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 3, 1), 500);
  const { rows } = await db.query(
    `SELECT ae.at, ae.object, ae.before, ae.after, u.display_name
       FROM keystone.audit_entry ae
       LEFT JOIN keystone.app_user u ON u.id = ae.actor_user_id
      WHERE ae.action = 'settings.changed'
      ORDER BY ae.at DESC
      LIMIT $1`,
    [lim]);
  return rows.map((r) => ({
    object: r.object,
    by: r.display_name ?? "an operator",
    at: r.at,
    before: r.before,
    after: r.after,
  }));
}

/**
 * ★★★ Task 17.6 — FOUR GROUPS FOR THE SETTINGS HUB, MATCHING THE FRAME. `cardKeys` is the ONLY
 *     place a settings page is named as belonging to a group; the actual card (title, href) always
 *     comes from the matching `SETTINGS_CHILDREN` row, never repeated here, so a label or path change
 *     in the nav can never leave this list stale. A `cardKeys` entry with no matching nav row today
 *     simply renders no card for it, which is correct: this page shows what EXISTS, never a
 *     placeholder for what will.
 */
const SETTINGS_HOME_GROUPS = Object.freeze([
  { key: "practice", title: "Your practice",
    cardKeys: ["set-practice", "set-branding", "set-terminology", "set-programs", "set-team-roles"] },
  { key: "how-it-works", title: "How it works",
    cardKeys: ["booking-settings", "set-money", "set-documents", "set-notifications", "set-fields-required"] },
  { key: "your-data", title: "Your data",
    cardKeys: ["set-import", "set-data-audit", "set-integrations", "set-developer"] },
  { key: "your-plan", title: "Your plan",
    cardKeys: [] },
]);

export function registerSettingsRoutes(app, { runTenantScoped, tenantIsPlatform } = {}) {
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ ONE WRAPPER, SO A THIRTEENTH ROUTE CANNOT FORGET THE CHECK. This is `developer.mjs`'s
  //     `session()` pattern, and it is that pattern because of `F100`: four developer routes
  //     authenticated and never authorised, and any principal in the tenant could mint a live key.
  //     The defect was not a wrong check — it was that writing NO check looked like a finished
  //     route. With the guard in the registrar the DEFAULT for a new settings route is refusal.
  //   ★★ IT ALSO REFUSES A NON-STAFF PRINCIPAL. `routes/index.mjs:82-125` records that a PARENT's
  //      own session reached `/api/settings/documents` on the deployed server and got 200: RLS held
  //      perfectly, and tenant-scoping is exactly what hands a member the practice's administration.
  //      Same tenant never implies same audience.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ THIS WRAPPER KEEPS A RANK FLOOR. F595, RULED 21 Sep 2026 — read before "finishing" it.
  //     It backs EVERY route this file registers, at two `minRank` values: `"admin"` (all but one)
  //     and `"coach"` for `/settings/email` GET and `/settings/sign-in` (GET + both POSTs, 6.12's).
  //
  //   ★★★ WHY IT IS NOT REPLACED BY A PERMISSION PAIR. 7.1's inventory is the 54-row `WRITE_ROUTES`
  //       table in `src/routes/writes.mjs` and NOTHING ELSE; `STAGE-7-PLAN.md:73` and
  //       `db/gates/s7_every_route_declares_a_permission.mjs`'s `NOT_ON_THE_LADDER` both declare
  //       this file's five mutating routes DELIBERATELY out of 7.1/7.12's scope, naming `guarded()`
  //       as their guard. So no `{object, action}` pair exists to carry over. Inventing one for
  //       `/settings/sign-in` would mean a new named action inside `0190`'s frozen 13-word
  //       `role_action_action_check` CHECK plus a re-seed — and a literal
  //       `{ object: "setting", action: "edit" }` here would gate `/settings/sign-in` on a grant
  //       `0190:195` seeds as `none/none` for Coach, locking every Coach out of their OWN device
  //       list (6.12/6.13's screen). A permission the canonical source does not carry is CLAUDE.md
  //       failure #3; refusing a Coach their own devices is a regression, not a tightening.
  //
  //   ★★★ AND WHY IT IS NOT SIMPLY DELETED AS REDUNDANT. EXECUTED 21 Sep 2026, every
  //       `guarded()`/`read()` call site in this file cross-checked against its nav row's resolved
  //       `minRole`: at **15 of 16** the `assertRank` floor is a DUPLICATE of the `authoriseSection`
  //       line above it (equal floor, or lower and therefore never binding — including all three
  //       `/settings/sign-in` routes, where row `minRole: 'coach'` already does the work). At
  //       **exactly one** it is LOAD-BEARING: `read("/tasks/automations", …)` (the automations GET),
  //       whose nav row inherits `minRole: 'staff'` from the Tasks section while `read()` passes
  //       `"admin"`. Dropping the call would admit every Coach to the practice's automations page.
  //       (Positive control in that same sweep: 52 (staff_role, site) admissions evaluated, and a
  //       fabricated `minRole: coach` / `minRank: admin` site is correctly reported load-bearing —
  //       so the sweep can see a binding floor where one exists. Pinned by leg (a2) of
  //       `test/s7_rank_ladder_retired.test.mjs`.)
  //
  //   ★★ SO: the floor stays, and it is a SCREEN floor, not a permission — note that its argument
  //      is a `navPath`, never an object. Q0-7 rules the nav ladder is DEMOTED, NOT DELETED, and
  //      this is exactly the question it keeps answering. 7.12a moves the comparison to
  //      `src/nav/authorise.mjs` as `atLeastRank(user, minRole)` on the one surviving `RANK`, and
  //      re-points this line — see the import comment and 7.12a field 2.
  const guarded = (navPath, minRank, fn, { status = 200, ...opts } = {}) => (c) =>
    runTenantScoped(c, async (ctx) => {
      if (!ctx.principal?.platformTenantId && ctx.principal?.user?.role !== "staff") {
        throw forbidden(
          "settings are for staff. Your account is a client of this practice — this is a refusal, " +
          "not an empty form.");
      }
      const isPlatform = await tenantIsPlatform(ctx.db, ctx.tenantId);
      const decision = authoriseSection(ctx.principal.user, navPath, { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
      atLeastRank(ctx.principal.user, minRank);
      return fn(ctx);
    }, opts).then((r) => c.json(r, status));

  const read = (navPath, fn) => guarded(navPath, "admin", fn, { bucket: "settings" });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Task 17.6 — /settings (SettingsHome). ★★★ THE CARD LIST IS NEVER A SECOND DECLARATION. It is
  // `SETTINGS_HOME_GROUPS`' `cardKeys` resolved AGAINST `SETTINGS_CHILDREN` (imported above), so a
  // card's title/href always match the sidebar's own row — a `cardKeys` entry naming a row that does
  // not exist yet simply renders no card, never a fabricated placeholder (§4: "this page shows what
  // EXISTS"). ★★ The "Your plan" group has no cards; instead the hub includes a plan block with
  // subscription data and the metric with highest usage ratio. The Recently changed block shows the
  // three most recent settings changes with before/after values when present. ★ A `status` CHIP IS
  // DRAWN ONLY WHERE A REAL SIGNAL EXISTS — three cards: Email (broken = domain issues), Integrations
  // (attention = nothing connected), and the status is now named "set-integrations" not "set-billing"
  // per §4's card list. Every other card's `status` is `null` — no chip drawn rather than guessed.
  app.get("/api/settings", read("/settings", async ({ db, tenantId }) => {
    const [{ rows: googleRows }, { rows: emailBrokenRows }, domainHealth, fullSub, usage, recentChanges_] = await Promise.all([
      db.query(
        `SELECT 1 FROM keystone.google_identity WHERE tenant_id = $1 AND grant_state <> 'withdrawn' LIMIT 1`,
        [tenantId]),
      db.query(
        `SELECT 1
           FROM keystone.sender_routing sr
           JOIN keystone.sender_identity si ON si.id = sr.sender_identity_id
           JOIN keystone.google_identity gi ON gi.id = si.google_identity_id
          WHERE sr.tenant_id = $1 AND gi.grant_state IN ('reconsent_required', 'withdrawn')
          LIMIT 1`,
        [tenantId]),
      getEmailDomainHealth(db, tenantId),
      getSubscription(db, tenantId),
      usageForPeriod(db, tenantId),
      recentChanges(db, { limit: 3 }),
    ]);
    const hasLiveGoogle = googleRows.length > 0;
    const emailBroken = emailBrokenRows.length > 0;

    const statusFor = (key) => {
      if (key === "set-email") return (emailBroken || domainHealth.state === 'broken') ? "broken" : (domainHealth.state === 'unknown' ? null : "ok");
      if (key === "set-integrations") {
        return (!hasLiveGoogle && !fullSub?.stripe_customer_id) ? "attention" : null;
      }
      return null;
    };

    const childByKey = new Map(SETTINGS_CHILDREN.map((row) => [row.key, row]));
    let attentionCount = 0;
    let totalCards = 0;
    // ★ Groups now have no detail field — row-level detail comes from the form, not the nav
    const groups = SETTINGS_HOME_GROUPS.map(({ key, title, cardKeys }) => {
      const cards = cardKeys
        .map((cardKey) => {
          const child = childByKey.get(cardKey);
          if (!child) return null;
          const status = statusFor(cardKey);
          if (status === "attention" || status === "broken") attentionCount += 1;
          totalCards += 1;
          return { key: cardKey, title: child.label, href: child.path, status };
        })
        .filter(Boolean);
      return { key, title, cards };
    });

    // ★ Build the plan block from subscription and usage data
    let plan = null;
    if (fullSub) {
      const planInfo = planByKey(fullSub.plan_key);
      const formatPrice = (minor) => {
        if (minor == null) return "custom";
        return `$${(minor / 100).toFixed(0)}`;
      };
      const priceSentence = `${formatPrice(planInfo?.monthlyPriceMinor)} a month`;

      // ★★★ R4 (the maintainer, 25 Sep 2026) — THE RENEWAL DATE IS STRIPE'S, NOT OURS. Read the mirror's
      //     `current_period_end` (written only by `src/billing/webhook.mjs` from the verified
      //     subscription event); NEVER compute it from `updated_at` — a computed date drifts on a
      //     trial, a proration, a failed payment or a plan change, and the screen then names a day
      //     the practice will not be charged on. No period on the mirror yet (trialing, no Stripe
      //     subscription) → no date shown. Absence is the honest display, not a guess.
      let renews = null;
      if (fullSub.current_period_end) {
        renews = new Date(fullSub.current_period_end)
          .toLocaleDateString(undefined, { day: "numeric", month: "long" });
      }

      // ★ Find the metric with the highest used/included ratio
      let topMetric = null;
      let topRatio = 0;
      for (const [metric, data] of Object.entries(usage)) {
        if (metric === 'staff') continue;
        const ratio = data.included > 0 ? data.used / data.included : 0;
        if (ratio > topRatio) {
          topRatio = ratio;
          topMetric = metric;
        }
      }

      plan = {
        name: planInfo?.name ?? "Unknown",
        priceSentence,
        renews,
        status: fullSub.status === "active" ? "active" : "inactive",
        staff: {
          used: usage.staff.used,
          included: usage.staff.included,
        },
        usage: topMetric ? {
          metric: topMetric,
          used: usage[topMetric].used,
          included: usage[topMetric].included,
        } : null,
      };
    }

    return {
      groups,
      attentionCount,
      plan,
      recentlyChanged: recentChanges_,
      // ★ Header sentence only shows "Nine things..." when card count is 9-13; otherwise "{n} things."
      headerSentence: totalCards >= 9 && totalCards <= 13
        ? "Nine things. Most practices touch three of them and never come back."
        : `${totalCards} things.`,
      lastChanged: await lastChangedBy(db, tenantId, null),
      // ★★★ CT-F02 (11.6) — the screens' source for the consequence modal (`reachKeys`) and the
      //     locked control (`lockedKeys`), rather than a second hand-written copy on the client.
      registry: { reachKeys: [...REACH_KEYS], lockedKeys: { ...LOCKED_KEYS } },
    };
  }));

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // P6.60 — /settings/practice.  ★ The row `HelpAction` and `AvatarMenu` both link to (`F234` D6).
  // ───────────────────────────────────────────────────────────────────────────────────────────
  // ★★★ TWO NAMES FOR ONE PRACTICE, AND THE SCREEN SAYS WHICH IS WHICH. `keystone.tenant.name` is
  //     set at signup and is what the tenant switcher and every provisioned artefact carry;
  //     `practice.name` is the SETTING. They are different objects and this route returns both
  //     rather than picking one and hiding the disagreement — see the handoff's finding.
  // ★★ `practice.support_phone` IS ALREADY READ BY `/api/help` (`routes/index.mjs:286`), which
  //    reports `configured:false` when it is unset. That route is the only consumer any of these
  //    keys has, and until this file existed nothing could set it — so the Help panel's "how to
  //    reach a human" was permanently unanswerable.
  app.get("/api/settings/practice", read("/settings/practice", async ({ db, tenantId }) => {
    const s = await getSettings(db);
    const { rows } = await db.query(
      `SELECT name, slug, timezone, status FROM keystone.tenant WHERE id = $1`, [tenantId]);
    const t = rows[0] ?? {};
    return {
      path: "/settings/practice", title: "Practice",
      intro: "How this practice describes itself, and how somebody reaches a human.",
      fields: [
        // ★ TY, 2026-09-16 — ONE NAME. The value shown is what the sidebar and the sign-in page
        //   show: the setting if set, otherwise the name given when the account was created.
        field("practice.name", "Practice name", s["practice.name"] ?? t.name ?? null,
          "Shown in the sidebar and on your sign-in page. It starts as the organisation name you gave when you created your account.",
          { confirm: "Change your practice name? It changes in the sidebar and on your sign-in page for everyone straight away." }),
        // ★ TY, 2026-09-16 — THE ACRONYM IS EDITABLE, like the name. It is the subdomain, so it is
        //   checked for availability live and saved through its own route (not a setting).
        field("tenant.slug", "Practice acronym", t.slug ?? null,
          `Your web address: ${t.slug ?? "acronym"}.${appDomain()}. Lowercase letters, numbers and hyphens, at least 3 characters.`,
          { type: "slug", domain: appDomain(),
            confirm: `Change your web address? Everyone, including you, will need to sign in again at the new address, and links to ${t.slug}.${appDomain()} will stop working.` }),
        field("practice.support_phone", "Support phone", s["practice.support_phone"],
          "Shown in the Help panel and required on the mobile forced-update prompt — a non-dismissable prompt with no way to reach a human is a locked door."),
      ],
      readOnly: [
        { label: "Address", value: t.slug ? `${t.slug}.${appDomain()}` : null },
        { label: "Timezone", value: t.timezone ?? null },
        { label: "Status", value: t.status ?? null },
      ],
      writable: true, notice: null,
      lastChanged: await lastChangedBy(db, tenantId, ["practice.name","practice.support_phone","practice.slug","practice.shape"]),
    };
  }));

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // P6.61 — /settings/branding
  // ───────────────────────────────────────────────────────────────────────────────────────────
  // ★★★ THE COLOUR RETINTS THE PRODUCT AND THE LOGO DOES NOT YET REACH THE LOGIN PANEL, AND BOTH
  //     FACTS ARE STATED. `applyTenantBrand()` (`web/src/brand.mjs`) had ZERO production callers —
  //     only gates — so a stored colour changed nothing anywhere. The branding screen is its first
  //     one. ★★ The LOGIN PANEL is a different problem and is NOT quietly claimed: it renders
  //     before any session exists, so it cannot read this authenticated route. `notice` says so in
  //     words. KS-5.6 — never substitute Keystone's mark for a tenant's — which means the panel
  //     falls back to the tenant's NAME, not to our logo, and it already does.
  // ★ `upload` IS ABSENT ON PURPOSE. Object storage for tenant assets is P18.3; a file input with
  //   nowhere to put the bytes is a control that cannot act.
  app.get("/api/settings/branding", read("/settings/branding", async ({ db, tenantId }) => {
    const s = await getSettings(db);
    const { rows: tenantRows } = await db.query(
      `SELECT name FROM keystone.tenant WHERE id = $1`,
      [tenantId]);
    const practiceName = tenantRows[0]?.name ?? "Your practice";

    return {
      path: "/settings/branding", title: "Branding",
      intro: "What clients see. Your logo turns up in eleven places — we'll show you each one.",
      fields: [],
      // ★ TY, 2026-09-16 — TWO UPLOADED LOGOS, each with the size to use (Square's pattern).
      logos: [
        { kind: "sidebar", label: "Sidebar logo",
          recommended: "A square image, 512 × 512 px. Shown small, next to your practice name in the sidebar.",
          box: { w: 512, h: 512 }, src: logoSrc("sidebar", s["branding.sidebar_logo"]) },
        { kind: "login", label: "Sign-in page logo",
          recommended: "A wide image, 1200 × 400 px (3:1). Shown larger, at the top of your sign-in page.",
          box: { w: 1200, h: 400 }, src: logoSrc("login", s["branding.logo_url"]) },
      ],
      // ★ TASK 17.10 — WHERE THE LOGO TURNS UP. Each row that points to a screen that exists is
      //   included with an href; others with no matching internal route have href:null and render
      //   as plain text (no "See it" link). Rows whose destination does not exist are omitted.
      whereItTurnsUp: [
        { key: "invoices", label: "Invoices and estimates",
          detail: "Top left, above the amount", href: "/money/invoices" },
        { key: "portal", label: "The client portal",
          detail: "Header, and the sign-in page", href: null },
        { key: "emails", label: "Emails you send",
          detail: "Above the message", href: null },
        { key: "booking", label: "Your booking page",
          detail: "Header and the browser tab", href: null },
        { key: "readers", label: "Card readers",
          detail: "On the screen when idle", href: null },
        // ★ the maintainer, 29 Sep 2026 (Docustay brief) — was /documents/contracts/templates, the retired
        //   generic list route (see webreact routes.js/surfaceRegistry.js's own notes).
        { key: "documents", label: "Signed documents",
          detail: "Top of every PDF", href: "/documents" },
      ],
      // ★ TASK 17.10 — INVOICE PREVIEW DATA for the "How it looks" card.
      preview: {
        practiceName,
        invoiceNumberExample: "000014",
        logoSrc: logoSrc("login", s["branding.logo_url"]),
      },
      // ★ TASK 17.10 — COLOUR ROW DISABLED WITH REASON. Per OQ-17.1, the colour is never
      //   changeable; the screen renders it greyed with the reason.
      colour: {
        changeable: false,
        value: null,
        reason: "Your practice's colours aren't changeable — Workbench's two colours are the same everywhere, so nothing you send can look broken.",
      },
      writable: true,
      // ★★★ THIS NOTICE SAID THE LOGO DID NOT YET REACH THE SIGN-IN PANEL. IT DOES NOW, AND HAS
      //     SINCE 0121 BUILT THE PRE-AUTH READ — `resolve_login_branding_by_slug` resolves the
      //     subdomain to a logo before any session exists, and `AuthPanel.svelte:43` renders it.
      //   ★★ A NOTICE THAT OUTLIVES ITS LIMITATION IS A LIE ON THE SCREEN, and a worse one than the
      //      usual kind: it tells an operator not to bother with a feature that works, so nobody
      //      ever discovers it does. [MEASURED — the panel renders `brand.logoUrl`.] The rule this
      //      codebase keeps for dead links is the same rule: never describe a limitation you have
      //      not just checked.
      notice: "PNG, JPG or WebP. Your image is resized to the recommended size before it is saved. " +
        "Without a logo, your practice name is shown instead.",
      lastChanged: await lastChangedBy(db, tenantId, ["branding.logo_url","branding.sidebar_logo"]),
    };
  }));

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // P6.65 — /settings/money
  // ───────────────────────────────────────────────────────────────────────────────────────────
  // ★★★ CHANGING PAYMENT TERMS MOVES NO EXISTING DEADLINE, AND THE SCREEN MUST SAY SO.
  //     `src/money/writes.mjs:448` reads this key ONCE, when an invoice is created, and stores the
  //     resulting DATE on the row. An operator who believes otherwise would change this expecting
  //     an invoice already sent to move — and it will not, silently.
  app.get("/api/settings/money", read("/settings/money", async ({ db, tenantId }) => {
    const s = await getSettings(db);
    const connectState = await getConnectAccountState(db, tenantId);
    return {
      path: "/settings/money", title: "Money",
      intro: "Currency and payment terms.",
      fields: [
        field("money.currency", "Currency", s["money.currency"],
          "A three-letter ISO code like USD. Prices already recorded keep the currency they were written in."),
        field("money.payment_terms_days", "Payment terms (days)", s["money.payment_terms_days"],
          "How many days after issue an invoice is due. Read once, when an invoice is created — changing it never moves a deadline on an invoice somebody has already been sent. 0 means due on receipt.",
          { type: "number" }),
        field("money.invoice_prefix", "Invoice prefix", s["money.invoice_prefix"] ?? "",
          "A short code for your invoices, like ACME or 2024. Invoices are numbered 000001, 000002, etc."),
        field("money.reminder_days", "Reminder days", s["money.reminder_days"] ?? [],
          "Which days before and after the due date to send reminders. The default is 7 days before, on the day, 1 and 3 days after.",
          { type: "array" }),
        field("money.tipping", "Tipping", s["money.tipping"],
          "Whether to offer tipping on invoices and in person.",
          { type: "object" }),
        field("money.part_payments", "Part payments", s["money.part_payments"],
          "Whether to let people pay an invoice in instalments you set.",
          { type: "boolean" }),
        field("money.dunning", "Dunning", s["money.dunning"],
          "How to handle failed payments: retry, notify, and pause.",
          { type: "object" }),
        field("money.statement_descriptor", "Statement descriptor", s["money.statement_descriptor"],
          "What appears on card statements when someone pays you (5-22 characters). Stripe requires this range.",
          { type: "text", maxLength: 22 }),
      ],
      connect: { state: connectState.state },
      writable: true, notice: null,
      lastChanged: await lastChangedBy(db, tenantId, ["money.payment_terms_days","money.currency","money.connect"]),
    };
  }));

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // B1.2 — /settings/money/connect. Stripe Connect state and OAuth flow.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  // ★★★ STRIPE CONNECT is how a practice connects THEIR OWN Stripe account so charges and
  //     payouts land on their account, not the platform's. This route returns the current
  //     connection state (not_connected/pending/live/restricted) and is called by MoneyConnect
  //     frame to draw the appropriate UI (button, status chip, or confirmation message).
  //   ★ Gated at admin level (both owner and admin can change payment settings).
  // ★ The OAuth flow uses the same pattern as email mailbox connect — state signing via HMAC,
  //   Stripe's authorize endpoint for user consent, then a callback with code/state verification
  //   and token exchange.
  app.get("/api/settings/money/connect", read("/settings/money", async ({ db, tenantId }) => {
    const account = await getConnectAccountState(db, tenantId);
    return {
      state: account.state,
      stripeAccountId: account.stripeAccountId,
    };
  }));

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // The OAuth flow: start → Stripe → callback. Same hand-rolled guard as email (not wrapped in
  // `guarded()`) because a 302 redirect wrapped in `c.json()` is not a redirect.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  const moneyOAuthFloor = async (ctx) => {
    if (!ctx.principal?.platformTenantId && ctx.principal?.user?.role !== "staff") {
      throw forbidden(
        "settings are for staff. Your account is a client of this practice — this is a refusal, " +
        "not an empty form.");
    }
    const isPlatform = await tenantIsPlatform(ctx.db, ctx.tenantId);
    const decision = authoriseSection(ctx.principal.user, "/settings/money", { tenantIsPlatform: isPlatform });
    if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
    atLeastRank(ctx.principal.user, "admin");
  };
  const connectRedirectUri = (c) => `${publicOrigin(c)}/api/settings/money/connect/callback`;
  const connectLandingUrl = (c, { connectError } = {}) => {
    const u = new URL("/settings/money", publicOrigin(c));
    if (connectError) u.searchParams.set("connectError", connectError);
    return u.toString();
  };

  // ★ FIX (coordinator, checkpoint, 24 Sep 2026, the maintainer's ruling): switched from Stripe Connect OAuth
  //   (which needed KEYSTONE_STRIPE_CONNECT_CLIENT_ID — never configured, a separate Stripe
  //   Dashboard object from the secret key, so this route always threw `dependency`) to Account
  //   Links, which needs only the platform's own secret key. See src/money/connect.mjs's header.

  // B1.2 — GET /api/settings/money/connect/start → 302 to Stripe's hosted onboarding.
  app.get("/api/settings/money/connect/start", (c) =>
    runTenantScoped(c, async (ctx) => {
      await moneyOAuthFloor(ctx);
      if (!(await flagIsOn(ctx.db, "stripe_enabled", ctx.tenantId))) {
        throw invalid("Stripe Connect is not turned on for this practice.");
      }
      // ★ Reuse an existing pending/restricted account rather than creating a new Stripe account
      //   on every retry — an abandoned or expired onboarding link still has a real account behind it.
      const existing = await getConnectAccountState(ctx.db, ctx.tenantId);
      let stripeAccountId = existing.state !== "not_connected" ? existing.stripeAccountId : null;
      if (!stripeAccountId) {
        const created = await createConnectAccount();
        stripeAccountId = created.stripeAccountId;
        await connectAccount(ctx.db, {
          tenantId: ctx.tenantId, stripeAccountId, state: "pending",
          actorUserId: ctx.principal.appUserId,
        });
      }
      // ★ `refresh_url` is Stripe's own retry convention (link expired / onboarding abandoned) —
      //   pointing it back at this same route is what makes the reuse above actually fire.
      const startUrl = `${publicOrigin(c)}/api/settings/money/connect/start`;
      const { url } = await createAccountLink({
        stripeAccountId, refreshUrl: startUrl, returnUrl: connectRedirectUri(c),
      });
      return found(url);
    }, { bucket: "api" }));

  // Task 15.33 — POST /api/settings/connect/start → JSON response with URL (for programmatic use)
  app.post("/api/settings/connect/start", (c) =>
    runTenantScoped(c, async (ctx) => {
      await moneyOAuthFloor(ctx);
      if (!(await flagIsOn(ctx.db, "stripe_enabled", ctx.tenantId))) {
        throw dependency("Stripe Connect is not turned on for this practice.");
      }
      // ★ Reuse an existing pending/restricted account rather than creating a new Stripe account
      //   on every retry — an abandoned or expired onboarding link still has a real account behind it.
      const existing = await getConnectAccountState(ctx.db, ctx.tenantId);
      let stripeAccountId = existing.state !== "not_connected" ? existing.stripeAccountId : null;
      if (!stripeAccountId) {
        const created = await createConnectAccount();
        stripeAccountId = created.stripeAccountId;
        await connectAccount(ctx.db, {
          tenantId: ctx.tenantId, stripeAccountId, state: "pending",
          actorUserId: ctx.principal.appUserId,
        });
      }
      const startUrl = `${publicOrigin(c)}/api/settings/money/connect/start`;
      const { url } = await createAccountLink({
        stripeAccountId, refreshUrl: startUrl, returnUrl: connectRedirectUri(c),
      });
      return { url };
    }, { bucket: "api" }).then((r) => c.json(r, 200)));

  // B1.2 — GET /api/settings/money/connect/callback → 302 back to /settings/money.
  // ★ Account Links' `return_url` carries NO query params (unlike OAuth's `?code=&state=`) — the
  //   account to check status for is the tenant's OWN pending row, never anything the request
  //   supplies, so there is nothing here for a forged parameter to attack.
  app.get("/api/settings/money/connect/callback", (c) =>
    runTenantScoped(c, async (ctx) => {
      await moneyOAuthFloor(ctx);
      const existing = await getConnectAccountState(ctx.db, ctx.tenantId);
      if (!existing.stripeAccountId) {
        return found(connectLandingUrl(c, { connectError: "invalid_state" }));
      }
      let status;
      try {
        status = await fetchConnectAccountStatus({ stripeAccountId: existing.stripeAccountId });
      } catch {
        return found(connectLandingUrl(c, { connectError: "stripe_unreachable" }));
      }
      // ★ Three-way, matching the schema's own state machine: charges enabled is `live`; details
      //   submitted but not yet enabled is Stripe still reviewing (`restricted`, the closest of the
      //   four states — not a rejection, but not usable either); neither means onboarding was
      //   abandoned before completion, so it STAYS `pending` rather than moving anywhere.
      const state = status.chargesEnabled ? "live" : status.detailsSubmitted ? "restricted" : "pending";
      try {
        await connectAccount(ctx.db, {
          tenantId: ctx.tenantId, stripeAccountId: existing.stripeAccountId, state,
          actorUserId: ctx.principal.appUserId,
        });
      } catch {
        return found(connectLandingUrl(c, { connectError: "stripe_unreachable" }));
      }
      return found(connectLandingUrl(c));
    }, { bucket: "api" }));

  // B1.2 — POST /api/settings/money/disconnect {} → { disconnected: true }. Idempotent.
  app.post("/api/settings/money/disconnect", (c) =>
    runTenantScoped(c, async (ctx) => {
      await moneyOAuthFloor(ctx);
      const result = await disconnectAccount(ctx.db, { tenantId: ctx.tenantId });
      await writeAudit(ctx.db, {
        tenantId: ctx.tenantId, action: "settings.changed", object: "money.connect",
        actorUserId: ctx.principal.appUserId, reason: null,
      });
      return result;
    }, { bucket: "write" }).then((r) => c.json(r, 200)));

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // P3.S13 — invoice PDF layouts: list, hide, show. A layout is a Stripe `invoice_rendering_
  // template` object — no local table, no migration; the list is Stripe's list, live.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  // ★ GET — Field 8(c): a Stripe failure on THIS read never throws; it comes back 200 with an
  //   empty list and `unavailable: true` (`invoiceLayouts.mjs`'s own note), so the picker falls
  //   back to "Default only" instead of blanking the whole Money settings screen.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  // ★ /documents/settings is the Documents island's OWN screen and API now (QUEUE §23.2.2): GET/POST /api/documents/settings, src/routes/documentsSettings.mjs.

  app.get("/api/settings/invoice-layouts", read("/settings/money", async ({ db, tenantId }) =>
    listInvoiceLayouts(db, { tenantId })));

  // ★ POST …/archive hides a layout from the picker; …/unarchive shows it again. Both require
  //   `setting.edit` — same permission every other write on this screen checks — and a Stripe
  //   refusal on either becomes `dependency("Stripe refused this: " + message)`, never swallowed.
  app.post("/api/settings/invoice-layouts/archive",
    guarded("/settings/money", "admin", async ({ db, tenantId, principal, body }) => {
      await assertMay(db, principal, { object: "setting", action: "edit" });
      if (!body?.templateId) throw invalid("templateId is required");
      return archiveInvoiceLayout(db, {
        tenantId, templateId: body.templateId, actorUserId: principal?.appUserId ?? null,
      });
    }, { bucket: "write" }));

  app.post("/api/settings/invoice-layouts/unarchive",
    guarded("/settings/money", "admin", async ({ db, tenantId, principal, body }) => {
      await assertMay(db, principal, { object: "setting", action: "edit" });
      if (!body?.templateId) throw invalid("templateId is required");
      return unarchiveInvoiceLayout(db, {
        tenantId, templateId: body.templateId, actorUserId: principal?.appUserId ?? null,
      });
    }, { bucket: "write" }));

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // P3.S14 — ways to pay: which Stripe payment method types show on this practice's pay pages. No
  // local table, no migration — Stripe holds the configuration; this stores only its id and the
  // last-saved enabled list (`src/settings/paymentMethods.mjs`).
  // ───────────────────────────────────────────────────────────────────────────────────────────
  // ★ GET — Field 8(c): a Stripe failure on THIS read never throws; it comes back 200 with the
  //   last saved enabled list and `unavailable: true`, so the picker falls back rather than
  //   blanking the whole Money settings screen.
  app.get("/api/settings/payment-methods", read("/settings/money", async ({ db, tenantId }) =>
    paymentMethodSettings(db, { tenantId })));

  // ★ POST — requires `setting.edit`, same permission every other write on this screen checks. A
  //   Stripe refusal becomes `dependency("Stripe refused this: " + message)`, never swallowed.
  app.post("/api/settings/payment-methods",
    guarded("/settings/money", "admin", async ({ db, tenantId, principal, body }) => {
      await assertMay(db, principal, { object: "setting", action: "edit" });
      if (!Array.isArray(body?.enabled)) throw invalid("enabled is required and must be a list of strings");
      return setPaymentMethodSettings(db, {
        tenantId, enabled: body.enabled, actorUserId: principal?.appUserId ?? null,
      });
    }, { bucket: "write" }));

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // P3.S15 — wallet domains status: which domains are registered for Apple Pay/Google Pay on this
  // practice's Stripe-hosted pay pages. No local table, no migration — Stripe holds the list.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  // ★ GET — Field 8(b): a Stripe failure on THIS read never throws; it comes back 200 with an
  //   empty list and `unavailable: true`, same discipline as the reads above it on this screen.
  app.get("/api/settings/wallet-domains", read("/settings/money", async ({ db, tenantId }) =>
    walletDomains(db, { tenantId })));

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 17.9 — POST /api/settings/terminology/lint. Check layout risks before saving.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  // ★ The lint is read-only: never writes terminology or any other setting. It checks the
  //   overrides object against known tight spots and reports which ones would overflow.
  app.post("/api/settings/terminology/lint", (c) =>
    runTenantScoped(c, async ({ db, body, principal, tenantId }) => {
      // ★ Admin-only check — same as the GET handler.
      const decision = authoriseSection(principal.user, "/settings/terminology");
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);

      const { lintTerms } = await import("../terminology/layoutLint.mjs");
      const overrides = body?.overrides ?? {};
      const warnings = lintTerms(overrides);
      return { warnings };
    }, { bucket: "settings", status: 200 }).then((result) => c.json(result)));

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // P6.70 — /settings/terminology.  ★★ CUT IN PART G, AND P1.5 BUILT THE STORE ANYWAY.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  // ★★★ THE REVERSAL, RECORDED RATHER THAN PERFORMED QUIETLY. `buildState.NOT_BUILT` marks this row
  //     `cut: true` with the reason "the terminology STORE is out of scope (Part G)". The store
  //     EXISTS: `terminology.overrides` is a catalogued key with a closed validator, `TERM_KEYS` is
  //     derived from the real nav rows, and `resolveTerms()` reads it. A row whose stated reason for
  //     being cut is a thing that was subsequently built is a WRONG EXPLANATION, which costs
  //     somebody a day before they discover it was never true.
  // ★★★ AND THE SAFETY PROPERTY IS STRUCTURAL, WHICH IS THE ONLY REASON THIS IS ALLOWED TO EXIST.
  //     The sibling project deleted its terminology layer because i18next ECHOES THE KEY ON A MISS.
  //     This resolver cannot: `sections.mjs` resolves `terms[termKey] || fallback` and the fallback
  //     is the ENGLISH WORD carried on the row. A miss renders the word. ★ The defaults below come
  //     from `TERM_FALLBACKS`, the same source, so this screen cannot show a different default from
  //     the one the nav would use.
  app.get("/api/settings/terminology", read("/settings/terminology", async ({ db, tenantId }) => {
    const s = await getSettings(db);
    const overrides = s["terminology.overrides"] ?? {};
    return {
      path: "/settings/terminology", title: "Terminology",
      intro: "What this practice calls the people it works with. A blank uses the default.",
      terms: TERM_KEYS.map((k) => ({
        key: k, label: TERM_FALLBACKS[k], fallback: TERM_FALLBACKS[k],
        override: typeof overrides[k] === "string" ? overrides[k] : null,
      })),
      settingKey: "terminology.overrides",
      writable: true,
      notice:
        "A label may not contain a dot — that is an identifier, not a label — and renaming a word " +
        "never renames a permission key.",
      lastChanged: await lastChangedBy(db, tenantId, ["terminology.overrides"]),
    };
  }));

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // P6.63 — /settings/client-app
  // ───────────────────────────────────────────────────────────────────────────────────────────
  // ★★★ P6.63's PROVES IS "A SURFACE TOGGLED OFF DISAPPEARS FROM `/api/app/surfaces`", so the
  //     setting is read BY THAT ROUTE — not merely stored beside it. A toggle whose value nothing
  //     consults is the write-only setting this batch found five of.
  // ★★ TURNING A SURFACE OFF IS A PAYLOAD DECISION, NEVER A PERMISSION. `document_is_visible()`
  //    (migration 0012) is what stops a parent reading session-note content; hiding the Documents
  //    tab does not, and the screen says so rather than letting an operator believe it is a control.
  app.get("/api/settings/client-app", read("/settings/client-app", async ({ db, tenantId }) => {
    const s = await getSettings(db);
    const off = new Set(Array.isArray(s["client_app.surfaces_off"]) ? s["client_app.surfaces_off"] : []);
    return {
      path: "/settings/client-app", title: "Client app",
      intro: "Which surfaces the people you work with see in their app.",
      settingKey: "client_app.surfaces_off",
      surfaces: SURFACES.map((x) => ({
        key: x.key, label: x.label, roles: x.roles, on: !off.has(x.key),
      })),
      writable: true,
      notice:
        "Switching a surface off removes it from everyone's app and from /api/app/surfaces. It is " +
        "not a permission: what a person may READ is decided in the database on every request, so " +
        "hiding a tab hides a tab and nothing more.",
      lastChanged: await lastChangedBy(db, tenantId, ["client_app.surfaces_off"]),
    };
  }));

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ PART 4.6 [TY, RULED 23 Sep 2026] — ONE SHAPE CONTROL. Replaces WORKSTREAM 12's per-group
  //     toggle list. `shape` is a real `tenant` column (migration 0343), not a `tenant_setting`,
  //     so it gets its own small GET/POST pair — same pattern as `/settings/practice/slug` above,
  //     not the generic `POST /api/settings` key/value store.
  //   ★ NOT A PERMISSION — same reasoning the old screen's notice stated: hiding a sidebar section
  //     does not touch `authoriseSection`/RLS (see `GET /api/nav`'s comment, `src/routes/index.mjs`).
  //     Direct requests to a hidden section's routes still work for anyone who holds the role.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  app.get("/api/settings/practice/shape", read("/settings/shape", async ({ db, tenantId }) => {
    const { rows } = await db.query("SELECT shape FROM keystone.tenant WHERE id = $1", [tenantId]);
    return {
      path: "/settings/shape", title: "Shape",
      intro: "Which parts of Workbench this practice uses. Switching hides sections from the " +
             "sidebar for everyone — nobody's data or permissions change.",
      shape: rows[0]?.shape ?? "both",
      options: SHAPES.map((key) => ({
        key, label: SHAPE_INFO[key].label, detail: SHAPE_INFO[key].detail,
      })),
      writable: true,
    };
  }));

  // ★ TY, 23 Sep 2026 — POST /api/settings/practice/shape  { shape }
  app.post("/api/settings/practice/shape", (c) =>
    runTenantScoped(c, async ({ db, body, principal, tenantId }) => {
      if (!principal?.platformTenantId && principal?.user?.role !== "staff") throw forbidden("settings are for staff.");
      const isPlatform = await tenantIsPlatform(db, tenantId);
      const decision = authoriseSection(principal.user, "/settings/shape", { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
      await assertMay(db, principal, { object: "setting", action: "edit" });
      if (!SHAPES.includes(body?.shape)) throw invalid(`shape must be one of ${SHAPES.join(", ")}`);
      const { rows } = await db.query("SELECT shape FROM keystone.tenant WHERE id = $1", [tenantId]);
      const oldShape = rows[0]?.shape ?? "both";
      await db.query("UPDATE keystone.tenant SET shape = $1 WHERE id = $2", [body.shape, tenantId]);
      // ★ Task 17.5 — audit the shape change
      if (body.shape !== oldShape) {
        await writeAudit(db, {
          tenantId,
          action: "settings.changed",
          object: "practice.shape",
          actorUserId: principal?.appUserId ?? null,
          before: { key: "practice.shape", value: oldShape },
          after: { key: "practice.shape", value: body.shape },
        });
      }
      return { shape: body.shape };
    }, { bucket: "settings", status: 200 }).then((result) => c.json(result)));

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // T1.23b — THE FORM BUILDER'S FIELD LIST. `GET /api/custom-fields?record_type=<type>` lists the
  //     active custom fields defined for one record type, so `FormBuilder.svelte` (a real caller,
  //     `FormBuilder.svelte:29`) has something to render instead of calling a route that never
  //     existed.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  app.get("/api/custom-fields", read("/settings/practice", async ({ db, tenantId, c }) => {
    const recordType = c.req.query("record_type");
    const VALID_RECORD_TYPES = ["person", "account", "network_party", "engagement", "document", "invoice"];
    if (!VALID_RECORD_TYPES.includes(recordType)) {
      throw invalid("record_type must be one of person, account, network_party, engagement, document, invoice");
    }
    const { rows } = await db.query(
      `SELECT id, key, label, kind, options, position FROM keystone.custom_field
         WHERE tenant_id = $1 AND record_type = $2 AND active ORDER BY position, label`,
      [tenantId, recordType]);
    return { fields: rows };
  }));

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // C1.9 — REQUIRED FIELDS ARE A PRACTICE SETTING.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ GET /api/settings/fields-required — Read the current required fields configuration
  //     and the defaults, so the screen knows what cannot be turned off.
  app.get("/api/settings/fields-required", read("/settings/practice", async ({ db, tenantId }) => {
    const current = await getSetting(db, "fields.required", null);
    const RECORD_TYPES = ["person", "account", "invoice", "document", "service", "booking"];
    const rules = {};
    let retroField = null;
    let maxMissing = 0;

    // ★ Check if any adolescent_client exists in this tenant
    const { rows: adolescentRows } = await db.query(
      "SELECT id FROM keystone.app_user WHERE role = 'client' AND date_of_birth IS NOT NULL AND EXTRACT(YEAR FROM AGE(date_of_birth)) < 18 LIMIT 1"
    );
    const hasAdolescent = adolescentRows.length > 0;

    for (const type of RECORD_TYPES) {
      const required = await requiredFor(db, tenantId, type);
      const unchangeable = unchangeableFor(type);
      const fields = [];

      // Build the fields array with reasons and missing counts
      const reasonsForType = REQUIRED_FIELD_REASONS[type] || {};
      for (const field of Object.keys(reasonsForType)) {
        let reason = reasonsForType[field];

        // Special case: date_of_birth reason depends on whether adolescent_client exists
        if (type === "person" && field === "date_of_birth" && hasAdolescent) {
          reason = "Required, because you take teenage clients and it decides which agreement they get.";
        }

        const missing = await missingCounts(db, type, field);
        const isRequired = required.includes(field);

        fields.push({
          field,
          label: field.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" "),
          required: isRequired,
          always: unchangeable.includes(field),
          reason,
          missing,
        });

        // Track the field with the most missing rows (for retro)
        if (isRequired && missing !== null && missing > maxMissing) {
          maxMissing = missing;
          retroField = { type, field, missing };
        }
      }

      rules[type] = {
        required,
        unchangeable,
        fields,
      };
    }

    return {
      path: "/settings/required-fields", title: "Required fields",
      intro: "Which fields are required when creating records. Default: person needs a name and " +
             "a way to reach them (email or mobile); account needs a name.",
      settingKey: "fields.required",
      rules,
      retro: retroField,
      writable: true,
      lastChanged: await lastChangedBy(db, tenantId, ["fields.required"]),
    };
  }));

  // ★ C1.9 — POST /api/settings/fields-required { person: [...], account: [...], ... }
  app.post("/api/settings/fields-required", (c) =>
    runTenantScoped(c, async ({ db, body, principal, tenantId }) => {
      if (!principal?.platformTenantId && principal?.user?.role !== "staff") throw forbidden("settings are for staff.");
      const isPlatform = await tenantIsPlatform(db, tenantId);
      const decision = authoriseSection(principal.user, "/settings/practice", { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
      await assertMay(db, principal, { object: "setting", action: "edit" });

      // ★ Validate that unchangeable fields remain required
      const RECORD_TYPES = ["person", "account", "invoice", "document", "service", "booking"];
      for (const type of RECORD_TYPES) {
        const proposed = body?.[type] ?? [];
        const unchangeable = unchangeableFor(type);
        for (const field of unchangeable) {
          if (!proposed.includes(field)) {
            throw invalid(
              `"${field}" is required on every ${type} and cannot be turned off`);
          }
        }
      }

      // ★ Write the setting
      await setSetting(db, {
        tenantId,
        key: "fields.required",
        value: body,
        updatedBy: principal.appUserId,
      });

      return { saved: true, fields_required: body };
    }, { bucket: "settings", status: 200 }).then((result) => c.json(result)));

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Task 17.18 — GET /api/settings/usage. The four meters, prices, reset date and pace prompt.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  app.get("/api/settings/usage", read("/settings/usage", async ({ db, tenantId, principal }) => {
    const { rows: tenantRows } = await db.query(
      `SELECT timezone FROM keystone.tenant WHERE id = $1`,
      [tenantId]
    );
    const tenantTz = tenantRows[0]?.timezone ?? "UTC";

    // ★ Get the current month's usage
    const usage = await usageForPeriod(db, tenantId);

    // ★ Calculate reset date: first of next month in tenant's timezone
    // ★ L8.3 — first of next month, in the tenant's OWN zone (tenantTz, fetched above) — the
    //   comment already promised this; the old code read UTC getters into a LOCAL Date constructor.
    const now = new Date();
    const nextMonthLocal = addMonths(new TZDate(now.getTime(), tenantTz), 1);
    const resetsOn = format(nextMonthLocal, "yyyy-MM-01");

    // ★ Build meter rows: ai_draft (500), text (400), esign (100), staff (5)
    const meters = [];
    const metricLabels = {
      ai_draft: "AI drafting",
      text: "Text messages",
      esign: "Signed documents",
      staff: "Staff",
    };
    const metricUnits = {
      ai_draft: "drafts",
      text: "texts",
      esign: "documents",
      staff: "people",
    };

    for (const metric of ["ai_draft", "text", "esign", "staff"]) {
      const data = usage[metric];
      const label = metricLabels[metric];
      const unit = metricUnits[metric];
      const used = data?.used ?? 0;
      const included = data?.included ?? 0;

      // ★ Staff uses {n}, others use {used} (spec verbatim from SetUsage)
      const placeholder = metric === "staff" ? "{n}" : "{used}";

      meters.push({
        metric,
        label: `${label} — ${placeholder} of ${included} ${unit}`,
        used,
        included,
        detail: null, // No detail sentences from ledger; it carries no per-purpose split
      });
    }

    // ★ Build price rows (verbatim from SetUsage frame)
    const prices = [
      { label: "AI drafting", sentence: "2¢ each" },
      { label: "Text messages", sentence: "3¢ each in the US" },
      { label: "Signed documents", sentence: "15¢ each" },
      { label: "Staff", sentence: "$12 a month each" },
    ];

    // ★ Compute prompts for settings_usage surface
    const canSeeMoney = principal?.user?.role === "owner" || principal?.user?.role === "admin";
    const prompts = (await computePrompts(db, {
      viewerId: principal.appUserId,
      canSeeMoney,
      surface: "settings_usage",
    })).prompts;

    // ★ Read the usage.ai_ceiling key (THE CEILING ROW: nothing else reads this key)
    const ceilingValue = await getSetting(db, "usage.ai_ceiling", null);

    return {
      path: "/settings/usage",
      title: "What you've used",
      resetsOn,
      meters,
      prices,
      prompts,
      lastChanged: null,
      ceiling: {
        key: "usage.ai_ceiling",
        valueMinor: ceilingValue,
        label: "Set a ceiling if you want one",
        sentence: "We stop rather than charge past a number you pick.",
      },
    };
  }));

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Task 6.5 / 06-settings.md §2.7, §9, §11 — /settings/billing, /settings/plans. THE A11 REBUILD.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  // ★★★ KS-10's BLOCKED FORM IS RETIRED, EXPLICITLY (§11). The response now reads
  //     `workbench_subscription.plan_key` — the ONE column of record for plan tier (the maintainer's ruling, 22
  //     Sep 2026) — instead of the old mirrored `billing.tier` `tenant_setting` key. The counsel
  //     blocker KS-10 named is resolved by A11: the Stripe Billing Portal / Checkout ARE built
  //     below, gated behind the SAME `stripe_enabled` per-tenant kill switch
  //     `stripeCustomer.mjs` already uses, so a practice on a platform where billing is not yet
  //     configured gets a named refusal, never a dead button and never a raw Stripe error.
  // ★ A price a plan does not carry (Enterprise, `monthlyPriceMinor: null`) can never reach
  //   Checkout — "custom" is a conversation, not a self-serve purchase (MOCKUPS §16:486, "Talk to
  //   us").
  app.get("/api/settings/billing", read("/settings/billing", async ({ db, tenantId }) => {
    const sub = await getSubscription(db, tenantId);
    const usage = await getUsage(db, tenantId);
    const plan = sub ? planByKey(sub.plan_key) : null;

    // ★★★ Task 17.17 — Calculate overage using reconciled (invoice) counts.
    // Overage = Σ over metrics of max(0, used − included) × OVERAGE_MINOR
    const fullUsage = usage._fullUsage;
    let overageMinor = 0;
    for (const metric of ['ai_draft', 'text', 'esign', 'marketing_email']) {
      const metricUsage = fullUsage[metric];
      // ★ marketing_email has a plan limit but no included-units allowance and no per-unit overage price (ALLOWANCES / OVERAGE_MINOR carry only ai_draft, text, esign):
      //   the old arithmetic made it `0 - undefined` = NaN, and NaN poisoned the whole sum — JSON turned the practice's overage into `null`. Only a metric with both numbers is billed.
      if (metricUsage && Number.isFinite(metricUsage.included) && Number.isFinite(OVERAGE_MINOR[metric])) {
        const overage = Math.max(0, metricUsage.used - metricUsage.included);
        overageMinor += overage * OVERAGE_MINOR[metric];
      }
    }

    return {
      planKey: sub?.plan_key ?? null,
      // ★ `founder` (Docustay's own free internal plan) is not in the sellable `PLANS` catalogue —
      //   `planByKey` returns null for it, so the raw key is shown rather than nothing.
      planName: plan?.name ?? sub?.plan_key ?? null,
      status: sub?.status ?? null,
      trialEndsAt: sub?.trial_ends_at ?? null,
      seatCount: sub?.seat_count ?? 0,
      seatLimit: sub?.seat_limit ?? null,
      // ★ SetBilling.frame.html's "After trial" stat — the price the CURRENT plan carries, so the
      //   frame's own figure can be drawn without a second round trip to `/api/settings/plans`.
      //   `null` for `founder` (not in the sellable catalogue) and for a tenant with no subscription.
      monthlyPriceMinor: plan?.monthlyPriceMinor ?? null,
      yearlyPriceMinor: plan?.yearlyPriceMinor ?? null,
      // ★★ NAMED GAP, not a guess: `workbench_subscription` (migration 0334, reused as-is by this
      //    task) carries no `current_period_end` column — nothing in this task's file list
      //    authorises a new migration to add one. Always `null` until that column exists.
      currentPeriodEnd: null,
      stripeCustomerId: Boolean(sub?.stripe_customer_id),
      usage: {
        aiDrafts: { used: usage.aiDraft, limit: plan?.aiDrafts ?? null },
        marketingEmails: { used: usage.marketingEmail, limit: plan?.marketingEmails ?? null },
      },
      overageMinor,
      lastChanged: await lastChangedBy(db, tenantId, "billing.plan"),
    };
  }));

  /**
   * ★ Shared by portal-session and checkout-session: resolve this tenant's Stripe customer id,
   *   lazy-creating one on the FIRST call (§6: "lazy customer creation on first 'Manage billing'
   *   click", reusing `createStripeCustomer` unchanged). `stripe_enabled` is checked by the caller
   *   BEFORE this runs. Returns `null` (never throws) when no platform credential is configured —
   *   the caller turns that into the shared "temporarily unavailable" refusal (§6).
   * ★★ Persists ONLY `stripe_customer_id`, a narrow single-column UPDATE — never `plan_key`/
   *    `status`/`seat_limit`/`trial_ends_at`, the four fields §2.7 (line 209) reserves for the
   *    webhook handler alone. A customer id is not a subscription fact Stripe could disagree with
   *    us about; it is simply where the lazy-created object now lives.
   */
  async function resolveStripeCustomerId(db, { tenantId, sub, tenantName, email }) {
    if (sub?.stripe_customer_id) return sub.stripe_customer_id;
    const apiKey = process.env[SECRET_KEY_VAR];
    if (!apiKey) return null;
    const result = await createStripeCustomer({ tenantId, email, name: tenantName }, { apiKey });
    if (!result.externalId) return null;
    await db.query(
      `UPDATE keystone.workbench_subscription SET stripe_customer_id = $2 WHERE tenant_id = $1`,
      [tenantId, result.externalId]);
    return result.externalId;
  }

  app.post("/api/settings/billing/portal-session",
    guarded("/settings/billing", "admin", async ({ db, tenantId, principal }) => {
      const enabled = await flagIsOn(db, "stripe_enabled", tenantId);
      if (!enabled) {
        throw invalid("stripe_enabled is off for this practice — a platform operator turned it off.");
      }
      const sub = await getSubscription(db, tenantId);
      const { rows } = await db.query(`SELECT name, slug FROM keystone.tenant WHERE id = $1`, [tenantId]);
      const t = rows[0] ?? {};
      const customerId = await resolveStripeCustomerId(db, {
        tenantId, sub, tenantName: t.name, email: principal?.user?.email ?? null,
      });
      if (!customerId) throw dependency("Billing is temporarily unavailable — try again shortly");

      const result = await callOutside("stripe", "https://api.stripe.com/v1/billing_portal/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env[SECRET_KEY_VAR]}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          customer: customerId,
          return_url: `https://${t.slug ?? "app"}.${appDomain()}/settings/billing`,
        }),
      }, { timeoutMs: 20_000 });
      // ★ Never a raw Stripe error string on this screen (§6) — one message, every failure shape.
      if (!result.ok || !result.body?.url) throw dependency("Billing is temporarily unavailable — try again shortly");
      return { url: result.body.url };
    }, { bucket: "write" }));

  app.post("/api/settings/billing/close",
    guarded("/settings/billing", "owner", async ({ db, tenantId, principal, body }) => {
      const { rows } = await db.query(`SELECT name FROM keystone.tenant WHERE id = $1`, [tenantId]);
      const practiceName = rows[0]?.name ?? "";
      const typed = String(body?.confirmPracticeName ?? "");
      // ★ Same confirm-by-typing pattern MOCKUPS §5:166 and TeamRemove's owner handover use — an
      //   exact match against the practice's own real name, never a case-insensitive or trimmed-
      //   only comparison (typing the wrong practice's name must never pass).
      if (typed !== practiceName) throw invalid("that doesn't match this practice's name");

      // ★★★ §9 "Cancelling the platform": `tenant.status = 'closed'` (existing CHECK value, no
      //     migration) and `workbench_subscription.status = 'canceled'` — read-only for 90 days,
      //     export any time; the 90-day window is a stated fact, not a separate timer table (§9).
      await db.query(`UPDATE keystone.tenant SET status = 'closed' WHERE id = $1`, [tenantId]);
      await db.query(
        `UPDATE keystone.workbench_subscription SET status = 'canceled' WHERE tenant_id = $1`,
        [tenantId]);

      await writeAudit(db, {
        tenantId, action: "settings.changed", object: "billing.plan",
        actorUserId: principal?.appUserId ?? null,
        after: { tenantStatus: "closed", subscriptionStatus: "canceled" },
      });

      return { closed: true };
    }, { bucket: "write" }));

  app.get("/api/settings/plans", read("/settings/plans", async ({ db, tenantId }) => {
    const sub = await getSubscription(db, tenantId);
    return {
      current: sub?.plan_key ?? null,
      plans: PLANS.map(({ key, name, seats, aiDrafts, marketingEmails, monthlyPriceMinor, yearlyPriceMinor }) =>
        ({ key, name, seats, aiDrafts, marketingEmails, monthlyPriceMinor, yearlyPriceMinor })),
      seatCount: sub?.seat_count ?? 0,
      lastChanged: await lastChangedBy(db, tenantId, ["billing.plan"]),
    };
  }));

  app.post("/api/settings/plans/checkout-session",
    // ★★★ F697 — was "admin". `setting.billing` (defaults.mjs's OWNER_ACTIONS-minus-nothing set) is
    //     Owner-only everywhere else on this file's billing surface (its sibling at :641,
    //     `/settings/billing/close`, is already "owner"-gated) — this route starts a paid plan
    //     change and was the one exception. Fixed to match, 22 Sep 2026.
    guarded("/settings/plans", "owner", async ({ db, tenantId, principal, body }) => {
      const planKey = String(body?.planKey ?? "");
      const interval = String(body?.interval ?? "");
      const plan = planByKey(planKey);
      // ★ A plan with no price (Enterprise, `monthlyPriceMinor: null`) is "Talk to us" (MOCKUPS
      //   §16:486) — it can never reach Checkout, same refusal as an unknown key.
      if (!plan || plan.monthlyPriceMinor == null) throw invalid("that is not a plan you can choose here");
      if (interval !== "monthly" && interval !== "yearly") throw invalid('interval must be "monthly" or "yearly"');

      const sub = await getSubscription(db, tenantId);
      // ★★★ §2.7/§9 — downgrade below current seat_count is refused BEFORE Stripe is even called,
      //     never a partial apply. `plan.seats === null` is Enterprise/unlimited, already excluded
      //     above by the price check, so this comparison only ever runs against a finite ceiling.
      const currentSeatCount = sub?.seat_count ?? 0;
      if (plan.seats != null && plan.seats < currentSeatCount) {
        throw invalid("ask the owner to remove people first");
      }

      const enabled = await flagIsOn(db, "stripe_enabled", tenantId);
      if (!enabled) {
        throw invalid("stripe_enabled is off for this practice — a platform operator turned it off.");
      }
      const { rows } = await db.query(`SELECT name, slug FROM keystone.tenant WHERE id = $1`, [tenantId]);
      const t = rows[0] ?? {};
      const customerId = await resolveStripeCustomerId(db, {
        tenantId, sub, tenantName: t.name, email: principal?.user?.email ?? null,
      });
      if (!customerId) throw dependency("Billing is temporarily unavailable — try again shortly");

      const unitAmount = interval === "yearly" ? plan.yearlyPriceMinor : plan.monthlyPriceMinor;
      const recurringInterval = interval === "yearly" ? "year" : "month";
      const params = new URLSearchParams({
        customer: customerId,
        mode: "subscription",
        success_url: `https://${t.slug ?? "app"}.${appDomain()}/settings/plans?checkout=success`,
        cancel_url: `https://${t.slug ?? "app"}.${appDomain()}/settings/plans?checkout=cancelled`,
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][unit_amount]": String(unitAmount),
        "line_items[0][price_data][recurring][interval]": recurringInterval,
        "line_items[0][price_data][product_data][name]": `Workbench — ${plan.name}`,
        // ★ Round-trips onto the created SUBSCRIPTION's own metadata, which
        //   `billing/webhook.mjs`'s mirror reads back on the `customer.subscription.created`
        //   event — the only place `plan_key`/`seat_count` are ever written to the mirror (§2.7
        //   line 209), never this route directly.
        ...Object.fromEntries(
          Object.entries(metadataFor("subscription", {
            keystone_tenant_id: tenantId,
            plan_key: plan.key,
            seat_count: String(plan.seats ?? currentSeatCount),
          })).map(([k, v]) => [`subscription_data[metadata][${k}]`, v])
        ),
      });
      const result = await callOutside("stripe", "https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env[SECRET_KEY_VAR]}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
      }, { timeoutMs: 20_000 });
      if (!result.ok || !result.body?.url) throw dependency("Billing is temporarily unavailable — try again shortly");
      return { url: result.body.url };
    }, { bucket: "write" }));

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ Task 6.4 — SetImport (06-settings.md §2.5, admin, `guarded("/settings/import", "admin", …)`
  //     per §4's own table). Upload sends `{ filename, dataBase64 }` — base64 in the JSON body, the
  //     SAME pattern `POST /api/settings/branding/logo` (above) already uses for a file, not the
  //     spec table's literal "multipart CSV file" wording: no multipart-handling code exists
  //     anywhere in this codebase to build on [MEASURED], and this file's own precedent for "a
  //     browser sends bytes" is base64-in-JSON. Flagged in this build's report as a scope decision.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  app.get("/api/settings/import", read("/settings/import", async ({ db, tenantId }) => ({
    fieldOptions: IMPORT_FIELD_OPTIONS, maxRows: MAX_IMPORT_ROWS, sources: IMPORT_SOURCES,
    lastChanged: await lastChangedBy(db, tenantId, ["settings.import"]),
  })));

  app.post("/api/settings/import",
    guarded("/settings/import", "admin", async ({ db, tenantId, principal, body }) => {
      const filename = String(body?.filename ?? "upload.csv");
      const b64 = String(body?.dataBase64 ?? "");
      if (!b64) throw invalid("no file was sent");
      let text;
      try { text = Buffer.from(b64, "base64").toString("utf8"); }
      catch { throw invalid("that file could not be read"); }
      const { columns, records } = csvToRecords(text);
      if (records.length > MAX_IMPORT_ROWS) {
        throw invalid(`that file has ${records.length} rows; the limit is ${MAX_IMPORT_ROWS}`);
      }
      const { rows } = await db.query(
        `INSERT INTO keystone.import_run (tenant_id, created_by, source_filename)
         VALUES ($1,$2,$3) RETURNING id`,
        [tenantId, principal?.appUserId ?? null, filename]);
      const importRunId = rows[0].id;
      for (let i = 0; i < records.length; i++) {
        await db.query(
          `INSERT INTO keystone.import_row (import_run_id, tenant_id, row_number, raw)
           VALUES ($1,$2,$3,$4)`,
          [importRunId, tenantId, i + 1, JSON.stringify(records[i])]);
      }
      return { importRunId, columns, sampleRows: records.slice(0, 5) };
    }, { bucket: "write" }));

  app.post("/api/settings/import/:id/mapping",
    guarded("/settings/import", "admin", async ({ db, tenantId, body, c }) =>
      setImportMapping(db, {
        tenantId, importRunId: c.req.param("id"),
        sourceKey: body?.sourceKey ?? null,
        mapping: body?.mapping, duplicatePolicy: body?.duplicatePolicy,
        marketingConsentConfirmed: Boolean(body?.marketingConsentConfirmed),
      }), { bucket: "write" }));

  app.post("/api/settings/import/:id/check",
    guarded("/settings/import", "admin", async ({ db, tenantId, c }) =>
      checkImportRun(db, { tenantId, importRunId: c.req.param("id") }), { bucket: "write" }));

  app.post("/api/settings/import/:id/run",
    guarded("/settings/import", "admin", async ({ db, tenantId, principal, c }) =>
      runImportRun(db, { tenantId, importRunId: c.req.param("id"), actorUserId: principal?.appUserId ?? null }),
      { bucket: "write" }));

  app.get("/api/settings/import/:id",
    read("/settings/import", async ({ db, tenantId, c }) =>
      importRunStatus(db, { tenantId, importRunId: c.req.param("id") })));

  app.post("/api/settings/import/:id/undo",
    guarded("/settings/import", "admin", async ({ db, tenantId, principal, c }) =>
      undoImportRun(db, { tenantId, importRunId: c.req.param("id"), actorUserId: principal?.appUserId ?? null }),
      { bucket: "write" }));

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ Task 6.4 — SetData export half (06-settings.md §2.6). View is admin; the export action
  //     itself is OWNER ONLY (MOCKUPS §13:420 "owner only, logged") — same override idiom
  //     `guarded("/settings/billing", "owner", …)` already uses two sections up, applied here.
  //     Import half is §2.5 above; the audit-log half is the existing `GET /api/developer/audit-log`
  //     (`src/routes/developer.mjs`) — this GET adds only a 3-row PREVIEW, reading the same
  //     `listAuditEvents` reader that full screen already uses.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  app.get("/api/settings/data", read("/settings/data", async ({ db, tenantId }) => ({
    exports: await listDataExports(db, { tenantId }),
    auditPreview: await listAuditEvents(db, { limit: 3 }),
    lastChanged: await lastChangedBy(db, tenantId, ["settings.data_export"]),
  })));

  app.post("/api/settings/data/export",
    guarded("/settings/data", "owner", async ({ db, tenantId, principal, body }) =>
      requestDataExport(db, {
        tenantId, requestedBy: principal?.appUserId ?? null,
        scope: body?.scope, personId: body?.personId ?? null,
      }), { bucket: "write" }));

  // Task 15.33 — POST /api/settings/data-export — alias for canonical /api/settings/data/export
  app.post("/api/settings/data-export",
    guarded("/settings/data", "owner", async ({ db, tenantId, principal, body }) =>
      requestDataExport(db, {
        tenantId, requestedBy: principal?.appUserId ?? null,
        scope: body?.scope, personId: body?.personId ?? null,
      }), { bucket: "write" }));

  // ★★★ F698 — was `read(...)`, which defaults to "admin" (:298). Its two siblings (`/settings/data`
  //     above :810, `/settings/data/export` above :816) are BOTH "owner"-gated, and `listDataExports`
  //     (dataExport.mjs:56's own comment) documents this whole surface as "owner only (gated by the
  //     caller)" — this route was the one caller that did not. `personName` (a client's display
  //     name) is in the response, so an Admin could see a named client's export history. Fixed to
  //     match its siblings, 22 Sep 2026.
  app.get("/api/settings/data/exports",
    guarded("/settings/data", "owner", async ({ db, tenantId }) => ({ exports: await listDataExports(db, { tenantId }) }),
      { bucket: "settings" }));

  // ★ The bytes themselves — owner only, same floor as requesting the export in the first place.
  app.get("/api/settings/data/exports/:id/download", (c) =>
    runTenantScoped(c, async (ctx) => {
      if (!ctx.principal?.platformTenantId && ctx.principal?.user?.role !== "staff") {
        throw forbidden("settings are for staff.");
      }
      const isPlatform = await tenantIsPlatform(ctx.db, ctx.tenantId);
      const decision = authoriseSection(ctx.principal.user, "/settings/data", { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
      atLeastRank(ctx.principal.user, "owner");
      const body = await loadDataExportFile(ctx.db, { tenantId: ctx.tenantId, exportId: ctx.c.req.param("id") });
      return body;
    }, { bucket: "settings" }).then((body) =>
      new Response(body, { status: 200, headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="export-${c.req.param("id")}.json"`,
      } })));

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // P6.76 — /settings/developer/sandbox
  // ───────────────────────────────────────────────────────────────────────────────────────────
  // ★★★ A SANDBOX CANNOT BE CREATED FROM A TENANT SESSION, AND THAT IS A PROPERTY WORTH KEEPING.
  //     `createSandboxTenant(adminTx, …)` writes `keystone.tenant` and then copies rows from one
  //     tenant into another — precisely the operation `withTenant()` exists to make impossible. Its
  //     own header says so: it runs "as a privileged connection … done in ONE named place rather
  //     than by loosening anything." ★★ So this row READS honestly and refuses to create, naming
  //     the reason — rather than drawing a "Create sandbox" button that would have to punch a hole
  //     through the tenant boundary to work.
  // ★★★ 9.11 — `writable` NOW ANSWERS "is THIS caller the platform", not a hardcoded `false`.
  //     `callerIsPlatform(db)` reads `keystone.operator_grant_id` — a GUC independent of which
  //     tenant this transaction's `keystone.tenant_id` is (the same helper `platform.mjs` and
  //     `writes.mjs`'s `platform: true` routes use, CCR-13/F594) — so it answers correctly whether
  //     the session belongs to the practice's own staff or to a platform operator with a live grant.
  //     ★ For everyone else this row's response is BYTE-FOR-BYTE what it always was: `writable:
  //       false` and the same notice, unchanged (field 4).
  app.get("/api/settings/developer/sandbox", read("/settings/developer/sandbox", async ({ db, tenantId }) => {
    const info = await sandboxInfo(db, tenantId);
    const platform = await callerIsPlatform(db);
    return {
      path: "/settings/developer/sandbox", title: "Sandbox",
      intro: "A second copy of this practice's configuration, with none of its people.",
      sandbox: info,
      writable: platform,
      notice: platform
        ? "Creating a sandbox writes the tenant table and copies this practice's configuration — " +
          "services, prices, document categories, document types and document templates — into a " +
          "second tenant. It copies no people, no documents and no signatures."
        : "A sandbox cannot be created from inside a practice. Creating one writes the tenant table " +
          "and copies configuration across two tenants — the one operation the tenant boundary is " +
          "built to refuse — so it is run by the platform, deliberately, and no button is drawn " +
          "here that would need that boundary loosened to work.",
    };
  }));

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ 9.11 — POST /api/settings/developer/sandbox. THE CREATE PATH `createSandboxTenant` AND
  //     `copyConfigurationIntoSandbox` HAVE NEVER HAD (CT-069): their only caller anywhere in
  //     `src/` was, until this route, zero — `db/gates/p19_audit_and_sandbox.mjs` was the sole
  //     caller of either function, which is the exact "built, tested and wired to nothing" shape
  //     CLAUDE.md's failure #1 names. `guarded()` above already refuses a client-of-the-practice
  //     and enforces the `/settings/developer/sandbox` nav row (`admin` floor); the check that
  //     matters for THIS route is `callerIsPlatform`, immediately below — the same one the GET
  //     route above just used to decide `writable`, so a `403` here and a `writable: false` there
  //     can never disagree about who may act.
  //
  // ★★★★ F621 — fixed by migration 0221 / task 9.11b — see FINDINGS.md F621 for the full history.
  //   ★ THE AUDIT RECORD field 4 ASKS FOR: `operator.acted_as` (one of the frozen 25 `AUDIT_ACTIONS`,
  //     `src/permissions/audit.mjs:58`, CT-042) is the general "a platform operator acted inside a
  //     tenant's own context" action — it has NO existing caller in `src/` (MEASURED: `grep -rn
  //     "operator.acted_as" src/` before this task returned only its own declaration in
  //     `audit.mjs`), it declares `AUDIT_FIELDS["operator.acted_as"] = []` (no extra-field shape to
  //     invent), and it requires a `reason` whenever `actorOperatorGrantId` is set — exactly the
  //     shape this call has. `object: "sandbox"` and `subjectId: sandbox.id` say what was acted on.
  //     ★ Deliberately NOT `platform.tenant.provisioned` (the event topic) — that topic drives the
  //     `onboarding.nudge` automation (setup-checklist nudges, `src/automations/catalogue.mjs:106-113`),
  //     which a sandbox must never receive; `writeAudit` writes a ROW, not an event, so this cannot
  //     fire it by accident. `actorOperatorGrantId` is read back from the GUC `withTenant` already
  //     set (`src/db/index.mjs:123`) rather than threaded through as a new parameter — the same value
  //     `callerIsPlatform` above just used to decide this caller may proceed at all.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  app.post("/api/settings/developer/sandbox", guarded("/settings/developer/sandbox", "admin", async ({ db, tenantId }) => {
    if (!(await callerIsPlatform(db))) {
      throw forbidden(
        "a sandbox cannot be created from inside a practice by anyone but the platform, " +
        "deliberately — see this row's own GET notice.");
    }
    let sandbox;
    try {
      sandbox = await createSandboxTenant(db, { liveTenantId: tenantId });
    } catch (err) {
      if (err instanceof SandboxRefused) throw invalid(err.message);
      if (err?.code === "23505") throw conflict("this practice already has a sandbox");
      throw err;
    }
    let counts;
    try {
      counts = await copyConfigurationIntoSandbox(db, { liveTenantId: tenantId, sandboxTenantId: sandbox.id });
    } catch (err) {
      if (err instanceof SandboxRefused) throw invalid(err.message);
      throw err;
    }
    const { rows: [guc] } = await db.query(
      `SELECT NULLIF(current_setting('keystone.operator_grant_id', true), '') AS grant_id`);
    await writeAudit(db, {
      tenantId,
      action: "operator.acted_as",
      object: "sandbox",
      subjectId: sandbox.id,
      reason: `created a sandbox of tenant ${tenantId}`,
      actorOperatorGrantId: guc?.grant_id ?? null,
    });
    // ★ The three shapes CT-069 freezes, returned exactly as `src/sandbox/writes.mjs` produces
    //   them — this route translates a request into a call, it does not reshape the answer.
    return { sandbox, counts };
  }, { status: 201, bucket: "write" }));

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ THE WRITE. `POST /api/settings` — THE TAP TEN SETTINGS HAVE BEEN WAITING FOR.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★ THE ROUTE VALIDATES NOTHING ITSELF. `setSetting` refuses an unknown key and a malformed
  //    value with a SENTENCE written for the operator, and the catalogue is the only place that
  //    decides. A second check here would be a second answer to "is this a setting", and the copy
  //    in the route is the one that drifts.
  // ★ 200, not 201. Setting a value is an UPSERT of a row that conceptually always existed — there
  //   is no new resource to point at, and `ON CONFLICT` means the caller cannot tell which happened.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  // A11.2 / F428 — /tasks/automations.  ★★★ THE ROW ALREADY EXISTED AND WAS MARKED `cut`.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  // ★★★ ITS CUT REASON DESCRIBED THIS SCREEN: *"NO BUILDER AT LAUNCH … Tenants get the automations
  //     we built, switched on or off."* That is exactly what this serves — the switches, never a
  //     builder. So no nav row is invented; the one that exists stops lying about itself.
  //
  // ★★★ TWO DIFFERENT FACTS, AND CONFLATING THEM IS THE WHOLE RISK. `settings` is what THIS
  //     PRACTICE chose. `platform` is n8n's own `active` flag, which no practice controls. A screen
  //     showing only the first would let somebody switch an automation "on" that is off
  //     platform-wide and then wait for messages that never arrive.
  //
  // ★★★ AND `platform: null` MEANS "WE COULD NOT ASK", NOT "EVERYTHING IS OFF". Only
  //     `N8nUnavailable` is caught — the error the client throws for an unreachable or refusing
  //     n8n. **Any other error propagates**, because swallowing it would turn a bug in our own join
  //     into a permanent, silent "service unavailable" nobody would ever investigate.
  app.get("/api/tasks/automations", read("/tasks/automations", async ({ db, tenantId }) => {
    const stored = await getSettings(db);

    // ★ Only the keys this catalogue owns. Returning the whole settings blob would ship unrelated
    //   configuration to a screen that has no use for it.
    const settings = {};
    for (const a of AUTOMATIONS) {
      const k = automationSettingKey(a.key);
      if (stored[k] !== undefined) settings[k] = stored[k];
    }

    let platform = null;
    try {
      // ★★ JOINED BY NAME, NOT BY ID. `workflowStates()` keys on the workflow's name and the
      //    catalogue carries the same name — so no n8n id is stored, cached or shown. An id we
      //    cached would be a second copy of something n8n owns.
      const states = await workflowStates();
      platform = {};
      for (const a of AUTOMATIONS) {
        const w = states.get(a.name);
        // ★ A workflow n8n has never heard of is NOT active. That is a real answer, not a missing
        //   one — it means the platform has not deployed it.
        platform[a.key] = { active: w ? w.active : false };
      }
    } catch (err) {
      if (!(err instanceof N8nUnavailable)) throw err;
      platform = null;
    }

    // ★★★ AUTOMATIONS CATALOG WITH METADATA FOR EACH AUTOMATION. The DataTable expects an array
    //     of automation rows with id, name, trigger, lastRun, deliveredCount, and enabled fields.
    //     ★ `id` uses the automation's catalogue key. ★ `trigger` is the "behaviour" field describing
    //       what the automation does. ★ `week_count` and `month_count` are counts of 'done'-state runs.
    //       ★ `defaultOn` comes from the catalogue.
    let ran_this_month = 0;
    const automations = await Promise.all(AUTOMATIONS.map(async (a) => {
      const { rows: weekRows } = await db.query(
        `SELECT COUNT(*) as count FROM keystone.automation_run
          WHERE tenant_id = $1 AND key = $2 AND state = 'done' AND run_at > now() - interval '7 days'`,
        [tenantId, a.key]);
      const week_count = parseInt(weekRows[0]?.count || 0);

      const { rows: monthRows } = await db.query(
        `SELECT COUNT(*) as count FROM keystone.automation_run
          WHERE tenant_id = $1 AND key = $2 AND state = 'done' AND run_at > now() - interval '30 days'`,
        [tenantId, a.key]);
      const month_count = parseInt(monthRows[0]?.count || 0);
      ran_this_month += month_count;

      return {
        id: a.key,
        name: a.name,
        trigger: a.behaviour,
        behaviour: a.behaviour,
        defaultOn: a.defaultOn,
        week_count,
        month_count,
        enabled: settings[automationSettingKey(a.key)] !== false,
      };
    }));

    return { path: "/tasks/automations", title: "Automations", settings, platform, automations, ran_this_month };
  }));

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // A11.2 / F427 + F428 — /settings/email.  ★★★ WHO A PRACTICE'S MAIL COMES FROM.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  // ★★★ THIS IS THE ROUTE `EmailSettingsPage` HAS NEEDED SINCE A10.5 AND NEVER HAD. The page was
  //     built, closed COMPLETE, and had no read route, no write route, no client method and no nav
  //     row — its routing control called `api.setSenderRouting`, which existed nowhere (F427). A
  //     control that throws `is not a function` is the dead-control defect this codebase has
  //     written more rules against than any other.
  //
  // ★★★ `grant_state` IS READ THROUGH THE REFERENCE AND NEVER MIRRORED. It lives on
  //     `google_identity`; migration 0126 deliberately does not copy it, because two systems
  //     holding one fact means the stale one eventually says a dead mailbox is fine.
  //
  // ★★ ZONE 1 IS ANY USER'S OWN MAILBOX; ZONE 2 (`sender_routing`) IS ADMIN. The route serves both
  //    and `assertRank` is applied to the WRITE, not to the read — a coach may see which address
  //    their practice sends invoices from; they may not change it.
  // ★★★ Task 6.6 / §2.8 — THE FOUR TOPICS `SettingsEmailBroken`'s `waitingCount` COUNTS. One per
  //     routable purpose (`ROUTABLE_PURPOSES`, `src/email/writes.mjs`) — the "N reminders and M
  //     invoices are waiting to send" text is a count of dead-lettered sends for exactly the kinds
  //     of mail a broken mailbox blocks, not every event this tenant has ever emitted.
  const EMAIL_WAITING_TOPICS = Object.freeze([
    "booking.booking.reminder", "documents.document.sent",
    "money.invoice.opened", "money.invoice.paid",
  ]);

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Task 16.58 (CT-F43) — part `email-health`. GET /api/settings/email/health, ONE read behind the
  // broken-email incident screen, the settings-hub chip and the Home prompt, so the three surfaces
  // cannot disagree about whether a practice's email is broken. The floor and wrapper are identical
  // to the sibling GET /api/settings/email immediately below (guarded()`s minRank param is "coach",`
  // matching that route's own call).
  // ───────────────────────────────────────────────────────────────────────────────────────────
  app.get("/api/settings/email/health",
    guarded("/settings/email", "member", async ({ db, tenantId }) =>
      getEmailDomainHealth(db, tenantId), { bucket: "settings" }));

  app.get("/api/settings/email", guarded("/settings/email", "member", async ({ db, tenantId }) => {
    const { rows: identities } = await db.query(
      `SELECT si.id, si.email, si.display_name, si.origin, si.kind, si.verified_at,
              si.google_identity_id,
              -- ★★★ grant_error, NOT last_error. I wrote the column name from migration 0126's
              -- PROSE ("stores the provider's error verbatim") instead of from the schema, and
              -- GET /api/settings/email answered 500: column gi.last_error does not exist, on
              -- every request. MEASURED by dumping information_schema: the column is grant_error,
              -- beside grant_state, grant_failed_at and withdrawn_at.
              -- ★★ This is the rule about dumping the object before claiming its shape, and I
              -- broke it on a table whose migration I had read an hour earlier.
              -- ★ NOTE FOR ANYONE EDITING THIS COMMENT: no backticks. It lives inside a JS
              -- template literal, and a backtick here ends the SQL string mid-query.
              gi.grant_state, gi.grant_error, gi.withdrawn_at, gi.grant_failed_at
         FROM keystone.sender_identity si
         LEFT JOIN keystone.google_identity gi ON gi.id = si.google_identity_id
        ORDER BY si.email`);
    const { rows: routes } = await db.query(
      `SELECT r.purpose, si.email
         FROM keystone.sender_routing r
         JOIN keystone.sender_identity si ON si.id = r.sender_identity_id`);

    // ★ The connected mailbox is the consent-backed identity, if there is one. `origin:'platform'`
    //   is a legitimate sender with NO consent behind it, so it is never reported as a mailbox.
    const consented = identities.filter((i) => i.google_identity_id);
    let waitingCount = 0;
    // ★★★ Task 6.6 / §2.8 — `SettingsEmailBroken`'s banner field. Counts `keystone.event` rows in
    //     the outbound dead-letter state (`status = 'dead'`) since the exact moment this mailbox
    //     stopped being usable — `withdrawn_at` (we disconnected it) or `grant_failed_at` (Google
    //     did). Zero when the mailbox is usable or nothing is connected — not computed, not guessed.
    if (consented.length && consented[0].grant_state && consented[0].grant_state !== "usable") {
      const since = consented[0].withdrawn_at ?? consented[0].grant_failed_at;
      const { rows: waiting } = await db.query(
        `SELECT count(*)::int AS n
           FROM keystone.event
          WHERE tenant_id = $1 AND status = 'dead' AND topic = ANY($2::text[])
            AND ($3::timestamptz IS NULL OR created_at >= $3::timestamptz)`,
        [tenantId, EMAIL_WAITING_TOPICS, since ?? null]);
      waitingCount = waiting[0]?.n ?? 0;
    }
    const mailbox = consented.length === 0 ? null : {
      email: consented[0].email,
      // ★ Task 6.6 — this route only ever connects a Google identity (§2.8's route table has no
      //   Microsoft verify route); `EmailSettingsPage.svelte:114` branches its whole Zone 1 layout
      //   on this field and it was never set, so every connected mailbox rendered the Microsoft
      //   typed-address branch instead of the Google address list. Fixed here, at the one place
      //   this object is built, not guessed at in the screen.
      provider: "google",
      grantState: consented[0].grant_state ?? "usable",
      grantError: consented[0].grant_error ?? null,
      brokenAt: consented[0].withdrawn_at ?? consented[0].grant_failed_at ?? null,
      waitingCount,
      // ★★ EVERY address this consent can send from — see A10.2: enumeration finds only what is
      //    ALREADY configured, so this list is what Google reported and not what we assume.
      addresses: identities.map((i) => ({
        email: i.email, kind: i.kind, origin: i.origin, verified: !!i.verified_at,
      })),
    };

    return {
      path: "/settings/email", title: "Email",
      mailbox,
      routing: Object.fromEntries(routes.map((r) => [r.purpose, r.email])),
      lastChanged: await lastChangedBy(db, tenantId, ["email.mailbox","email.sending_domain"]),
    };
  }, { bucket: "settings" }));

  // ★★★ THE WRITE F427 FOUND MISSING. `sender_routing` is UNIQUE (tenant_id, purpose) — one route
  //     per purpose — so this is an UPSERT, not an insert. Two rows for one purpose would make
  //     "which address sends invoices" a question with two answers.
  //   ★★ IT REFUSES AN UNKNOWN PURPOSE RATHER THAN STORING IT. `auth` is deliberately not a legal
  //      purpose: a sign-in link is a credential and never leaves a tenant-controlled mailbox,
  //      because a broken mailbox would lock everybody out of the thing that fixes it. The CHECK
  //      constraint in 0126 enforces it; this returns the 400 rather than a Postgres error.
  app.post("/api/settings/email/routing",
    guarded("/settings/email", "admin", async ({ db, tenantId, body }) => {
      if (!body || typeof body !== "object") throw invalid("a JSON object body is required");
      try {
        // ★★★ THE SQL LIVES IN `src/email/writes.mjs`, NOT HERE. `write-census` caught this file
        //     writing raw SQL — *"src/routes/settings.mjs WRITES AND IS NOT CLASSIFIED"* — and it
        //     was right: no other domain write in this codebase sits in a route. A route
        //     authorises and translates; a writer writes.
        return await setSenderRouting(db, { tenantId, purpose: body.purpose, email: body.email });
      } catch (err) {
        // ★★ A REFUSAL IS A 400 WITH ITS OWN SENTENCE, never a 500. Same shape as
        //    `PermissionViolation` above — the writer's message names the field and the legal
        //    values, which is the most useful text in the feature.
        if (err instanceof SenderViolation) throw invalid(err.message);
        throw err;
      }
    }, { bucket: "write" }));

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Task 6.6 / 06-settings.md §2.8, §10 item 4 — THE MAILBOX OAUTH ROUND TRIP. `EmailSettingsPage`'s
  // "Connect a mailbox" (dead control #1, `:100-102`) and `SettingsEmailBroken`'s "Reconnect" (no
  // button of its own — reuses this exact flow, §2.8's own table). Same shape as
  // `src/routes/calendar.mjs`'s Google connect/callback pair, which is why these three routes are
  // NOT wrapped in `guarded()`: that wrapper always answers `c.json(...)`, and a 302 redirect
  // wrapped in `c.json` is not a redirect. The same staff/section/rank floor `guarded()` applies is
  // reproduced by hand below, exactly as `calendar.mjs`'s own header explains for the same reason.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  const emailOAuthFloor = async (ctx) => {
    if (!ctx.principal?.platformTenantId && ctx.principal?.user?.role !== "staff") {
      throw forbidden(
        "settings are for staff. Your account is a client of this practice — this is a refusal, " +
        "not an empty form.");
    }
    const isPlatform = await tenantIsPlatform(ctx.db, ctx.tenantId);
    const decision = authoriseSection(ctx.principal.user, "/settings/email", { tenantIsPlatform: isPlatform });
    if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
    atLeastRank(ctx.principal.user, "member");
  };
  const emailRedirectUri = (c) => `${publicOrigin(c)}/api/settings/email/connect/callback`;
  const emailLandingUrl = (c, { connectError } = {}) => {
    const u = new URL("/settings/email", publicOrigin(c));
    if (connectError) u.searchParams.set("connectError", connectError);
    return u.toString();
  };

  // §2.8 — GET /api/settings/email/connect/start → 302 to Google's consent screen.
  // Errors: `invalid` (google_mail_enabled flag off) — §2.8's own table, NOT a redirect for this row.
  app.get("/api/settings/email/connect/start", (c) =>
    runTenantScoped(c, async (ctx) => {
      await emailOAuthFloor(ctx);
      if (!(await flagIsOn(ctx.db, "google_mail_enabled", ctx.tenantId))) {
        throw invalid("Email mailbox connection is not turned on for this practice.");
      }
      const { clientId } = googleClientCredentials();
      const state = signMailboxOAuthState({ tenantId: ctx.tenantId });
      const url = buildMailboxAuthorizeUrl({ clientId, state, redirectUri: emailRedirectUri(c) });
      return found(url);
    }, { bucket: "api" }));

  // §2.8 — GET /api/settings/email/connect/callback ?code=&state= → 302 back to /settings/email.
  // Errors: on failure, 302 back with `?connectError=` the screen renders as a banner.
  app.get("/api/settings/email/connect/callback", (c) =>
    runTenantScoped(c, async (ctx) => {
      await emailOAuthFloor(ctx);
      if (c.req.query("error")) {
        return found(emailLandingUrl(c, { connectError: "google_declined" }));
      }
      let verified;
      try {
        verified = verifyMailboxOAuthState(c.req.query("state"));
      } catch {
        return found(emailLandingUrl(c, { connectError: "invalid_state" }));
      }
      if (verified.tenantId !== ctx.tenantId) {
        return found(emailLandingUrl(c, { connectError: "invalid_state" }));
      }
      const code = c.req.query("code");
      if (!code) return found(emailLandingUrl(c, { connectError: "invalid_state" }));

      const { clientId, clientSecret } = googleClientCredentials();
      let exchanged;
      try {
        exchanged = await exchangeMailboxCode({ code, clientId, clientSecret, redirectUri: emailRedirectUri(c) });
      } catch {
        return found(emailLandingUrl(c, { connectError: "google_unreachable" }));
      }
      try {
        await connectMailbox(ctx.db, {
          tenantId: ctx.tenantId, googleSubject: exchanged.googleSubject, googleEmail: exchanged.googleEmail,
          refreshToken: exchanged.refreshToken, accessToken: exchanged.accessToken,
        });
        await writeAudit(ctx.db, {
          tenantId: ctx.tenantId, action: "settings.changed", object: "email.mailbox",
          actorUserId: ctx.principal.appUserId, reason: null,
        });
      } catch {
        return found(emailLandingUrl(c, { connectError: "google_unreachable" }));
      }
      return found(emailLandingUrl(c));
    }, { bucket: "api" }));

  // §2.8 — POST /api/settings/email/disconnect {} → { disconnected: true }. Idempotent (§2.8's own
  // table: "disconnecting an already-disconnected mailbox is a 200, not an error").
  app.post("/api/settings/email/disconnect", (c) =>
    runTenantScoped(c, async (ctx) => {
      await emailOAuthFloor(ctx);
      const result = await disconnectMailbox(ctx.db, { tenantId: ctx.tenantId });
      await writeAudit(ctx.db, {
        tenantId: ctx.tenantId, action: "settings.changed", object: "email.mailbox",
        actorUserId: ctx.principal.appUserId, reason: null,
      });
      return result;
    }, { bucket: "write" }).then((r) => c.json(r, 200)));

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // C4.3 — /settings/growth (GrowthDomain). Custom domain for Resend email sending.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  // ★★★ THE RESEND SENDING DOMAIN. A practice can view and update the custom domain they use
  //     for sending transactional and marketing emails via Resend. The domain is verified through
  //     the provisioning flow (`src/provisioning/steps/resendDomain.mjs`); this screen lets them
  //     view the current setting and change it if needed.
  app.get("/api/settings/growth", read("/settings", async ({ db }) => {
    const s = await getSettings(db);
    return {
      path: "/settings/growth", title: "Growth domain",
      intro: "The custom domain used for sending your practice's emails.",
      fields: [
        field("email.sending_domain", "Sending domain", s["email.sending_domain"],
          "Your verified Resend sending domain (e.g., mail.yourpractice.com). Until verified, " +
          "emails send from our platform domain with your practice name in the display name.",
          { type: "text" }),
      ],
      writable: true, notice: null,
    };
  }));

  // C4.3 — POST /api/settings/growth { key, value } — update the growth/sending domain setting.
  app.post("/api/settings/growth", (c) =>
    runTenantScoped(c, async ({ db, body, principal, tenantId }) => {
      if (!principal?.platformTenantId && principal?.user?.role !== "staff") throw forbidden("settings are for staff.");
      const isPlatform = await tenantIsPlatform(db, tenantId);
      const decision = authoriseSection(principal.user, "/settings", { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
      await assertMay(db, principal, { object: "setting", action: "edit" });

      const key = body?.key;
      const value = body?.value;

      if (key !== "email.sending_domain") {
        throw invalid(`this route only accepts "email.sending_domain", not "${key}"`);
      }

      try {
        await setSetting(db, { tenantId, key, value, updatedBy: principal.appUserId });
        await writeAudit(db, {
          tenantId, action: "settings.changed", object: "email.sending_domain",
          actorUserId: principal.appUserId, reason: null,
        });
        return { key, value };
      } catch (err) {
        if (err instanceof SettingViolation) throw invalid(err.message);
        throw err;
      }
    }, { bucket: "settings", status: 200 }).then((r) => c.json(r)));

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // ★ EMAIL TEMPLATE OPERATIONS — preview, list, and test-send.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  app.get("/api/settings/email/templates", guarded("/settings/email", "member",
    async () => {
      return { templates: await listEmailTemplates() };
    }, { bucket: "settings" }));

  app.post("/api/settings/email/templates/:key/preview", guarded("/settings/email", "member",
    async ({ db, tenantId, params, body }) => {
      const key = params.key;
      if (!key) throw invalid("template key is required");

      // ★ Render with sample data only, never expose real client information
      const samples = getSampleVars(key);
      const rendered = await (async () => {
        try {
          // ★ FIX, 1 Oct 2026 (Part 2 Addition) — this called the HARDCODED path with no
          //   tx/tenantId, so "Preview" ALWAYS showed the shipped default and never a practice's
          //   own active edit — the preview and what actually sends could disagree, silently,
          //   which is exactly what "the ONE renderer" is supposed to make impossible by
          //   construction (this file's own registry.mjs header). `db` here IS the withTenant
          //   handle `runTenantScoped` already opened for this request.
          return await renderTemplate(key, samples, {}, { tx: db, tenantId });
        } catch (err) {
          throw invalid(`cannot render template "${key}": ${err.message}`);
        }
      })();

      return {
        key,
        subject: rendered.subject,
        text: rendered.text,
        previewOnly: true,
      };
    }, { bucket: "settings" }));

  app.post("/api/settings/email/templates/:key/test-send", guarded("/settings/email", "member",
    async ({ db, tenantId, principal, params, body }) => {
      const key = params.key;
      if (!key) throw invalid("template key is required");

      // ★ Get the caller's email address
      const { rows: user } = await db.query(
        `SELECT email FROM keystone.app_user WHERE id = $1 AND tenant_id = $2`,
        [principal.appUserId, tenantId]);
      if (!user.length || !user[0].email) {
        throw invalid("cannot send test: your email is not configured");
      }
      const recipientEmail = user[0].email;

      // ★ Render with sample data
      const samples = getSampleVars(key);
      let rendered;
      try {
        // ★ FIX, 1 Oct 2026 (Part 2 Addition) — same bug as /preview just above: a test-send always
        //   sent the shipped default, never the practice's own active edit, which is the one thing
        //   "send test" exists to prove works.
        rendered = await renderTemplate(key, samples, {}, { tx: db, tenantId });
      } catch (err) {
        throw invalid(`cannot render template "${key}": ${err.message}`);
      }

      // ★ Create a temporary notification for recording purposes
      const notificationId = (await db.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
      await db.query(
        `INSERT INTO keystone.notification
           (id, tenant_id, recipient_id, event_id, topic, title, body)
         VALUES ($1,$2,$3,NULL,$4,$5,$6)`,
        [notificationId, tenantId, principal.appUserId, "email.test_send",
         `Test: ${key}`, `Testing email template: ${key}`]);

      // ★ Send the email via the notification delivery system
      const { sendNotificationEmail } = await import("../email/send.mjs");
      const outcome = await sendNotificationEmail({
        tenantId, notificationId, to: recipientEmail, templateKey: key,
        vars: samples, terms: {},
      });

      return {
        key,
        sent: outcome.status === "sent" || outcome.status === "delivered",
        status: outcome.status,
        error: outcome.error,
        deliveryId: outcome.deliveryId,
      };
    }, { bucket: "write" }));

  // ★ TY, 2026-09-16 — POST /api/settings/branding/logo  { kind: "sidebar"|"login", dataBase64 }
  app.post("/api/settings/branding/logo", (c) =>
    runTenantScoped(c, async ({ db, body, principal, tenantId }) => {
      if (!principal?.platformTenantId && principal?.user?.role !== "staff") throw forbidden("settings are for staff.");
      const isPlatform = await tenantIsPlatform(db, tenantId);
      const decision = authoriseSection(principal.user, "/settings/branding", { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
      await assertMay(db, principal, { object: "setting", action: "edit" });
      const kind = String(body?.kind ?? "");
      if (!LOGO_KEY[kind]) throw invalid('kind must be "sidebar" or "login"');
      const b64 = String(body?.dataBase64 ?? "");
      if (!b64) throw invalid("no image was sent");
      const buf = Buffer.from(b64, "base64");
      if (buf.length === 0) throw invalid("the image was empty");
      if (buf.length > LOGO_MAX_BYTES) throw invalid(`that image is ${Math.round(buf.length / 1024)} KB after resizing; the limit is 700 KB`);
      const img = sniffImage(buf);
      if (!img) throw invalid("that file is not a PNG, JPG or WebP image");
      const hash = createHash("sha256").update(buf).digest("hex").slice(0, 16);
      const key = objectKey({ tenantId, kind: "brand_logo", id: `${kind}-${hash}.${img.ext}` });
      const put = await putObject({ key, body: buf, contentType: img.type });
      if (!put.ok) throw dependency(`the file store refused the logo: ${put.error}`);
      await setSetting(db, { tenantId, key: LOGO_KEY[kind], value: `ks-object:${key}`,
        updatedBy: principal?.appUserId ?? null });
      // ★ F20.8 — fire-and-forget push to Stripe (failure is logged, never thrown)
      pushBrandingToStripe(db, { tenantId }).catch((err) => {
        console.error("Failed to push branding to Stripe:", err.message);
      });
      return { kind, src: logoSrc(kind, `ks-object:${key}`), saved: true };
    }, { bucket: "write" }).then((r) => c.json(r, 200)));

  // ★ GET /api/settings/branding/logo/:kind — the bytes, for any signed-in person of this practice.
  app.get("/api/settings/branding/logo/:kind", async (c) => {
    const kind = c.req.param("kind");
    const out = await runTenantScoped(c, async ({ db }) => {
      if (!LOGO_KEY[kind]) return null;
      const { rows } = await db.query(
        "SELECT value #>> '{}' AS v FROM keystone.tenant_setting WHERE key = $1", [LOGO_KEY[kind]]);
      const m = LOGO_POINTER.exec(rows[0]?.v ?? "");
      if (!m) return null;
      const got = await getObject({ key: m[1] });
      if (!got.ok) return null;
      return { body: got.body, type: sniffImage(got.body)?.type ?? "application/octet-stream" };
    }, { bucket: "settings" });
    if (!out && c.req.query("probe") === "1") return c.body(null, 204);   // the settings card asks "is there a logo?" without a red 404 in the browser console
    if (!out) return c.json({ error: { kind: "not_found", message: "no logo" } }, 404);
    return c.body(out.body, 200, { "content-type": out.type, "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff" });
  });

  // ★ TY, 2026-09-16 — GET /api/settings/practice/slug-available?slug=
  app.get("/api/settings/practice/slug-available", read("/settings/practice", async ({ db, tenantId, c }) => {
    const { rows } = await db.query("SELECT slug FROM keystone.tenant WHERE id = $1", [tenantId]);
    return slugAvailability(c.req.query("slug"), rows[0]?.slug);
  }));

  // ★ TY, 2026-09-16 — POST /api/settings/practice/slug  { slug }
  app.post("/api/settings/practice/slug", (c) =>
    runTenantScoped(c, async ({ db, body, principal, tenantId }) => {
      if (!principal?.platformTenantId && principal?.user?.role !== "staff") throw forbidden("settings are for staff.");
      const isPlatform = await tenantIsPlatform(db, tenantId);
      const decision = authoriseSection(principal.user, "/settings/practice", { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
      await assertMay(db, principal, { object: "setting", action: "edit" });
      const { rows } = await db.query("SELECT slug FROM keystone.tenant WHERE id = $1", [tenantId]);
      const current = rows[0]?.slug ?? null;
      const a = await slugAvailability(body?.slug, current);
      if (!a.available) throw invalid(a.reason);
      if (a.current) return { slug: a.slug, address: `${a.slug}.${appDomain()}`, changed: false };
      try {
        await db.query("UPDATE keystone.tenant SET slug = $1 WHERE id = $2", [a.slug, tenantId]);
      } catch (err) {
        if (err?.code === "23505") throw invalid("that acronym is already taken");
        throw err;
      }
      // ★★★ STAGE 4 TASK 4 — F505, IN THE SAME TRANSACTION AS THE WRITE (`db` is the tenant
      //     transaction `runTenantScoped` opened — same contract every other `emit(db, …)` call
      //     from a route relies on, e.g. `routes/developer.mjs:191`). Reached ONLY when the slug
      //     actually changed: the two earlier returns above (`a.current` — same value typed back —
      //     and the thrown refusals for a taken/invalid slug) never reach here, so an unchanged or
      //     refused slug emits nothing.
      //   ★★ `subjectType`/`subjectId` are left null. `SUBJECT_TYPES` (topics.mjs) is the fixed
      //      vocabulary and has no `tenant`/`practice` entry — `person`, `account`, `document`, …
      //      are all THINGS INSIDE a tenant, and this fact is about the tenant itself. Inventing one
      //      would be exactly what 02-event-catalogue.md §2 rule 3 closed the vocabulary to prevent;
      //      null is legal for both (emit() explicitly allows "no subject at all") and is the
      //      honest answer here. Recorded as an open question in the task-4 report.
      //   ★ Payload carries the setting KEY and the old/new SLUG only — both closed, bounded token
      //     shapes (`validateSubdomain`: lowercase letters/digits/hyphens, ≤63 chars), never the
      //     practice NAME, which §2.4 bans outright.
      await emit(db, {
        tenantId, topic: "settings.setting.changed", emittedBy: "settings",
        actor: userActor(principal?.appUserId ?? null),
        payload: { key: "practice.slug", old_slug: current, new_slug: a.slug },
      });
      // ★ Task 17.5 — audit the slug change
      await writeAudit(db, {
        tenantId,
        action: "settings.changed",
        object: "practice.slug",
        actorUserId: principal?.appUserId ?? null,
        before: { key: "practice.slug", value: current },
        after: { key: "practice.slug", value: a.slug },
      });
      return { slug: a.slug, address: `${a.slug}.${appDomain()}`,
               url: `https://${a.slug}.${appDomain()}/settings/practice`, changed: true };
    }, { bucket: "write" }).then((r) => c.json(r, 200)));

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ TASK 11.23 (CT-F44) — THE BATCH SETTINGS WRITE. `POST /api/settings` now accepts the
  //     legacy `{key, value}` shape (unchanged, still 200 `{key, value, saved:true}`) AND
  //     `{changes:[{key,value},…], confirm?:{reach:true, tell?:{message}}}`. Every key lands or
  //     none do: the handler body already runs inside `withTenant`'s one `BEGIN`/`COMMIT`
  //     (`src/http/app.mjs`, `src/db/index.mjs`), so atomicity comes from THROWING, never from
  //     opening a second transaction. There is no `continue` in the write loop below — the first
  //     failure throws and carries the per-row states built so far, which unwinds the whole
  //     transaction, including any `settings.setting.changed` events already written to the outbox.
  //   ★ 11.6's write-lock 409 (11-S2) is CARRIED FORWARD UNCHANGED, in the same relative position:
  //     after authorisation, before any write.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  app.post("/api/settings", (c) =>
    runTenantScoped(c, async ({ db, body, principal, tenantId }) => {
      if (!body || typeof body !== "object") throw invalid("a JSON object body is required");

      // ★ CT-F44's reference — the first 8 hex of the request id, falling back to a raw slice when
      //   an inbound `x-request-id` (legally any [A-Za-z0-9._-]{8,128}, errors.mjs) carries fewer
      //   than 8 hex characters.
      const requestId = c.get("requestId");
      const rawRequestId = String(requestId ?? "");
      const hexOnly = rawRequestId.replace(/[^0-9a-f]/gi, "");
      const reference = hexOnly.length >= 8 ? hexOnly.slice(0, 8).toLowerCase() : rawRequestId.slice(0, 8);

      // ── 1/2 — shape discrimination. Batch is Array.isArray(body.changes) and nothing else. ──
      const isBatch = Array.isArray(body.changes);
      if (isBatch && body.key !== undefined) {
        throw invalid("send either one {key, value} or a {changes:[…]} list, not both");
      }
      const changes = isBatch ? body.changes : [{ key: String(body.key ?? ""), value: body.value }];
      if (isBatch) {
        if (changes.length === 0) throw invalid("changes is empty — there is nothing to save");
        if (changes.length > 50) throw invalid("too many changes in one save (max 50)");
        const seen = new Set();
        for (const entry of changes) {
          const k = entry?.key;
          if (seen.has(k)) throw invalid(`"${k}" appears twice in one save`);
          seen.add(k);
        }
      }

      // ── 3 — the logo guard, applied to every key. ──
      // ★ TY, 2026-09-16 — logo settings hold storage pointers and are written ONLY by the upload
      //   route below, so a pointer can never be aimed at another practice's files.
      for (const { key } of changes) {
        if (key === "branding.logo_url" || key === "branding.sidebar_logo") {
          throw invalid("logos are uploaded as files from Settings → Branding, not set as text.");
        }
      }

      // ── 4 — authorisation, unchanged and in today's order. `authoriseSection` runs once PER KEY
      //     because `sectionForKey` resolves a different nav row per prefix and a caller allowed at
      //     `/settings` is not thereby allowed at every section. `assertMay` runs once. ──
      if (!principal?.platformTenantId && principal?.user?.role !== "staff") {
        throw forbidden("settings are for staff.");
      }
      const isPlatform = await tenantIsPlatform(db, tenantId);
      for (const { key } of changes) {
        const decision = authoriseSection(principal.user, sectionForKey(key), { tenantIsPlatform: isPlatform });
        if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
      }
      await assertMay(db, principal, { object: "setting", action: "edit" });

      // ── 5 — 11.6's write-lock, carried forward verbatim, applied per key, immediately after
      //     assertMay (11-S2: a locked key is a refusal ABOUT THE SETTING, and only a caller
      //     already allowed to edit settings may be told about it). ──
      for (const { key } of changes) {
        if (typeof LOCKED_KEYS[key] === "string") {
          const lockedRows = changes.map((entry) => (entry.key === key
            ? { key: entry.key, state: "refused", reason: LOCKED_KEYS[key] }
            : { key: entry.key, state: "not_saved" }));
          throw conflict(LOCKED_KEYS[key], { key, locked: true, rows: lockedRows, reference });
        }
      }

      // ── 6 — the reach gate, once for the whole list, before any write. Returns the reach keys
      //     that actually differ, for step 8's "tell" below. ──
      const reachChanges = await assertReachConfirmed(db, { tenantId, changes, confirm: body.confirm });

      // ── 7 — the loop. NO continue: the first SettingViolation throws with the per-row states
      //     built so far; anything else is re-thrown untouched. ──
      const outRows = [];
      for (let i = 0; i < changes.length; i += 1) {
        const { key, value } = changes[i];
        try {
          const row = await setSetting(db, { tenantId, key, value, updatedBy: principal?.appUserId ?? null });
          outRows.push({ key, value: row.value, state: "saved" });
        } catch (err) {
          if (!(err instanceof SettingViolation)) throw err;
          const failRows = changes.map((entry, j) => (j < i ? outRows[j]
            : j === i ? { key: entry.key, state: "refused", reason: err.message }
              : { key: entry.key, state: "not_saved" }));
          throw invalid(err.message, { rows: failRows, reference });
        }
      }

      // ── 8 — confirm.tell, AFTER the loop, still inside the same transaction: a failure here
      //     rolls the settings back, and a failure in step 7 already skipped this entirely. Once
      //     per reach key that actually changed — never a non-reach key, never an unchanged one. ──
      if (body.confirm && typeof body.confirm.tell === "object" && body.confirm.tell !== null) {
        for (const { key, from, to } of reachChanges) {
          await announceChange(db, {
            tenantId, key, from, to, message: body.confirm.tell.message,
            actorUserId: principal?.appUserId ?? null,
          });
        }
      }

      // ── 9 — return. Legacy shape unchanged; batch gets {saved, rows}. Status stays 200. ──
      if (isBatch) return { saved: true, rows: outRows };
      return { key: outRows[0].key, value: outRows[0].value, saved: true };
    }, { bucket: "write" }).then((r) => c.json(r, 200)));

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 6.12 — `/settings/sign-in`. Every staff rank reaches this row (`guarded(..., "coach", ...)`,
  // not `read()`, which hard-codes "admin"): a Coach's own device list is not a settings-wide
  // permission and the `authoriseSection` check above still refuses a Coach at `/settings/practice`.
  // ★★★ THE SCOPING RULE, APPLIED TO ALL THREE: a caller may only ever act on THEIR OWN sessions.
  //     The person is `principal.appUserId`, taken from the resolved session (P13.6, above) — never
  //     from the body, and there is no "whose sessions" parameter anywhere below. This is what
  //     makes 6.4/6.5's `p_app_user_id` argument safe at the route layer: the SQL guard covers the
  //     tenant, this covers the person.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  const SIGN_IN_SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  app.get("/api/settings/sign-in", guarded("/settings/sign-in", "member", async ({ db, tenantId, principal }) => {
    const sessions = await listSessionsForUser(db, tenantId, principal.appUserId, principal.tokenId);
    return { sessions };
  }, { bucket: "settings" }));

  // ★ Revoking the CURRENT session is allowed — a person may remove the device they are holding;
  //   the screen reloads and the next request 401s. ★ A `sessionId` belonging to someone else
  //   returns `{ revoked:false }`, never 404/403 — the same non-oracle discipline as logout.
  app.post("/api/settings/sign-in/revoke",
    guarded("/settings/sign-in", "member", async ({ db, tenantId, body, principal }) => {
      const sessionId = String(body?.sessionId ?? "");
      if (!SIGN_IN_SESSION_ID_RE.test(sessionId)) throw invalid("sessionId must be a UUID", { field: "sessionId" });
      return await revokeSessionById(db, tenantId, principal.appUserId, sessionId, "device_removed");
    }, { bucket: "write" }));

  // ★ Practice-scoped (spec 04 §3 default 5): ends this person's OTHER sessions in THIS practice
  //   only. `exceptTokenId` is the caller's own live token, so the browser making the request stays
  //   signed in. The "everywhere, across practices" variant is `revokeSessionsForUid`, which no
  //   route exposes here — recorded rather than half-built.
  app.post("/api/settings/sign-in/revoke-all",
    guarded("/settings/sign-in", "member", async ({ db, tenantId, principal }) => {
      return await revokeSessionsForUser(db, tenantId, principal.appUserId, "device_removed",
        { exceptTokenId: principal.tokenId });
    }, { bucket: "write" }));

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Task 17.20 — SETTINGS MINE: OWN PROFILE, PHOTO, LASTCHANGED, NOTIFICATION ROWS (F710)
  // ───────────────────────────────────────────────────────────────────────────────────────────
  app.get("/api/settings/mine", guarded("/settings/mine", "member", async ({ db, tenantId, principal }) => {
    const appUserId = principal.appUserId;

    // Get the user's own profile
    const { rows: userRows } = await db.query(
      `SELECT display_name, photo_url, bio, booking_slug FROM keystone.app_user WHERE id = $1`,
      [appUserId]
    );
    const user = userRows[0] || {};

    // ★ FIX — this read `${appDomain()}/book/${principal.user.slug}`, but `principal.user`
    //   (src/http/app.mjs:915) never carries a `.slug` field, so this always rendered
    //   ".../book/undefined". A personal booking link lives on the PRACTICE'S OWN subdomain
    //   (same pattern as src/routes/practiceLinks.mjs), keyed by the person's OWN booking_slug
    //   (src/booking/bookingLinks.mjs), never a value that does not exist on the principal.
    const { rows: tenantSlugRows } = await db.query(
      `SELECT slug FROM keystone.tenant WHERE id = $1`, [tenantId]
    );
    const tenantSlug = tenantSlugRows[0]?.slug ?? null;
    const bookingLink = (tenantSlug && user.booking_slug)
      ? `${tenantSlug}.${appDomain()}/book/${user.booking_slug}`
      : null;

    // Get notification preferences (explicit overrides only)
    const { rows: prefRows } = await db.query(
      `SELECT topic, channel, enabled FROM keystone.notification_preference
        WHERE tenant_id = $1 AND app_user_id = $2`,
      [tenantId, appUserId]
    );

    // Get device tokens (push registrations)
    const { rows: devRows } = await db.query(
      `SELECT id, platform, registered_at, last_seen_at FROM keystone.device_token
        WHERE tenant_id = $1 AND app_user_id = $2
        ORDER BY last_seen_at DESC`,
      [tenantId, appUserId]
    );

    // Get last change timestamp for own profile settings
    const { rows: auditRows } = await db.query(
      `SELECT ae.at FROM keystone.audit_entry ae
        WHERE ae.tenant_id = $1 AND ae.action = 'settings.changed' AND ae.subject_id = $2
        ORDER BY ae.at DESC LIMIT 1`,
      [tenantId, appUserId]
    );

    return {
      about: {
        displayName: user.display_name || "",
        photoSrc: user.photo_url || null,
        bio: user.bio || "",
        bookingLink,
      },
      work: {
        href: "/people/scheduling",
        lastChanged: auditRows[0] ? { at: auditRows[0].at } : null,
      },
      reaches: {
        devices: devRows.map(r => ({
          id: r.id,
          platform: r.platform,
          registeredAt: r.registered_at,
          lastSeenAt: r.last_seen_at,
        })),
        preferences: prefRows,
        quietAfter: null,
      },
      lastChanged: auditRows[0] ? { at: auditRows[0].at } : null,
    };
  }, { bucket: "settings" }));

  app.post("/api/settings/mine", guarded("/settings/mine", "member", async ({ db, tenantId, principal, body }) => {
    const appUserId = principal.appUserId;
    const displayName = body?.displayName ? String(body.displayName).slice(0, 80) : null;
    const bio = body?.bio ? String(body.bio).slice(0, 280) : null;

    if (displayName !== null || bio !== null) {
      const updates = [];
      const params = [];
      let paramIndex = 1;

      if (displayName !== null) {
        updates.push(`display_name = $${paramIndex}`);
        params.push(displayName);
        paramIndex++;
      }
      if (bio !== null) {
        updates.push(`bio = $${paramIndex}`);
        params.push(bio);
        paramIndex++;
      }

      await db.query(
        `UPDATE keystone.app_user SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
        [...params, appUserId]
      );

      await writeAudit(db, {
        tenantId,
        object: "me.profile",
        action: "settings.changed",
        subjectId: appUserId,
        actorUserId: appUserId,
      });
    }

    return { saved: true };
  }, { bucket: "write" }));

  app.post("/api/settings/mine/photo", guarded("/settings/mine", "member", async ({ db, tenantId, principal, body }) => {
    const appUserId = principal.appUserId;
    const b64 = String(body?.dataBase64 ?? "");
    if (!b64) throw invalid("no image was sent");
    const buf = Buffer.from(b64, "base64");
    if (buf.length === 0) throw invalid("the image was empty");
    if (buf.length > LOGO_MAX_BYTES) throw invalid(`that image is ${Math.round(buf.length / 1024)} KB; the limit is 700 KB`);
    const img = sniffImage(buf);
    if (!img) throw invalid("that file is not a PNG, JPG or WebP image");
    const hash = createHash("sha256").update(buf).digest("hex").slice(0, 16);
    const key = objectKey({ tenantId, kind: "staff_photo", id: `${appUserId}-${hash}.${img.ext}` });
    const put = await putObject({ key, body: buf, contentType: img.type });
    if (!put.ok) throw dependency(`the file store refused the photo: ${put.error}`);

    await db.query(
      `UPDATE keystone.app_user SET photo_url = $1 WHERE id = $2`,
      [`ks-object:${key}`, appUserId]
    );

    await writeAudit(db, {
      tenantId,
      object: "me.profile",
      action: "settings.changed",
      subjectId: appUserId,
      actorUserId: appUserId,
    });

    return { saved: true, photoSrc: `/api/settings/mine/photo/${appUserId}` };
  }, { bucket: "write" }));

  app.get("/api/settings/mine/photo/:userId", async (c) => {
    const userId = c.req.param("userId");
    const out = await runTenantScoped(c, async ({ db, principal }) => {
      // Any signed-in staff member can read any staff photo from their practice
      if (!principal?.user?.id || principal?.user?.role !== "staff") return null;

      const { rows } = await db.query(
        `SELECT photo_url FROM keystone.app_user WHERE id = $1`,
        [userId]
      );
      const photoUrl = rows[0]?.photo_url;
      if (!photoUrl) return null;

      // Extract the storage key from the ks-object pointer
      const m = /^ks-object:(.+)$/.exec(photoUrl);
      if (!m) return null;

      const got = await getObject({ key: m[1] });
      if (!got.ok) return null;
      return { body: got.body, type: sniffImage(got.body)?.type ?? "application/octet-stream" };
    }, { bucket: "settings" });

    if (!out) return c.json({ error: { kind: "not_found", message: "no photo" } }, 404);
    return c.body(out.body, 200, { "content-type": out.type, "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff" });
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Task 6.7 — MY NOTIFICATION PREFERENCES. The caller's own explicit personal overrides, read
  // from the notification_preference table. Tier 1 of the three-tier fallback in
  // getEffectiveChannels() (`src/notifications/rules.mjs`). Returns only the ROWS that exist
  // (explicit overrides); the UI handles displaying "using practice default" when no row exists
  // for a topic-channel pair.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  app.get("/api/notifications/my-preferences", guarded("/settings/sign-in", "member", async ({ db, tenantId, principal }) => {
    const { rows } = await db.query(
      `SELECT topic, channel, enabled FROM keystone.notification_preference
        WHERE tenant_id = $1 AND app_user_id = $2`,
      [tenantId, principal.appUserId]);
    return { userId: principal.appUserId, preferences: rows };
  }, { bucket: "settings" }));

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // P6.62 — CHANGE ONE GRANT.  `POST /api/settings/roles/permission`
  // ───────────────────────────────────────────────────────────────────────────────────────────
  // ★★★ SCOPE IS NON-NULLABLE IN THE UI AS WELL AS THE SCHEMA, and this route is where that stops
  //     being a claim: it passes `scope` through to `setRolePermission`, which validates the pair
  //     against `validateGrant` and then against `role_permission_coherent` in Postgres. Two
  //     refusals for one rule, deliberately — the database makes it TRUE and the module makes it
  //     READABLE.
  // ★★ `OWNERLESS_OBJECTS` IS EXPORTED FOR THIS SCREEN AND FOR NOTHING ELSE. `objects.mjs` said so
  //    in advance: *"P6.62 will need it, to grey out the scope dropdown for `setting` on the roles
  //    screen; it gets exported THEN, with its caller."* This is that caller.
  // ★★★ Task 1.3 — SHARED READ, TWO DOORS. `loadRolesView` is the exact body the pre-existing
  //     `GET /api/settings/roles` route always had (plus the additive `actions` field below), now
  //     extracted so `GET /api/settings/roles/presets` — TeamRoles's own dedicated read path,
  //     required by `db/gates/p6_build_state_map.mjs`'s route-backing convention for a nav row
  //     marked "built" — can serve the IDENTICAL data without a second, drifting copy of the SQL.
  //     Both routes stay `authoriseSection`'d against the same `"/settings/roles"` navPath, so the
  //     security floor (`read()`'s own guard) is unchanged for either door.
  async function loadRolesView(db) {
    const docustay = (await db.query(`SELECT product FROM keystone.tenant WHERE id = keystone.current_tenant_id()`)).rows[0]?.product === "docustay";
    const { rows: roles } = await db.query(
      `SELECT r.id, r.key, r.label, r.is_builtin, r.rank,
              (SELECT count(*)::int FROM keystone.user_role ur WHERE ur.role_id = r.id) AS members,
              (SELECT count(*)::int FROM keystone.user_role WHERE role_id = r.id) AS member_count,
              (NOT r.is_builtin AND r.personal_for_user_id IS NULL) AS is_custom
         FROM keystone.role r WHERE r.personal_for_user_id IS NULL ORDER BY r.is_builtin DESC, r.label`);
    const { rows: grants } = await db.query(
      `SELECT role_id, object, verb, scope FROM keystone.role_permission ORDER BY object`);
    // ★★★ Task 1.3 — `actions` ADDED (additive, no existing field touched). TeamRoles's four
    //     plain-language "action" switches (add new clients, send documents, waive charges, manage
    //     billing, remove team members) need to draw their CURRENT on/off state, and there is no
    //     other route that carries `keystone.role_action` rows to the browser. 01-team-and-roles.md
    //     §2 calls this GET's response "unchanged" — that describes the fields it already reasoned
    //     about (`roles`/`vocabulary`/`notice`); it does not anticipate the four action-backed
    //     switches this same section's table adds two rows later. Kept as one extra key per role
    //     rather than a second GET, for the same reason `grants` merges onto `roles` above: one
    //     screen, one read.
    const { rows: actions } = await db.query(
      `SELECT role_id, action FROM keystone.role_action ORDER BY action`);
    // ★★★ RP.1 — The editor reads legal scopes from the database (RX-9). Query permission_object
    //     for each object with its metadata so the roles editor knows which scopes are valid for
    //     each object (e.g., ownerless objects can only use "none" or "everything").
    const { rows: objectMetadata } = await db.query(
      `SELECT key, label, ownable, scopes FROM keystone.permission_object ORDER BY key`);
    return {
      path: "/settings/roles", title: "Roles and permissions",
      roles: roles.map((r) => ({
        ...r,
        // a Docustay workspace says Owner / Admin / Member in Docustay's own words (the stored label of a built-in role is the platform's: "Coach")
        ...(docustay && r.is_builtin && ROLE_WORDS[r.key] ? { label: ROLE_WORDS[r.key].label, description: ROLE_WORDS[r.key].description } : {}),
        grants: grants.filter((g) => g.role_id === r.id),
        actions: actions.filter((a) => a.role_id === r.id).map((a) => a.action),
      })),
      vocabulary: { objects: objectMetadata, verbs: VERBS, scopes: SCOPES, ownerless: OWNERLESS_OBJECTS },
      writable: true,
      // ★★★ THE SENTENCE THAT MAKES AN EMPTY GRID READABLE, AND IT IS A SECURITY STATEMENT.
      //     [MEASURED 2026-09-15] `role`, `role_permission` and `user_role` are EMPTY in every one
      //     of the 26 tenants in this database, including the reference practice. While that is
      //     true, `keystone.scope_not_yet_configured()` (0075/0078) hands every staff member
      //     TENANT-WIDE access on every list — so an empty grid does not mean "nobody may do
      //     anything", it means the opposite, and a screen that showed nothing would say the
      //     dangerous thing by omission.
      notice: roles.length === 0
        ? "No roles are configured in this practice. Until at least one role exists, every staff " +
          "member is treated as having tenant-wide access — the transitional fallback that keeps " +
          "an un-backfilled practice working. An empty list here is not a locked door."
        : null,
    };
  }

  app.get("/api/settings/roles", read("/settings/roles", async ({ db }) => loadRolesView(db)));

  // ★ Task 1.3 — TeamRoles's own dedicated read path. Same data, same authorisation floor, a
  //   second door so `/settings/roles/presets` can be marked "built" in `src/nav/buildState.mjs`
  //   without `db/gates/p6_build_state_map.mjs` calling it a lie.
  app.get("/api/settings/roles/presets", read("/settings/roles", async ({ db }) => loadRolesView(db)));

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ SELF-ESCALATION GUARD (01-team-and-roles.md §4, task 1.3). An Admin may change a Coach's
  //     grants but never their own, another Admin's, or the Owner's — the grant that decides
  //     "may bill" must never be reachable by escalating through this very screen. Shared by
  //     `/permission` and `/action` below (both take a `roleId`). The Owner is exempt: the
  //     practice's one Owner (0188) may edit any role, including their own — nothing above them
  //     could escalate INTO.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  async function refuseSelfEscalation(db, tenantId, principal, roleId) {
    const callerRank = effectiveRank(principal.user);
    if (callerRank === "owner") return;
    const { rows } = await db.query(
      `SELECT key FROM keystone.role WHERE tenant_id = $1 AND id = $2`, [tenantId, roleId]);
    const targetKey = rows[0]?.key ?? null;
    if (targetKey && (targetKey === "owner" || targetKey === callerRank)) {
      throw forbidden(`only the Owner may change the "${targetKey}" role's permissions`);
    }
  }

  app.post("/api/settings/roles/permission",
    guarded("/settings/roles", "admin", async ({ db, body, principal, tenantId }) => {
      if (!body || typeof body !== "object") throw invalid("a JSON object body is required");
      await refuseSelfEscalation(db, tenantId, principal, body.roleId);
      try {
        return await setRolePermission(db, {
          tenantId, roleId: body.roleId, object: body.object, verb: body.verb, scope: body.scope,
          actorId: principal?.appUserId ?? null,
        });
      } catch (err) {
        // ★★★ A REFUSAL IS A 400 WITH ITS OWN SENTENCE, NEVER A 500 — and this route was the one
        //     place in this file that forgot it. `POST /api/settings` already does exactly this for
        //     `SettingViolation` (see above); `PermissionViolation` is the same kind of object and
        //     was reaching the error layer unhandled.
        //   ★★ [EXECUTED] `db/gates/p21c_route_role_matrix.mjs` walks every route with a probe body
        //      and reported `5xx / THROW — POST /api/settings/roles/permission as super_admin → 500`
        //      for EVERY role, on a message that reads
        //      `"undefined" is not a permission object — the eleven are …`. That sentence is a
        //      perfectly good 400: it names the field and lists the legal values. Returned as a 500
        //      it reads as a broken server, and a screen showing it says the product is down rather
        //      than that the request was wrong.
        if (err instanceof PermissionViolation) throw invalid(err.message);
        throw err;
      }
    }, { status: 200, bucket: "write" }));

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Task 1.3 — CHANGE ONE NAMED ACTION.  `POST /api/settings/roles/action`  { roleId, action, granted }
  // ───────────────────────────────────────────────────────────────────────────────────────────
  // ★ Same guard shape as `/permission` above: `setRoleAction` validates `action` against
  //   `NAMED_ACTIONS`, and the self-escalation guard refuses an Admin granting themselves (or
  //   another Admin, or the Owner) anything — including `setting.billing`, Owner-only per 05 §4.
  app.post("/api/settings/roles/action",
    guarded("/settings/roles", "admin", async ({ db, body, principal, tenantId }) => {
      if (!body || typeof body !== "object") throw invalid("a JSON object body is required");
      if (!NAMED_ACTIONS.includes(body.action)) {
        throw invalid(`"${body.action}" is not a named action — the thirteen are ${NAMED_ACTIONS.join(", ")}`);
      }
      await refuseSelfEscalation(db, tenantId, principal, body.roleId);
      try {
        return await setRoleAction(db, {
          tenantId, roleId: body.roleId, action: body.action, granted: !!body.granted,
          actorId: principal?.appUserId ?? null,
        });
      } catch (err) {
        if (err instanceof PermissionViolation) throw invalid(err.message);
        throw err;
      }
    }, { status: 200, bucket: "write" }));

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Task 1.3 — RESET A BUILT-IN ROLE TO ITS SHIPPED PRESET.  `POST /api/settings/roles/reset`  { roleId }
  // ───────────────────────────────────────────────────────────────────────────────────────────
  // ★ `TeamRolesAdvanced`'s "Reset to presets" button (01-team-and-roles.md §2 — "this spec's only
  //   change to this screen is C1's fix ... plus one addition: a 'Reset to presets' button").
  //   404s for a role this practice has no preset for (custom role, or an id that resolves to
  //   nothing) rather than a 400 — there is nothing wrong with the REQUEST, the role just is not
  //   one of the three shipped ones.
  app.post("/api/settings/roles/reset",
    guarded("/settings/roles", "admin", async ({ db, body, principal, tenantId }) => {
      if (!body || typeof body !== "object") throw invalid("a JSON object body is required");
      await refuseSelfEscalation(db, tenantId, principal, body.roleId);
      try {
        const role = await resetRoleToPreset(db, {
          tenantId, roleId: body.roleId, actorId: principal?.appUserId ?? null,
        });
        return { role };
      } catch (err) {
        // ★ 404, not 400 — nothing is wrong with the REQUEST; the role just is not one of the
        //   three shipped presets (a custom role, or an id that resolves to nothing).
        if (err instanceof PermissionViolation) throw notFound(err.message);
        throw err;
      }
    }, { status: 200, bucket: "write" }));

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // RP.2 — CREATE A CUSTOM ROLE.  `POST /api/settings/roles/create`  { label, basedOn }
  // ───────────────────────────────────────────────────────────────────────────────────────────
  app.post("/api/settings/roles/create", guarded("/settings/roles", "admin", async ({ db, tenantId, body, principal }) => {
    if (!body || typeof body !== "object") throw invalid("a JSON object body is required");
    await refuseSelfEscalation(db, tenantId, principal, body.basedOn);
    try {
      return await createCustomRole(db, { tenantId, label: body.label, basedOn: body.basedOn, actorUserId: principal.appUserId });
    } catch (err) {
      if (err instanceof PermissionViolation) throw invalid(err.message);
      throw err;
    }
  }, { status: 200, bucket: "write" }));

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // RP.2 — RENAME A CUSTOM ROLE.  `POST /api/settings/roles/rename`  { roleId, label }
  // ───────────────────────────────────────────────────────────────────────────────────────────
  app.post("/api/settings/roles/rename", guarded("/settings/roles", "admin", async ({ db, tenantId, body, principal }) => {
    if (!body || typeof body !== "object") throw invalid("a JSON object body is required");
    await refuseSelfEscalation(db, tenantId, principal, body.roleId);
    try {
      return await renameCustomRole(db, { tenantId, roleId: body.roleId, label: body.label });
    } catch (err) {
      if (err instanceof PermissionViolation) throw invalid(err.message);
      throw err;
    }
  }, { status: 200, bucket: "write" }));

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // RP.2 — DELETE A CUSTOM ROLE.  `POST /api/settings/roles/delete`  { roleId }
  // ───────────────────────────────────────────────────────────────────────────────────────────
  app.post("/api/settings/roles/delete", guarded("/settings/roles", "admin", async ({ db, tenantId, body, principal }) => {
    if (!body || typeof body !== "object") throw invalid("a JSON object body is required");
    await refuseSelfEscalation(db, tenantId, principal, body.roleId);
    try {
      return await deleteCustomRole(db, { tenantId, roleId: body.roleId });
    } catch (err) {
      if (err instanceof PermissionViolation) throw invalid(err.message);
      throw err;
    }
  }, { status: 200, bucket: "write" }));

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // RP.2 — SET ONE MEMBER'S PERMISSION ON ONE OBJECT (create/override).
  // `POST /api/settings/members/permission`  { userId, object, verb, scope }
  // ───────────────────────────────────────────────────────────────────────────────────────────
  app.post("/api/settings/members/permission", guarded("/settings/roles", "admin", async ({ db, tenantId, body, principal }) => {
    if (!body || typeof body !== "object") throw invalid("a JSON object body is required");
    // ★ Prevent Admin from editing their own member row (unless they are Owner).
    const callerRank = effectiveRank(principal.user);
    if (body.userId === principal.appUserId && callerRank !== "owner") {
      throw forbidden(`only the Owner may change the "${callerRank}" role's permissions`);
    }
    try {
      return await setMemberPermission(db, { tenantId, userId: body.userId, object: body.object, verb: body.verb, scope: body.scope });
    } catch (err) {
      if (err instanceof PermissionViolation) throw invalid(err.message);
      throw err;
    }
  }, { status: 200, bucket: "write" }));

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // RP.2 — SET ONE MEMBER'S NAMED ACTION (create/override).
  // `POST /api/settings/members/action`  { userId, action, granted }
  // ───────────────────────────────────────────────────────────────────────────────────────────
  app.post("/api/settings/members/action", guarded("/settings/roles", "admin", async ({ db, tenantId, body, principal }) => {
    if (!body || typeof body !== "object") throw invalid("a JSON object body is required");
    // ★ Prevent Admin from editing their own member row (unless they are Owner).
    const callerRank = effectiveRank(principal.user);
    if (body.userId === principal.appUserId && callerRank !== "owner") {
      throw forbidden(`only the Owner may change the "${callerRank}" role's permissions`);
    }
    try {
      return await setMemberAction(db, { tenantId, userId: body.userId, action: body.action, granted: body.granted });
    } catch (err) {
      if (err instanceof PermissionViolation) throw invalid(err.message);
      throw err;
    }
  }, { status: 200, bucket: "write" }));

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // RP.2 — RESET ONE MEMBER'S PERMISSIONS TO THEIR BASE ROLE.
  // `POST /api/settings/members/reset`  { userId }
  // ───────────────────────────────────────────────────────────────────────────────────────────
  app.post("/api/settings/members/reset", guarded("/settings/roles", "admin", async ({ db, tenantId, body, principal }) => {
    if (!body || typeof body !== "object") throw invalid("a JSON object body is required");
    // ★ Prevent Admin from editing their own member row (unless they are Owner).
    const callerRank = effectiveRank(principal.user);
    if (body.userId === principal.appUserId && callerRank !== "owner") {
      throw forbidden(`only the Owner may change the "${callerRank}" role's permissions`);
    }
    try {
      return await resetMemberPermissions(db, { tenantId, userId: body.userId });
    } catch (err) {
      if (err instanceof PermissionViolation) throw invalid(err.message);
      throw err;
    }
  }, { status: 200, bucket: "write" }));
}

// ★★ NO `SETTINGS_ROUTES` EXPORT. One was written here — a frozen array of the ten paths, "so a
//    gate can enumerate what this file serves without importing the server" — and `db/gates/wiring.mjs`
//    correctly named it an orphan: nothing imported it, not even the gate it was written for, which
//    enumerates `app.routes` AT RUNTIME instead and is stronger for it. `src/permissions/objects.mjs`
//    states the rule this violated: an export arrives WITH ITS CALLER, never one phase early on the
//    strength of an intention. Deleted rather than kept for a consumer that may never exist.
