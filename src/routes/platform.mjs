// ═══════════════════════════════════════════════════════════════════════════════════════════════
// P6.82 — `/platform/health`, AND THE TWO FUNCTIONS THAT HAD NO CALLERS.
//
// ★★★ `calendarHealth()` AND `findSilentlyBrokenConnections()` WERE WRITTEN AND NEVER CALLED.
//     [MEASURED 2026-09-15] `src/booking/calendarSync.mjs:173` and `:44`; the only caller of the
//     second is the first, and the first has NO caller anywhere in `src/`. The logic that detects a
//     calendar quietly missing change events existed the whole time and nothing ever ran it.
//
// ★★★ AND THE ROW LIED IN THE OTHER DIRECTION TOO. `/platform/health` was marked **`built`** in the
//     build-state map while there was NO ROUTE AT ALL (`F110` / P6.0): `/healthz` and `/readyz` are
//     PRE-AUTH and excluded from the SPA fallback, so they cannot serve a nav row. The row rendered a
//     live link to an empty screen — the inverse of the other three P6.0 defects and the harder one
//     to notice, because nothing errors.
//
// ★★ THE GATE IS THE SAME ONE EVERY `/platform` ROW USES, AND IT IS NOT AN `if` IN THIS FILE:
//    `authoriseSection` (`src/nav/authorise.mjs:102-105`) refuses unless the tenant's `is_platform`
//    is true — READ FROM THE DATABASE, never from a client claim — AND the rank is `super_admin_1`.
//
// ★ SCOPE, STATED RATHER THAN ASSUMED: `calendar_connection` is tenant-scoped and RLS applies, so
//   this reports the CALLING tenant's connections. [MEASURED] there are **0 rows on both databases**
//   today, so a cross-tenant view could not be demonstrated either way; when connections exist, the
//   cross-tenant version is a `SECURITY DEFINER` function gated on `keystone.caller_is_platform()`,
//   exactly as `platform_list_tenants()` does — MEASURED to return 3 of 3 tenants, so the pattern
//   genuinely crosses the boundary.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { forbidden, invalid, internal, conflict } from "../http/errors.mjs";
import { authoriseSection } from "../nav/authorise.mjs";
import { systemChecks } from "../health/watch.mjs";
import { listPlatformEvents } from "../health/platformEvents.mjs";
import { assertNoNoteFields } from "../platform/redact.mjs";
// ★★★ Task 9.13 — `flagIsOn`/`setFlagForPractice` are 9.3's read/write PRIMITIVE over the three
//     feature-flag tables; this route is the platform-only gate around them (flags.mjs's own header
//     says so explicitly). Neither is edited here.
import { flagIsOn, setFlagForPractice } from "../platform/flags.mjs";
// ★★★ 7.12b — Q7-5: "the operator grant alone". `keystone.caller_is_platform()` (0186) takes NO
//     arguments — it reads `keystone.operator_grant_id`, the GUC `withTenant` sets from the
//     session's live grant (7.6, `src/db/index.mjs:123`).
//   ★★ F594, RULED 21 Sep 2026: 7.12b field 4 said to import "7.6's `callerIsPlatform(db)` helper
//      (already built)" and NO SUCH EXPORT EXISTED — 7.6's file list only redefines the SQL
//      function. The helper is now REAL and SHARED, at `src/db/index.mjs`, so this file, 7.12a's
//      `writes.mjs` platform branch and any later `developer.mjs` follow-up ask one question
//      through one line. The private copy that stood here during the 7.12b build is GONE.
import { callerIsPlatform, withTenant } from "../db/index.mjs";
import { writeAudit } from "../permissions/audit.mjs";
import { createTier, updateTier } from "../platform/siteTiers.mjs";
import { CAPABILITIES, tenantHasCapability } from "../platform/capabilities.mjs";
import { computePlatformPrompts } from "../platform/prompts.mjs";
// ◆ 18.16 import
import { JOB_POLICY } from "../queue/jobPolicy.mjs";
import { enqueue } from "../queue/runner.mjs";
// ★★★ 11.20 — the practice-less chain (11.19). `handlePlatformRequest` resolves the session and
//     opens the operator transaction; it is imported DIRECTLY, never injected through `createApp`,
//     the same way `registerPlatformGrantAccessRoutes(app)` takes no injection at all (`app.mjs:358`).
import { handlePlatformRequest } from "../paths/index.mjs";

const HEALTH_ROW = "/platform/health";
const PROVISIONING_ROW = "/platform/provisioning";
// ★★★ Task 9.13 — the row `src/nav/sections.mjs` already declares (`pf-flags`) and
//     `src/nav/buildState.mjs` un-cuts as part of this same task.
const FLAGS_ROW = "/platform/flags";
const AUDIT_ROW = "/platform/audit";

// ★ Format check only — not a second definition of a business fact, just the standard shape every
//   uuid column in this project uses. Kept local rather than imported: no shared export exists
//   (src/db/index.mjs's own UUID_RE is module-private).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registerPlatformRoutes(app, { runTenantScoped, tenantIsPlatform } = {}) {
  const session = (navPath, minRank, fn, { status = 200, ...opts } = {}) => (c) =>
    runTenantScoped(c, async (ctx) => {
      const isPlatform = await tenantIsPlatform(ctx.db, ctx.tenantId);
      const decision = authoriseSection(ctx.principal.user, navPath, { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
      // ★ `minRank` (still passed at every call site below, `:46`'s `"super_admin_1"` included) is
      //   now an INERT residual — nothing reads it. Out of scope by ruling, 21 Sep 2026 (round-3
      //   critic D3): retiring the dead argument is a later cleanup, not this task's named part.
      if (!(await callerIsPlatform(ctx.db))) throw forbidden("refused: no_operator_grant");
      return fn(ctx);
    }, opts).then((r) => c.json(r, status));

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ 11.20 — `operatorRead`: THE PRACTICE-LESS CHAIN, FOR THE TWO READS BELOW THAT NEED NO
  //     PRACTICE. NOT `session` — `session` asks `tenantIsPlatform`/`authoriseSection`, both
  //     questions about a practice the operator is not in (S11-OQ-1's (b)). This asks the ONE
  //     question that matters: does the live operator grant belong to a platform caller.
  //   ★ `handlePlatformRequest` re-resolves the session (11.1's door already resolved it once, to
  //     decide admission) and applies the SAME two-part condition — a live grant AND a session that
  //     resolved no practice — so the pair can only ever admit-then-refuse, never the reverse
  //     (critic A, 11-M3). `minRank` is not carried here either, for the same reason `session`'s own
  //     copy is inert: nothing in this chain reads a rank.
  //   ★★★ NO RATE LIMITER OF ITS OWN. The `platform` bucket these two routes used to pass is a
  //     PER-PRACTICE counter (`keystone.rate_limit_window`'s `tenant_id uuid NOT NULL`,
  //     `db/migrations/0003_idempotency_and_limits.sql:56-62`) and an operator has no practice to
  //     key it on. `checkKeyLimit` is not the substitute either: it requires a `tenantId`, takes no
  //     `bucket`, and refuses any non-ULID `tokenId` — an operator grant id is a uuid, so it would
  //     throw and 500 these reads. The per-IP fixed-window limiter mounted on `/api/*`
  //     (`src/http/app.mjs`, before authentication) still covers every request here, operator
  //     sessions included. A per-operator budget, if ever wanted, is a new table keyed on the grant
  //     id plus a new migration — out of scope for this task, not "finished" here.
  //   ★ THE FOUR TARGET-PRACTICE ROUTES BELOW (`/flags`, `/tiers`, grant-access, provisioning's
  //     advance) STILL USE `session`/`withPracticeContext`. They need a TARGET practice's own GUC,
  //     which is Stage 18's work (CT-F13) — pointing one of them at this practice-less chain would
  //     silently return zero rows for every practice-scoped read inside it.
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // ★ `body` is the PARSED JSON for a POST. The first draft had handlers read `c.req.body`, which is
  //   the raw request stream — every `body?.key` was undefined and every platform write refused.
  const operatorRead = (fn, { status = 200 } = {}) => async (c) => {
    const body = c.req.method === "GET" ? null : await c.req.json().catch(() => {
      throw invalid("the request body is not JSON");
    });
    return handlePlatformRequest({ sessionId: c.get("principal")?.sessionId }, async (db) => {
      if (!(await callerIsPlatform(db))) throw forbidden("refused: no_operator_grant");
      return fn({ db, c, body });
    }).then((r) => c.json(r, status));
  };

  app.get("/api/platform/health", operatorRead(async ({ db }) => {
    // ★★★ Stage 4 Task 11 (07 §5) — CALENDAR SYNC MOVED INTO `systemChecks()` ITSELF, cross-tenant,
    //     as the platform role (`keystone_meta.calendar_health()`, migration 0152) — it used to be
    //     read HERE via `calendarHealth(db)`, which is FORCE RLS to the calling session's own tenant
    //     only. `systemChecks()` now returns a `calendars` entry directly; this route no longer
    //     computes it separately. See `src/booking/calendarSync.mjs`'s `platformCalendarHealth`.
    // ★★ P8.10 — THE CHECKS THAT WERE NOT HERE. This row once showed ONE thing (calendars) while the
    //     queue carrying every email, webhook and sweep had nothing looking at it, and a backup
    //     script that had never run could not have been noticed not running.
    // ★★ Stage 3 Task 6 (spec 02 §2.11) — the platform's own recent facts: checks failing and
    //    recovering, backups verified or failed, jobs giving up. Read through
    //    keystone.platform_list_platform_events(), gated IN SQL on caller_is_platform() — this route's
    //    authoriseSection check is the second lock, not the only one.
    //  ★ READ BEFORE systemChecks, deliberately: on app_rw the queue check fails "permission denied
    //    for schema graphile_worker" and, inside this route's transaction, that aborts every later
    //    statement (F498, still open — out of this task's scope). Reading first keeps the facts
    //    visible while that defect stands.
    const platformEvents = await listPlatformEvents(db, { limit: 50 });
    const system = await systemChecks(db);

    // ★★★ 18.19 — Build the board object with health categories
    // Measure app response time
    const t0 = performance.now();
    await db.query("SELECT 1");
    const appResponseMs = Math.round(performance.now() - t0);

    // Helper to map check state to display state
    const checkStateToDisplayState = (check) => {
      if (check.state === "ok") return "fine";
      if (check.state === "problem") return "down";
      if (check.state === "unknown") return "not_measured";
      return "fine";
    };

    // Find checks by key
    const checksByKey = {};
    for (const c of system) checksByKey[c.key] = c;

    // Build Ours category
    const ours = [
      {
        label: "App",
        detail: `Railway · answering in ${appResponseMs}ms`,
        state: "up"
      },
      {
        label: "Worker",
        detail: checksByKey.worker_heartbeat?.detail ?? "no heartbeat",
        state: checksByKey.worker_heartbeat ? (checksByKey.worker_heartbeat.state === "ok" ? "up" : "down") : "down"
      },
      {
        label: "Database",
        detail: checksByKey.database?.detail ?? "unknown",
        state: checkStateToDisplayState(checksByKey.database || { state: "unknown" })
      },
      {
        label: "Storage",
        detail: checksByKey.storage?.detail ?? "not configured",
        state: checkStateToDisplayState(checksByKey.storage || { state: "unknown" })
      },
      {
        label: "Certificates",
        detail: checksByKey.certificate?.detail ?? "unknown",
        state: checkStateToDisplayState(checksByKey.certificate || { state: "unknown" })
      }
    ];

    // Build Theirs category
    const theirs = [
      {
        label: "Stripe",
        detail: checksByKey.stripe_webhooks?.detail ?? "no webhook data",
        state: checkStateToDisplayState(checksByKey.stripe_webhooks || { state: "unknown" })
      },
      {
        label: "Resend",
        detail: checksByKey.email?.detail ?? "not measured",
        state: checkStateToDisplayState(checksByKey.email || { state: "unknown" })
      },
      {
        label: "Twilio",
        detail: "no text sender",
        state: "not_measured"
      },
      {
        label: "Google",
        detail: checksByKey.calendars?.detail ?? "unknown",
        state: checkStateToDisplayState(checksByKey.calendars || { state: "unknown" })
      },
      {
        label: "Meta",
        detail: "waiting on posting approval",
        state: "pending"
      }
    ];

    // Build Jobs category (from ledger if available, else from queue check)
    const jobs = [];
    // TODO: Extract jobs from 18.20's ledger or use queue check
    // For now, use placeholder
    if (checksByKey.queue) {
      const queueDetail = checksByKey.queue.state === "ok" ? "queue is healthy" : checksByKey.queue.detail;
      jobs.push({
        label: "Job queue",
        detail: queueDetail,
        state: checkStateToDisplayState(checksByKey.queue)
      });
    }

    // Build History metrics
    let daysSinceDown = null;
    let lastDownCause = null;
    for (const evt of platformEvents) {
      if (evt.kind === "health.check_failed") {
        if (daysSinceDown === null) {
          const eventTime = new Date(evt.created_at);
          daysSinceDown = Math.floor((Date.now() - eventTime.getTime()) / (1000 * 60 * 60 * 24));
          lastDownCause = `${evt.facts?.check || "unknown"} check failed`;
        }
      }
    }

    const migrations = checksByKey.database?.applied || 0;
    let failedWebhooks24h = 0;
    // Count failed webhooks in stripe_webhooks check facts if available
    if (checksByKey.stripe_webhooks?.facts?.failed_webhooks_24h !== undefined) {
      failedWebhooks24h = checksByKey.stripe_webhooks.facts.failed_webhooks_24h;
    }

    const board = {
      history: {
        daysSinceDown,
        lastDownCause,
        migrations,
        failedWebhooks24h
      },
      ours,
      theirs,
      jobs
    };

    return { platform_events: platformEvents, checks: system, board };
  }));

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ Task 9.13 / 18.17 — `/platform/flags`. The catalog is read directly (feature_flag is
  //     `USING (true)` — platform-owned, no tenant_id, 0213); a per-practice view (overrides,
  //     effective on/off, change log) needs `?tenantId=<uuid>` and is read through `withTenant`
  //     to the target practice's own tenant context, because `feature_flag_practice`/`feature_flag_change`
  //     are FORCED RLS on `current_tenant_id()` and this session's own tenant context is the PLATFORM
  //     tenant, not the practice being inspected.
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  app.get("/api/platform/flags", operatorRead(async ({ db, c, body }) => {
    const { rows: flagRows } = await db.query(
      `SELECT key, description, default_on, label, availability, availability_reason
         FROM keystone.feature_flag ORDER BY key`);

    const practiceTenantId = c.req.query("tenantId") ?? null;
    if (practiceTenantId === null) {
      // ★ Without ?tenantId, return the catalogue with metadata: onFor (count of practices with it on)
      //   and since (earliest set_at of an on override, or null if only defaults apply).
      const flags = [];
      for (const f of flagRows) {
        const { rows: onForRows } = await db.query(
          `SELECT COUNT(*) as count FROM keystone.feature_flag_practice
            WHERE flag_key = $1 AND "on" = true`,
          [f.key]);
        const onFor = Number(onForRows[0]?.count ?? 0);

        const { rows: sinceRows } = await db.query(
          `SELECT MIN(set_at) as earliest FROM keystone.feature_flag_practice
            WHERE flag_key = $1 AND "on" = true`,
          [f.key]);
        const since = sinceRows[0]?.earliest ?? null;

        flags.push({
          key: f.key,
          description: f.description,
          default_on: f.default_on,
          label: f.label,
          availability: f.availability,
          availabilityReason: f.availability_reason,
          onFor,
          since,
        });
      }
      return { flags, practice: null };
    }

    if (!UUID_RE.test(practiceTenantId)) {
      throw invalid(`tenantId must be a uuid — got ${JSON.stringify(practiceTenantId)}`);
    }

    const practice = await withTenant(practiceTenantId, async (tx) => {
      const effective = {};
      for (const f of flagRows) effective[f.key] = await flagIsOn(tx, f.key, practiceTenantId);
      const { rows: overrides } = await tx.query(
        `SELECT flag_key, "on", set_by, set_at
           FROM keystone.feature_flag_practice WHERE tenant_id = $1 ORDER BY flag_key`,
        [practiceTenantId]);
      const { rows: changeLog } = await tx.query(
        `SELECT flag_key, "on", previous, reason, set_by, set_at
           FROM keystone.feature_flag_change WHERE tenant_id = $1
          ORDER BY set_at DESC LIMIT 100`,
        [practiceTenantId]);
      return { tenantId: practiceTenantId, effective, overrides, changeLog };
    });

    return { flags: flagRows, practice };
  }));

  // ★★★ Task 18.17 — THE WRITE. `setFlagForPractice` (9.3's) appends the change-log row in the SAME
  //     transaction as the override, so a reader can never observe one without the other
  //     (flags.mjs's own rule). POST refuses a flag whose availability is `blocked` or
  //     `being_built` with 409 and a readable reason.
  // ═════════════════════════════════════════════════════════════════
  // 21 Oct 2026 (the maintainer, pricing integrity) — THE DOCUSTAY REVIEW LIST. Repeat free workspaces, fair-use lines passed, a lost dispute. Review only: nothing here blocks anyone by itself. Both routes are POSTs by the route table's own rule
  // (a list with a limit; a resolve). Resolving a lost-dispute flag lifts that workspace's pause (a dispute_cleared line in its billing record).
  // ═════════════════════════════════════════════════════════════════
  app.post("/api/platform/docustay/review", operatorRead(async ({ db, body }) => {
    const limit = Number.isInteger(body?.limit) ? Math.max(1, Math.min(body.limit, 500)) : 200;
    const { rows } = await db.query(`SELECT id, kind, subject, workspace_id, detail, created_at, resolved_at FROM keystone.docustay_review_flags($1)`, [limit]);
    return { flags: rows.map((r) => ({ id: r.id, kind: r.kind, subject: r.subject, workspaceId: r.workspace_id, detail: r.detail, createdAt: r.created_at, resolvedAt: r.resolved_at })) };
  }));
  app.post("/api/platform/docustay/review/resolve", operatorRead(async ({ db, body }) => {
    const id = body?.id;
    if (typeof id !== "string" || !UUID_RE.test(id)) throw invalid("id must be a uuid");
    const { rows } = await db.query(`SELECT kind, workspace_id FROM keystone.docustay_review_flags(1000) WHERE id = $1`, [id]);
    const flag = rows[0];
    if (!flag) throw invalid("There is no such review item.");
    const { rows: [done] } = await db.query(`SELECT keystone.docustay_review_flag_resolve($1) AS yes`, [id]);
    if (done?.yes && flag.kind === "dispute_lost" && flag.workspace_id) {
      await withTenant(flag.workspace_id, (tx) => tx.query(`INSERT INTO keystone.docustay_billing_record (tenant_id, kind, detail) VALUES ($1, 'dispute_cleared', $2::jsonb)`, [flag.workspace_id, JSON.stringify({ flag: id })]));
    }
    return { resolved: Boolean(done?.yes) };
  }));

  app.post("/api/platform/flags", operatorRead(async ({ db, c, body }) => {
    const key = body?.key;
    const practiceTenantId = body?.tenantId;
    const on = body?.on;
    const reason = body?.reason ?? null;

    if (typeof key !== "string" || key.trim() === "") throw invalid("key is required");
    if (typeof practiceTenantId !== "string" || !UUID_RE.test(practiceTenantId)) {
      throw invalid(`tenantId must be a uuid — got ${JSON.stringify(practiceTenantId)}`);
    }
    if (typeof on !== "boolean") throw invalid("on must be a boolean");
    if (reason !== null && typeof reason !== "string") throw invalid("reason must be a string or null");

    // ★ Check if flag is blocked or being_built before allowing the write.
    const { rows: flagRows } = await db.query(
      `SELECT availability, availability_reason FROM keystone.feature_flag WHERE key = $1`,
      [key]);
    if (flagRows.length === 0) {
      throw invalid(`feature flag "${key}" does not exist`);
    }
    const { availability, availability_reason } = flagRows[0];
    if (availability === "blocked" || availability === "being_built") {
      throw conflict(`This one can't be turned on yet — ${availability_reason}`);
    }

    // ★ P13.6's own rule, restated here: the acting person comes from the OPERATOR GRANT'S own session,
    //   resolved and validated by handlePlatformRequest. The principal for an operator session
    //   has no appUserId (the operator is not a staff person at a practice), so we use a system
    //   attribution or retrieve the operator identifier if available — for now, use "system" as the
    //   standard operator audit trail.
    const setBy = "system";

    await withTenant(practiceTenantId, async (tx) => {
      await setFlagForPractice(tx, { key, tenantId: practiceTenantId, on, setBy, reason });
    });

    return { ok: true, key, tenantId: practiceTenantId, on };
  }, { status: 200 }));

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ `/api/platform/audit` — CROSS-TENANT AUDIT LOG FOR PLATFORM OPERATORS ONLY.
  //     The database function keystone.platform_list_audit_events() returns zero rows if the
  //     caller is not a platform operator (checked in SQL via keystone.caller_is_platform());
  //     this route's own callerIsPlatform() check is a secondary defense, not the primary one.
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  app.get("/api/platform/audit", operatorRead(async ({ db }) => {
    const { rows: auditEvents } = await db.query(
      `SELECT id, tenant_id, at, actor_user_id, actor_operator_uid, actor_operator_grant_id,
              action, object, subject_id, before, after, reason, request_id, event_type
         FROM keystone.platform_list_audit_events()
        ORDER BY at DESC`);
    return { audit_events: auditEvents };
  }));

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ `/api/platform/tiers` — SITE TIER CATALOGUE MANAGEMENT FOR PLATFORM OPERATORS ONLY.
  //     Create and update tiers with write-through to Stripe's Prices API. The tier catalogue
  //     is platform-owned, not tenant-scoped.
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  const TIERS_ROW = "/platform/tiers";

  app.post("/api/platform/tiers", session(TIERS_ROW, "super_admin_1", async (ctx) => {
    const { db, body } = ctx;
    const { name, placeholder_price_minor, display_order } = body ?? {};

    if (typeof name !== "string" || name.trim() === "") throw invalid("name is required");
    if (!Number.isInteger(placeholder_price_minor)) throw invalid("placeholder_price_minor must be an integer");

    const tier = await createTier(db, {
      name,
      placeholder_price_minor,
      display_order: display_order ?? 0,
    });
    return tier;
  }, { status: 201 }));

  app.patch("/api/platform/tiers/:tierId", session(TIERS_ROW, "super_admin_1", async (ctx) => {
    const { db, c, body } = ctx;
    const tierId = c.req.param("tierId");
    const { name, placeholder_price_minor, display_order } = body ?? {};

    if (!tierId) throw invalid("tierId is required (path parameter)");

    const tier = await updateTier(db, {
      tierId,
      name: name ?? null,
      placeholder_price_minor: placeholder_price_minor ?? null,
      display_order: display_order ?? null,
    });
    return tier;
  }));

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ `/api/platform/prompts` — PLATFORM PROMPTS FOR OPERATOR OVERVIEW.
  //     The operator's "Needs looking at" prompts, up to 3, dismissible per operator for 7 days.
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  app.get("/api/platform/prompts", operatorRead(async ({ db }) => {
    // operatorGrantId is set in the GUC by handlePlatformRequest
    const { rows: grantRows } = await db.query(
      `SELECT current_setting('keystone.operator_grant_id')::uuid as grant_id`
    );
    const operatorGrantId = grantRows[0]?.grant_id;
    if (!operatorGrantId) throw forbidden("no operator grant");
    const result = await computePlatformPrompts(db, { operatorGrantId });
    return result;
  }));

  app.post("/api/platform/prompts/dismiss", operatorRead(async ({ db, c, body }) => {
    // operatorGrantId is set in the GUC by handlePlatformRequest
    const { rows: grantRows } = await db.query(
      `SELECT current_setting('keystone.operator_grant_id')::uuid as grant_id`
    );
    const operatorGrantId = grantRows[0]?.grant_id;
    if (!operatorGrantId) throw forbidden("no operator grant");

    const key = body?.key;
    const subjectTenantId = body?.subjectTenantId;

    if (typeof key !== "string" || key.trim() === "") throw invalid("key is required");
    if (subjectTenantId !== null && subjectTenantId !== undefined && typeof subjectTenantId !== "string") {
      throw invalid("subjectTenantId must be a uuid or null");
    }
    if (subjectTenantId && !UUID_RE.test(subjectTenantId)) {
      throw invalid(`subjectTenantId must be a valid uuid — got ${JSON.stringify(subjectTenantId)}`);
    }

    // Call the database function to dismiss the prompt
    const { rows } = await db.query(
      `SELECT keystone.dismiss_platform_prompt($1, $2, $3)`,
      [operatorGrantId, key, subjectTenantId || null]
    );

    if (rows.length === 0) throw internal("dismiss failed");

    return { dismissed: true };
  }, { status: 200 }));

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ TASK 20.34 — PLATFORM SCREENS: USAGE, AUTOMATIONS, BRANDING
  // ═════════════════════════════════════════════════════════════════════════════════════════════

  // ──── `/api/platform/usage` — CROSS-PRACTICE USAGE METRICS ──────────────────────────────────
  app.get("/api/platform/usage", operatorRead(async ({ db }) => {
    // ★ Returns usage metrics across all practices. Counts only, never names.
    const { rows: usageRows } = await db.query(
      `SELECT tenant_id, 'sessions' as metric, COUNT(*) as count, false as overage
         FROM keystone.booking
        WHERE archived_at IS NULL
        GROUP BY tenant_id
       UNION ALL
       SELECT tenant_id, 'people' as metric, COUNT(*) as count, false as overage
         FROM keystone.app_user
        WHERE archived_at IS NULL
        GROUP BY tenant_id
       ORDER BY tenant_id, metric`);

    const usage = {};
    for (const row of usageRows) {
      if (!usage[row.tenant_id]) {
        usage[row.tenant_id] = { tenant_id: row.tenant_id };
      }
      usage[row.tenant_id][row.metric] = { count: row.count, overage: row.overage };
    }
    return { usage };
  }));

  // ──── `POST /api/platform/usage/tell` — NOTIFY PRACTICE OWNER ABOUT USAGE ──────────────────
  app.post("/api/platform/usage/tell", operatorRead(async ({ db, c, body }) => {
    const tenantId = body?.tenantId;
    const metric = body?.metric;
    const message = body?.message;

    if (!UUID_RE.test(tenantId)) throw invalid(`tenantId must be a uuid — got ${JSON.stringify(tenantId)}`);
    if (typeof metric !== "string" || metric.trim() === "") throw invalid("metric is required");
    if (typeof message !== "string" || message.length < 1 || message.length > 500) {
      throw invalid("message is required — 1 to 500 characters");
    }

    // ★★ NOT BUILT (26 Sep 2026): the once-per-period guard reads keystone.platform_usage_tell, which
    //    no migration ever created and no spec defines — every call 500'd. Refused plainly until the
    //    table is specified (RUN-2-TRACKER F-R2-4), rather than telling a practice with no guard.
    throw conflict("Telling a practice about its usage is not built yet — there is nowhere to record that it was told, so it could be sent twice.", { kind: "not_built" });
  }));

  // ──── GET `/api/platform/automations` — ADOPTION COUNTS AND INCIDENTS ──────────────────────
  app.get("/api/platform/automations", operatorRead(async ({ db }) => {
    // ★ Get adoption counts per automation family
    // ★★ NOT BUILT (26 Sep 2026): keystone.automation_adoption and keystone.automation_incident were
    //    never created by any migration (F-R2-4) — this route 500'd. Adoption and incidents come back
    //    as null with `notBuilt`, never as empty lists: "no incidents" would be a claim, not a fact.
    const adoptionRows = null;
    const notBuilt = ["adoption", "incidents"];

    // ★ Get incidents from 20.18's incident feed
    const incidentRows = null;

    // ★ Read workflow states live from n8n
    const { workflowStates, assertConfigured } = await import("../automations/n8n.mjs");
    let states = {};
    try {
      assertConfigured();
      const statesMap = await workflowStates();
      states = Object.fromEntries(statesMap);
    } catch (err) {
      // n8n not configured — states will be empty
    }

    const automations = adoptionRows === null ? null : adoptionRows.map((row) => ({
      ...row,
      workflow_id: states[row.workflow_name]?.id ?? null,
    }));

    return { automations, incidents: incidentRows, states, notBuilt };
  }));

  // ──── POST `/api/platform/automations/kill-switch` — TOGGLE WORKFLOW ACTIVE STATE ──────────
  app.post("/api/platform/automations/kill-switch", operatorRead(async ({ db, c, body }) => {
    const workflowId = body?.workflowId;
    const active = body?.active;

    if (typeof workflowId !== "string" || workflowId.trim() === "") {
      throw invalid("workflowId is required");
    }
    if (typeof active !== "boolean") throw invalid("active must be a boolean");

    // ★ Call n8n to flip the switch
    const { setWorkflowActive } = await import("../automations/n8n.mjs");
    await setWorkflowActive(workflowId, active);

    // ★ Read back live state to confirm
    const { workflowStates } = await import("../automations/n8n.mjs");
    const statesMap = await workflowStates();
    const state = statesMap.get(workflowId);

    return { ok: true, workflowId, active: state?.active ?? active };
  }));

  // ──── GET `/api/platform/branding` — PUSH STATES AND FAILURE REASONS ──────────────────────
  app.get("/api/platform/branding", operatorRead(async ({ db }) => {
    // ★ Get push states across all practices
    // ★★ NOT BUILT (26 Sep 2026): keystone.platform_branding_push was never created (F-R2-4) — 500'd.
    return { push_states: null, notBuilt: ["push_states"] };
  }));

  app.get("/api/platform/provisioning/:runId/steps", operatorRead(async ({ db, c, body }) => {
    const runId = c.req.param("runId");
    if (!UUID_RE.test(runId)) {
      throw invalid(`runId must be a uuid — got ${JSON.stringify(runId)}`);
    }
    const { rows: steps } = await db.query(
      `SELECT name, ordinal, state, attempts, max_attempts, started_at, completed_at, retryable
         FROM keystone.platform_list_provisioning_steps($1)`,
      [runId]
    );
    return { steps };
  }));

  // ◆ 18.15 routes
  // ◆ 18.16 routes
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ 18.21 — `/api/platform/jobs` AND `run-now`
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  app.get("/api/platform/jobs", operatorRead(async ({ db }) => {
    // Get job run history from the ledger
    const { rows: jobRuns } = await db.query(
      `SELECT * FROM keystone.platform_list_job_runs() ORDER BY task`);

    // Get current queued jobs from platform_list_worker_jobs
    const { rows: workerJobs } = await db.query(
      `SELECT DISTINCT topic AS task FROM keystone.platform_list_worker_jobs() ORDER BY 1`  /* the function names it `topic` */);

    // Build failures list (give-ups that have failure_id)
    const { rows: failureRows } = await db.query(
      `SELECT * FROM keystone.platform_list_job_failures() ORDER BY last_seen_at DESC`);

    // Build the jobs list from jobPolicy periodic tasks and ledger data
    const jobsMap = new Map();

    // Add all periodic jobs from JOB_POLICY
    for (const [taskName, policy] of Object.entries(JOB_POLICY)) {
      if (policy.periodic) {
        const ledgerRun = jobRuns.find((r) => r.task === taskName);
        const isPending = workerJobs.some((j) => j.task === taskName);

        jobsMap.set(taskName, {
          task: taskName,
          label: policy.label,
          cadence: policy.label.includes("15 minutes")
            ? "Every 15 minutes"
            : policy.label.includes("Daily")
            ? "Daily, 9am"
            : policy.label.includes("Nightly") || policy.label.includes("2am")
            ? "Nightly, 2am"
            : "When asked",
          lastRun: ledgerRun?.last_finished ?? null,
          durationMs: ledgerRun?.last_duration_ms ?? null,
          summary: ledgerRun?.last_summary ?? null,
          state: (function() {
            if (ledgerRun?.last_outcome === "failed") return "Failed";
            if (isPending) return "Waiting";
            return "Fine";
          })(),
        });
      }
    }

    // Convert to array
    const jobs = Array.from(jobsMap.values());

    return {
      jobs,
      failures: failureRows.map((f) => ({
        id: f.id,
        taskIdentifier: f.task_identifier,
        gaveUpAt: f.gave_up_at,
        reason: f.reason,
        repeatCount: f.repeat_count,
        lastSeenAt: f.last_seen_at,
      })),
    };
  }));

  // POST to enqueue a periodic task "now" (outside its normal schedule)
  app.post("/api/platform/jobs/run-now", operatorRead(async ({ db, c, body }) => {
    const taskName = body?.task;

    if (!taskName || typeof taskName !== "string") {
      throw invalid("task is required and must be a string");
    }

    // Only allow periodic tasks
    const policy = JOB_POLICY[taskName];
    if (!policy || !policy.periodic) {
      throw conflict("This task cannot be run now — only periodic jobs can be queued manually");
    }

    // Enqueue the task
    // For per-tenant tasks, enqueue once per active tenant; for global tasks, enqueue once
    const tasksWithTenant = [
      "sweep_tenants", "dispatch_outbox", "retry_webhooks", "retry_n8n",
      "close_orphan_tasks", "sweep_run_schedule", "run_pull", "prune_run_payloads",
      "prune_bookkeeping", "usage_reconcile", "sweep_due",
      "sweep_calendar_renewal", "sweep_calendar_pull",
    ];

    let queued = 0;
    if (tasksWithTenant.includes(taskName)) {
      // Get all active tenants and enqueue once per tenant
      const { rows: tenants } = await db.query(
        `SELECT tenant_id FROM keystone_auth.list_active_tenant_ids()`);
      for (const { tenant_id } of tenants) {
        await enqueue(taskName, { tenantId: tenant_id }, {});
        queued++;
      }
    } else {
      // Global task - enqueue once
      await enqueue(taskName, {}, {});
      queued = 1;
    }

    return { queued };
  }));

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ `/api/platform/tiers/capabilities` — TIER CAPABILITY GRID FOR PLATFORM OPERATORS ONLY.
  //     GET: read the grid (tier_id, capability_key, allowed). PUT: update cells and audit changes.
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  const TIERS_CAPABILITIES_ROW = "/platform/tiers/capabilities";

  app.get("/api/platform/tiers/capabilities", operatorRead(async ({ db }) => {
    // ★ Read all tiers, all capabilities, and their allowed status
    const { rows: tiers } = await db.query(
      `SELECT id, name, display_order FROM keystone.site_tier ORDER BY display_order ASC`);

    const { rows: capabilityRows } = await db.query(
      `SELECT tier_id, capability_key, allowed FROM keystone.tier_capability ORDER BY tier_id, capability_key`);

    // ★ Build a grid: { tiers: [...], capabilities: [...], grid: { tierId: { capKey: bool } } }
    const grid = {};
    for (const { tier_id, capability_key, allowed } of capabilityRows) {
      if (!grid[tier_id]) grid[tier_id] = {};
      grid[tier_id][capability_key] = allowed;
    }

    return { tiers, grid };
  }));

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ TASK 20.39 — `/api/platform/tiers/capabilities/:tierId/:capKey/impact` — OFF-TRANSITION
  //     IMPACT COUNTS for confirmation modal. Returns { practiceCount, recentCount, scheduledCount,
  //     editedCount } — only the figures that can be computed appear in the response (no zeros, no
  //     guesses). Every count reads from real tables with no cache.
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  app.get(
    "/api/platform/tiers/capabilities/:tierId/:capKey/impact",
    operatorRead(async ({ db, c, body }) => {
      const tierId = c.req.param("tierId");
      const capKey = c.req.param("capKey");

      if (!UUID_RE.test(tierId)) {
        throw invalid(`tierId must be a uuid — got ${JSON.stringify(tierId)}`);
      }
      if (typeof capKey !== "string" || capKey.trim() === "") {
        throw invalid("capKey is required");
      }

      // ★ Check capability is in the frozen registry
      if (!CAPABILITIES.includes(capKey)) {
        throw invalid(`Unknown capability: ${JSON.stringify(capKey)}`);
      }

      // ★ Count: practices on this tier that have the capability enabled
      const { rows: practiceRows } = await db.query(
        `SELECT DISTINCT tenant_id
           FROM keystone.tenant_site_tier
          WHERE site_tier_id = $1`,
        [tierId]
      );
      const practiceCount = practiceRows.length;

      const impact = {};
      if (practiceCount > 0) impact.practiceCount = practiceCount;

      // ★ The remaining counts depend on the capability. For now, return practiceCount only
      // if other tables exist, they will be queried here per-capability or generically.
      // Counts are omitted entirely if they cannot be computed or are zero.

      return assertNoNoteFields(impact);
    })
  );

  app.put("/api/platform/tiers/capabilities", operatorRead(async ({ db, c, body }) => {
    const updates = body?.updates ?? {}; // { tierId: { capKey: bool } }

    if (typeof updates !== "object" || updates === null || Array.isArray(updates)) {
      throw invalid("updates must be an object mapping tierId to { capKey: bool }");
    }

    // ★ Get the operator grant id for audit
    const { rows: grantRows } = await db.query(
      `SELECT current_setting('keystone.operator_grant_id')::uuid as grant_id`
    );
    const operatorGrantId = grantRows[0]?.grant_id;
    if (!operatorGrantId) throw forbidden("no operator grant");

    // ★ Track changes for audit
    const changes = [];

    // ★ For each tier and capability, apply the update and audit if it changed
    for (const tierId of Object.keys(updates)) {
      if (!UUID_RE.test(tierId)) {
        throw invalid(`tierId must be a uuid — got ${JSON.stringify(tierId)}`);
      }

      const capUpdates = updates[tierId];
      if (typeof capUpdates !== "object" || capUpdates === null || Array.isArray(capUpdates)) {
        throw invalid(`updates[${tierId}] must be an object mapping capKey to bool`);
      }

      for (const capKey of Object.keys(capUpdates)) {
        const newAllowed = capUpdates[capKey];
        if (typeof newAllowed !== "boolean") {
          throw invalid(`updates[${tierId}][${capKey}] must be a boolean — got ${JSON.stringify(newAllowed)}`);
        }

        // ★ Get the current value (if any)
        const { rows: currentRows } = await db.query(
          `SELECT allowed FROM keystone.tier_capability WHERE tier_id = $1 AND capability_key = $2`,
          [tierId, capKey]);
        const currentAllowed = currentRows.length > 0 ? currentRows[0].allowed : null;

        // ★ Only update if changed
        if (currentAllowed !== newAllowed) {
          await db.query(
            `INSERT INTO keystone.tier_capability (tier_id, capability_key, allowed)
               VALUES ($1, $2, $3)
             ON CONFLICT (tier_id, capability_key)
               DO UPDATE SET allowed = EXCLUDED.allowed`,
            [tierId, capKey, newAllowed]);

          // ★ Audit the change
          changes.push({
            tierId,
            capKey,
            before: currentAllowed,
            after: newAllowed,
          });
        }
      }
    }

    // ★★★ F829, 1 Oct 2026 — FOUND LIVE: this used to be a raw `INSERT INTO keystone.audit_entry`,
    //   the second writer src/permissions/audit.mjs's own header explicitly forbids ("a second
    //   writer is ever tempted, it belongs here, not as a raw INSERT somewhere else") — bypassing
    //   both the AUDIT_ACTIONS validity check and the AUDIT_FIELDS allowlist (Q7-7), and keyed to
    //   `(SELECT id FROM keystone.tenant LIMIT 1)` with no ORDER BY — non-deterministic on a
    //   multi-tenant database, and semantically wrong besides: a tier-capability change is a
    //   PLATFORM-wide fact (`keystone.tier_capability`/`site_tier` carry no tenant_id at all,
    //   0361/0487), not any one practice's. Routed through `writeAudit()` now, into the PLATFORM
    //   tenant's own log — the same "no practice to show it to, so the platform's own" rule
    //   `src/platform/jobActions.mjs`'s `auditForPractice` already states for exactly this shape.
    //   `resolve_tenant_by_slug` (SECURITY DEFINER) finds it with no tenant GUC needed first, same
    //   fix as 0541/0550's identical chicken-and-egg problem earlier this engagement.
    if (changes.length > 0) {
      const { rows: [{ resolve_tenant_by_slug: platformTenantId }] } =
        await db.query(`SELECT keystone.resolve_tenant_by_slug('platform')`);
      if (!platformTenantId) throw internal("the platform tenant could not be resolved — audit cannot be written");
      await withTenant(platformTenantId, async (tx) => {
        for (const change of changes) {
          await writeAudit(tx, {
            tenantId: platformTenantId,
            action: "platform.tier_capability.changed",
            object: "tier_capability",
            subjectId: change.tierId,
            before: { capability: change.capKey, value: change.before },
            after: { capability: change.capKey, value: change.after },
            reason: "tier_capability_changed",
            actorOperatorGrantId: operatorGrantId,
            requestId: c.req.header("x-request-id") ?? null,
          });
        }
      });
    }

    return {
      ok: true,
      changed: changes.length,
      changes,
    };
  }));
}
