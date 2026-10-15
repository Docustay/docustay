// ═══════════════════════════════════════════════════════════════════════════════════════════════
// TASK WRITE ROUTES — P20.3. Creating and snoozing tasks.
//
// ★★★ BOTH FUNCTIONS WIRE `src/tasks/writes.mjs` EXPORTS: `createManualTask()` and `snoozeTask()`.
//     Every route in this file inherits the `runTenantScoped` chain: auth → tenant from the GUC →
//     rate limit → Idempotency-Key required and stored response replayed → savepoint → error mapping.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { invalid, forbidden } from "../http/errors.mjs";
import { authoriseSection } from "../nav/authorise.mjs";
import { assertMay } from "../permissions/assertMay.mjs";
import { createManualTask, snoozeTask } from "../tasks/writes.mjs";
import { readLeadBoard } from "../people/writes.mjs";
import { AUTOMATIONS, automationSettingKey } from "../automations/catalogue.mjs";
import { readConfig, validateConfig, CONFIG_SCHEMA } from "../automations/config.mjs";
import { setSetting } from "../settings/writes.mjs";
import { emit, userActor } from "../events/outbox.mjs";

/**
 * POST /api/tasks — Create a manual task.
 *
 * ★★ Body: { topic, subjectType, subjectId, title, assigneeId?, dueAt? }
 *    Returns: { id }
 *
 * ★ Requires Idempotency-Key header (inherited from runTenantScoped).
 */
export function registerTaskRoutes(app, { runTenantScoped, tenantIsPlatform } = {}) {
  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Task creation. Gated at Tasks section.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  app.post("/api/tasks", (c) =>
    runTenantScoped(c, async ({ db, principal, body, tenantId }) => {
      if (!body || typeof body !== "object") {
        throw invalid("a JSON object body is required");
      }

      // ★★★ AUTHORISE BEFORE ANY WRITE, ON THE SERVER, EVERY TIME. Not "the UI only shows the button
      //     to admins" — §K3: "client-side role gating is NOT a security boundary. Hiding a tab
      //     renders nothing unreachable."
      const isPlatform = await tenantIsPlatform(db, tenantId);
      const decision = authoriseSection(principal.user, "/tasks", { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
      await assertMay(db, principal, { object: "task", action: "edit", subject: body.assigneeId ?? principal.appUserId });

      if (!body.topic || typeof body.topic !== "string") {
        throw invalid("topic is required and must be a string");
      }
      if (!body.subjectType || typeof body.subjectType !== "string") {
        throw invalid("subjectType is required and must be a string");
      }
      if (!body.subjectId || typeof body.subjectId !== "string") {
        throw invalid("subjectId is required and must be a string");
      }
      if (!body.title || typeof body.title !== "string") {
        throw invalid("title is required and must be a string");
      }

      // ★ Optional fields
      const assigneeId = body.assigneeId ?? null;
      const dueAt = body.dueAt ? new Date(body.dueAt) : null;

      const result = await createManualTask(db, {
        tenantId,
        topic: body.topic,
        subjectType: body.subjectType,
        subjectId: body.subjectId,
        title: body.title,
        createdByAppUserId: principal?.appUserId ?? null,
        assigneeId,
        dueAt,
      });

      return result;
    }, { bucket: "write", status: 200 }).then((r) => c.json(r, 200)));

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Task snooze. Gated at Tasks section.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  app.post("/api/tasks/snooze", (c) =>
    runTenantScoped(c, async ({ db, principal, body, tenantId }) => {
      if (!body || typeof body !== "object") {
        throw invalid("a JSON object body is required");
      }

      // ★★★ AUTHORISE BEFORE ANY WRITE, ON THE SERVER, EVERY TIME.
      const isPlatform = await tenantIsPlatform(db, tenantId);
      const decision = authoriseSection(principal.user, "/tasks", { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);

      if (!body.taskId || typeof body.taskId !== "string") {
        throw invalid("taskId is required and must be a string");
      }

      // ★ Resolve the task's assignee for the permission check
      const taskRow = await db.query(
        `SELECT assignee_id FROM keystone.task WHERE id = $1`,
        [body.taskId]);
      if (!taskRow.rows[0]) throw forbidden("refused: requires edit on task");

      await assertMay(db, principal, { object: "task", action: "edit", subject: taskRow.rows[0].assignee_id });

      // ★ snoozeUntil is optional — null clears the snooze
      const snoozeUntil = body.snoozeUntil ? new Date(body.snoozeUntil) : null;

      const result = await snoozeTask(db, {
        tenantId,
        taskId: body.taskId,
        snoozeUntil,
        actorUserId: principal?.appUserId ?? null,
      });

      return result;
    }, { bucket: "write", status: 200 }).then((r) => c.json(r, 200)));

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Lead board. Gated at Tasks section.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  app.get("/api/people/lead-board", (c) =>
    runTenantScoped(c, async ({ db, principal, tenantId }) => {
      const isPlatform = await tenantIsPlatform(db, tenantId);
      const decision = authoriseSection(principal.user, "/tasks", { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);

      const result = await readLeadBoard(db, {
        tenantId,
        viewerId: principal?.appUserId ?? null,
      });

      return result;
    }, { bucket: "list" }).then((r) => c.json(r, 200)));

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // GET /api/tasks/automations/:key — Automation detail, runs, and reach.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  app.get("/api/tasks/automations/:key", (c) => {
    const key = c.req.param("key");
    return runTenantScoped(c, async ({ db, principal, tenantId }) => {
      await assertMay(db, principal, { object: "automation", action: "view" });
      const automation = AUTOMATIONS.find((a) => a.key === key);
      if (!automation) throw invalid(`unknown automation: ${key}`);

      const config = await readConfig(db, { tenantId, key });
      const schema = CONFIG_SCHEMA[automation.kind] || {};

      // Read enabled state
      const { rows: settingRows } = await db.query(
        `SELECT value FROM keystone.tenant_setting WHERE tenant_id = $1 AND key = $2`,
        [tenantId, automationSettingKey(key)]);
      const enabled = settingRows.length ? settingRows[0].value !== false : automation.defaultOn;

      // Read runs (latest 50)
      const { rows: runRows } = await db.query(
        `SELECT ar.id, ar.run_at, ar.person_id, ar.action, ar.state, ar.outcome, ar.outcome_detail,
                p.display_name as person_name
           FROM keystone.automation_run ar
           LEFT JOIN keystone.app_user p ON p.id = ar.person_id
          WHERE ar.tenant_id = $1 AND ar.key = $2
          ORDER BY ar.run_at DESC
          LIMIT 50`,
        [tenantId, key]);

      // Count runs since first
      const { rows: ranCountRows } = await db.query(
        `SELECT COUNT(*) as count FROM keystone.automation_run
          WHERE tenant_id = $1 AND key = $2`,
        [tenantId, key]);
      const ran_count_since_first = parseInt(ranCountRows[0]?.count || 0);

      // Count bought_again outcomes
      const { rows: boughtRows } = await db.query(
        `SELECT COUNT(*) as count FROM keystone.automation_run
          WHERE tenant_id = $1 AND key = $2 AND outcome = 'bought_again'`,
        [tenantId, key]);
      const bought_count = parseInt(boughtRows[0]?.count || 0);

      // Calculate reach based on kind
      let reachCount = null;
      let reachSentence = null;
      if (automation.kind === "package_low") {
        const { rows: pkgRows } = await db.query(
          `SELECT COUNT(*) as count FROM keystone.entitlement
            WHERE tenant_id = $1 AND status = 'active'`,
          [tenantId]);
        reachCount = parseInt(pkgRows[0]?.count || 0);
        reachSentence = `Clients with a package. ${reachCount} people right now.`;
      } else if (automation.kind === "quiet_flag") {
        const { rows: qRows } = await db.query(
          // ★ there is no keystone.person table (the canonical person is app_user) — this 500'd
          `SELECT COUNT(*) as count FROM keystone.app_user
            WHERE tenant_id = $1 AND role IN ('adult_client','adolescent_client')
              AND lifecycle_status = 'active' AND archived_at IS NULL`,
          [tenantId]);
        reachCount = parseInt(qRows[0]?.count || 0);
        reachSentence = `Active clients. ${reachCount} people right now.`;
      } else if (automation.kind === "invoice_chase") {
        const { rows: iRows } = await db.query(
          `SELECT COUNT(*) as count FROM keystone.invoice_effective
            WHERE tenant_id = $1 AND status = 'open'`,  // outstanding = open (draft/void/paid are not)
          [tenantId]);
        reachCount = parseInt(iRows[0]?.count || 0);
        reachSentence = `Outstanding invoices. ${reachCount} right now.`;
      } else {
        reachSentence = "Applies as it happens.";
      }

      return {
        key,
        name: automation.name,
        kind: automation.kind,
        behaviour: automation.behaviour,
        enabled,
        config,
        schema,
        disabledReason: key === "ads.keyword_pause" ? "Needs Google Ads connected — this rule only ever proposes, it never acts" : null,
        runs: runRows.map((r) => ({
          id: r.id,
          run_at: r.run_at,
          person_name: r.person_name || null,
          action: r.action,
          state: r.state,
          outcome: r.outcome,
          outcome_detail: r.outcome_detail,
        })),
        ran_count_since_first,
        bought_count,
        reach: { count: reachCount, sentence: reachSentence },
      };
    }, { bucket: "list" }).then((r) => c.json(r, 200));
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // POST /api/tasks/automations/:key — Update automation config/enabled.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  app.post("/api/tasks/automations/:key", (c) => {
    const key = c.req.param("key");
    return runTenantScoped(c, async ({ db, principal, body, tenantId }) => {
      await assertMay(db, principal, { object: "automation", action: "edit" });
      const automation = AUTOMATIONS.find((a) => a.key === key);
      if (!automation) throw invalid(`unknown automation: ${key}`);

      if (!body || typeof body !== "object") {
        throw invalid("a JSON object body is required");
      }

      // Special case: ads.keyword_pause cannot be enabled
      if (key === "ads.keyword_pause" && body.enabled === true) {
        throw invalid("Needs Google Ads connected — this rule only ever proposes, it never acts");
      }

      // Handle config update
      if (body.config !== undefined) {
        const err = validateConfig(key, body.config);
        if (err) {
          throw invalid(err);
        }
        await db.query(
          `INSERT INTO keystone.automation_config (tenant_id, key, config)
            VALUES ($1, $2, $3)
            ON CONFLICT (tenant_id, key) DO UPDATE SET config = EXCLUDED.config`,
          [tenantId, key, JSON.stringify(body.config)]);
      }

      // Track if enabled changed
      let enabledChanged = false;
      let droppedCount = 0;

      // Handle enabled update
      if (body.enabled !== undefined) {
        const settingKey = automationSettingKey(key);
        await setSetting(db, {
          tenantId,
          key: settingKey,
          value: body.enabled,
          updatedBy: principal.appUserId,
        });
        enabledChanged = true;

        // If disabling, drop queued runs
        if (body.enabled === false) {
          const { rows: droppedRows } = await db.query(
            `UPDATE keystone.automation_run SET state = 'dropped'
              WHERE tenant_id = $1 AND key = $2 AND state = 'queued'
              RETURNING id`,
            [tenantId, key]);
          droppedCount = droppedRows.length;
        }
      }

      // Emit event
      if (enabledChanged || body.config !== undefined) {
        await emit(db, {
          tenantId,
          topic: "settings.automation.changed",
          emittedBy: "settings", // RUN-2: "automations" is not a section — emit() threw and the automation settings save rolled back
          actor: userActor(principal.appUserId),
          payload: {
            key,
            enabled_changed: enabledChanged,
            config_changed: body.config !== undefined,
          },
        });
      }

      return { ok: true, dropped: droppedCount };
    }, { bucket: "write", status: 201 }).then((r) => c.json(r, 201));
  });
}
