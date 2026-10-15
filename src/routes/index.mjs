// P12.10 / P12.11 / P12.12 — THE FIRST ROUTE MODULES.
//
// ★★★ SCOPE, STATED, SO IT IS NOT MISREAD AS A GAP. P12.12 says route modules for the ✅ rows of
// Part B **ONLY**, and [MEAS] that is FOUR of 75 rows: /settings/notifications,
// /settings/integrations, /platform/tenants, /platform/provisioning. Everything else in Part B is
// ⚠️ — the table exists and NO READ QUERY EXISTS ANYWHERE IN src/. Writing those queries is
// PHASE 15's work, not this phase's, and inventing them here would hide how much is missing.
//
// ★★ THE NAV IS DATA AND THIS FILE DOES NOT HOLD A COPY OF IT. The renderer walks navTree();
// sections.mjs is the single source. "A second copy of the nav is how the PIR portal ended up
// with two disagreeing label tables" — P4.10, measured.

import { navTree, SECTIONS } from "../nav/sections.mjs";
import { resolveTerms } from "../terminology/resolve.mjs";
import { customFieldValues } from "../fields/custom.mjs";
import { hiddenPanelKeys } from "../fields/layers.mjs";
// ★ P15C.6 — the seven axes' vocabularies, from the ONE place they are declared (vocabulary.mjs, whose
//   agreement with the database's CHECK constraints is asserted by db/gates/p6_vocabulary_agreement.mjs
//   in BOTH directions). The route ships them so no UI can offer a value the database would refuse.
import {
  SIGNER_CONFIGS, AUDIENCES, DIVISIONS, APPLIES_TO, ASSIGNMENT_TARGETS,
} from "../documents/frontDoor.mjs";
import { visibleSections, authoriseSection, knownPaths, effectiveRank } from "../nav/authorise.mjs";
import { buildRecordShell, RECORD_TYPES } from "../records/shell.mjs";
// ★ Task 12.11 — the `personTabs` object on `GET /api/records/person/:id`'s return, ONLY.
import { personRecordTabs } from "../people/recordTabs.mjs";
import { RECORD_QUERIES, RELATED_QUERIES, ACTIVITY_SQL, ACTIVITY_SUBJECT } from "../records/queries.mjs";
// ★ Stage 7 / 7.15, F597's resolution — the ONE execution point a private read can be audited from.
//   See the note at the `GET /api/records/:type/:id` handler below.
import { auditPrivateRead, writeAudit } from "../permissions/audit.mjs";
// ★ Task 1.4 / CT-112 — TeamSeeAs's own gate (`person: view` at `everything` scope, spec §4) and
//   its session-claim writes. `enterViewingAs`/`exitViewingAs` are the SAME thin-wrapper style
//   `upgradeSession` already uses (src/auth/session.mjs) — parse the RAW presented token this
//   route already holds on `principal.sessionId` (src/auth/install.mjs's `resolvePrincipal`: "the
//   SESSION TOKEN is what travels"), never a second network round trip.
import { assertMay } from "../permissions/assertMay.mjs";
import { enterViewingAs, exitViewingAs } from "../auth/session.mjs";
// ★ Task 12.29 — TeamSeeAs's own summary route. `effectiveGrants` is the SAME reader
//   `allows()`/`scopeAllows()` (src/permissions/resolve.mjs) build on, so the can/cannot table is
//   read from the identical grant rows the enforcement path itself consults — never a second,
//   drifting copy of "what does this role allow". `verbRank`/`scopeRank` let the route pick the
//   WIDEST grant per object for display, the same ranking `allows()` already uses to compare.
import { effectiveGrants, permissionSummary } from "../permissions/resolve.mjs";
import { verbRank, scopeRank } from "../permissions/objects.mjs";
// ★ Task 1.5 (01-team-and-roles.md §2/§3/§4/§13) — TeamRemove's two writers, one preview read and
//   one one-transaction write. See src/people/offboard.mjs's own header for why no migration and no
//   new AUDIT_ACTIONS/topics member were added.
import { getOffboardPreview, offboardTeamMember, suspendTeamMember, reactivateTeamMember } from "../people/offboard.mjs";
// ★ D6 [TY, RULED 23 Sep 2026] — deliberately its own file, not `people/writes.mjs`: see
//   `preferences.mjs`'s own header for why this one write is not event-emitting.
import { setSidebarCollapsed, setDensity, setCalendarPreferences } from "../people/preferences.mjs";
// ★ Task 12.14 — ONE function for seat usage, so this route and `src/routes/writes.mjs`'s
//   invite-cap check can never disagree about what "used" means.
import { teamSeatUsage } from "../people/seats.mjs";
// ★ Task 12.17 — `portalStatus`'s FIRST real caller (the wiring ratchet drops by one orphan): the
//   ONE decision point over the three raw facts `src/records/lists/people.mjs`'s `PORTAL` constant
//   selects. See the `GET /api/list/*` handler below, just before its `return`.
import { portalStatus } from "../people/portalStatus.mjs";
// ★★★ P5.11 — `scoped` is the SAME per-object visibility predicate the 29 list views use.
//     Global search must never grow its own; see the route for why.
import { LIST_VIEWS, HOME_TILES, HOME_TODAY_SQL, HOME_NEEDS_YOU_SQL, HOME_WEEK_SQL, HOME_TEAM_TODAY_SQL, HOME_HERO_SQL, HOME_STAFF_PEOPLE_SQL, scoped as scopePredicate } from "../records/lists.mjs";
import { permissionObjectFor } from "../permissions/ownership.mjs";
// ★ P17.2 — the build state travels with the nav. See the note at the /api/nav return.
import { stateFor, COUNTS } from "../nav/buildState.mjs";
import { renderableCapabilities } from "../provisioning/capabilities.mjs";
import { buildOnboardingChecklist } from "../provisioning/onboardingChecklist.mjs";
// ★ 5.4 — `AppError` + `ErrorKind` so a paging refusal can carry 5.1's `fields` (`invalid()` takes none).
import { notFound, forbidden, invalid, internal, conflict, unauthenticated, AppError, ErrorKind } from "../http/errors.mjs";
// ★ P18.9 — the retrieve half of "store and retrieve a real PDF". It verifies the sha256 recorded
//   at archive time before serving a single byte; see the route at the bottom of this file.
import { fetchArchivedPdf } from "../documents/frontDoor.mjs";
import { searchInstances, unsignedInstanceCountExpr, activeTemplateCountExpr, settingsCategoriesAndTypes } from "../documents/api.mjs";
// ★ P5.7 — Help reads the SAME setting the mobile forced-update gate mandates. One declaration.
import { getSetting } from "../settings/writes.mjs";
import { sectionsHiddenByShape } from "../nav/groups.mjs";
// ★ P5.9 — ONE slot read, shared with the client route. Never a second copy of that query.
// ★★ 13.19 — cached: G10's sub-second read. `readSlotsCached` falls straight through to the same
//    `readSlots` on a miss/stale row; see src/booking/availabilityCache.mjs for the TTL and the
//    eight DB triggers that keep a cached row from outliving what it describes.
import { readSlotsCached } from "../booking/availabilityCache.mjs";
// ★ TASK 6.3 — SetNotifications' events × role matrix (06-settings.md §2.3). The closed topic
//   catalogue, the three matrix roles, and the CT-105 "last changed by" read — the SAME helper
//   every other settings screen uses, imported from settings.mjs rather than re-implemented here.
import { NOTIFICATION_TOPICS } from "../notifications/topics.mjs";
import { NOTIFICATION_ROLES, getCatalogueDefaults, getEffectiveChannelsWithProvenance } from "../notifications/rules.mjs";
import { CHANNELS as NOTIFICATION_CHANNELS, setNotificationRule } from "../notifications/writes.mjs";
import { lastChangedBy } from "./settings.mjs";
// ★★★ 11.20 — the practice-less chain (11.19), for `/api/platform/tenants` and
//     `/api/platform/provisioning` below. Not imported before this task — confirmed absent, added
//     here per 11.20 field 4 ("the builder confirms and adds the import only if absent").
import { handlePlatformRequest } from "../paths/index.mjs";
import { callerIsPlatform } from "../db/index.mjs";
// ★ 17.25 — release notes and feature log, parsed once at module load.
import { getWhatsNew } from "../whats-new/parser.mjs";
// ★ 17.26 — headline composer for home band.
import { composeHeadline } from "../home/headline.mjs";
// ★ 17.27 — band runner for independent home band failures, and prompts engine for home prompts.
import { runBand } from "../home/bands.mjs";
import { computePrompts } from "../prompts/engine.mjs";
// ★ readSlots/readSlotsForAnyHost are used to get day slots for the headline.
import { readSlots, readSlotsForAnyHost } from "../booking/read.mjs";
import { subMonths, format } from "date-fns";
import { TZDate } from "@date-fns/tz";

// ★★★ ONE PLACE ASKS THE DATABASE WHETHER THIS TENANT IS THE PLATFORM TENANT — D-17.28.
//     Three routes used to do it inline, all three keyed on `principal.tenantId`, which is
//     DELIBERATELY NEVER SET (app.mjs: "AND A PRINCIPAL CANNOT CARRY ONE"). Every one of them
//     therefore matched zero rows and concluded `false`, so `/platform` never appeared in any nav and
//     every `foundryOnly` row was refused to everyone — silently, for the whole project.
// ★★ IT THROWS WHEN THE ROW IS ABSENT instead of returning false. Inside its own tenant transaction
//    the tenant row is always visible, so "no row" means the context is wrong — a different fact from
//    "not a platform tenant", and collapsing the two with `?.` is exactly what hid this. FAIL CLOSED
//    AND LOUDLY, never quietly in the safe-looking direction.
// ★ EXPORTED because `routes/writes.mjs` authorises every write with the same answer. One definition,
//   so the read side and the write side cannot disagree about which tenant is the platform.
const tenantIdentity = async (db, tenantId) => {
  const { rows } = await db.query(
    "SELECT id, slug, name, is_platform, shape FROM keystone.tenant WHERE id = $1", [tenantId]);
  if (rows.length !== 1) {
    throw internal(
      `the tenant row for the current context (${tenantId ?? "no tenant id"}) is not readable — ` +
      `refusing to treat that as "not a platform tenant"`
    );
  }
  return { id: rows[0].id, slug: rows[0].slug, name: rows[0].name,
           isPlatform: rows[0].is_platform === true, shape: rows[0].shape };
};

// ★★ THE NAME COMES BACK ON THE SAME ROW THE PLATFORM FLAG DOES, AND THAT IS THE WHOLE CHANGE.
//    Selecting one more column from a row already being read costs nothing, and it is what lets
//    `/api/nav` carry the practice name — see the note beside `tenant:` in the nav payload.
export const tenantIsPlatform = async (db, tenantId) =>
  (await tenantIdentity(db, tenantId)).isPlatform;


// ★★★ `RECORD_SOURCES` IS GONE — PHASE 15 REPLACED IT WITH `src/records/queries.mjs`.
//     It listed a table and a column list per type, which was the minimum P12.11 needed to prove
//     all seven descriptors could be served over HTTP. It could not express any of the following,
//     all of which the record page actually requires:
//       · the SIX U3 highlight values, four of which are derived across three tables each;
//       · `current_price()` instead of the stale `price_minor` column (B2.1 / P15.5a);
//       · `plan_id`/`app_user_id` resolved to NAMES instead of raw UUIDs (P15.2c).
//     Three of its seven entries carried a ★ comment naming a defect it was deliberately not
//     fixing. Those comments are now closed, in queries.mjs, against real columns.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ 5.4 — THE PAGING CURSOR (CT-011, CCR-7). ONE ENCODER, EXPORTED, SO 5.10 DOES NOT WRITE A SECOND.
//
//   The wire shape is CT-011's: the client sees an OPAQUE string and hands it back unchanged. In
//   Stage 5 the payload is `{o: <offset>}` (base64url of its JSON) because the 45 list descriptors
//   declare no sort key, so true keyset paging would mean rewriting all 45 WHERE clauses. That is
//   DEFERRED, NOT FIXED: an offset page can skip a row inserted mid-scroll. Because nothing outside
//   this file may read the payload, swapping it to `{k, id}` per view later is a server-only change.
// ★★ `decodeCursor` is STRICT: it accepts only a string that `encodeCursor` could have produced
//    (canonical base64url, a JSON object, one non-negative safe-integer `o`). Anything else is a 400
//    naming `cursor` — never a silent "page one", which would hand a client the same rows forever.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const invalidField = (field, message) =>
  new AppError(ErrorKind.VALIDATION, message, { fields: { [field]: message } });

export const encodeCursor = (offset) => {
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error(`encodeCursor: offset must be a non-negative safe integer, got ${offset}`);
  }
  return Buffer.from(JSON.stringify({ o: offset }), "utf8").toString("base64url");
};

export const decodeCursor = (s) => {
  const bad = () => invalidField("cursor", "cursor is not a valid paging cursor — use the nextCursor from a previous response, unchanged");
  if (typeof s !== "string" || s.length === 0 || s.length > 64) throw bad();
  let payload;
  try { payload = JSON.parse(Buffer.from(s, "base64url").toString("utf8")); } catch { throw bad(); }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) throw bad();
  const o = payload.o;
  if (!Number.isSafeInteger(o) || o < 0) throw bad();
  // Canonical form only: a string that decodes but is not what encodeCursor would emit is not ours.
  if (encodeCursor(o) !== s) throw bad();
  return o;
};

// ★ 5.4 — CT-011 request bounds. Default 50 is spec 03 §5's.
const LIST_DEFAULT_LIMIT = 50;
const LIST_MAX_LIMIT = 200;
const parseListLimit = (raw) => {
  if (raw === undefined) return LIST_DEFAULT_LIMIT;
  const n = /^[0-9]{1,6}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > LIST_MAX_LIMIT) {
    throw invalidField("limit", `limit must be a whole number from 1 to ${LIST_MAX_LIMIT}`);
  }
  return n;
};

// ★★ 5.4 — `totalColumn` / `currencyColumn` are INTERPOLATED into SQL. They come from a descriptor and
//    never from a request, but "it cannot come from a user today" is the assumption that ages worst,
//    so each is checked and double-quoted.
const SQL_IDENT_RE = /^[a-z_][a-z0-9_]*$/;
const quoteIdent = (name, what) => {
  if (typeof name !== "string" || !SQL_IDENT_RE.test(name)) {
    throw internal(`list descriptor ${what} ${JSON.stringify(name)} is not a plain SQL identifier`);
  }
  return `"${name}"`;
};

export function registerRoutes(app, { runTenantScoped }) {
  // ★★★ `scoped` EXISTS BECAUSE THE OBVIOUS FORM IS SILENTLY WRONG, AND IT FAILED EXACTLY THE WAY
  //     THIS PHASE EXISTS TO CATCH. Written as
  //         app.get(path, (c) => runTenantScoped(c, handler))
  //     every handler below returns a PLAIN OBJECT — the correct data, read from the correct row,
  //     inside the correct tenant context — and Hono has no Response to send. [EXECUTED] the
  //     server answered `RangeError: Invalid status code: undefined` and the client got a 500
  //     whose body was not even JSON. ★★ The module worked. The QUERY ran. THE WIRE WAS NOT
  //     CONNECTED — which is the phase-close rule ("end-to-end means the wire and the action")
  //     reproducing itself in miniature, and a source-text review would have passed it.
  const scoped = (c, fn, opts) => runTenantScoped(c, fn, opts).then((r) => c.json(r));

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ `crmScoped` — U21's SERVER HALF, IN ONE PLACE, BECAUSE SIX ROUTES DID NOT HAVE IT.
  //
  // [MEASURED 2026-09-14, P16.12's deployed E2E] a **PARENT's own session reached
  // `/api/settings/documents` on the deployed server and got 200** — the full seven-axis document
  // configuration of the practice. Auditing the rest of this router from its route table found the
  // same hole on SIX of twelve routes, none of which had any role predicate at all:
  //
  //   /api/records/:type/:id     any record in the practice — another client's person row, an
  //                              invoice, a service, by id
  //   /api/home                  the practice's operational tile COUNTS
  //   /api/capabilities          provisioning state and last_error strings
  //   /api/settings/notifications  ★ EVERY person's notification preferences, `ORDER BY app_user_id`
  //   /api/settings/documents      the seven axes — the one the E2E actually caught
  //   /api/settings/integrations   provisioning_step, including last_error
  //
  // ★★ RLS WAS NEVER THE MISSING PIECE AND IT IS IMPORTANT TO SAY SO. Every one of those queries
  //    ran correctly inside the right tenant, returning that tenant's own rows. The tenant boundary
  //    held perfectly. What was absent is the boundary INSIDE a tenant: a parent is a member of this
  //    practice, so tenant-scoping is exactly what hands them the practice's own administration.
  //    §K3 — staff code ships to client devices — means "same tenant" can never imply "same audience".
  //
  // ★★★ WHY A WRAPPER AND NOT SIX `if`s. The defect was not that somebody wrote a wrong check; it
  //     was that writing NO check looked identical to a finished route. With the predicate in the
  //     registrar, the DEFAULT for a new CRM route is refusal, and adding one cannot silently skip
  //     it. An inline `if` per route restores the original failure mode on route thirteen.
  //   ★ The check was already written, correctly, on `/api/nav` alone (P16.12's first finding). It is
  //     hoisted here verbatim rather than copied, so there is ONE sentence to maintain.
  //
  // ★ A PLATFORM principal passes: it has no tenant person (`principal.user` is null) but is staff
  //   by nature — U14. `/api/platform/*` keeps its DATABASE gate (`caller_is_platform()`) on top of
  //   this; two independent refusals for the platform console is deliberate, not redundant.
  // ★ `/api/list/*` and `/api/section/*` keep `authoriseSection()` as well. That is FINER than
  //   staff/not-staff (it rules on rank and on `foundryOnly`), so this wrapper is a floor beneath it,
  //   never a replacement.
  const assertCrmPrincipal = (principal) => {
    if (principal?.platformTenantId) return;
    if (principal?.user?.role === "staff") return;
    throw forbidden(
      "the CRM is for staff. Your account is a client of this practice, and the client app has its " +
      "own surfaces at /api/app/* — this is a refusal, not an empty list or a filtered tree, " +
      "because what we chose to include is not a security boundary (U15/U21).");
  };
  const crmScoped = (c, fn, opts) =>
    scoped(c, async (ctx) => { assertCrmPrincipal(ctx.principal); return fn(ctx); }, opts);

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ 11.20 — `operatorRead`: THE PRACTICE-LESS CHAIN, for `/api/platform/tenants` and
  //     `/api/platform/provisioning` below. The SAME shape `src/routes/platform.mjs`'s own
  //     `operatorRead` runs — duplicated here, not imported, because that file exports no such
  //     name (11.20 field 4). NOT `crmScoped`: `assertCrmPrincipal`/`scoped` both ask about a
  //     practice the operator is not in. `handlePlatformRequest` (11.19) re-resolves the session
  //     and applies the two-part narrow-door condition (a live grant AND no resolved practice);
  //     `callerIsPlatform(db)` is the one question asked once inside the transaction.
  //   ★★★ NO RATE LIMITER OF ITS OWN — the `{ bucket: "platform" }` these two routes used to pass
  //     is DROPPED, deliberately (critic A, 11-S3): it is a per-PRACTICE counter
  //     (`keystone.rate_limit_window`'s `tenant_id uuid NOT NULL`) and an operator has no practice
  //     to key it on. The per-IP limiter mounted on `/api/*` still covers every request here. See
  //     `platform.mjs`'s own `operatorRead` comment for the full argument (`checkKeyLimit` is not
  //     the substitute either).
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  const operatorRead = (fn, { status = 200 } = {}) => (c) =>
    handlePlatformRequest({ sessionId: c.get("principal")?.sessionId }, async (db) => {
      if (!(await callerIsPlatform(db))) throw forbidden("refused: no_operator_grant");
      return fn({ db, c });
    }).then((r) => c.json(r, status));

  // ★★★ ONE PLACE ASKS THE DATABASE WHETHER THIS TENANT IS THE PLATFORM TENANT — D-17.28.
  //     Three routes used to do it inline, all three keyed on `principal.tenantId`, which is
  //     DELIBERATELY NEVER SET (app.mjs: "AND A PRINCIPAL CANNOT CARRY ONE"). Every one of them
  //     therefore matched zero rows and concluded `false`, so `/platform` never appeared in any
  //     nav and every `foundryOnly` row was refused to everyone — silently, for the whole project.
  // ★★ IT THROWS WHEN THE ROW IS ABSENT instead of returning false. Inside its own tenant
  //    transaction the tenant row is always visible, so "no row" means the context is wrong —
  //    a different fact from "not a platform tenant", and collapsing the two with `?.` is exactly
  //    what hid this. FAIL CLOSED AND LOUDLY, never quietly in the safe-looking direction.
  // ★ The helper is now module-scope and EXPORTED (see above), because the WRITE routes need the
  //   same answer and a second copy is the drift this note's own history is about.

  // ───────────────────────────────────────────────────────────────────────────
  // P5.11 — GET /api/search?q= · the highest-risk read in the product
  // ───────────────────────────────────────────────────────────────────────────
  // ★★★ WHY THIS ONE IS DANGEROUS, AND IT IS ALREADY WRITTEN DOWN ABOVE (`:82-125`): **six of
  //     twelve read routes shipped with NO role predicate**, and a PARENT's own session reached
  //     `/api/settings/documents` on the deployed server and got 200. RLS held perfectly — the
  //     boundary INSIDE the tenant did not. ★★ A single unqualified `ILIKE` across `app_user`,
  //     `document_instance` and `invoice` reproduces that across every table AT ONCE.
  //
  // ★★★ SO IT DOES NOT WRITE A PREDICATE. It calls `scoped(object, alias)` — the SAME helper the
  //     29 list views use, which resolves `user_may($1, object, 'view', owner)` per object and
  //     carries the archive filter with it. A search with its own hand-rolled visibility rule
  //     would be a 30th answer to a question that already has one, and the one most likely to be
  //     wrong because it is the newest.
  //
  // ★★ THREE SHAPES STAY THREE SHAPES. `api.js:7-8` rules it and this route honours it: zero
  //    results is `{hits: []}` with 200, a refusal is a 403 from `crmScoped`, and a malformed
  //    query is a 400. **A search that returned `[]` for a refusal would be exactly the defect
  //    this item exists to prevent, wearing a friendly face.**
  app.get("/api/search", (c) =>
    crmScoped(c, async ({ db, principal }) => {
      const raw = (c.req.query("q") ?? "").trim();
      // ★ Two characters minimum. One character matches most of the practice and is never what
      //   somebody meant; returning it would also defeat the trigram index, which needs three
      //   characters to use a trigram at all and falls back to a scan below that.
      if (raw.length < 2) {
        return {
          q: raw, hits: [],
          // ★★ SAID, NOT IMPLIED. An empty result with no explanation reads as "nothing matches",
          //    which is a different fact from "I have not searched yet".
          detail: "Type at least two characters to search.",
        };
      }
      // ★★★ THE PATTERN IS A BOUND PARAMETER, and the wildcards are added HERE rather than by the
      //     caller. `%` and `_` are LIKE metacharacters: a person searching for "50%" would
      //     otherwise match everything. Escaped first, then wrapped.
      const pattern = `%${raw.replace(/([%_\\])/g, "\\$1")}%`;
      const viewer = principal?.appUserId ?? null;

      // ★ `LIMIT` per type, not overall — otherwise 20 people crowd out the one invoice somebody
      //   was actually looking for, and the groups the item asks for would be empty by accident.
      const PER_TYPE = 8;

      const [people, documents, invoices] = await Promise.all([
        db.query(
          `SELECT u.id, u.display_name AS label, u.email AS detail
             FROM keystone.app_user u
            WHERE (lower(u.display_name) LIKE lower($2) OR lower(u.email) LIKE lower($2))
              AND ${scopePredicate("person", "u")}
            ORDER BY u.display_name
            LIMIT ${PER_TYPE}`, [viewer, pattern]),
        searchInstances(db, { viewer, pattern, limit: PER_TYPE }),
        db.query(
          `SELECT i.id, i.invoice_number AS label, ie.status AS detail
             FROM keystone.invoice i
             JOIN keystone.invoice_effective ie ON ie.id = i.id
            WHERE lower(i.invoice_number) LIKE lower($2)
              AND ${scopePredicate("invoice", "i")}
            ORDER BY i.created_at DESC
            LIMIT ${PER_TYPE}`, [viewer, pattern]),
      ]);

      // ★★ GROUPED BY TYPE, and each hit carries the RECORD PATH that already exists — the item
      //    says "each opening the record page that already exists", so search invents no screen.
      const group = (type, rows) => ({
        type,
        hits: rows.rows.map((r) => ({
          id: r.id, label: r.label, detail: r.detail, path: `/record/${type}/${r.id}`,
        })),
      });
      const groups = [
        group("person", people),
        group("document", documents),
        group("invoice", invoices),
      ].filter((g) => g.hits.length > 0);

      return {
        q: raw,
        groups,
        // ★ A flat count as well, so the caller can say "nothing matched" without walking groups.
        hits: groups.flatMap((g) => g.hits),
      };
    }, { bucket: "nav" })
  );

  // ───────────────────────────────────────────────────────────────────────────
  // P5.9 — GET /api/engagements/slots · the staff-side read that did not exist
  // ───────────────────────────────────────────────────────────────────────────
  // ★★★ THE WRITE EXISTED AND THE READ DID NOT. `POST /api/engagements/bookings` has been live
  //     since P15B; `generateSlots()` had exactly ONE caller, inside `GET /api/app/booking`, which
  //     calls `assertClientRole()` and REFUSES EVERY STAFF SESSION. **A coach could create a
  //     booking and could not ask the server when anyone was free** — so the CTA this item builds
  //     had nothing to offer but a blank time field.
  //
  // ★★ IT SHARES `readSlots` WITH THE CLIENT ROUTE. The item says it in terms: *"Do not hand-write
  //    a second slot query."* That one query was wrong in every column until a deployed E2E ran it,
  //    and was STILL wrong in two silent ways after (see `src/booking/read.mjs`). A second copy
  //    would be a second chance to get all of it wrong again.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ A4.1 — THE NO-SHOW CHARGE, READ FROM **THE SAME RESOLVER THE WRITE USES**.
  //
  //   The attendance control has to NAME THE CONSEQUENCE before it is pressed — "No-show — 50%
  //   charge" — and BUILD-ACTIONS is explicit: *"Read the percentage from
  //   `booking.no_show_charge_percent`; do not hardcode the ruled default."*
  //   ★★ It was unreadable from a browser. The key is registered in `settings/keys.mjs` and **no
  //      route returned it**, so the only way to put a number on that button was to type 50 into
  //      the component — which is the one thing the instruction forbids, and for a good reason: a
  //      practice that has set 25% would have been shown 50% and charged 25%.
  //
  // ★★★ IT CALLS `resolveNoShowCharge`, NOT `getSetting`. That function is what
  //     `recordAttendance` itself calls, so **the number on the button and the number that moves
  //     the money are the same function's answer.** Reading the setting directly here would be a
  //     second implementation of the same decision — including its `null`-vs-`undefined` handling,
  //     which was a real bug (P6.B12) — and the two would drift the first time one was fixed.
  // ★ `source` travels too, so a screen can distinguish a practice's own figure from the ruling's
  //   default without guessing.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  app.get("/api/engagements/attendance-policy", (c) =>
    crmScoped(c, async ({ db }) => {
      const { resolveNoShowCharge } = await import("../booking/attendance.mjs");
      return resolveNoShowCharge(db);
    }, { bucket: "engagements" })
  );

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ BOOKING OVERHAUL, 29 Sep 2026 — WHAT THE HELD/NO-SHOW CONFIRMATION MODAL SHOWS BEFORE A
  //     CLICK CHARGES ANYTHING. Same reasoning as `attendance-policy` immediately above: computed
  //     by `previewSettlement` (src/booking/settleBooking.mjs), the SAME function `settleBooking`
  //     itself calls for the real amount, so the number shown and the number charged cannot drift.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  app.get("/api/engagements/settle-preview", (c) =>
    crmScoped(c, async ({ db, tenantId }) => {
      const { previewSettlement } = await import("../booking/settleBooking.mjs");
      const bookingId = c.req.query("bookingId");
      const outcome = c.req.query("outcome");
      if (!bookingId) throw invalid("bookingId is required");
      if (!["completed", "no_show"].includes(outcome)) {
        throw invalid('outcome must be "completed" or "no_show"');
      }
      return previewSettlement(db, { tenantId, bookingId, outcome });
    }, { bucket: "engagements" })
  );

  app.get("/api/engagements/slots", (c) =>
    crmScoped(c, async ({ db, principal }) => {
      // ★ The host defaults to the CALLER — "when am I free" is the common question, and a coach
      //   opening the CTA should not have to name themselves first.
      const hostId = c.req.query("hostId") ?? principal?.appUserId ?? null;
      const date = c.req.query("date") ?? new Date().toISOString().slice(0, 10);
      const serviceId = c.req.query("serviceId") ?? null;
      if (!hostId) throw invalid("hostId is required — slots are always for one person's calendar");
      // ★★ NO EXTRA AUTHORISATION BEYOND `crmScoped` + `authoriseSection`, DELIBERATELY. Any staff
      //    member may see when a COLLEAGUE is free: that is a working calendar, not a private one,
      //    and RLS keeps it inside the practice. What they may not do is READ THE BOOKINGS —
      //    this returns free times, never who is in the taken ones.
      return readSlotsCached(db, { tenantId: principal.user?.tenant_id ?? null, hostId, date, serviceId });
    }, { bucket: "engagements" })
  );

  // ───────────────────────────────────────────────────────────────────────────
  // TASK 1.2 (spec 01 §2, §3) — TeamList's two extra reads. Neither is a list view (`LIST_VIEWS`
  // stays 45 unchanged rows, F660's own discipline): each answers one question the roster's own
  // `GET /api/list/people/team` row cannot, by design (§3: "TeamList's own bespoke screen" makes
  // a SEPARATE call for each, keyed by what the roster route already returned).
  // ───────────────────────────────────────────────────────────────────────────
  // ★★★ SAME `authoriseSection(principal.user, "/people/team", …)` FLOOR THE ROSTER ITSELF USES —
  //     `crmScoped` alone is staff-vs-not-staff (§K3's floor beneath every finer gate, `:191-193`
  //     above), and `/people/team` now carries its own `minRole: 'admin'`
  //     (`src/nav/sections.mjs`) — this asks that SAME question a second, explicit time rather than
  //     assuming `crmScoped` already asked it, because these two routes are not `/api/list/*` and so
  //     never pass through that handler's own `authoriseSection` call at `:787` above.
  app.get("/api/people/team/two-step-status", (c) =>
    crmScoped(c, async ({ db, principal, tenantId }) => {
      const isPlatform = await tenantIsPlatform(db, tenantId);
      const decision = authoriseSection(principal.user, "/people/team", { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`section refused: ${decision.reason}`);

      // ★ RLS scopes this to the caller's own tenant (FORCE on `app_user`); no explicit
      //   `tenant_id` predicate is added, matching `_shared.mjs`'s own stated discipline for every
      //   other query in this file.
      const { rows } = await db.query(
        `SELECT id, firebase_uid FROM keystone.app_user
          WHERE role = 'staff' AND firebase_uid IS NOT NULL`);
      const uids = rows.map((r) => r.firebase_uid);
      // ★ Zero staff with a firebase_uid is a legitimate, empty answer — `confirmed_totp_uids`
      //   (0251) takes an array either way; an empty `ANY($1)` matches nothing, which is correct.
      const { rows: confirmed } = await db.query(
        `SELECT firebase_uid FROM keystone.confirmed_totp_uids($1::text[])`, [uids]);
      const confirmedSet = new Set(confirmed.map((r) => r.firebase_uid));

      const byAppUserId = {};
      for (const r of rows) byAppUserId[r.id] = confirmedSet.has(r.firebase_uid);
      return { twoStepByAppUserId: byAppUserId };
    // ★★★ `bucket: "list"`, NOT a new "people" bucket — `RATE_BUCKETS` (`src/http/rateLimit.mjs:38-50`)
    //     is a CLOSED, eleven-name vocabulary, CHECK-constrained by migration 0166, and adding a
    //     twelfth is explicitly out of scope ("Adding a twelfth bucket is a plan defect this task
    //     does not commit", `rateLimit.mjs:208`). This route is TeamList's own second call, following
    //     the roster's own `/api/list/people/team` (`bucket: "list"`, `:1000` above) into the SAME
    //     bucket rather than inventing one this task does not own.
    }, { bucket: "list" })
  );

  app.get("/api/people/team/seats", (c) =>
    crmScoped(c, async ({ db, principal, tenantId }) => {
      const isPlatform = await tenantIsPlatform(db, tenantId);
      const decision = authoriseSection(principal.user, "/people/team", { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`section refused: ${decision.reason}`);

      // ★ Task 12.14 — `teamSeatUsage` (src/people/seats.mjs) is now the ONE place `used` is
      //   computed: staff + open staff invites, never staff alone (an open invite already
      //   reserves the seat it would become).
      const { staff, openInvites, used, limit, planKey } = await teamSeatUsage(db);
      return { used, staff, openInvites, limit, planKey };
    }, { bucket: "list" })
  );

  // ───────────────────────────────────────────────────────────────────────────
  // TASK 1.4 (01-team-and-roles.md §2, §3, §4) — TeamSeeAs, CT-112's SAME-TENANT half. Spec 11
  // builds the cross-tenant PlatViewingAs half separately; nothing here reaches another practice —
  // `enter_viewing_as` (0250) only ever UPDATEs the caller's OWN session row, matched by its own
  // token/secret, and only admits a target `role='staff'` in that SAME session's `tenant_id`.
  // ───────────────────────────────────────────────────────────────────────────
  // ★★★ THE GATE IS `person: view` AT `everything` SCOPE (spec §4) — an Admin or Owner, never a
  //     Coach, and never scoped down to "your own caseload": no `subjectId`/`body.id` is passed to
  //     `assertMay`, so `resolveOwnerId` returns `null` and only `scope='everything'` can pass
  //     (`src/permissions/assertMay.mjs:60-74`). `authoriseSection` is asked too, same floor
  //     `/people/team`'s own roster and TeamList's two extra reads already ask (`:381-385` above).
  app.post("/api/people/team/see-as", (c) =>
    crmScoped(c, async ({ db, c: ctx, principal, tenantId, body }) => {
      const isPlatform = await tenantIsPlatform(db, tenantId);
      const decision = authoriseSection(principal.user, "/people/team", { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`section refused: ${decision.reason}`);
      await assertMay(db, principal, { object: "person", action: "view" });

      const personId = body?.personId;
      if (!personId) throw invalid("personId is required", { field: "personId" });

      // ★ 409 already previewing — spec §2's own error row. Checked before the target is even
      //   looked up, matching the spec's listed order.
      if (principal.viewingAsAppUserId) {
        throw conflict("already previewing as someone — exit first");
      }

      // ★ 403 not staff / 403 is-the-caller are named HERE, in plain language, even though
      //   `enter_viewing_as` (0250) refuses both at the database too (defence in depth, same
      //   argument `keystone.enforce_last_owner()` gets in TeamRemove, §4) — a bare "0 rows
      //   updated" from the definer would otherwise have to be reverse-engineered into one of two
      //   different reasons.
      const { rows } = await db.query(
        `SELECT id, display_name, staff_role, role FROM keystone.app_user WHERE id = $1`, [personId]);
      const target = rows[0];
      if (!target || target.role !== "staff") {
        throw forbidden("refused: the target is not staff in this practice");
      }
      if (target.id === principal.appUserId) {
        throw forbidden("refused: you cannot preview as yourself");
      }

      // ★ THE RAW PRESENTED TOKEN — `principal.sessionId` IS IT (src/auth/install.mjs's
      //   `resolvePrincipal`: "sessionId: presented"), never re-parsed from a header a second time.
      if (!principal.sessionId) throw unauthenticated("sign in required");
      const entered = await enterViewingAs(principal.sessionId, target.id);
      if (!entered) {
        throw conflict("could not start the preview — sign in again or exit any other preview first");
      }

      // ★ CT-107 — one audit row per successful preview ENTRY, never on exit (spec §3: "exiting is
      //   the absence of a claim, not an occurrence worth its own audit row").
      await writeAudit(db, {
        tenantId,
        action: "staff.viewed_as",
        object: "person",
        subjectId: target.id,
        after: { viewed_app_user_id: target.id },
        actorUserId: principal.appUserId,
        requestId: ctx.get("requestId") ?? null,
      });

      return {
        viewingAs: { id: target.id, displayName: target.display_name, staffRole: target.staff_role },
        expiresAt: entered.expiresAt,
      };
    }, { bucket: "write" })
  );

  // ★ Idempotent per spec §2: "409 not currently viewing as anyone (idempotent — returns {ok:true}
  //   rather than erroring, matching revokeInvite's own idempotent-revoke idiom)" — so the ONLY
  //   refusal left is "not signed in at all", which is 401, not 409.
  app.post("/api/people/team/see-as/exit", (c) =>
    crmScoped(c, async ({ principal }) => {
      if (!principal.sessionId) throw unauthenticated("sign in required");
      const exited = await exitViewingAs(principal.sessionId);
      if (!exited) throw unauthenticated("sign in required");
      return { ok: true };
    }, { bucket: "write" })
  );

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // TASK 12.29 (STAGE-12-PLAN.md §12.29) — TeamSeeAs's summary: the can/can't table, computed from
  // the real grants, fetched with the CALLER's OWN real identity — BEFORE `see-as` is ever entered.
  //
  // ★★★ SAME GATE AS SEE-AS ITSELF (see the header note above `POST /api/people/team/see-as`):
  //     `authoriseSection('/people/team')` + `assertMay(person, view)` with NO subjectId, so only
  //     `scope='everything'` passes — an Admin or Owner, never a Coach (test (b)). This is what
  //     makes the route safe to answer AT ALL: the caller already has unrestricted `person: view`,
  //     so every fact this route returns (a count, a verb, a scope) is something the caller could
  //     already see for themselves by opening the target's own role in Settings → Roles. The route
  //     NEVER RETURNS A NAME belonging to anyone but the target (a fellow staff member the caller's
  //     own roster already lists) — only counts — so a scope preview can never leak a client's
  //     identity across a boundary the caller could not otherwise cross.
  //
  // ★★ TEN ROWS, EACH DERIVED FROM ONE `role_permission` GRANT (field 4). `bestGrant` below picks
  //    the WIDEST single grant per object — same ranking `allows()`/`scopeAllows()` use — because a
  //    person can hold more than one role and the display answers "what CAN they do", the union of
  //    every role held, exactly as 05's `effectiveGrants` doc says the enforcement path already does.
  //    A row's SIDE (can/cannot) and its wording both come from that one grant; nothing here invents
  //    a permission the target does not actually hold.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  app.get("/api/people/team/:personId/see-as-summary", (c) =>
    crmScoped(c, async ({ db, principal, tenantId }) => {
      const isPlatform = await tenantIsPlatform(db, tenantId);
      const decision = authoriseSection(principal.user, "/people/team", { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`section refused: ${decision.reason}`);
      await assertMay(db, principal, { object: "person", action: "view" });

      const personId = c.req.param("personId");
      if (!UUID_RE.test(personId)) throw invalid("personId must be a UUID", { field: "personId" });

      const { rows: targetRows } = await db.query(
        `SELECT id, display_name, staff_role, role FROM keystone.app_user WHERE id = $1`, [personId]);
      const target = targetRows[0];
      if (!target || target.role !== "staff") {
        throw notFound("no such team member");
      }

      // ★ Terminology through the server-side resolver, never a hardcoded label a tenant could
      //   have renamed (§1.5) — `userType.coach`/`userType.admin` are real TERM_KEYS; `owner` has
      //   none (an Owner is never realistically a see-as target) so it falls back to the plain word.
      const terms = await resolveTerms(db);
      const roleLabel = terms[`userType.${target.staff_role}`]
        ?? (target.staff_role ? target.staff_role.charAt(0).toUpperCase() + target.staff_role.slice(1) : "Staff");

      // ★ `own`/`total` — COUNTS ONLY, never a row, never a name. Same owner column P1.4 names for
      //   `person` (`app_user.owner_user_id`), same "clients" filter (`role <> 'staff'`) and same
      //   "current, not archived" filter 12.17's own `caseload_count` field uses, so this never
      //   disagrees with the figure the roster screen shows for the very same person.
      const { rows: countRows } = await db.query(
        `SELECT
           count(*) FILTER (WHERE owner_user_id = $1) AS own,
           count(*) AS total
         FROM keystone.app_user
        WHERE role <> 'staff' AND archived_at IS NULL`,
        [target.id]);
      const own = Number(countRows[0]?.own ?? 0);
      const total = Number(countRows[0]?.total ?? 0);

      const teamWideNotes = await getSetting(db, "people.team_wide_notes", false);

      const grants = await effectiveGrants(db, target.id);
      const bestGrant = (object) => {
        const list = grants[object] ?? [];
        return list.reduce(
          (best, g) => {
            if (scopeRank(g.scope) > scopeRank(best.scope)) return g;
            if (scopeRank(g.scope) === scopeRank(best.scope) && verbRank(g.verb) > verbRank(best.verb)) return g;
            return best;
          },
          { verb: "none", scope: "none" },
        );
      };

      const can = [];
      const cannot = [];

      // 1 & 2 — person: view. Two facts from one grant: what's reachable, and what's hidden.
      {
        const g = bestGrant("person");
        if (g.verb === "none") {
          cannot.push({ label: "Their clients", detail: "No client access on this role" });
        } else if (g.scope === "everything") {
          can.push({ label: "All clients", detail: `${total} of your ${total}`, count: total });
        } else {
          can.push({ label: "Their own clients", detail: `${own} of your ${total}`, count: own });
          if (total > own) {
            cannot.push({ label: `Other coaches' clients`, detail: `${total - own} of your ${total}` });
          }
        }
      }

      // 3 — engagement: view/edit.
      {
        const g = bestGrant("engagement");
        if (g.verb === "none") {
          cannot.push({ label: "Their calendar", detail: "No calendar access on this role" });
        } else {
          can.push({
            label: "Their own calendar",
            detail: g.scope === "everything"
              ? "And the whole team's calendar"
              : "And the team calendar, read only",
          });
        }
      }

      // 4 — note: view/edit, gated further by the `people.team_wide_notes` tenant setting.
      {
        const g = bestGrant("note");
        if (g.verb === "none") {
          cannot.push({ label: "Their notes", detail: "Not visible on this role" });
        } else {
          can.push({
            label: "Their own notes",
            detail: teamWideNotes ? "Everyone's notes on their clients" : "Not anyone else's",
          });
        }
      }

      // 5 — item: view/edit ("Services and prices").
      {
        const g = bestGrant("item");
        if (g.verb === "none") {
          cannot.push({ label: "Services and prices", detail: "Not visible on this role" });
        } else {
          can.push({ label: "Services and prices", detail: "So they can tell people what things cost" });
        }
      }

      // 6 — document: needs `edit` to send one, per field 4's own frame detail.
      {
        const g = bestGrant("document");
        if (g.verb === "none") {
          cannot.push({ label: "Documents", detail: "Not visible on this role" });
        } else if (verbRank(g.verb) >= verbRank("edit")) {
          can.push({ label: "Documents", detail: "They can send one, and see whether it's signed" });
        } else {
          can.push({ label: "Documents", detail: "They can see them, but not send one" });
        }
      }

      // 7 — invoice: `none` is the money wall (test (a)/(b) fixture).
      {
        const g = bestGrant("invoice");
        if (g.verb === "none") {
          cannot.push({
            label: "Money, anywhere",
            detail: "No invoices, no payments, no reports with money in them",
          });
        } else {
          can.push({ label: "Money", detail: "Invoices and payments, on their role" });
        }
      }

      // 8 — network_party ("How you're found").
      {
        const g = bestGrant("network_party");
        if (g.verb === "none") {
          cannot.push({ label: "How you're found", detail: "Not on this role" });
        } else {
          can.push({ label: "How you're found", detail: "Referral sources and partners" });
        }
      }

      // 9 — setting: coherent scopes are only `none`/`everything` (0066's own CHECK).
      {
        const g = bestGrant("setting");
        if (g.verb === "none") {
          cannot.push({ label: "Settings", detail: "Except their own profile and notifications" });
        } else {
          can.push({ label: "Settings", detail: "Full practice settings" });
        }
      }

      // 10 — task: owned/team reads as "only their own"; everything reads as the whole team's.
      {
        const g = bestGrant("task");
        if (g.verb === "none") {
          cannot.push({ label: "Tasks", detail: "Not visible on this role" });
        } else if (g.scope === "everything") {
          can.push({ label: "The team's tasks", detail: `Every coach's, not just their own` });
        } else {
          cannot.push({ label: "The team's tasks", detail: "Only their own" });
        }
      }

      return {
        person: { id: target.id, displayName: target.display_name, staffRole: target.staff_role, roleLabel },
        can,
        cannot,
      };
    }, { bucket: "list" })
  );

  // ───────────────────────────────────────────────────────────────────────────
  // TASK 1.5 (01-team-and-roles.md §2/§3/§4/§12/§13) — TeamRemove (owner handover) + TeamSolo.
  // Same floor as TeamSeeAs above: `authoriseSection(principal.user, "/people/team", …)`, then the
  // finer gate — here `team.remove`, a NAMED action (src/permissions/assertMay.mjs), Owner/Admin
  // only, never Coach. Hand-registered here, not in `src/routes/writes.mjs`'s declarative `ROUTES`
  // table, because both routes carry a `:personId` path param that table has no shape for (same
  // reason `/api/records/:type/:id`, below, is hand-registered too).
  // ───────────────────────────────────────────────────────────────────────────
  app.get("/api/people/team/:personId/offboard-preview", (c) =>
    crmScoped(c, async ({ db, principal, tenantId }) => {
      const isPlatform = await tenantIsPlatform(db, tenantId);
      const decision = authoriseSection(principal.user, "/people/team", { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`section refused: ${decision.reason}`);
      await assertMay(db, principal, { action: "team.remove" });

      const personId = c.req.param("personId");
      if (!UUID_RE.test(personId)) throw invalid("personId must be a UUID", { field: "personId" });

      return getOffboardPreview(db, { personId });
    }, { bucket: "list" })
  );

  app.post("/api/people/team/:personId/offboard", (c) =>
    crmScoped(c, async ({ db, principal, tenantId, body }) => {
      const isPlatform = await tenantIsPlatform(db, tenantId);
      const decision = authoriseSection(principal.user, "/people/team", { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`section refused: ${decision.reason}`);
      await assertMay(db, principal, { action: "team.remove" });

      const personId = c.req.param("personId");
      if (!UUID_RE.test(personId)) throw invalid("personId must be a UUID", { field: "personId" });

      return offboardTeamMember(db, {
        tenantId,
        personId,
        reassignments: body?.reassignments ?? [],
        futureSessions: body?.futureSessions,
        actorUserId: principal.appUserId,
      });
    }, { bucket: "write" })
  );

  // ───────────────────────────────────────────────────────────────────────────
  // the maintainer's brief, 1 Oct 2026 — Team's "suspend" action, same floor as offboard above
  // (team.remove for the removal-strength actions above this, staff_role.change here since this
  // is a standing change, not a removal). Hand-registered for the same reason offboard is: a
  // `:personId` path param the declarative ROUTES table in writes.mjs has no shape for.
  // ───────────────────────────────────────────────────────────────────────────
  app.post("/api/people/team/:personId/suspend", (c) =>
    crmScoped(c, async ({ db, principal, tenantId, body }) => {
      const isPlatform = await tenantIsPlatform(db, tenantId);
      const decision = authoriseSection(principal.user, "/people/team", { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`section refused: ${decision.reason}`);
      await assertMay(db, principal, { action: "staff_role.change" });

      const personId = c.req.param("personId");
      if (!UUID_RE.test(personId)) throw invalid("personId must be a UUID", { field: "personId" });

      return suspendTeamMember(db, {
        tenantId, personId, reason: body?.reason ?? null, actorUserId: principal.appUserId,
      });
    }, { bucket: "write" })
  );

  app.post("/api/people/team/:personId/reactivate", (c) =>
    crmScoped(c, async ({ db, principal, tenantId, body }) => {
      const isPlatform = await tenantIsPlatform(db, tenantId);
      const decision = authoriseSection(principal.user, "/people/team", { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`section refused: ${decision.reason}`);
      await assertMay(db, principal, { action: "staff_role.change" });

      const personId = c.req.param("personId");
      if (!UUID_RE.test(personId)) throw invalid("personId must be a UUID", { field: "personId" });

      return reactivateTeamMember(db, {
        tenantId, personId, reason: body?.reason ?? null, actorUserId: principal.appUserId,
      });
    }, { bucket: "write" })
  );

  // ───────────────────────────────────────────────────────────────────────────
  // ───────────────────────────────────────────────────────────────────────────
  // P5.7 — GET /api/help · how to reach a human
  // ───────────────────────────────────────────────────────────────────────────
  // ★★★ `scoped`, NOT `crmScoped`, AND THAT IS THE ITEM'S RULE VERBATIM: *"Help must never be
  //     permission-gated."* Every other read in this file refuses a client because the CRM is for
  //     staff — this one must not, because the moment somebody cannot work out how to reach a
  //     person is exactly the moment a refusal is the wrong answer.
  //
  // ★★★ ONE VALUE, TWO SURFACES, NO SECOND DECLARATION. `src/cutover/mobileBridge.mjs:44-51`
  //     already makes a support phone MANDATORY on the forced-update gate — *"a non-dismissable
  //     prompt with no way to reach a human is a locked door, and the people on the other side of
  //     it are in recovery."* **The CRM has never applied that rule to itself.** This reads the
  //     SAME `practice.support_phone` setting rather than declaring a second one.
  //
  // ★★ AND AN ABSENT NUMBER IS REPORTED, NOT HIDDEN. `configured:false` travels to the client so
  //    the menu can SAY there is no number — the item's FAILURE row: *"never render an empty menu."*
  //    A blank Help panel is the locked door again, one surface along.
  app.get("/api/help", (c) =>
    scoped(c, async ({ db }) => {
      const phone = await getSetting(db, "practice.support_phone", null);
      const configured = typeof phone === "string" && phone.trim().length >= 7;
      return {
        supportPhone: configured ? phone.trim() : null,
        configured,
        // ★ WHERE TO SET IT, sent with the answer. A person told "no number is configured" and not
        //   told where to put one has been given half a sentence.
        settingKey: "practice.support_phone",
        settingsPath: "/settings/practice",
      };
    }, { bucket: "nav" })
  );

  // ───────────────────────────────────────────────────────────────────────────
  // P5.5 — GET /api/notifications · GET /api/notifications/unread-count
  // ───────────────────────────────────────────────────────────────────────────
  // ★★★ THE INDEX FOR THE COUNT EXISTED AND THE COUNT DID NOT. [MEASURED]
  //     `0016_events_and_notifications.sql:105` creates
  //     `notification_unread ON keystone.notification (tenant_id, recipient_id) WHERE read_at IS NULL`
  //     — a PARTIAL index built precisely to serve this query — and **nothing in `src/` issued it.**
  //     Someone designed the read, indexed it, and never wrote it.
  //
  // ★★★ AND `deep_link` REACHED NO WIRE. The column is written (`notifications/writes.mjs:72`) and
  //     the only SELECT of the table — the CLIENT route at `routes/app.mjs:244` — omits it. The
  //     field that makes a notification ACTIONABLE was on the schema and on no response. Both reads
  //     below select it, because a notification you cannot follow is an announcement, not a task.
  //
  // ★★ `recipient_id = $1` ON BOTH, ALWAYS. RLS scopes these rows to the TENANT; it does not scope
  //    them to the PERSON, and a notification is addressed to one person by name. Tenant-scoping
  //    alone would hand every admin everybody else's inbox — the §K3 lesson that
  //    `/api/settings/notifications` already learned once.
  // ───────────────────────────────────────────────────────────────────────────
  // ★ 17.34 — derives family from topic's section prefix in TOPICS (src/events/topics.mjs)
  function getNotificationFamily(topic) {
    if (!topic) return "other";
    const section = topic.split(".")[0];
    if (section === "money" || section === "items") return "money";
    if (section === "booking" || section === "calendar") return "sessions";
    if (section === "documents") return "documents";
    return "other";
  }

  app.get("/api/notifications", (c) =>
    crmScoped(c, async ({ db, principal }) => {
      const me = principal?.appUserId ?? null;
      // ★ A platform principal has no tenant person, so it is nobody's recipient. An empty list is
      //   the honest answer; `recipient_id = NULL` would match nothing anyway, but saying so here
      //   means the query is never issued with a null identity by accident.
      if (!me) return { notifications: [], unread: 0 };
      const isOwner = principal.user?.role === "staff" && principal.user?.staff_role === "owner";
      const isOwnerOrAdmin = isOwner || (principal.user?.role === "staff" && principal.user?.staff_role === "admin");
      const { rows } = await db.query(
        `SELECT id, topic, title, body, deep_link, read_at, created_at
           FROM keystone.notification
          WHERE recipient_id = $1
          ORDER BY created_at DESC
          LIMIT 100`, [me]);
      // ★ 17.34 — add family field and filter out money-family rows for non-Owner/Admin principals.
      //   The unread count is computed AFTER the omission so the badge never promises a row the
      //   panel will not show.
      const notifications = rows
        .map((n) => ({ ...n, family: getNotificationFamily(n.topic) }))
        .filter((n) => !(!isOwnerOrAdmin && n.family === "money"));
      // ★★ THE UNREAD COUNT TRAVELS WITH THE LIST. Opening the panel and reading the badge are one
      //    interaction; two round trips would let them disagree for as long as the second was in
      //    flight, and the badge is the thing people trust.
      return { notifications, unread: notifications.filter((r) => !r.read_at).length };
    }, { bucket: "app" })
  );

  app.get("/api/notifications/unread-count", (c) =>
    crmScoped(c, async ({ db, principal }) => {
      const me = principal?.appUserId ?? null;
      if (!me) return { unread: 0 };
      const isOwner = principal.user?.role === "staff" && principal.user?.staff_role === "owner";
      const isOwnerOrAdmin = isOwner || (principal.user?.role === "staff" && principal.user?.staff_role === "admin");
      // ★★★ THIS IS THE QUERY THE PARTIAL INDEX WAS BUILT FOR — `(tenant_id, recipient_id) WHERE
      //     read_at IS NULL`. It is a COUNT, not a length: the badge must not depend on having
      //     fetched the list, and `LIMIT 100` above would cap it at 100 anyway.
      //   ★ P3.2's rule — never read an estimate as a count. `count(*)` over the index, not
      //     `reltuples` and not a planner guess.
      //   ★ 17.34 — applies the SAME family omission rule as the list route so the badge and list
      //     agree on unread count. Non-Owner/Admin users do not see money-family notifications.
      const whereClause = isOwnerOrAdmin
        ? `recipient_id = $1 AND read_at IS NULL`
        : `recipient_id = $1 AND read_at IS NULL AND topic NOT SIMILAR TO '(money|items)\.%'`;
      const { rows } = await db.query(
        `SELECT count(*)::int AS unread
           FROM keystone.notification
          WHERE ${whereClause}`, [me]);
      return { unread: rows[0]?.unread ?? 0 };
    }, { bucket: "app" })
  );

  // ───────────────────────────────────────────────────────────────────────────
  // P5.1 — GET /api/auth/practices · the tenant switcher's read
  // ───────────────────────────────────────────────────────────────────────────
  // ★★★ IT USES `scoped`, NOT `crmScoped`, AND THAT IS A DELIBERATE DISTINCTION. Which practices
  //     you belong to is a fact about YOURSELF, not a CRM administration screen — a client who
  //     happens to be on two practices' books is entitled to the same answer as an admin. The CRM
  //     refusal exists to stop a client reaching STAFF surfaces; this is not one.
  //
  // ★★★ IT DOES NOT RESOLVE THE SESSION ITSELF, AND THE FIRST VERSION DID. [EXECUTED 2026-09-15]
  //     that version lived in `auth/install.mjs` and called `resolveSession()` directly, which
  //     bypasses the resolver `installSessionResolver` registers — so under the route-matrix
  //     harness it refused **all eight identities**, and `p21c_route_role_matrix.mjs` caught it:
  //     *"no route may refuse EVERYONE ... a route that every identity is refused on passes every
  //     negative test ever written and serves nobody."* ★★ The authentication a route needs is the
  //     one the application already did; re-deriving it is how a route ends up secured by being
  //     broken.
  //
  // ★ The ORACLE argument is unchanged and is now enforced by the wrapper rather than by a hand
  //   written 401: an unauthenticated caller never reaches this handler at all, so it cannot be
  //   asked whether a given person exists or how many practices they work for.
  app.get("/api/auth/practices", (c) =>
    scoped(c, async ({ db, principal, tenantId }) => {
      // ★★ A PLATFORM principal has no tenant person (`principal.user` is null — U14). It belongs
      //    to no practice in this sense, so the honest answer is an empty list rather than a crash
      //    or every tenant in the installation.
      const appUserId = principal?.appUserId ?? null;
      if (!appUserId) return { practices: [] };
      const r = await db.query(
        `SELECT id, slug, name, is_current FROM keystone.practices_for_session($1, $2)`,
        [tenantId, appUserId]
      );
      // ★ id, slug, name, is_current — nothing else. A count, a role or a join date would each be a
      //   second question answered ACROSS a tenant boundary, which is what this must not become.
      return { practices: r.rows };
    })
  );

  // ───────────────────────────────────────────────────────────────────────────
  // P12.10 — GET /api/nav
  // ───────────────────────────────────────────────────────────────────────────
  app.get("/api/nav", (c) =>
    crmScoped(c, async ({ db, principal, tenantId }) => {
      // ═══════════════════════════════════════════════════════════════════════════════════════
      // ★★★ THE CRM NAVIGATION IS FOR STAFF. A CLIENT IS REFUSED HERE, NOT FILTERED.
      //     [MEASURED 2026-09-14, P16.12's deployed E2E] a **PARENT's own session reached
      //     /api/nav and got 200.** They were correctly refused /api/list/people/all and
      //     /api/platform/tenants (403), but the CRM's navigation route had no role check at all.
      //   ★★★ AND RELYING ON THE NAV TREE TO FILTER ITSELF IS EXACTLY WHAT P16 FORBIDS.
      //        `web/src/app/ClientApp.jsx` declares `NAV_IS_NOT_A_BOUNDARY = true`: the nav is a
      //        convenience, and anything that must not be reached has to be refused by a GUARD. A
      //        200 with a filtered tree makes the boundary "what we chose to include" instead of
      //        "you are not a CRM user" — and the next section added without a role predicate is
      //        then visible to every client in the practice.
      //   ★ The client app has its own namespace (`/api/app/*`, U14/U15) and needs nothing here.
      //     A platform principal is allowed through: it has no tenant person but is staff by nature.
      // ★ THE REFUSAL ITSELF NOW LIVES IN `crmScoped` — see its note. It was written here first,
      //   for this one route, and hoisting it is what closed the other six.
      // ★★ `tenantIsPlatform` comes FROM THE DATABASE, never from the client and never matched
      //    on a slug — authorise.mjs:86 is explicit about it.
      const tenant = await tenantIdentity(db, tenantId);
      const isPlatform = tenant.isPlatform;
      const opts = { tenantIsPlatform: isPlatform };

      // ★★★ P1.5 — THE STORE NOW EXISTS AND THIS IS ITS ONE CONSUMER. This line read `const terms
      //     = {}` from P14.9a until now, with a comment calling it *"a real live defect, not a
      //     hypothetical"* — the four `termKey` rows took their fallback on every request because
      //     nothing had ever been able to supply an override.
      //   ★★ A MISS IS STILL SAFE, AND THAT IS STRUCTURAL. `resolveSections` does
      //      `terms[row.termKey] || row.fallback`, and the fallback is the ENGLISH WORD carried on
      //      the row. An empty map, a missing key, a tenant that has configured nothing — all render
      //      `Clients`, never `userType.clientPlural`. That is the difference between this design
      //      and the i18next layer the sibling project had to delete (§2.7 there).
      //   ★ One query per nav request, on a table with one row per key per tenant.
      const terms = await resolveTerms(db);
      const tree = navTree(terms);
      const allowed = new Set(visibleSections(principal.user, opts).map((s) => s.key));
      // ═══════════════════════════════════════════════════════════════════════════════════════
      // ★★★ PART 4 [TY, RULED 23 Sep 2026] — A SECOND, UX-ONLY filter, deliberately layered on top
      //     of `allowed` rather than folded into `visibleSections`/`authoriseSection`. Those two
      //     stay the security floor (§P16 above: "relying on the nav tree to filter itself is
      //     exactly what P16 forbids") — this hides sections the practice's SHAPE doesn't cover,
      //     the same way `authorise.mjs`'s own header describes hiding as "not a security
      //     boundary". Nothing this touches gates a single route or RLS policy; a direct request
      //     to a hidden section's API still works for anyone with the role for it.
      //   ★ `tenant.shape` — a real column (migration 0343), not a tenant_setting — read on `tenant`
      //     above, the same row `isPlatform` already came from. Replaces WORKSTREAM 12's
      //     `nav.groups_off`/`sectionsHiddenByGroups`.
      const hiddenByShape = sectionsHiddenByShape(tenant.shape);

      return {
        sections: tree.filter((s) => allowed.has(s.key) && !hiddenByShape.has(s.key)),
        rank: effectiveRank(principal.user),
        // ★ QUEUE §4 — the practice's resolved words (client types etc.) for STAFF screens too; the portal gets the same map from /api/app.
        terms,
        // ★★★ RP.1 (specs/react-rebuild) — the viewer's resolved permissions, for the UI's <Can>/useWrite.
        //     UX only: every route still authorises itself. The Svelte app ignores this field.
        permissions: principal.appUserId
          ? { rank: effectiveRank(principal.user), ...(await permissionSummary(db, principal.appUserId)) }
          : null,
        // ═══════════════════════════════════════════════════════════════════════════════════════
        // ★★★ WHICH PRACTICE THIS IS. Added 2026-09-16 — F460, and it is the same shape of fix as
        //     `me` directly below, for the same reason.
        //
        //   The sidebar's practice name — the first thing on the screen, present on EVERY screen —
        //   came only from `GET /api/auth/practices`, a SECOND fetch whose job is really to
        //   populate the SWITCHER MENU. So the most prominent piece of chrome in the product
        //   depended on an independently-failing request, and when that request came back empty
        //   for any reason the column announced **"No practice"** — which reads as a broken app,
        //   is indistinguishable from a layout bug, and has already cost this project one long
        //   investigation (F365, a `permission denied` inside `practices_for_session`).
        //
        // ★★ THE TWO QUESTIONS ARE GENUINELY DIFFERENT AND NOW COME FROM DIFFERENT PLACES:
        //      "which practice am I in?"      → HERE, on the nav, which the app already awaits
        //                                       before it renders anything at all.
        //      "which practices could I switch to?" → `/api/auth/practices`, whose emptiness is a
        //                                       real answer and costs only the MENU.
        //    A name that the session itself can always answer must not be gated on a list that
        //    sometimes cannot.
        // ★ It costs no extra query: `tenantIdentity` selects three columns from the row
        //   `tenantIsPlatform` was already reading.
        // ═══════════════════════════════════════════════════════════════════════════════════════
        // ★ TY, 2026-09-16 — ONE NAME, ONE MARK: the practice.name setting if set (else the name
        //   given at signup), and the uploaded sidebar logo if there is one.
        tenant: await (async () => {
          const { rows: br } = await db.query(
            `SELECT key, value #>> '{}' AS v FROM keystone.tenant_setting
              WHERE key IN ('practice.name', 'branding.sidebar_logo')`);
          const get = (k) => br.find((r) => r.key === k)?.v || null;
          const m = /^ks-object:t\/[0-9a-f-]{36}\/brand_logo\/([A-Za-z0-9._-]{1,128})$/i.exec(get("branding.sidebar_logo") ?? "");
          return { id: tenant.id, slug: tenant.slug, name: get("practice.name") ?? tenant.name, isPlatform,
                   logoUrl: m ? `/api/settings/branding/logo/sidebar?v=${encodeURIComponent(m[1])}` : null };
        })(),
        // ═══════════════════════════════════════════════════════════════════════════════════════
        // ★★★ WHO IS SIGNED IN. Added 2026-09-16 — F447. The chrome has always needed this and has
        //     never had it: `AvatarMenu` renders `displayName`'s initials, `app.me` was declared
        //     and only ever assigned `null`, and there is no `/api/me` route. So the avatar showed
        //     the literal fallback **"?"** on every screen for every user, and the "Your profile"
        //     menu item — which needs `appUserId` to build `/record/person/{id}` — was permanently
        //     replaced by its own disabled refusal row.
        //   ★★ the maintainer read that "?" as a broken help button. It was the avatar.
        //   ★★★ IT GOES ON THE NAV RATHER THAN A NEW ROUTE because the nav is already fetched once
        //       on boot and everything else is gated on it (`appState.boot()` awaits `loadNav()`
        //       first). A second round trip for two strings the server already holds would be a
        //       slower first paint for no correctness gain.
        //   ★ BOTH VALUES ARE ALREADY RESOLVED on the principal — `src/http/app.mjs:499-501` sets
        //     `appUserId` and `displayName` for every tenant principal. Nothing new is looked up.
        //   ★ A PLATFORM PRINCIPAL HAS NO PERSON (deliberate, §A9), so this is null for them and
        //     the menu correctly keeps its refusal row rather than linking to a record that does
        //     not exist.
        // ═══════════════════════════════════════════════════════════════════════════════════════
        me: principal.appUserId
          ? {
              appUserId: principal.appUserId,
              displayName: principal.displayName ?? null,
              role: principal.user?.role ?? null,
              staffRole: principal.user?.staff_role ?? null,
              // ═══════════════════════════════════════════════════════════════════════════════
              // ★★★ F636 — DOES THE SIGNED-IN IDENTITY HOLD A LIVE, APPROVED OPERATOR GRANT
              //     RIGHT NOW, independent of whether THIS session is a tenant session or a
              //     Platform one. Read from `keystone.operator_grant_id`, the GUC `withTenant`
              //     already sets on every browser request (`src/db/index.mjs:123`, sourced from
              //     `keystone.resolve_session`'s own subquery, migration 0208) — same
              //     `current_setting(..., true)` idiom `runTenantScoped` uses for the tenant id
              //     (`src/http/app.mjs:857`). No new lookup, no new migration.
              // ★★ TWO STATES, NOT THREE, DELIBERATELY: `keystone.operator_grant_status`'s own
              //    `COMMENT ON FUNCTION` (migration 0208) says "zero rows means inactive (no
              //    grant, unapproved, revoked or expired — the caller cannot and need not tell
              //    which)`. A coach who never held a grant and an operator whose grant lapsed are`
              //    indistinguishable here on purpose — the row this drives is ABSENT for both,
              //    never disabled-with-a-reason the server has no way to supply.
              // ═══════════════════════════════════════════════════════════════════════════════
              operatorGrantActive: await (async () => {
                const { rows } = await db.query(
                  `SELECT nullif(current_setting('keystone.operator_grant_id', true), '') IS NOT NULL AS active`);
                return rows[0]?.active === true;
              })(),
              // ═══════════════════════════════════════════════════════════════════════════════
              // ★★★ TASK 12.5 — `12-signup-first-run-people.md` §11. THE `/` → `/home` REDIRECT'S
              //     OWN INPUT. `[...path]/+page.svelte`'s `$effect` reads `app.me.needsIntake` and,
              //     when true on a `/`/`/home` path, redirects to `/signup/questions` instead —
              //     so a fresh Owner answers SignupQuestions before Home ever renders, rather than
              //     landing on Home and never being pointed at it.
              //   ★ OWNER ONLY, and NO ROW for anyone else — a coach's own `keystone.tenant_intake`
              //     absence-check would ask the same question about a table only the Owner ever
              //     writes to; nobody but the Owner is ever redirected.
              //   ★ SAME UNDERLYING FACT AS `/api/home`'s `needsIntake` (above, `index.mjs`'s own
              //     "/home" route) — one absence-check, read from two surfaces, never two.
              // ═══════════════════════════════════════════════════════════════════════════════
              needsIntake: principal.user?.role === "staff" && principal.user?.staff_role === "owner"
                ? (await db.query(`SELECT 1 FROM keystone.tenant_intake LIMIT 1`)).rows.length === 0
                : false,
              // ★ D6 [TY, RULED 23 Sep 2026] — re-read every boot, same reasoning as `me` itself:
              //   a reload must show the sidebar the way this person left it, not the default.
              sidebarCollapsed: (await db.query(
                `SELECT sidebar_collapsed FROM keystone.app_user WHERE id = $1`,
                [principal.appUserId])).rows[0]?.sidebar_collapsed === true,
              // ★ D4 [TY, RULED 23 Sep 2026] — same re-read-every-boot reasoning as
              //   `sidebarCollapsed`, immediately above: a reload must show the density this person
              //   left it at, not the default.
              density: (await db.query(
                `SELECT density FROM keystone.app_user WHERE id = $1`,
                [principal.appUserId])).rows[0]?.density ?? "compact",
              // ★★★ R-13.10 — THE SIX CALENDAR DISPLAY PREFERENCES, PER PERSON. Added 25 Sep 2026
              //     because 13.46 built the WRITE (`POST /api/me/calendar-preferences`) and nothing
              //     built the READ, so 13.43's screen had no way to show a person what their own
              //     settings currently are. ★★ Exactly the same re-read-every-boot reasoning D6/D4
              //     already gave for `sidebarCollapsed` and `density` immediately above: a reload
              //     must show the calendar the way this person left it, not the default.
              //   ★ ONE query for all six rather than six queries — `sidebarCollapsed` and
              //     `density` each have their own only because they were added a ruling apart; that
              //     is history, not a pattern worth copying six more times.
              //   ★★ DEFAULTS HERE MATCH 0403's COLUMN DEFAULTS and the CalendarSettings frame
              //     (Monday · 7:00am-8:00pm · 30 minutes · cancelled greyed for a week · by
              //     service), so a person whose row predates the migration sees the same calendar
              //     they saw yesterday rather than a silently different one.
              //   ★ 0403 IS WRITTEN AND NOT YET APPLIED (migrations apply at step 3 TEST), so this
              //     SELECT resolves only once the stage's migrations run -- the same condition every
              //     other Stage 13 read of a new column is already in.
              calendarPreferences: await (async () => {
                const { rows } = await db.query(
                  `SELECT calendar_week_starts, calendar_day_from_minute, calendar_day_to_minute,
                          calendar_slot_minutes, calendar_show_cancelled_days, calendar_colour_by
                     FROM keystone.app_user WHERE id = $1`,
                  [principal.appUserId]);
                const r = rows[0] ?? {};
                return {
                  weekStarts: r.calendar_week_starts ?? "monday",
                  dayFromMinute: r.calendar_day_from_minute ?? 420,
                  dayToMinute: r.calendar_day_to_minute ?? 1200,
                  slotMinutes: r.calendar_slot_minutes ?? 30,
                  showCancelledDays: r.calendar_show_cancelled_days ?? 7,
                  colourBy: r.calendar_colour_by ?? "service",
                };
              })(),
            }
          : null,
        // ═══════════════════════════════════════════════════════════════════════════════════════
        // ★★★ TASK 1.4 / CT-112 — THE BANNER'S OWN READ. Same F447 "resolved once on the
        //     principal, returned on every nav load" pattern `me` already established, immediately
        //     above. `principal.viewingAsAppUserId` is set inside `loadPerson`
        //     (`src/http/app.mjs`) from `resolve_session`'s own output, already NULLED when the
        //     30-minute claim has expired (0250) — so this is `null` for the ordinary case and
        //     needs no separate expiry check here. DISPLAY DATA ONLY (spec §4's own explicit
        //     invariant): no write path anywhere reads this field as an identity to act as.
        // ═══════════════════════════════════════════════════════════════════════════════════════
        viewingAs: principal.viewingAsAppUserId
          ? await (async () => {
              const { rows: vr } = await db.query(
                `SELECT id, display_name, staff_role FROM keystone.app_user WHERE id = $1`,
                [principal.viewingAsAppUserId]);
              const v = vr[0];
              // ★ The claim can outlive the row it names (a colleague removed mid-preview) — read
              //   as "no claim", the same "zero rows reads as absent" discipline the resolver uses.
              return v ? { id: v.id, displayName: v.display_name, staffRole: v.staff_role } : null;
            })()
          : null,
        // ★ Reported so a renderer can never quietly disagree with the server about the size of
        //   the nav. knownPaths().length === 75 today.
        knownPathCount: knownPaths().length,
        sectionCount: SECTIONS.length,
        // ═══════════════════════════════════════════════════════════════════════════════════════
        // ★★★ TASK 18.23 — STAFF APP ROUTER. Five tabs for every staff member: Today, People,
        //     Calendar, Get paid, More. Returned only if user.role === 'staff'; otherwise null.
        //   ★ The feature flag 'feature.staff-ui-enabled' that gated the old three-screen app
        //     did not exist in the settings registry (0 rows in production), so the old gate
        //     never passed — it was a switch wired to nothing (CLAUDE.md's "built and wired to
        //     nothing" failure #1). The new app calls only routes a staff session may already
        //     call, so there is nothing for a flag to protect. Retired here.
        // ═══════════════════════════════════════════════════════════════════════════════════════
        staff: principal.user?.role === "staff" ? [
          { key: "today", path: "/staff/today", label: "Today" },
          { key: "people", path: "/staff/people", label: "People" },
          { key: "calendar", path: "/staff/calendar", label: "Calendar" },
          { key: "get-paid", path: "/staff/get-paid", label: "Get paid" },
          { key: "more", path: "/staff/more", label: "More" },
        ] : null,
        // ★★★ P17.2 — THE BUILD STATE TRAVELS WITH THE NAV, FOR THE SAME REASON knownPathCount
        //     DOES: "so a renderer can never quietly disagree with the server." The Sidebar needs
        //     `stateFor(path)` to decide whether a row is a live link or a NAMED SectionNotBuilt
        //     (P14.11), and a browser bundle holding its own copy would keep drawing live links to
        //     rows a newer server knows are unbuilt — and a dead link is indistinguishable from a
        //     bug (B2.3). ★ buildState.mjs stays the ONE source; this only transports it.
        // ★★ Keyed by PATH and covering EVERY known path, not only the ones in `tree` — a row
        //    hidden from this principal by authorise.mjs is absent from `tree` by design (U16),
        //    and a state map with holes would make a legitimately hidden row look unbuilt.
        buildState: Object.fromEntries(knownPaths().map((p) => [p, stateFor(p)])),
        buildStateCounts: COUNTS,
      };
    }, { bucket: "nav" })
  );

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // D6 [TY, RULED 23 Sep 2026] — THE SIDEBAR REMEMBERS. Whether THIS person left the sidebar
  // collapsed to its icon rail, read back into `/api/nav`'s own `me.sidebarCollapsed` field
  // immediately above, so a reload does not re-expand a column the person just narrowed.
  // ★ A PLATFORM PRINCIPAL HAS NO PERSON (§A9, same fact `me` above is null for) — refused here
  //   rather than silently no-op'd, because a click that visibly did nothing is worse than one that
  //   explains why.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  app.post("/api/me/sidebar-collapsed", (c) =>
    crmScoped(c, async ({ db, principal, body }) => {
      if (!principal.appUserId) {
        throw forbidden("the platform console has no person row to hold this preference");
      }
      return setSidebarCollapsed(db, {
        appUserId: principal.appUserId,
        collapsed: Boolean(body?.collapsed),
      });
    }, { bucket: "write" })
  );

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // D4 [TY, RULED 23 Sep 2026] — THE SHELL REMEMBERS ITS DENSITY. Compact / comfortable / spacious,
  // read back into `/api/nav`'s own `me.density` field immediately above, same shape as
  // `/api/me/sidebar-collapsed` immediately above this block.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  app.post("/api/me/density", (c) =>
    crmScoped(c, async ({ db, principal, body }) => {
      if (!principal.appUserId) {
        throw forbidden("the platform console has no person row to hold this preference");
      }
      const density = String(body?.density ?? "");
      if (!["compact", "comfortable", "spacious"].includes(density)) {
        throw invalid(`density must be compact, comfortable or spacious, got "${density}"`);
      }
      return setDensity(db, { appUserId: principal.appUserId, density });
    }, { bucket: "write" })
  );

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // 13.46 [R-13.10] — THE CALENDAR REMEMBERS HOW THIS PERSON LIKES TO SEE IT. Week starts / the
  // visible day window / slot size / how long a cancelled day stays visible / colour-by — six DISPLAY
  // preferences, per person, same shape as `/api/me/density` immediately above this block: every
  // field optional, self-scoped to `principal.appUserId` (never a body id), no event (a display
  // preference is not a business fact — D6, same file header). A PLATFORM PRINCIPAL HAS NO PERSON
  // (§A9) — refused here with the same sentence the two sibling routes use.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  app.post("/api/me/calendar-preferences", (c) =>
    crmScoped(c, async ({ db, principal, body }) => {
      if (!principal.appUserId) {
        throw forbidden("the platform console has no person row to hold this preference");
      }
      const weekStarts = body?.calendarWeekStarts;
      if (weekStarts !== undefined && !["monday", "sunday"].includes(weekStarts)) {
        throw invalid(`calendarWeekStarts must be monday or sunday, got "${weekStarts}"`);
      }
      const slotMinutes = body?.calendarSlotMinutes;
      if (slotMinutes !== undefined && ![15, 30, 60].includes(slotMinutes)) {
        throw invalid(`calendarSlotMinutes must be 15, 30 or 60, got "${slotMinutes}"`);
      }
      const showCancelledDays = body?.calendarShowCancelledDays;
      if (showCancelledDays !== undefined && ![0, 7].includes(showCancelledDays)) {
        throw invalid(`calendarShowCancelledDays must be 0 or 7, got "${showCancelledDays}"`);
      }
      const colourBy = body?.calendarColourBy;
      if (colourBy !== undefined && !["service", "staff", "state", "program"].includes(colourBy)) {
        throw invalid(`calendarColourBy must be service, staff, state or program, got "${colourBy}"`);
      }
      const dayFromMinute = body?.calendarDayFromMinute;
      if (dayFromMinute !== undefined &&
          !(Number.isInteger(dayFromMinute) && dayFromMinute >= 0 && dayFromMinute <= 1440)) {
        throw invalid(`calendarDayFromMinute must be an integer between 0 and 1440, got "${dayFromMinute}"`);
      }
      const dayToMinute = body?.calendarDayToMinute;
      if (dayToMinute !== undefined &&
          !(Number.isInteger(dayToMinute) && dayToMinute >= 0 && dayToMinute <= 1440)) {
        throw invalid(`calendarDayToMinute must be an integer between 0 and 1440, got "${dayToMinute}"`);
      }
      if (dayFromMinute !== undefined && dayToMinute !== undefined && dayToMinute <= dayFromMinute) {
        throw invalid(
          `calendarDayToMinute (${dayToMinute}) must be after calendarDayFromMinute (${dayFromMinute})`);
      }
      return setCalendarPreferences(db, {
        appUserId: principal.appUserId,
        weekStarts,
        dayFromMinute,
        dayToMinute,
        slotMinutes,
        showCancelledDays,
        colourBy,
      });
    }, { bucket: "write" })
  );

  // ───────────────────────────────────────────────────────────────────────────
  // P12.11 — GET /api/records/:type/:id  — all 7 descriptors
  // ───────────────────────────────────────────────────────────────────────────
  app.get("/api/records/:type/:id", (c) =>
    crmScoped(c, async ({ db, c: ctx, principal, tenantId }) => {
      const type = ctx.req.param("type");
      const id = ctx.req.param("id");
      const q = RECORD_QUERIES[type];
      // ★★ AN UNKNOWN TYPE IS A REFUSAL, NOT A PASS-THROUGH — the same rule authorise.mjs:93
      //    applies to an unknown path.
      if (!q || !RECORD_TYPES[type]) throw notFound(`no record type "${type}"`);
      if (!UUID_RE.test(id)) throw invalid("record id must be a UUID", { field: "id" });

      // ★★★ P1.7 — `$2` IS THE VIEWER. A record the caller's scope does not reach returns zero rows
      //     and therefore **404, not 403** — deliberately identical to the cross-tenant answer, so a
      //     coach probing ids cannot tell "not yours" from "not there".
      let { rows } = await db.query(q.sql, [id, principal?.appUserId ?? null]);

      // ★★★ R2 — MERGE REDIRECT. If the requested person is a merged-away loser, redirect to the
      //     survivor's record. Only applies to person records; other types have no merge tombstones.
      //   ★ Check ONLY when the query returns zero rows, so the redirect is transparent to normal
      //     queries but catches archived/inaccessible losers that would otherwise 404.
      //   ★ The tombstone tells us who the survivor is; we re-query using the survivor id.
      if (rows.length === 0 && type === "person") {
        const { rows: tombstones } = await db.query(
          `SELECT survivor_id FROM keystone.person_merge_tombstone
            WHERE tenant_id = $1 AND loser_id = $2 AND undone_at IS NULL
            LIMIT 1`,
          [tenantId, id]
        );
        if (tombstones.length > 0) {
          // Re-query using the survivor id
          const { rows: survivorRows } = await db.query(q.sql, [tombstones[0].survivor_id, principal?.appUserId ?? null]);
          if (survivorRows.length > 0) {
            // Survivor found and accessible; use their record
            rows = survivorRows;
          }
        }
      }

      // ★★★ 404, NEVER 403, WHEN THE ROW IS NOT VISIBLE. RLS returns zero rows for another
      //     tenant's id; answering 403 would confirm the row EXISTS and leak across the
      //     boundary. P13.7b asserts exactly this distinction.
      // ═══════════════════════════════════════════════════════════════════════════════════════
      // ★★★ S3.2 — THE TYPE'S OWN WORDS, NOT "record not found".
      //
      //   A list screen's empty state answers *"you have none of these yet"*. A RECORD page has no
      //   such state and must never grow one — there is no "create your first" for a URL somebody
      //   followed to a record that is not there. What it owes is a sentence about the RECORD, and
      //   the generic string describes the LOOKUP instead.
      //
      // ★★★ AND THE WORDING CARRIES A SECURITY PROPERTY, WHICH IS WHY IT IS DECLARED PER TYPE AND
      //     ASSERTED AT MODULE LOAD RATHER THAN IMPROVISED HERE. "Not found" and "you may not see
      //     it" **must read identically**: this route takes an id straight off the URL, so a message
      //     that distinguished them would answer *"does a person with this id exist in this
      //     practice"* to anybody who can type a uuid. Every one of the nine sentences says both.
      //
      // ★★ SENT AS THE SERVER'S OWN MESSAGE, which is what the screen already renders — `api.js`'s
      //    rule is *"the server's own message, never a re-worded one"*, so no client change is
      //    needed and no second copy of this copy exists. **Same lesson as F378, applied before it
      //    could repeat:** a descriptor gaining a field means nothing until a route names it.
      // ═══════════════════════════════════════════════════════════════════════════════════════
      if (rows.length === 0) {
        const nf = RECORD_TYPES[type]?.notFound;
        throw notFound(nf ? `${nf.headline}. ${nf.line}` : "record not found");
      }

      // ═══════════════════════════════════════════════════════════════════════════════════════
      // ★★★ STAGE 7 / 7.15 — "EVERY PRIVATE READ LEAVES AN AUDIT ROW" (F597's resolution).
      //
      //   THIS IS THE ONE EXECUTION POINT. `RECORD_QUERIES`/`RELATED_QUERIES`
      //   (src/records/queries.mjs) are `Object.freeze()`d static SQL-string maps with no
      //   per-request JS of their own — F597 measured that and added THIS handler to 7.15's file
      //   scope for exactly that reason, rather than splicing a raw INSERT into the frozen SQL
      //   text, which would have bypassed `writeAudit`'s one-writer invariant
      //   (src/permissions/audit.mjs:11-15).
      //
      //   FIRES when the row just read IS a session note (`is_session_note`, selected by
      //   `RECORD_QUERIES.document` alongside the row itself, in the SAME query — never a second
      //   read) AND the reader is not its own author (`created_by`, 0194 §A). The assigned coach
      //   and the Owner ARE audited when they open somebody else's note; the writer reading their
      //   own note is not, because 05 §6 counts a read of somebody else's note, not your own.
      //   `rows[0].created_by` is `NULL` for a note written before 0194 — nobody recorded who
      //   wrote it, so `NULL !== appUserId` is always true and it is treated as "not the reader's
      //   own", the safe direction.
      //
      //   ★ WHO SUPPLIES THE CONDITION: the read path itself, not a guard — there is nothing here
      //     to fool (7.15 field 4).
      //   ★ SAME TRANSACTION AS THE READ: `db` is the caller's own transaction client
      //     (`withTenant`'s, per `runTenantScoped`) — a later throw in this same handler (the
      //     related-list "declared with no query" throw below, for instance) rolls this insert
      //     back with everything else, which is exactly 7.15 field 8(c)'s assertion.
      //   ★ ONLY `note.viewed` HAS A CALLER THIS STAGE. `message.viewed`/`goal.viewed`/
      //     `checkin.viewed` stay in AUDIT_ACTIONS with no caller until Stage 8/9 build those
      //     surfaces — declared to 7.20's wiring gate by name, not an oversight.
      // ═══════════════════════════════════════════════════════════════════════════════════════
      if (type === "document" && rows[0].is_session_note === true
          && rows[0].created_by !== (principal?.appUserId ?? null)) {
        await auditPrivateRead(db, {
          tenantId,
          action: "note.viewed",
          object: "document",
          subjectId: id,
          actorUserId: principal?.appUserId ?? null,
          requestId: ctx.get("requestId") ?? null,
        });
      }

      // ★★★ AND THE ACTIVITY FEED IS FETCHED IN THE SAME TRANSACTION, from `event` — F13's real
      //     table. Fetching it separately would mean a record page whose header and whose history
      //     were read at two different instants, which is how a page shows a document as `sent`
      //     above a feed that already says `executed`.
      // ★ $3 is the VIEWER (Stage 7 / 7.17 field 4.2) — the same `principal?.appUserId` already used
      //   as the viewer at :621 for the record query itself, so the invoice/payment branches are
      //   gated on the person actually making this request, not a second lookup.
      const activity = await db.query(ACTIVITY_SQL, [ACTIVITY_SUBJECT[type], id, principal?.appUserId ?? null]);

      // ★ Both field layers, in the same transaction as the row itself — a card whose fields and
      //   whose values were read at two different instants is the split-read defect one level down.
      const [customFields, hidePanels] = await Promise.all([
        customFieldValues(db, type, id),
        hiddenPanelKeys(db),
      ]);

      // ★ Seat counts for a `count` related-entry. U11: the ONLY shape available to an account.
      const relatedCounts = {};
      if (type === "account") {
        const { rows: sc } = await db.query(
          `SELECT total_seats FROM keystone.account_seat_counts($1)`, [id]);
        relatedCounts.seats = sc[0]?.total_seats ?? 0;
      }

      // ═══════════════════════════════════════════════════════════════════════════════════════
      // ★★★ TASK 2.5 — `whatKeepsWorking` FOR THE `ItemsStopSelling` CONFIRM (02-items.md §2,
      //     `specs/mockups/ItemsStopSelling.frame.html`). Computed the same way `relatedCounts`
      //     is above: a small, type-gated query run in the SAME transaction as the record read
      //     (never a second round trip after the confirm opens), and never folded into
      //     `RECORD_QUERIES`/`buildRecordShell`'s whitelist — this is an input to a CONFIRM
      //     DIALOG, not a panel field a coach reads on the card.
      //   ★ `package` has no `RECORD_TYPES` entry (no record page exists for it at all — a
      //     pre-existing gap, out of this task's scope, reported separately) so it is left out
      //     of this branch; the LIST-level Stop selling toggle (`setItemActive`) does not need
      //     this data at all, only the record-page confirm does.
      // ═══════════════════════════════════════════════════════════════════════════════════════
      let whatKeepsWorking = {};
      if (type === "service") {
        const { rows: wk } = await db.query(
          `SELECT
             (SELECT count(DISTINCT pl.package_id) FROM keystone.package_line pl
                JOIN keystone.package p ON p.id = pl.package_id AND p.tenant_id = pl.tenant_id
               WHERE pl.tenant_id = $1 AND pl.service_id = $2 AND p.active)               AS active_packages,
             (SELECT count(DISTINCT sub.id) FROM keystone.subscription sub
                JOIN keystone.plan pl2 ON pl2.id = sub.plan_id AND pl2.tenant_id = sub.tenant_id
                JOIN keystone.plan_line pll ON pll.plan_id = pl2.id AND pll.tenant_id = pl2.tenant_id
               WHERE sub.tenant_id = $1 AND pll.service_id = $2 AND sub.state = 'active')  AS live_plan_subscribers,
             (SELECT count(*) FROM keystone.booking b
               WHERE b.tenant_id = $1 AND b.service_id = $2
                 AND b.starts_at > now() AND b.state NOT IN ('cancelled'))                 AS future_bookings`,
          [tenantId, id]);
        whatKeepsWorking = {
          activePackages: Number(wk[0]?.active_packages ?? 0),
          livePlanSubscribers: Number(wk[0]?.live_plan_subscribers ?? 0),
          futureBookings: Number(wk[0]?.future_bookings ?? 0),
        };
      } else if (type === "plan") {
        // ★ A plan is not included IN a package, and no booking references a plan directly — so
        //   only `livePlanSubscribers` (this plan's own active subscribers) is a real count.
        const { rows: wk } = await db.query(
          `SELECT count(*) AS n FROM keystone.subscription sub
            WHERE sub.tenant_id = $1 AND sub.plan_id = $2 AND sub.state = 'active'`,
          [tenantId, id]);
        whatKeepsWorking = {
          activePackages: 0,
          livePlanSubscribers: Number(wk[0]?.n ?? 0),
          futureBookings: 0,
        };
      }

      // ★★★ P2.4 — THE RELATED LISTS, AS ROWS. Every `kind:'list'` entry rendered a sentence saying
      //     its rows would appear "once <of> rows exist" — and said it WHILE HOLDING THEM. The
      //     referral edge is what made that untenable: a school that has sent you three people is
      //     the case the placeholder gets wrong.
      //   ★★ IN THE SAME TRANSACTION as the row and the activity feed, for the reason stated above
      //      them: a page whose header and whose related rail were read at two different instants
      //      can show a record one way and its links another.
      //   ★ A missing query is a LOUD THROW, not an empty rail — the same contract
      //     `buildRecordShell` applies to a declared field the query forgot. An entry declared in
      //     `shell.mjs` with nothing behind it is precisely the defect this item exists to close.
      const relatedRows = {};
      for (const r of RECORD_TYPES[type].related) {
        if (r.kind !== "list") continue;
        const sql = RELATED_QUERIES[`${type}.${r.key}`];
        if (!sql) {
          throw new Error(
            `related list "${type}.${r.key}" is declared in shell.mjs and has no query in ` +
            `src/records/queries.mjs — it would render as a heading with nothing behind it`);
        }
        const { rows: rel } = await db.query(sql, [id, principal?.appUserId ?? null]);
        relatedRows[r.key] = rel;
      }

      // ★★★ TASK 12.11 — `personTabs`, PERSON RECORDS ONLY. `rows[0].id`, NOT the URL `id`: a merge
      //     redirect (R2, above) may have re-queried onto the survivor, and `personTabs` must read
      //     the row the response is actually about. Same transaction as everything above it, same
      //     reasoning as `activity`/`relatedRows` — a page whose header and whose tabs were read at
      //     two different instants is the split-read defect one level down.
      const personTabs = type === "person"
        ? await personRecordTabs(db, { viewerId: principal?.appUserId ?? null, personId: rows[0].id })
        : undefined;

      // ★★★ the maintainer, 29 Sep 2026 — THE SAME ONE DECISION POINT THE LIST ROUTE USES (line ~1763 below),
      //     computed here for the RECORD page's portal-invite control. `RECORD_QUERIES.person`
      //     selects the three raw facts (`email_bounced_at`/`has_ever_signed_in`/`invited_at`);
      //     `portal_status` replaces them on the row so the raw facts never reach `shell.fields`
      //     (CONTROL_KEYS is a whitelist — only what is explicitly added below is visible), the
      //     same discipline the list route's own comment states for exactly these three keys.
      if (type === "person") {
        rows[0].portal_status = portalStatus({
          hasEverSignedIn: rows[0].has_ever_signed_in,
          invitedAt: rows[0].invited_at,
          emailBouncedAt: rows[0].email_bounced_at,
        });
      }

      return {
        // ★★★ P2.2 — THE OTHER TWO FIELD LAYERS, RESOLVED PER TENANT AND HANDED IN AS DATA.
        //     CUSTOM arrives as `{key,label,kind,value}[]`; TEMPLATE arrives as the panel keys to
        //     HIDE. Neither goes through the static descriptors, because `buildRecordShell` throws
        //     on a declared field the row does not carry — and tenant B's query will never select
        //     tenant A's custom field. **Two mechanisms, kept apart.**
        shell: buildRecordShell(type, rows[0], { customFields, hidePanels }),
        activity: activity.rows,
        relatedCounts,
        relatedRows,
        // ★ TASK 2.5 — see the computation above; `{}` for every type but service/plan, so the
        //   confirm dialog can always read `data.whatKeepsWorking.activePackages` etc. without a
        //   type check of its own.
        whatKeepsWorking,
        // ★ TASK 12.11 — present ONLY for `type === "person"`, never an empty object for anything
        //   else (RecordFull/RecordTeen/RecordNew/RecordArchived/RecordCoach/RecordDocument/
        //   RecordInvoice all read this key; every other record type has no tabs at all).
        ...(personTabs ? { personTabs } : {}),
      };
    }, { bucket: "records" })
  );

  // ───────────────────────────────────────────────────────────────────────────
  // P15.5 — THE LIST VIEWS. Query AND screen, for the eight areas P15.5 names.
  // ───────────────────────────────────────────────────────────────────────────
  app.get("/api/list/*", (c) =>
    crmScoped(c, async ({ db, principal, c: ctx, tenantId }) => {
      const path = "/" + ctx.req.path.split("/api/list/")[1];
      const view = LIST_VIEWS[path];
      if (!view) throw notFound(`no list view for "${path}"`);

      // ★★★ THE SECTION IS AUTHORISED SERVER-SIDE BEFORE THE QUERY RUNS. U16: "client-side role
      //     gating is NOT a security boundary — the server decides on every request." A list
      //     route that trusted the sidebar would be reachable by typing the URL.
      const isPlatform = await tenantIsPlatform(db, tenantId);
      const decision = authoriseSection(principal.user, path, {
        tenantIsPlatform: isPlatform,
      });
      if (!decision.allowed) throw forbidden(`section refused: ${decision.reason}`);

      // ★★★ "YOU MAY NOT SEE THIS" IS NOT "THERE IS NOTHING HERE" (F-R2-10, 26 Sep 2026). A coach
      //     whose role grants `none` on invoices got 200 + 0 rows, and the screen said "You haven't
      //     sent an invoice yet". The objects are DERIVED from the view's own scope predicate
      //     (`user_may($1,'<object>'…)`), so this can never disagree with the rows: if no role the
      //     viewer holds grants view-or-better on ANY of them, the view can never show a row — refuse.
      //   ★ A staff member holding no role at all is left to the transitional path in scoped().
      {
        const objects = [...new Set([...view.sql.matchAll(/user_may\(\$1,\s*'([a-z_]+)'/g)].map((m) => m[1]))];
        const viewerId = principal?.appUserId ?? null;
        if (objects.length > 0 && viewerId) {
          const { rows: [g] } = await db.query(
            `SELECT count(*)::int AS roles,
                    count(*) FILTER (WHERE rp.object = ANY($2) AND rp.verb <> 'none' AND rp.scope <> 'none')::int AS may
               FROM keystone.user_role ur
               LEFT JOIN keystone.role_permission rp ON rp.role_id = ur.role_id
              WHERE ur.user_id = $1`,
            [viewerId, objects]);
          if (g.roles > 0 && g.may === 0) {
            throw forbidden(`Your role can't see ${view.title ? view.title.toLowerCase() : "this list"}. ` +
              `An owner or admin can change that in Settings › Roles.`);
          }
        }
      }

      // ★★★ P1.7 — THE VIEWER IS BOUND AS `$1` ON EVERY LIST, WITHOUT EXCEPTION. Each view's SQL
      //     carries either `keystone.user_may($1, …)` — the per-grant scope predicate — or, for the
      //     objects `src/permissions/ownership.mjs` marks un-ownable, the fail-closed `$1 IS NOT
      //     NULL`. ★★ The arity is uniform ON PURPOSE: the alternative is this line deciding, per
      //     list, whether to bind a parameter, and that is a decision with 29 chances to be wrong.
      //   ★ `appUserId` is NULL for a platform principal (no tenant person), and that is correct:
      //     no viewer, no rows. Platform's own surfaces live in `/api/platform/*`, not here.
      // ═══════════════════════════════════════════════════════════════════════════════════════════
      // ★★★ 5.4 — THE PAGE QUERY. The 45 views are NOT touched: each is wrapped as a subquery and
      //     `LIMIT`/`OFFSET` ride on the outside, so a view's own `ORDER BY` still decides the order.
      //   · `$2 = limit + 1` — the extra row is how `hasMore` is known without a second query. It is
      //     dropped before serialising.
      //   · `count(*) OVER ()` is the whole scoped set's ROW COUNT, identical on every row, which is
      //     `page.totalCount`. It is a transport detail, so it is STRIPPED from every row: leaving it
      //     would put an undeclared field on all 45 lists.
      //   · The view's SQL goes on its own lines so a trailing `--` comment cannot swallow `) v`.
      // ═══════════════════════════════════════════════════════════════════════════════════════════
      const limit = parseListLimit(ctx.req.query("limit"));
      const cursorRaw = ctx.req.query("cursor");
      const offset = cursorRaw === undefined ? 0 : decodeCursor(cursorRaw);
      const viewer = principal?.appUserId ?? null;
      const { rows: pageRows } = await db.query(
        `SELECT v.*, count(*) OVER () AS total_count FROM (\n${view.sql}\n) v LIMIT $2 OFFSET $3`,
        [viewer, limit + 1, offset]);
      const hasMore = pageRows.length > limit;
      const rows = pageRows.slice(0, limit).map(({ total_count: _tc, ...row }) => row);
      // ★ `Number()` IS MANDATORY: node-postgres returns `count(*)` (int8) as a STRING and this
      //   codebase sets no type parser. A string here would not fail — it would just be the wrong type.
      let totalCount;
      if (pageRows.length > 0) {
        totalCount = Number(pageRows[0].total_count);
      } else if (offset === 0) {
        totalCount = 0;
      } else {
        // ★ A cursor past the end (rows removed between two page requests) returns no rows, and the
        //   window count lives on the rows — so ask once, rather than report 0 for a non-empty list.
        const cnt = await db.query(`SELECT count(*) AS n FROM (\n${view.sql}\n) v`, [viewer]);
        totalCount = Number(cnt.rows[0].n);
      }

      // ═══════════════════════════════════════════════════════════════════════════════════════════
      // ★★★ U5 — THE PRACTICE'S IANA ZONE TRAVELS WITH EVERY LIST, AND IT HAS TO COME FROM HERE.
      //
      // `starts_at` is a `timestamptz` — an INSTANT. To draw a week grid you need the LOCAL
      // wall-clock, and *"local wall-clock plus IANA zone, never stored UTC"* is the ruling.
      // ★★★ THE BROWSER`S ZONE IS THE WRONG ANSWER AND IT IS WRONG SILENTLY. A coach on holiday in`
      //     another zone, or a laptop that never had its clock set, would see a different grid for
      //     the same practice — and every session would still be in *a* plausible slot, so nothing
      //     would look broken. **A wrong answer that looks right is the expensive kind.**
      //   ★★ AND IT IS A DST QUESTION, NOT A CONSTANT OFFSET ONE. The week containing a transition
      //      has a 23-hour and a 25-hour day; an offset captured once, or taken from the viewer's
      //      machine, puts every session in that week an hour out of place.
      // ★ ON EVERY LIST, NOT JUST THE CALENDAR: uniform shape beats a per-path decision with 45
      //   chances to be wrong, and any list with a `date`/`datetime` column has the same need.
      // ═══════════════════════════════════════════════════════════════════════════════════════════
      const tz = await db.query(`SELECT timezone FROM keystone.tenant WHERE id = $1`, [tenantId]);

      // ═══════════════════════════════════════════════════════════════════════════════════════════
      // ★★★ U7.2 — THE TOTAL IS THE SERVER'S FIGURE. *"The question is always how much is
      //     outstanding."*
      //
      // ★★ COMPUTED HERE, NOT IN THE BROWSER. A browser `reduce()` over the rows it happens to hold
      //    is exact ONLY while nothing paginates — and the day a `LIMIT` is added it becomes a sum
      //    of the first page **wearing the authority of a grand total**, with nothing to notice it.
      //  ★★★ 5.4 — THE `LIMIT` HAS BEEN ADDED (above), SO THIS HAS MOVED INTO SQL, AS THE SEPARATE
      //      AGGREGATE THIS COMMENT USED TO PREDICT. `rows` is now ONE PAGE, and a reduce over it would
      //      be "the total of the first 50 rows" wearing a grand total's authority. `total` KEEPS ITS
      //      MEANING (a money sum in minor units — both bundles format it as currency, gated on
      //      `typeof view.total === "number"`); the ROW COUNT is the separate `page.totalCount`.
      // ★ Minor units in, minor units out — no currency maths in a route. The screen formats it
      //   through the same `formatValue` every money cell already uses.
      // ═══════════════════════════════════════════════════════════════════════════════════════════
      const totalColumn = view.totalColumn ?? null;
      // ★★★ AND A MIXED-CURRENCY LIST HAS NO SINGLE TOTAL. `amount_minor` is an integer count of
      //     minor units with NO currency of its own — the descriptor names a separate `currency`
      //     column, because *"an amount with no currency is a number, and 1200 is not a price"*
      //     (`web/src/record/format.js`). **Adding 120000 USD to 95000 GBP yields 215000 of
      //     nothing**, and it would render with a currency symbol and look completely credible.
      //   ★★ So the total is produced ONLY when every row agrees on one currency. Otherwise it is
      //      `null` and `totalCurrencies` says why, which the screen can state — a refusal to add
      //      up is a fact worth showing, and it is infinitely better than a confident wrong figure.
      const currencyColumn = totalColumn
        ? (view.columns.find((c) => c.field === totalColumn)?.currency ?? null) : null;
      // ★★ 5.4 — ONE EXTRA AGGREGATE over the SAME scoped set, on 2 of the 45 lists (`money.mjs:71,185`)
      //    and none of the others. It reports the sum AND the distinct currencies of the WHOLE set, so
      //    "one currency or several" is decided over every row and not over the page — a page of 50
      //    that happens to be all-USD must not certify a total over 60 USD and 60 GBP rows.
      //    (`array_agg(DISTINCT …) OVER ()` is not legal Postgres, and `min/max OVER ()` would name only
      //    two of three currencies; both bundles print `totalCurrencies.join(" and ")`.)
      // ★★★ `Number()` ON THE SUM: node-postgres returns `sum()` as a STRING. `ListView` gates the whole
      //    figure row on `typeof view.total === "number"`, so a string would make it vanish silently.
      let currencies = [];
      let wholeSetSum = 0;
      if (totalColumn) {
        const totalIdent = quoteIdent(totalColumn, "totalColumn");
        const currencyExpr = currencyColumn
          ? `array_agg(DISTINCT v.${quoteIdent(currencyColumn, "currency column")}) ` +
            `FILTER (WHERE v.${quoteIdent(currencyColumn, "currency column")} IS NOT NULL)`
          : "NULL::text[]";
        const agg = await db.query(
          `SELECT sum(v.${totalIdent})::numeric AS total_sum, ${currencyExpr} AS currencies ` +
          `FROM (\n${view.sql}\n) v`,
          [viewer]);
        currencies = (agg.rows[0]?.currencies ?? []).filter(Boolean);
        wholeSetSum = Number(agg.rows[0]?.total_sum ?? 0) || 0;
      }
      const oneCurrency = currencies.length <= 1;
      const total = totalColumn && oneCurrency ? wholeSetSum : null;

      // ═══════════════════════════════════════════════════════════════════════════════════════
      // ★★★ TOUCH-UP · WORKSTREAM 6.1 — THE ROLE-AWARE EMPTY STATE / PERMISSION BANNER.
      //     OPT-IN: only the descriptors that name `emptyState.noWrite` (currently
      //     `/items/services`, `/people/parents` — `src/records/lists/items.mjs`,
      //     `src/records/lists/people.mjs`) pay for the extra `keystone.user_may` round trip; the
      //     other 43 keep the single-query shape they have always had.
      //   ★★ THE SAME PREDICATE EVERY GRANT CHECK IN THIS CODEBASE USES — `keystone.user_may`,
      //      never a hand-rolled role check — and `permissionObjectFor(view.recordType)` is the
      //      SAME resolver `src/records/queries.mjs`'s related-list scoping uses, so this cannot
      //      name a permission object those call sites would disagree with.
      //   ★ `p_owner_id = NULL`: both flagged lists are effectively unowned FOR THIS QUESTION —
      //     services have no per-person owner at all, and a Coach never owns a parent record — so
      //     "can this viewer edit an unowned row of this object" is exactly "can they write here
      //     at all", not a narrower question than the banner is answering.
      // ═══════════════════════════════════════════════════════════════════════════════════════
      let canWrite = null;
      let emptyStateOut = view.emptyState ?? null;
      let noWriteNotice = null;
      if (view.emptyState?.noWrite) {
        // ★ RUN-2 C3 — `/items/coupons` has `recordType: null` (it has no record page) and a noWrite
        //   state, so this asked OWNERSHIP about "null" and 500'd the whole list. Such a view declares
        //   `permissionObject`; a view with neither still throws, by name, rather than guessing.
        // ★★★ FIX, 30 Sep 2026 ("New package button is hidden" brief) — `permissionObject` now WINS
        //   over `recordType` when a view names both, not the reverse. MEASURED: `/items/plans` sets
        //   `recordType: 'plan'` for its OWN, separate job (routing a row to its record page), but
        //   `'plan'` is not a key in `OWNERSHIP` at all — under the old `recordType ?? permissionObject`
        //   order, adding `noWrite` to that view would have thrown the exact RUN-2 C3 failure the
        //   comment above describes, the moment anyone declared it. A view naming `permissionObject`
        //   explicitly is saying "ask about THIS object, regardless of what recordType is for" — every
        //   existing caller (Services, Parents: recordType only; Coupons: permissionObject only) sees
        //   no change, since only one of the two was ever set for them.
        const object = permissionObjectFor(view.permissionObject ?? view.recordType);
        const may = await db.query(`SELECT keystone.user_may($1, $2, 'edit', NULL) AS ok`, [viewer, object]);
        canWrite = may.rows[0]?.ok === true;
        noWriteNotice = view.emptyState.noWrite.notice ?? null;
        if (!canWrite) {
          const { noWrite, ...rest } = view.emptyState;
          emptyStateOut = { ...rest, ...noWrite };
        }
      }
      // ★ TOUCH-UP · WORKSTREAM 6.2 — same opt-in shape as `noWrite` immediately above, gated on
      //   `emptyState.firstRun` so only `/engagements/calendar` pays for the extra query. Same
      //   in-force predicate `coachHoursSet` uses (`src/routes/index.mjs`'s own `/api/capabilities`,
      //   above) — never a second, possibly-drifted copy of "what counts as an hour."
      if (view.emptyState?.firstRun) {
        const hours = await db.query(
          `SELECT count(*) AS n FROM keystone.availability_rule a
             WHERE a.effective_from <= current_date
               AND (a.effective_to IS NULL OR a.effective_to > current_date)`);
        if (Number(hours.rows[0]?.n ?? 0) === 0) {
          const { firstRun, noWrite, ...rest } = emptyStateOut;
          emptyStateOut = { ...rest, ...firstRun, kind: 'first-run' };
        }
      }

      // ═══════════════════════════════════════════════════════════════════════════════════════
      // ★★★ TASK 12.17 — PORTAL STATUS COLLAPSES, MONEY COLUMNS DROP BY GRANT, THE SUMMARY RIDES
      //     ALONG. All three are per-VIEW opt-ins (a descriptor that selects none of these raw
      //     facts/columns pays nothing extra) rather than a fifth hard-coded special case, matching
      //     the `noWrite`/`firstRun` opt-in shape immediately above.
      //
      // · PORTAL — `portalStatus()` (`src/people/portalStatus.mjs`) is the ONE decision point over
      //   the three raw facts `PORTAL` (`src/records/lists/people.mjs`) selects; this is its first
      //   real caller (the wiring ratchet drops by one orphan). A row that never selected the three
      //   raw keys is left untouched — `in` on the exact key, not a truthy check, so a genuinely
      //   `false`/`null` fact still triggers the collapse for a row that DOES carry them.
      // · MONEY — a column declaring `requires: 'invoice.view'` is dropped from `columns` AND its
      //   value/currency keys deleted from every row for a viewer who holds the grant NOWHERE at
      //   all (`user_may($1,'invoice','view',NULL)`); the per-row `OWES`/`state` CASE in the SQL
      //   itself is the finer, per-owner gate — defense in depth, not a duplicate.
      // · SUMMARY — `view.summarySql`, run with the SAME `$1 = viewer` every row query binds, so a
      //   summary can never disagree with what the rows it summarises were scoped to see.
      // ═══════════════════════════════════════════════════════════════════════════════════════
      const portalRows = rows.map((r) => {
        if (!('has_ever_signed_in' in r)) return r;
        const { has_ever_signed_in, email_bounced_at, invited_at, ...rest } = r;
        return {
          ...rest,
          portal_status: portalStatus({
            hasEverSignedIn: has_ever_signed_in,
            emailBouncedAt: email_bounced_at,
            invitedAt: invited_at,
          }),
        };
      });
      const moneyCols = view.columns.filter((c) => c.requires === 'invoice.view');
      let columns = view.columns;
      let outRows = portalRows;
      if (moneyCols.length) {
        const m = await db.query(`SELECT keystone.user_may($1,'invoice','view',NULL) AS ok`, [viewer]);
        if (m.rows[0]?.ok !== true) {
          columns = view.columns.filter((c) => c.requires !== 'invoice.view');
          outRows = portalRows.map((r) => {
            const o = { ...r };
            for (const c of moneyCols) { delete o[c.field]; delete o[c.currency]; }
            return o;
          });
        }
      }
      const summary = view.summarySql ? (await db.query(view.summarySql, [viewer])).rows[0] ?? null : null;

      return {
        path,
        title: view.title,
        columns,
        recordType: view.recordType ?? null,
        empty: view.empty,
        canWrite,
        noWriteNotice,
        summary,
        // ═══════════════════════════════════════════════════════════════════════════════════════
        // ★★★ S2.2 — THE FOUR-PART EMPTY STATE TRAVELS WITH THE LIST, AND WITHOUT THIS LINE NONE OF
        //     IT REACHES A SCREEN.
        //
        //   All 45 descriptors carry `emptyState` — kind, icon, headline, line, action, and the
        //   blocked variants. This route returned only `empty`, the legacy STRING, so the client
        //   fell back to the no-headline, no-icon, no-action shape on every one of the 45.
        //   [EXECUTED 2026-09-16] found by fetching the DEPLOYED bundle and grepping for copy that
        //   only this work introduces — "Nothing on your plate", "Add your first client" — and
        //   finding none of it, in the client OR the server response. **The descriptors were right
        //   and the wire dropped them.**
        //
        // ★★ BOTH KEYS ARE SENT, DELIBERATELY, FOR AS LONG AS BOTH BUNDLES ARE LIVE. The React
        //    `ListView` renders `empty` as a text node and would throw "Objects are not valid as a
        //    React child" on the block; the Svelte one prefers `emptyState` and falls back to the
        //    string. `emptyOf()` DERIVES the string from the block's own `line`, so they cannot
        //    disagree — and S6.2 deletes `empty` when the React bundle goes.
        // ═══════════════════════════════════════════════════════════════════════════════════════
        emptyState: emptyStateOut,
        totalColumn,
        total,
        totalCurrency: currencies[0] ?? null,
        // ★ Named, not just counted: a screen that says "two currencies" is reportable; one that
        //   says "no total" is a mystery.
        totalCurrencies: currencies,
        // ★★ `?? null`, NEVER `?? "UTC"`. A missing zone is a fact the screen must be able to state;
        //    defaulting to UTC would silently draw a London week for a Californian practice.
        timezone: tz.rows[0]?.timezone ?? null,
        rows: outRows,
        // ★★★ 5.4 — CT-011's `page`, plus CCR-14's `totalCount`. `rows` STAYS (Q0-3), so no client changes.
        //   `nextCursor` is opaque to the client; `totalCount` is the whole scoped set's row count,
        //   the same number on every page — and NOT `total`, which is money.
        page: { limit, nextCursor: hasMore ? encodeCursor(offset + limit) : null, hasMore, totalCount },
      };
    }, { bucket: "list" })
  );

  // ───────────────────────────────────────────────────────────────────────────
  // /home — the dashboard. Counts only, each one a link to the list behind it.
  // ───────────────────────────────────────────────────────────────────────────
  app.get("/api/home", (c) =>
    crmScoped(c, async ({ db, principal, tenantId }) => {
      const requestId = c.get("requestId") ?? null;
      const viewer = principal?.appUserId ?? null;
      // ★ Computed BEFORE the tile loop below, which reads it — moved up from its original spot
      //   (which threw "Cannot access 'isOwnerOrAdmin' before initialization", F707) to stay a
      //   `const` computed once, not a function re-evaluated per tile.
      const isOwner = principal.user?.role === "staff" && principal.user?.staff_role === "owner";
      const isOwnerOrAdmin = isOwner || (principal.user?.role === "staff" && principal.user?.staff_role === "admin");
      const isStaff = principal.user?.role === "staff";

      // ═══════════════════════════════════════════════════════════════════════════════════════
      // ★★★ TASK 17.27 — DETERMINE `view` TYPE. `view:'first_run'` when practice has no
      //     non-staff, non-sample, non-archived app_user row. ONE query, used here to decide the
      //     response view type (17.27 owns this decision; 17.35 owns the screen).
      // ═══════════════════════════════════════════════════════════════════════════════════════
      const { rows: viewRows } = await db.query(
        `SELECT EXISTS(SELECT 1 FROM keystone.app_user
          WHERE role <> 'staff' AND is_sample IS NOT true AND archived_at IS NULL) AS has_people`);
      const isFirstRun = !viewRows[0]?.has_people;
      const view = isFirstRun ? 'first_run' : (isStaff ? (isOwner || isOwnerOrAdmin ? 'owner' : 'staff') : 'staff');

      const tiles = [];
      for (const t of HOME_TILES) {
        // ★★★ MONEY-BAND FILTERING: non-Owner/Admin viewers skip money tiles entirely, never sent to browser.
        if (t.band === "money" && !isOwnerOrAdmin) {
          continue;
        }
        // ★★★ THE VIEWER IS BOUND HERE TOO. This line read `db.query(t.sql)` — no parameter, no
        //     predicate — so the dashboard counted the whole tenant for everybody. A tile is a
        //     number AND A DESTINATION; one that disagrees with its own list is a leak and a lie.
        const { rows } = await db.query(t.sql, [principal?.appUserId ?? null]);
        // ★ A tile is a NUMBER AND A DESTINATION. A figure nobody can take apart is a decoration.
        const tile = { key: t.key, label: t.label, path: t.path, count: rows[0]?.n ?? 0, band: t.band };
        if (t.money) {
          tile.money = true;
          tile.currency = rows[0]?.currency ?? "USD";
        }
        tiles.push(tile);
      }

      // ═══════════════════════════════════════════════════════════════════════════════════════
      // ★★★ TASK 17.27 — BANDS RUN INDEPENDENTLY. Each band uses SAVEPOINT/ROLLBACK so one
      //     failure never blanks another. Bands run SEQUENTIALLY (one pg client cannot run
      //     savepoints in parallel).
      // ═══════════════════════════════════════════════════════════════════════════════════════

      // HERO BAND — owner/admin money or staff sessions
      const heroBand = await runBand(db, "hero", async () => {
        if (isOwnerOrAdmin) {
          // Owner/Admin hero: this/last month payment amounts
          const { rows: heroRows } = await db.query(HOME_HERO_SQL, [viewer]);  // scoped() consumes $1 — this failed every time
          const thisMonthMinor = heroRows[0]?.this_month_minor ?? 0;
          const lastMonthMinor = heroRows[0]?.last_month_minor ?? 0;
          const firstPaymentAt = heroRows[0]?.first_payment_at;

          // Check if first payment is < 45 days old
          const now = new Date();
          const sinceStarted = firstPaymentAt &&
            (new Date(firstPaymentAt).getTime() > now.getTime() - 45 * 24 * 60 * 60 * 1000);

          // Compute delta sentence
          let deltaSentence;
          if (sinceStarted) {
            deltaSentence = thisMonthMinor > 0 ? `since you started` : `$0 since you started`;
          } else {
            const delta = thisMonthMinor - lastMonthMinor;
            const deltaMoney = new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: "USD",
              minimumFractionDigits: 0,
            }).format(Math.abs(delta) / 100);
            const direction = delta >= 0 ? "▲" : "▼";
            const lastMonthDate = subMonths(new TZDate(now.getTime(), "UTC"), 1);
            const monthName = format(lastMonthDate, "LLLL");
            deltaSentence = `${direction} ${deltaMoney} on ${monthName}`;
          }

          return {
            amountMinor: thisMonthMinor,
            sessions: undefined,
            deltaSentence,
            sinceStarted: sinceStarted ?? false,
          };
        } else if (isStaff) {
          // Staff hero: sessions this week vs last week
          // ★ RLS-scoped by the booking table's RLS policies; crmScoped wrapper ensures
          //   the viewer is bound via current_user_id() and current_tenant_id() GUCs.
          const { rows: sessionsThisWeek } = await db.query(
            `SELECT count(*)::int AS n FROM keystone.booking b
             WHERE b.starts_at >= date_trunc('week', now())
               AND b.state IN ('confirmed','pending_payment','completed')`);
          const { rows: sessionsLastWeek } = await db.query(
            `SELECT count(*)::int AS n FROM keystone.booking b
             WHERE b.starts_at >= date_trunc('week', now()) - interval '7 days'
               AND b.starts_at < date_trunc('week', now())
               AND b.state IN ('confirmed','pending_payment','completed')`);

          const thisWeek = sessionsThisWeek[0]?.n ?? 0;
          const lastWeek = sessionsLastWeek[0]?.n ?? 0;
          const delta = thisWeek - lastWeek;
          const direction = delta >= 0 ? "▲" : "▼";
          const deltaSentence = `${direction} ${Math.abs(delta)} on last week`;

          return {
            amountMinor: undefined,
            sessions: thisWeek,
            deltaSentence,
            sinceStarted: false,
          };
        }
      }, requestId);

      // PROMPTS BAND — computed prompts from engine, capped at HOME_PROMPT_CEILING
      const promptsBand = await runBand(db, "prompts", async () => {
        const { prompts, total } = await computePrompts(db, {
          viewerId: viewer,
          canSeeMoney: isOwnerOrAdmin,
          surface: 'home',
          filter: 'everything',
        });
        // ★ Engine already caps home at HOME_PROMPT_CEILING; prompts are ≤3
        return {
          items: prompts,
          moreCount: Math.max(0, total - prompts.length),
        };
      }, requestId);

      // TODAY BAND — today's sessions (not error-wrapped, per existing behavior)
      const { rows: todayRows } = await db.query(HOME_TODAY_SQL, [viewer]);

      // NEEDS YOU BAND — things waiting on the viewer
      const { rows: needsRows } = await db.query(HOME_NEEDS_YOU_SQL, [viewer]);

      // WEEK BAND — this week's slots (not error-wrapped, per existing behavior)
      const { rows: weekRows } = await db.query(HOME_WEEK_SQL, [viewer]);

      // MONEY BAND — owner/admin money details (omitted for non-owner/admin)
      let moneyBand = undefined;
      if (isOwnerOrAdmin) {
        moneyBand = await runBand(db, "money", async () => {
          // ★★ Was `return {}` — the band printed "$0.00 owed to you" beside $1,900 outstanding
          //    (26 Sep 2026). Every figure is a row count or a sum of mirrored rows; none is estimated.
          const { rows: [m] } = await db.query(
            `SELECT
               (SELECT COALESCE(SUM(po.owes_minor), 0)::bigint
                  FROM keystone.person_owes po) AS owed,
               (SELECT COALESCE(SUM(ie.amount_remaining_minor), 0)::bigint
                  FROM keystone.invoice_effective ie
                  JOIN keystone.invoice i ON i.id = ie.id
                 WHERE ie.status = 'open' AND i.due_at < now()) AS late,
               (SELECT COALESCE(SUM(p.amount_minor - p.refunded_minor), 0)::bigint FROM keystone.payment_effective p
                 WHERE p.status IN ('succeeded', 'partially_refunded')
                   AND COALESCE(p.received_at, p.created_at) >= date_trunc('month', now())) AS this_month,
               (SELECT count(*)::int FROM keystone.booking b
                 WHERE b.state IN ('confirmed', 'pending_payment', 'completed')
                   AND b.starts_at >= date_trunc('week', now())
                   AND b.starts_at < date_trunc('week', now()) + interval '7 days') AS sessions,
               (SELECT count(*)::int FROM keystone.app_user u
                 WHERE u.role IN ('adult_client', 'adolescent_client') AND u.lifecycle_status = 'active'
                   AND u.archived_at IS NULL
                   AND NOT EXISTS (SELECT 1 FROM keystone.booking_participant bp
                                     JOIN keystone.booking b ON b.id = bp.booking_id
                                    WHERE bp.app_user_id = u.id AND b.state <> 'cancelled'
                                      AND b.starts_at > now() - interval '30 days')) AS drifting,
               ${unsignedInstanceCountExpr("d")} AS unsigned`);
          return {
            owedMinor: Number(m.owed), lateMinor: Number(m.late), thisMonthMinor: Number(m.this_month),
            sessions: m.sessions, drifting: m.drifting, unsigned: m.unsigned,
          };
        }, requestId);
      }

      // FOUND BAND — owner/admin audit findings (F09, optional reader from 17.35 discovery)
      let foundBand = undefined;
      if (isOwnerOrAdmin) {
        // found band is present if reader exists; absent if not. For now, absent.
      }

      // PEOPLE BAND — staff-only client metrics
      let peopleBand = undefined;
      if (isStaff) {
        peopleBand = await runBand(db, "people", async () => {
          const { rows: peopleRows } = await db.query(HOME_STAFF_PEOPLE_SQL, [viewer]);  // scoped() consumes $1
          return {
            clients: peopleRows[0]?.clients ?? 0,
            drifting: peopleRows[0]?.drifting ?? 0,
            notesToWrite: peopleRows[0]?.notes_to_write ?? 0,
          };
        }, requestId);
      }

      // HEADLINE — composed from sessions this week and availability
      // ★ For v1, omit detailed day clauses (calling readSlots 7 times for each day's slots
      //   is deferred to 17.35's screen composition logic). Compose headline with available data.
      let headline = { text: "", strong: [] };
      const headlineBand = await runBand(db, "headline", async () => {
        let sessionsThisWeek = 0;

        // Count total sessions from week rows
        if (weekRows && weekRows.length > 0) {
          sessionsThisWeek = weekRows.reduce((sum, r) => sum + (r.n ?? 0), 0);
        }

        // Compose headline (no day clauses for now)
        const role = view === 'owner' ? 'owner' : 'staff';
        return composeHeadline({
          role,
          sessionsThisWeek,
          owedMinor: 0,
          currency: "USD",
          days: [],
          drifting: peopleBand && !peopleBand.error ? (peopleBand.drifting ?? 0) : 0,
        });
      }, requestId);
      if (headlineBand && !headlineBand.error) {
        headline = headlineBand;
      }

      // ═══════════════════════════════════════════════════════════════════════════════════════
      // ★★ EXISTING FIELDS — kept for compatibility with existing screens.
      // ═══════════════════════════════════════════════════════════════════════════════════════
      const { rows: sampleCount } = await db.query(
        `SELECT count(*) AS n FROM keystone.app_user WHERE is_sample = true AND archived_at IS NULL`);
      const { rows: intake } = isOwner
        ? await db.query(`SELECT 1 FROM keystone.tenant_intake LIMIT 1`)
        : Promise.resolve({ rows: [] });
      const { rows: teamToday } = isOwner
        ? await db.query(HOME_TEAM_TODAY_SQL)
        : Promise.resolve({ rows: [] });
      const { rows: hasServices } = await db.query(`SELECT EXISTS(SELECT 1 FROM keystone.service) AS x`);
      const { rows: hasPackages } = await db.query(`SELECT EXISTS(SELECT 1 FROM keystone.package) AS x`);
      const { rows: hasPlans } = await db.query(`SELECT EXISTS(SELECT 1 FROM keystone.plan) AS x`);
      const { shape: tenantShape } = await tenantIdentity(db, tenantId);

      // Build response object with proper payload rule (no money keys for non-owner/admin)
      const response = {
        view,
        hero: heroBand && !heroBand.error ? heroBand : { deltaSentence: "", sinceStarted: false },
        headline,
        prompts: promptsBand && !promptsBand.error ? promptsBand : { items: [], moreCount: 0 },
        today: todayRows,
        week: weekRows,
        tiles,
        sampleBanner: { count: Number(sampleCount[0]?.n ?? 0) },
        needsIntake: isOwner && intake.length === 0,
        // ★★ `total` IS REPORTED SEPARATELY AND THE ROWS ARE STRIPPED OF IT. The query bounds the
        //    page at 12 and reports the true backlog through `count(*) OVER ()`, so the screen can
        //    say "and 9 more" rather than showing twelve things and implying that is all there is.
        // ★★ THE HREF IS COMPOSED HERE, WHERE THE ROUTE TABLE LIVES. The query returns
        //    `record_type` and `id`; this turns them into a path.
        needsYou: needsRows.map(({ total, record_type, ...r }) =>
          ({ ...r, href: `/record/${record_type}/${r.id}` })),
        needsYouTotal: needsRows[0]?.total ?? 0,
        teamToday,
        hasServices: Boolean(hasServices[0]?.x),
        hasPackages: Boolean(hasPackages[0]?.x),
        hasPlans: Boolean(hasPlans[0]?.x),
        shape: tenantShape,
      };

      // Add optional bands only if owner/admin and populated
      if (isOwnerOrAdmin && moneyBand && !moneyBand.error) {
        response.money = moneyBand;
      }
      if (foundBand && !foundBand.error) {
        response.found = foundBand;
      }
      if (isStaff && peopleBand && !peopleBand.error) {
        response.people = peopleBand;
      }

      // ★★★ PAYLOAD RULE: For non-owner/admin viewers, REMOVE all money-related keys
      if (!isOwnerOrAdmin) {
        // Recursively remove money-related keys
        const removeMoneyKeys = (obj) => {
          if (!obj || typeof obj !== 'object') return obj;
          if (Array.isArray(obj)) return obj.map(removeMoneyKeys);
          const result = {};
          for (const [key, val] of Object.entries(obj)) {
            if (!['money', 'amountMinor', 'owedMinor', 'currency'].includes(key)) {
              result[key] = removeMoneyKeys(val);
            }
          }
          return result;
        };
        return removeMoneyKeys(response);
      }

      return response;
    }, { bucket: "home" })
  );

  // ───────────────────────────────────────────────────────────────────────────
  // P15.9 / U23 — CapabilityLocked and the onboarding checklist, RENDERED AT LAST.
  // ★★ Both modules already existed and had never been called by anything but a test.
  // ───────────────────────────────────────────────────────────────────────────
  app.get("/api/capabilities", (c) =>
    crmScoped(c, async ({ db, tenantId }) => {
      const { rows: steps } = await db.query(
        `SELECT name, state, attempts, max_attempts, last_error, last_error_retryable
           FROM keystone.provisioning_step ORDER BY ordinal`);

      // ═══════════════════════════════════════════════════════════════════════════════════════════
      // ★★★ P5.2 — THE REAL-STATE COUNTS. `provisioning_step` answers "did OUR jobs finish"; these
      //     answer "can this practice actually trade yet", and the setup meter needs the second.
      //
      // ★★★ KS-9.4, LITERALLY: *"services priced is true when an ACTIVE PRICE ROW exists."* So
      //     `servicesPriced` counts services that HAVE such a row — it does NOT read
      //     `service.price_minor`. ★★ That column still exists and is the superseded one: P2.5 ruled
      //     that a definition carries no price and that a price change is a NEW ROW, never an edit.
      //     Counting `price_minor IS NOT NULL` would mark a service "priced" from a value no
      //     invoice is raised from — a superseded column still being read, which is a defect class
      //     this project has already been bitten by twice.
      //
      // ★★ AND THE WINDOW IS CHECKED, not just the flag. `active = true` with an `effective_to` in
      //    the past is a price that HAS expired; treating it as current would tell a practice it is
      //    ready to bill on a rate that no longer applies. Both conditions, as P2 requires.
      // ═══════════════════════════════════════════════════════════════════════════════════════════
      const { rows: [counts] } = await db.query(`
        SELECT
          (SELECT count(*) FROM keystone.service s
            WHERE s.active AND s.archived_at IS NULL)                        AS services_defined,
          (SELECT count(*) FROM keystone.service s
            WHERE s.active AND s.archived_at IS NULL
              AND EXISTS (SELECT 1 FROM keystone.price p
                           WHERE p.subject_type = 'service' AND p.subject_id = s.id
                             AND p.active
                             AND p.effective_from <= now()
                             AND (p.effective_to IS NULL OR p.effective_to > now())))
                                                                             AS services_priced,
          -- ★ A CLIENT, not a person. Staff are created by provisioning and by invitation; counting
          --   them would make "add your first client" tick itself the moment the practice exists.
          (SELECT count(*) FROM keystone.app_user u
            WHERE u.role <> 'staff' AND u.archived_at IS NULL)               AS people_added,

          -- ═══════════════════════════════════════════════════════════════════════════════════
          -- ★★★ S2.3 — THE OTHER THREE ROOTS OF THE BLOCKED CHAIN. Twelve of the 45 list screens
          --     are BLOCKED and the spec requires each to point at its blocker from the SAME
          --     SOURCE this meter reads — "one truth, two surfaces". Three of the four roots had
          --     no count, so three quarters of the chain had nothing to resolve against.
          -- ═══════════════════════════════════════════════════════════════════════════════════

          -- ★★ A rule that is IN FORCE, not merely a row. effective_to is nullable and an ended
          --    rule is kept rather than deleted (a deleted rule makes past bookings inexplicable),
          --    so counting rows would report hours for a coach whose availability lapsed in March.
          --    Same reasoning as services_priced checking the price WINDOW and not just the flag.
          (SELECT count(*) FROM keystone.availability_rule a
            WHERE a.effective_from <= current_date
              AND (a.effective_to IS NULL OR a.effective_to > current_date)) AS coach_hours_set,

          -- ★ ACTIVE templates only. A deactivated template still exists because instruments sent
          --   against it must keep resolving, but nothing new can be sent from it — so counting it
          --   would tell a practice it can send when it cannot.
          ${activeTemplateCountExpr("t")}                                     AS templates_created,

          -- ★★ A LIVE grant, not a historical one. revoked_at IS NULL is the same predicate the
          --    /accounts/access list uses to decide whether a property is connected, so the meter
          --    and the screen cannot disagree about what "connected" means.
          (SELECT count(*) FROM keystone.account_grant g
            WHERE g.revoked_at IS NULL)                                      AS properties_connected,

          -- ★ The fifth root, and the twelfth blocked screen. A campaign sends ONE message to ONE
          --   list, so with no segment there is nobody for it to go to.
          (SELECT count(*) FROM keystone.segment)                            AS lists_created,

          -- ★ An ACTIVE plan. A deactivated one cannot start a new subscription.
          (SELECT count(*) FROM keystone.plan pl
            WHERE pl.active AND pl.archived_at IS NULL)                        AS plans_created,

          -- ★★★ F371 — SIX SCREENS BLOCK ON AN ACCOUNT EXISTING, NOT ON A CONNECTED PROPERTY. The
          --     four Build-Wire-Run lists, Monitoring and Access all carry ONE ROW PER ACCOUNT, so
          --     they are empty only while this count is zero.
          (SELECT count(*) FROM keystone.account a
            WHERE a.archived_at IS NULL)                                     AS accounts_added,

          -- ★ Stripe is connected when a connect_account exists with state 'live' or 'restricted'
          -- (FOUNDRY IS the platform's own Stripe account — keystone.stripe_account is_platform, 0575 — so it
          --  has no connect_account row and used to read "not connected" beside live Stripe money.)
          ((SELECT count(*) FROM keystone.connect_account c
             WHERE c.state IN ('live', 'restricted'))
           + (SELECT count(*) FROM keystone.stripe_account sa
               WHERE sa.tenant_id = keystone.current_tenant_id()))             AS connect_stripe,

          -- ★ the maintainer, 29 Sep 2026 — done when a version of the client-invite template has ever been
          --   SAVED (any version, active or not) — a real row, not a flag; see the checklist
          --   spec's own comment for why this is the honest thing to measure.
          (SELECT count(*) FROM keystone.email_template t
            WHERE t.key = 'auth.client_invite')                               AS client_invite_reviewed
      `);

      const realState = {
        servicesDefined: Number(counts.services_defined),
        servicesPriced: Number(counts.services_priced),
        peopleAdded: Number(counts.people_added),
        coachHoursSet: Number(counts.coach_hours_set),
        templatesCreated: Number(counts.templates_created),
        propertiesConnected: Number(counts.properties_connected),
        listsCreated: Number(counts.lists_created),
        plansCreated: Number(counts.plans_created),
        accountsAdded: Number(counts.accounts_added),
        connectStripe: Number(counts.connect_stripe),
        clientInviteReviewed: Number(counts.client_invite_reviewed),
      };

      // ★ PART 4.7 [TY, RULED 23 Sep 2026] — steps filter by shape. Reuses `tenantIdentity`, the
      //   same row `GET /api/nav` reads `shape` from.
      const { shape } = await tenantIdentity(db, tenantId);

      // ★ Check if provisioning questions were answered (sets up starter services)
      const { rows: qaRows } = await db.query(
        `SELECT 1 FROM keystone.event
          WHERE topic = 'provisioning.questions.answered' LIMIT 1`);
      const questionsAnswered = qaRows.length > 0;

      return {
        capabilities: renderableCapabilities(steps),
        checklist: buildOnboardingChecklist(steps, realState, shape, questionsAnswered),
      };
    }, { bucket: "settings" })
  );

  // ───────────────────────────────────────────────────────────────────────────
  // 17.25 — What's new: Release notes and Feature log.
  // ───────────────────────────────────────────────────────────────────────────
  app.get("/api/whats-new", (c) =>
    crmScoped(c, async () => {
      // ★★★ PARSED ONCE AT MODULE LOAD, NEVER PER REQUEST. See parser.mjs for the caching note.
      return getWhatsNew();
    }, { bucket: "settings" })
  );

  // ───────────────────────────────────────────────────────────────────────────
  // P12.12 — THE FOUR ✅ ROWS. NOTHING FOR ❌ ROWS, AND NOTHING FOR ⚠️ ROWS.
  // ───────────────────────────────────────────────────────────────────────────

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // TASK 6.3 (06-settings.md §2.3) — /settings/notifications, REBUILT AS THE EVENTS × ROLE MATRIX.
  //
  // ★★★ TWO THINGS CHANGED FROM THE ROUTE THIS REPLACES, BOTH MEASURED GAPS.
  //   1. ADMIN-ONLY, NOW ACTUALLY ENFORCED. [MEASURED] this route was ONE OF SIX with no role
  //      predicate at all (`:171` above, in THIS SAME FILE's own header note) — `crmScoped` alone
  //      is staff-vs-not-staff, so any Coach could read the tenant's whole notification
  //      configuration even though `/settings` itself already declares `minRole: 'admin'`
  //      (`src/nav/sections.mjs:50`). §2.3's own error column states this directly: "this screen
  //      moves from 'any staff' to admin-only … a practice-wide setting." Same
  //      `authoriseSection(principal.user, …, {tenantIsPlatform})` precedent as
  //      `/api/people/team/two-step-status` above (`:374-378`) — `/settings/notifications`'s own nav
  //      row carries no `minRole` of its own, so it INHERITS the parent section's `admin` floor
  //      (`src/nav/authorise.mjs:70-84`'s child-inherits-parent rule).
  //   2. THE RESPONSE SHAPE. The old query answered "every person's own preference row" — itself the
  //      OTHER measured gap this same header note names (`:171`: "EVERY person's notification
  //      preferences, ORDER BY app_user_id"). §2.3 replaces it with the PRACTICE's own default
  //      matrix — one row per (topic, role, channel), read from `keystone.notification_rule`
  //      (0336), never from `notification_preference` (a DIFFERENT, per-person table `SettingsMine`
  //      — not built by any spec yet, §14 — still owns).
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  app.get("/api/settings/notifications", (c) =>
    crmScoped(c, async ({ db, principal, tenantId }) => {
      const isPlatform = await tenantIsPlatform(db, tenantId);
      const decision = authoriseSection(principal.user, "/settings/notifications", { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`section refused: ${decision.reason}`);

      // TASK 20.25 — read practice rules for all topics (not just those with rows; defaults are
      // materialised lazily, never migrated). Build matrix with provenance for each cell.
      const { rows: practiceRules } = await db.query(
        `SELECT topic, role, channel, enabled, locked FROM keystone.notification_rule`);
      const practiceByKey = new Map(practiceRules.map((r) => [`${r.topic}|${r.role}|${r.channel}`, { enabled: r.enabled, locked: r.locked }]));

      const topics = NOTIFICATION_TOPICS.map(({ topic, label, defaultOn, locked }) => ({
        key: topic,
        label,
        locked,
        roles: Object.fromEntries(NOTIFICATION_ROLES.map((role) => [
          role,
          Object.fromEntries(NOTIFICATION_CHANNELS.map((channel) => {
            const practice = practiceByKey.get(`${topic}|${role}|${channel}`);
            // Resolution: practice > default (personal tier is not in settings matrix)
            const enabled = practice ? practice.enabled : defaultOn;
            const provenance = practice ? "practice" : "default";
            return [channel, { enabled, provenance }];
          })),
        ])),
      }));

      return {
        topics,
        lastChanged: await lastChangedBy(db, tenantId, "settings.notifications"),
      };
    }, { bucket: "settings" })
  );

  // TASK 20.25 — PUT /settings/notifications: write practice rules for the matrix.
  app.put("/api/settings/notifications", (c) =>
    crmScoped(c, async ({ db, principal, tenantId }) => {
      const isPlatform = await tenantIsPlatform(db, tenantId);
      const decision = authoriseSection(principal.user, "/settings/notifications", { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`section refused: ${decision.reason}`);

      const { topic, role, channel, enabled } = c.req.json();
      // Locked-entry check before setNotificationRule: return 409 with reason for locked topics
      const defaults = getCatalogueDefaults(topic);
      if (!defaults) {
        throw invalid(`topic "${topic}" is not in the notification catalogue`);
      }
      if (defaults.locked) {
        throw conflict(
          `"${NOTIFICATION_TOPICS.find((t) => t.topic === topic)?.label}" is always on and cannot be changed here`);
      }

      await setNotificationRule(db, {
        tenantId, topic, role, channel, enabled, actorUserId: principal.user.id,
      });

      return { updated: true };
    }, { bucket: "settings" })
  );

  // ───────────────────────────────────────────────────────────────────────────
  // P15C.6 — /settings/documents. ★★★ THE SEVEN AXES LIVE HERE, AND THEY LIVE HERE AS SEVEN.
  // ───────────────────────────────────────────────────────────────────────────
  // ★★ AUDIENCE AND ASSIGNED-TO ARE DIFFERENT QUESTIONS AND BOTH MUST PASS (0012). The route returns
  //    them as SEPARATE fields and the UI renders them as separate controls — collapsing them loses one
  //    or the other:
  //      · `audience` is ORG POLICY, set once per TYPE — "may a parent ever see a consent form?"
  //      · `default_assigned_to` is THIS DOCUMENT's parties — "is this particular instrument for them?"
  //    Per-type alone shows a client every other client's agreement; per-document alone is hand-set
  //    visibility that does not survive a second tenant.
  // ★ The VOCABULARIES come with the response, from the server's own frozen lists, so the builder UI
  //   cannot offer a value the database would refuse — and cannot hold a second copy of the axes.
  app.get("/api/settings/documents", (c) =>
    crmScoped(c, async ({ db }) => {
      const { categories, types } = await settingsCategoriesAndTypes(db);
      return {
        categories,
        types,
        // ★★ THE SIGNING ORDER TRAVELS WITH THE CONFIG. P15C.7's rule: expose it FROM THE SERVER; the
        //    front end must not re-declare it, because a second declaration is a second answer to "who
        //    signs next" and P4.10 measured what that costs.
        vocabulary: {
          signer_configs: SIGNER_CONFIGS,
          audiences: AUDIENCES,
          divisions: DIVISIONS,
          applies_to: APPLIES_TO,
          assignment_targets: ASSIGNMENT_TARGETS,
        },
      };
    }, { bucket: "settings" })
  );

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Task 6.2 / 06-settings.md §2.2 — /settings/integrations (`SetIntegrations`). ★★★ SAME PATH,
  // RESHAPED RESPONSE, NOT A NEW ROUTE — the onboarding checklist this path used to serve moved to
  // `/settings/setup-checklist` (`Screen.svelte`, `webui/src/lib/app/Shell.svelte`); this URL now
  // renders the actual integrations list.
  // ★★ EVERY ROW IS A REAL SIGNAL, NEVER INVENTED (§2.2): Google Workspace connected = any
  //    non-revoked `google_identity` row; Stripe connected = `workbench_subscription
  //    .stripe_customer_id IS NOT NULL`. `available`/`comingLater` carry no backing table — they are
  //    the spec's own static list, matching MOCKUPS §13:419 verbatim.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  app.get("/api/settings/integrations", (c) =>
    crmScoped(c, async ({ db, tenantId }) => {
      const [{ rows: googleRows }, { rows: subRows }, { rows: gtmRows }] = await Promise.all([
        db.query(
          `SELECT google_email FROM keystone.google_identity
            WHERE tenant_id = $1 AND grant_state <> 'withdrawn'
            ORDER BY granted_at DESC LIMIT 1`,
          [tenantId]),
        db.query(
          `SELECT stripe_customer_id, updated_at FROM keystone.workbench_subscription WHERE tenant_id = $1`,
          [tenantId]),
        db.query(
          `SELECT value FROM keystone.tenant_setting
            WHERE tenant_id = $1 AND key = 'run.gtm_container_id'`,
          [tenantId]),
      ]);
      const connected = [];
      const available = [];
      if (googleRows.length > 0) {
        connected.push({
          key: "google-workspace", name: "Google Workspace",
          detail: googleRows[0].google_email ?? "Connected",
        });
      } else {
        available.push({
          key: "google-workspace", name: "Google Workspace",
          detail: "Connect your mailbox and calendar", href: "/settings/email",
        });
      }
      if (subRows[0]?.stripe_customer_id) {
        connected.push({
          key: "stripe", name: "Stripe", detail: "Connected",
          lastSyncedAt: subRows[0].updated_at,
        });
      } else {
        available.push({
          key: "stripe", name: "Stripe", detail: "Connect a payment account", href: "/settings/billing",
        });
      }
      if (gtmRows[0]?.value) {
        connected.push({
          key: "gtm", name: "Google Tag Manager", detail: gtmRows[0].value,
        });
      } else {
        available.push({
          key: "gtm", name: "Google Tag Manager", detail: "One snippet carries tracking and your business details",
          action: "gtm",
        });
      }
      available.push(
        { key: "outlook", name: "Outlook", detail: "Coming with calendar sync",
          href: "/settings/integrations" },
        { key: "website-embed", name: "Website embed", detail: "Add a booking form to your site",
          href: "/settings/developer/embeds" },
      );
      const comingLater = [
        { key: "zoom", name: "Zoom" },
        { key: "quickbooks", name: "QuickBooks" },
        { key: "zapier", name: "Zapier" },
        { key: "texting", name: "Texting" },
      ];
      return { connected, available, comingLater };
    }, { bucket: "settings" })
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Task 16.27 — GET /api/run/gtm · Google Tag Manager snippet endpoint
  // ───────────────────────────────────────────────────────────────────────────
  // ★ Same guard as other settings/integrations routes: `crmScoped`, admin-floor.
  app.get("/api/run/gtm", (c) =>
    crmScoped(c, async ({ db, principal, tenantId }) => {
      const { gtmSnippets } = await import("../run/gtm.mjs");
      const { rows: settingRows } = await db.query(
        `SELECT value FROM keystone.tenant_setting
          WHERE tenant_id = $1 AND key = 'run.gtm_container_id'`,
        [tenantId]);
      const containerId = settingRows[0]?.value ?? null;
      if (!containerId) {
        return { containerId: null, snippets: null };
      }
      const { rows: tenantRows } = await db.query(
        `SELECT name, slug FROM keystone.tenant WHERE id = $1`,
        [tenantId]);
      const practice = tenantRows[0];
      if (!practice) {
        throw internal("tenant row not found");
      }
      const snippets = gtmSnippets({ containerId, practice });
      return { containerId, snippets };
    }, { bucket: "settings" })
  );

  // Task 16.36 — GET /api/growth/campaigns/:id · campaign details with results
  app.get("/api/growth/campaigns/:id", (c) =>
    crmScoped(c, async ({ db, principal, tenantId }) => {
      const may = await db.query(`SELECT keystone.user_may($1, $2, 'view', NULL) AS ok`, [principal.appUserId, 'campaign']);
      if (may.rows[0]?.ok !== true) throw forbidden("no permission");
      const { campaignResults } = await import("../growth/campaigns.mjs");
      const campaignId = c.req.param("id");
      const { rows: campaignRows } = await db.query(
        `SELECT id, tenant_id, name, subject, body, segment_id, leave_out_segment_id, never_more_than_days, state, created_at, scheduled_for AS scheduled_at, sent_at FROM keystone.campaign WHERE tenant_id = $1 AND id = $2`,
        [tenantId, campaignId]);
      if (!campaignRows.length) throw notFound("campaign not found");
      const campaign = campaignRows[0];
      const results = await campaignResults(db, { tenantId, campaignId });
      return { campaign, results };
    }, { bucket: "list" })
  );

  // Task 20.43 — GET /api/growth/campaign-groups/:id/results · rollup results for a group
  app.get("/api/growth/campaign-groups/:id/results", (c) =>
    crmScoped(c, async ({ db, principal, tenantId }) => {
      const may = await db.query(`SELECT keystone.user_may($1, $2, 'view', NULL) AS ok`, [principal.appUserId, 'campaign']);
      if (may.rows[0]?.ok !== true) throw forbidden("no permission");
      const { getCampaignGroupResults } = await import("../growth/campaignGroups.mjs");
      const groupId = c.req.param("id");
      const results = await getCampaignGroupResults(db, { tenantId, groupId });
      return results;
    }, { bucket: "list" })
  );

  // Task 16.36 — GET /api/growth/audience · compute segment audience with exclusions
  app.get("/api/growth/audience", (c) =>
    crmScoped(c, async ({ db, principal, tenantId }) => {
      const may = await db.query(`SELECT keystone.user_may($1, $2, 'view', NULL) AS ok`, [principal.appUserId, 'campaign']);
      if (may.rows[0]?.ok !== true) throw forbidden("no permission");
      const { campaignAudience } = await import("../growth/campaigns.mjs");
      const segmentId = c.req.query("segmentId") ?? null;
      if (!segmentId) throw invalid("choose a segment to count its audience");
      const leaveOutSegmentId = c.req.query("leaveOutSegmentId") ?? null;
      const audience = await campaignAudience(db, { tenantId, segmentId, leaveOutSegmentId });
      return { audience };
    }, { bucket: "list" })
  );

  // Task 20.47 — GET /api/growth/forms — list all form templates for the tenant
  app.get("/api/growth/forms", (c) =>
    crmScoped(c, async ({ db, principal, tenantId }) => {
      const may = await db.query(`SELECT keystone.user_may($1, $2, 'view', NULL) AS ok`, [principal.appUserId, 'campaign']);
      if (may.rows[0]?.ok !== true) throw forbidden("no permission");
      const { listFormTemplates } = await import("../growth/forms.mjs");
      const forms = await listFormTemplates(db, tenantId);
      return { forms };
    }, { bucket: "list" })
  );

  // Task 20.47 — POST /api/growth/forms — create a new form template
  app.post("/api/growth/forms", (c) =>
    crmScoped(c, async ({ db, principal, tenantId, body }) => {
      const may = await db.query(`SELECT keystone.user_may($1, $2, 'edit', NULL) AS ok`, [principal.appUserId, 'campaign']);
      if (may.rows[0]?.ok !== true) throw forbidden("no permission");
      const { createFormTemplate } = await import("../growth/forms.mjs");
      const form = await createFormTemplate(db, tenantId, body, principal.appUserId);
      return { form };
    }, { bucket: "list" })
  );

  // Task 20.47 — GET /api/growth/forms/:id — fetch a single form template
  app.get("/api/growth/forms/:id", (c) =>
    crmScoped(c, async ({ db, principal, tenantId }) => {
      const may = await db.query(`SELECT keystone.user_may($1, $2, 'view', NULL) AS ok`, [principal.appUserId, 'campaign']);
      if (may.rows[0]?.ok !== true) throw forbidden("no permission");
      const { getFormTemplate } = await import("../growth/forms.mjs");
      const formId = c.req.param("id");
      const form = await getFormTemplate(db, tenantId, formId);
      return { form };
    }, { bucket: "list" })
  );

  // Task 20.47 — POST /api/growth/forms/:id — update a form template
  app.post("/api/growth/forms/:id", (c) =>
    crmScoped(c, async ({ db, principal, tenantId, body }) => {
      const may = await db.query(`SELECT keystone.user_may($1, $2, 'edit', NULL) AS ok`, [principal.appUserId, 'campaign']);
      if (may.rows[0]?.ok !== true) throw forbidden("no permission");
      const { updateFormTemplate } = await import("../growth/forms.mjs");
      const formId = c.req.param("id");
      const form = await updateFormTemplate(db, tenantId, formId, body);
      return { form };
    }, { bucket: "list" })
  );

  // /platform/tenants
  app.get("/api/platform/tenants", operatorRead(async ({ db }) => {
    // ★★★ THROUGH THE GATED DEFINER LISTER (migration 0018), NEVER `SELECT … FROM tenant`.
    //     A direct read here is FORCE RLS under `id = current_tenant_id()` and returns exactly
    //     ONE row — the platform tenant itself — with no error. A platform console showing one
    //     customer looks like a platform with one customer. The lister is gated on
    //     keystone.caller_is_platform(), so any other tenant's context gets zero rows FROM THE
    //     DATABASE, not merely from the middleware in front of it (§K3).
    const { rows } = await db.query(`SELECT * FROM keystone.platform_list_tenants()`);
    return { tenants: rows };
  }));

  // /platform/provisioning
  app.get("/api/platform/provisioning", operatorRead(async ({ db }) => {
    // ★ Same gate. Counts only — no step payload and no last_error, which can carry a
    //   vendor response body and therefore another tenant's data.
    const { rows } = await db.query(`SELECT * FROM keystone.platform_list_provisioning_runs()`);
    return { runs: rows };
  }));

  // ───────────────────────────────────────────────────────────────────────────
  // ★★ EVERY OTHER NAV PATH ANSWERS HONESTLY RATHER THAN 404-ing.
  //    P14.11's rule ("a ❌ row renders SectionNotBuilt, NAMED, never a dead link") has a server
  //    half: a path that IS in the ruled nav and has no route yet must say so in those words.
  //    A bare 404 is indistinguishable from a typo, and that is how a dead link survives.
  // ───────────────────────────────────────────────────────────────────────────
  app.get("/api/section/*", (c) =>
    crmScoped(c, async ({ principal, c: ctx, db, tenantId }) => {
      const path = "/" + ctx.req.path.split("/api/section/")[1];
      const isPlatform = await tenantIsPlatform(db, tenantId);
      const decision = authoriseSection(principal.user, path, {
        tenantIsPlatform: isPlatform,
      });
      if (!decision.allowed) throw forbidden(`section refused: ${decision.reason}`);
      // ════════════════════════════════════════════════════════════════════════════════════════
      // ★★★ P4.12 — THE SERVER SAYS **WHICH** FACT. IT USED TO SAY THE SAME THING ABOUT EVERYTHING.
      //
      //   This returned a FIXED `{ path, state: "SectionNotBuilt", detail }` for every path, while
      //   `stateFor(path)` (src/nav/buildState.mjs) was already producing four honest states
      //   carrying `reason`, `phase` and `cut`. **All three were thrown away here.**
      //   ★★ So `SectionNotBuilt.jsx`'s `state?.state === "cut"` was ALWAYS FALSE and
      //      `state?.reason` was ALWAYS `undefined`: [EXECUTED] a CUT feature and a PHASE-DEFERRED
      //      one rendered the identical sentence over an EMPTY reason paragraph — a blank-value
      //      violation on the honest-empty-state screen itself.
      //
      // ★★★ THE THREE FACTS ARE DIFFERENT PROMISES AND MUST NOT SHARE A SENTENCE:
      //       cut          — this will never exist. Stop waiting for it.
      //       not_built    — it is planned, and here is the phase that builds it.
      //       no_read_path — the TABLE exists and the query does not. Different work, different ETA.
      //     Collapsing them is how a plan stops describing reality — buildState.mjs's own words.
      // ★ `state` keeps its legacy spelling for any existing reader, and the honest value travels
      //   beside it rather than replacing it, so this is additive rather than a breaking change.
      // ════════════════════════════════════════════════════════════════════════════════════════
      const honest = stateFor(path);
      return {
        path,
        state: "SectionNotBuilt",
        buildState: honest.state,
        cut: honest.cut ?? false,
        phase: honest.phase ?? null,
        reason: honest.reason ?? null,
        detail:
          honest.state === "cut"
            ? `This was cut from the plan and will not be built. ${honest.reason ?? ""}`.trim()
            : honest.state === "no_read_path"
              ? `The data for this exists; the screen that reads it does not yet. ${honest.reason ?? ""}`.trim()
              : `This is planned and not built yet.${honest.phase ? ` It is PHASE ${honest.phase}.` : ""}` +
                `${honest.reason ? ` ${honest.reason}` : ""}`,
      };
    }, { bucket: "nav" })
  );

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // ★★★ P18.9 — RETRIEVE THE ARCHIVED PDF OF AN EXECUTED INSTRUMENT.
  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // ★★ THIS ONE CANNOT USE `crmScoped`, AND THE REASON IS NOT A LOOPHOLE. `crmScoped` ends in
  //    `c.json(r)`; this route returns PDF BYTES. So it calls `runTenantScoped` directly and applies
  //    **the same `assertCrmPrincipal`** — the predicate, not the wrapper, is the boundary.
  //  ★ Written this way deliberately rather than by adding a `raw: true` option to `crmScoped`: a
  //    wrapper with a mode flag is a wrapper that can be called in the wrong mode. One extra line here
  //    is cheaper than a flag that can be set wrong on a route nobody re-reads.
  //
  // ★★★ THE HASH IS CHECKED BEFORE ANYTHING IS SERVED — see `fetchArchivedPdf`. "Retrieve a real PDF"
  //     is satisfied by a 200 and some bytes, but a 200 and some bytes only proves that SOMETHING came
  //     back. Comparing against the sha256 recorded at archive time is what makes it the same document,
  //     and a mismatch is a refusal rather than a served file with a warning nobody reads.
  app.get("/api/documents/:id/pdf", async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) {
      const e = invalid("document id must be a UUID", { field: "id" });
      return c.json(e.toResponse().body, e.statusCode);
    }
    const out = await runTenantScoped(c, async ({ db, principal }) => {
      assertCrmPrincipal(principal);
      return fetchArchivedPdf(db, { instanceId: id });
    }, { bucket: "documents" });
    return c.body(out.body, 200, {
      "content-type": "application/pdf",
      // ★ `inline` and a real filename: an executed agreement is something a person READS, and a
      //   download named after a UUID is a file nobody can identify later (U30's spirit, one layer out).
      "content-disposition": `inline; filename="executed-${id}.pdf"`,
      // ★★ THE HASH TRAVELS WITH THE BYTES. A caller that stores this file can re-verify it later
      //    against the same digest the archive row holds, without asking this server again.
      "x-keystone-sha256": out.sha256,
      "x-keystone-archived-at": new Date(out.archivedAt).toISOString(),
      // ★ An executed instrument is immutable (U25), so its rendering is too — it may be cached hard.
      "cache-control": "private, max-age=31536000, immutable",
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PERSON ATTACHMENTS — LIST, CREATE, DELETE
  // ───────────────────────────────────────────────────────────────────────────
  // ★ LIST ATTACHMENTS on a person record.
  app.get("/api/people/:id/attachments", async (c) => {
    const personId = c.req.param("id");
    if (!UUID_RE.test(personId)) {
      const e = invalid("person id must be a UUID", { field: "id" });
      return c.json(e.toResponse().body, e.statusCode);
    }
    const out = await runTenantScoped(c, async ({ db }) => {
      const { listAttachments } = await import("../records/attachments.mjs");
      return { attachments: await listAttachments(db, { tenantId: (await db.query(
        "SELECT current_setting('app.tenant_id')::uuid AS id")).rows[0].id, personId }) };
    }, { bucket: "records" });
    return c.json(out.attachments);
  });

  // ★ CREATE ATTACHMENT on a person record. Body: {filename, fileData (base64), contentType (opt)}
  app.post("/api/people/:id/attachments", async (c) => {
    const personId = c.req.param("id");
    if (!UUID_RE.test(personId)) {
      const e = invalid("person id must be a UUID", { field: "id" });
      return c.json(e.toResponse().body, e.statusCode);
    }
    const out = await runTenantScoped(c, async ({ db, principal, body, tenantId }) => {
      // ★★★ RUN-2 T17 (26 Sep 2026) — THIS ROUTE CHECKED NOTHING: any signed-in principal, a CLIENT
      //     included, could attach a file to ANY person in the practice (ROUTE-AUTH-AUDIT.md, UNGUARDED).
      //     Same two-layer guard as POST /api/tasks: the section floor, then the object/verb/scope check
      //     with the person as the owned subject — the server decides on every request.
      const isPlatform = await tenantIsPlatform(db, tenantId);
      const decision = authoriseSection(principal.user, "/people/all", { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
      await assertMay(db, principal, { object: "person", action: "edit", subject: personId });
      if (!body || typeof body !== "object") throw invalid("a JSON object body is required");
      const { filename, fileData, contentType } = body;
      if (!filename) throw invalid("filename is required", { field: "filename" });
      if (!fileData) throw invalid("fileData is required (base64-encoded)", { field: "fileData" });

      let fileBuffer;
      try {
        fileBuffer = Buffer.from(fileData, "base64");
      } catch (e) {
        throw invalid(`fileData must be valid base64: ${e.message}`);
      }

      const { createAttachment } = await import("../records/attachments.mjs");
      return createAttachment(db, {
        tenantId, personId, filename, contentType, fileBuffer, actorUserId: principal?.appUserId
      });
    }, { bucket: "records" });
    return c.json(out, 201);
  });

  // ★ DELETE ATTACHMENT (soft-delete).
  app.post("/api/people/:id/attachments/:attachmentId/delete", async (c) => {
    const personId = c.req.param("id");
    const attachmentId = c.req.param("attachmentId");
    if (!UUID_RE.test(personId)) {
      const e = invalid("person id must be a UUID", { field: "id" });
      return c.json(e.toResponse().body, e.statusCode);
    }
    if (!UUID_RE.test(attachmentId)) {
      const e = invalid("attachment id must be a UUID", { field: "attachmentId" });
      return c.json(e.toResponse().body, e.statusCode);
    }
    const out = await runTenantScoped(c, async ({ db, principal, tenantId }) => {
      // ★★★ RUN-2 T17 — was UNGUARDED (any signed-in principal could delete any attachment). Same guard,
      //     `delete` verb.
      const isPlatform = await tenantIsPlatform(db, tenantId);
      const decision = authoriseSection(principal.user, "/people/all", { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
      await assertMay(db, principal, { object: "person", action: "delete", subject: personId });
      const { deleteAttachment } = await import("../records/attachments.mjs");
      return deleteAttachment(db, { tenantId, id: attachmentId, actorUserId: principal?.appUserId });
    }, { bucket: "records" });
    return c.json(out);
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // TELEMETRY — screen views and flow steps, for evidence-based analysis.
  // CHEAP and FAIL-SILENT: telemetry must never interrupt user work.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  app.post("/api/telemetry", async (c) => {
    // Deliberately NOT using crmScoped — telemetry is low-stake and auth overhead is unnecessary.
    // Parse the request without throwing, so telemetry failures never interrupt the user.
    try {
      const body = await c.req.json?.().catch(() => null);
      // ★ FIX (live bug report, 24 Sep 2026) — `c.json(null, 204)` throws `TypeError: Response
      //   constructor: Invalid response status code 204`: Hono's `c.json()` always attaches a
      //   serialized body ("null"), and the Fetch spec forbids ANY body on a 204/205/304 response.
      //   `c.body(null, 204)` is Hono's own no-body path — it sends the status with nothing
      //   attached, which is what a null-body status requires. Every telemetry POST hit this,
      //   500ing on the one line meant to make telemetry silent.
      if (!body || typeof body !== "object") return c.body(null, 204);

      const { kind, path, detail } = body;
      if (kind !== "screen_view" && kind !== "flow_step") return c.body(null, 204);
      if (!path || typeof path !== "string") return c.body(null, 204);

      // Write telemetry inside a transaction, fail-silent.
      await runTenantScoped(c, async ({ db, principal, tenantId }) => {
        const { recordScreenView, recordFlowStep } = await import("../telemetry/index.mjs");
        if (kind === "screen_view") {
          await recordScreenView(db, { tenantId, appUserId: principal?.appUserId, path });
        } else if (kind === "flow_step") {
          await recordFlowStep(db, { tenantId, appUserId: principal?.appUserId, path, detail });
        }
      }, { bucket: "nav" });
    } catch (e) {
      if (process.env.DEBUG_TELEMETRY) console.error("[telemetry route]", e.message);
    }
    // Always return 204 No Content, so the browser knows the telemetry hit the server
    // but has nothing to parse — fire-and-forget from the client's view.
    return c.body(null, 204);
  });
}

// ★ RECORD_SOURCES is gone — see the note above. queries.mjs is the single source now.
