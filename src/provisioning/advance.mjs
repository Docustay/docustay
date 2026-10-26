// ═══════════════════════════════════════════════════════════════════════════════════════════════
// P6.79 — ADVANCE A PROVISIONING RUN. THE CALLER THE RUNNER NEVER HAD.
//
// ★★★ `executeStep()` AND `reconcileRunState()` HAVE EXISTED WITH ZERO CALLERS FOR THE WHOLE BUILD
//     [MEASURED 2026-09-15]: `src/provisioning/runner.mjs:48` and `:131`, referenced nowhere in
//     `src/` or `web/src/` outside their own file. So did all three provider steps —
//     `steps/stripeCustomer.mjs`, `steps/resendDomain.mjs`, `steps/documensoTeam.mjs` (the third of
//     these is DELETED as of S2 Task 3 / 01 default 9 — this line is the 2026-09-15 snapshot, kept
//     verbatim because it is the historical measurement, not a claim about today's tree). The retry
//     logic, the attempt budget, the backoff, the classification of a provider error into
//     retryable-versus-fatal: all written, all tested, and **never once run by the product.**
//
// ★★★ AND THE DEPLOYED DATABASE SHOWS EXACTLY WHAT THAT COSTS. [MEASURED 2026-09-15 against the
//     deployed Postgres] ONE provisioning run, state `running`:
//       organisation_and_admin  succeeded      ← the prefix, done at signup
//       stripe_customer         pending
//       form_workspace          pending
//       resend_domain           pending
//       documenso_team          awaiting_human ← STILL TRUE TODAY. This row is the one stranded
//                                                 production run named throughout this file and in
//                                                 HANDOFF.md; S2 Task 3 deleted the STEP DEFINITION
//                                                 and the only code that could ever close it
//                                                 (`completeHandoff`), but did not and could not
//                                                 touch this already-existing row (see Task 9).
//     The tenant is live and usable — that is the DESIGNED `partial` state — but four steps have sat
//     untouched since the day it was created, because **nothing in the product can move them.**
//     A run that only a redeploy could advance is not a run, it is a record of an intention.
//
// ★★ THE ONE THING THIS MUST NOT DO IS PRETEND. `form_workspace` HAS NO IMPLEMENTATION — there is no
//    `steps/formWorkspace.mjs` and no provider call anywhere for it. It is reported by name, with
//    that reason, and left `pending`. Marking it succeeded because the screen has a button would be
//    the worst available outcome: a step that nobody performed, recorded as done, on the surface
//    whose whole job is to say what is outstanding.
//
// ★★ `documenso_team` NO LONGER EXISTS — S2 TASK 3 (01 default 9: Documenso is retired). It was the
//    one step `executeStep`'s `awaiting_human` guard (`runner.mjs:66`) and `skipReason` below were
//    written for: never auto-retried, closeable only by a person recording a team id through
//    `completeHandoff()`. That function, and the module it delegated to
//    (`steps/documensoTeam.mjs`), are deleted with it — nothing in the product can produce
//    `Outcome.AWAITING_HUMAN` today. The state and the guard both stay (see `classify.mjs`), because
//    a FUTURE step may genuinely need a human, but there is currently no caller of that path.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { executeStep, reconcileRunState } from "./runner.mjs";
import { createStripeCustomer } from "./steps/stripeCustomer.mjs";
import { registerSendingDomain } from "./steps/resendDomain.mjs";
// ★★★ F478 STEP 5 FIX ROUND 1 — REUSE, NOT A SECOND DEFINITION OF "LIVE". The review's Critical 1:
//     this file used to decide "live" with its own `!key.startsWith("sk_test_")`, which is a
//     SECOND, incompatible definition from `charge.mjs`'s `/^(sk|rk)_live_/` — the exact
//     duplicate-truth shape F478 exists to remove, one level down. `classifyStripeKeyShape` is the
//     one place that fact lives now.
import { classifyStripeKeyShape } from "../money/charge.mjs";

/** ★ The prefix step is all-or-nothing and already committed; it is never re-run from a screen. */
const PREFIX_STEP = "organisation_and_admin";

/**
 * Which provider call backs each step — ★ INJECTABLE, because a gate must never make a real call to
 * Stripe or Resend and the alternative (a gate that does) is a test that spends money and mail
 * quota. The default map is what production uses; a caller may supply its own.
 */
export const STEP_PERFORMERS = Object.freeze({
  stripe_customer: async ({ run, secrets }) => createStripeCustomer(
    { tenantId: run.tenant_id, email: run.admin_email, name: run.requested_name },
    { apiKey: secrets.stripeApiKey }),
});

// ★★★ `resend_domain` IS DELIBERATELY ABSENT FROM THAT MAP, AND THIS IS THE SECOND THING THIS FILE
//     REFUSES TO PRETEND ABOUT. `registerSendingDomain({ tenantId, domain })` needs the tenant's
//     OWN sending domain, and [MEASURED 2026-09-15] **nothing in this system holds one**: not a
//     column on `keystone.tenant` (id · slug · name · status · timezone · is_platform · sandbox_of
//     · is_reference), not a key in `tenant_setting` (zero rows, zero keys, on either database).
//     ★★ `PLATFORM_SENDING_DOMAIN` is NOT that value — `resendDomain.mjs` uses it as the FALLBACK
//        a tenant sends from when their own domain is unverified, so passing it in as the domain to
//        register would ask Resend to re-register the platform's own domain per tenant.
//     ★ My first draft read `run.sending_domain` and `run.admin_email` off the run row. Neither
//       column exists — `provisioning_run` is (id · tenant_id · requested_slug · requested_name ·
//       state · created_at · updated_at · completed_at). That is SHAPE-ASSUMED, caught by dumping
//       the columns rather than by reasoning, which is the standing rule for exactly this reason.
//       `admin_email` now comes from the tenant's own admin user (see the query below); the domain
//       has no source at all, so the step is reported and never attempted.
const NO_INPUT_SOURCE = Object.freeze({
  resend_domain:
    "no sending domain is recorded for this tenant anywhere — not on `tenant`, not in " +
    "`tenant_setting` — so there is nothing to register. This needs a domain field before it can run.",
});

/**
 * ★★ WHY A STEP WAS NOT ATTEMPTED, IN WORDS, EVERY TIME. A result list that silently omits the
 *    steps it skipped reads as "four steps, two advanced" and says nothing about the other two —
 *    which is how `form_workspace` would quietly stay pending forever with nobody able to say why.
 */
/**
 * ★★★ CORRECTED — this used to claim "there is no Stripe key and no Resend key" configured
 *     anywhere in `src/`. That was already FALSE before F478: `src/money/charge.mjs` has always
 *     read `KEYSTONE_STRIPE_SECRET_KEY` and `src/email/resend.mjs` has always read
 *     `RESEND_API_KEY`. This project's own rule is that a comment recording an overturned fact
 *     gets REWRITTEN, not left — a stale "true when written" sentence is failure #2's shape in
 *     miniature. What is actually true, per the F478 task brief (names only, never a value, per
 *     CLAUDE.md): **neither `KEYSTONE_STRIPE_SECRET_KEY` nor its old alias is set on any Railway
 *     service; `RESEND_API_KEY` IS set on both `keystone-app` and `keystone-worker`.** So
 *     `resend_domain` has a credential available today (it still cannot run, per the separate
 *     `NO_INPUT_SOURCE` gap below — no sending domain exists to register); `stripe_customer`
 *     genuinely has no credential configured yet, for a deployment reason, not a code reason — the
 *     code that would read the key exists and reads the right name.
 * ★★ THEREFORE THIS REPORTS THE ABSENCE INSTEAD OF THROWING. A 500 on the one screen whose job is
 *    to explain why a run is stuck would replace the answer with a stack trace. The step stays
 *    `pending`, untouched, and the screen names the variable that would unblock it.
 * ★ NEVER a fallback value. CLAUDE.md §2.3 — no `process.env.KEY || 'literal'`, ever, and a
 *   provisioning path that invented a key would be inventing one against a live provider account.
 */
// ★★★ F478 — ONE NAME PER CREDENTIAL. These used to be `KEYSTONE_STRIPE_API_KEY` and
//     `KEYSTONE_RESEND_API_KEY` — SECOND names for the same two secrets `src/money/charge.mjs` and
//     `src/email/resend.mjs` already read under `KEYSTONE_STRIPE_SECRET_KEY` and `RESEND_API_KEY`.
//     A deployment that set only ONE of a pair looked fully configured to whichever module read
//     that name and silently unconfigured to this one. `db/gates/s2_one_name_per_credential.mjs`
//     is the gate that keeps this from drifting back to two names.
const SECRET_ENV = Object.freeze({
  stripeApiKey: "KEYSTONE_STRIPE_SECRET_KEY",
  resendApiKey: "RESEND_API_KEY",
});
const SECRET_FOR_STEP = Object.freeze({ stripe_customer: "stripeApiKey", resend_domain: "resendApiKey" });

/** ★ Read from the environment at call time, never cached — a key rotated in Railway takes effect
 *  on the next request rather than on the next deploy. */
function resolveSecrets(env = process.env) {
  return Object.fromEntries(
    Object.entries(SECRET_ENV).map(([k, name]) => [k, env[name] ?? null]));
}

// ★★★ F478 STEP 5 — THE PROVISIONING STRIPE CALL HAD NO LIVE/TEST CHECK. `src/money/charge.mjs`
//     refuses a live key outright without a named, in-session approver (HARD LIMIT 1); this call
//     creates a Stripe CUSTOMER rather than moving money, but a live key reaching it from a
//     staging/local run of `advanceRun` is still the same class of drift — a card-holding account
//     touched by a deployment nobody meant to point at production Stripe. So OUTSIDE production,
//     the key must be a TEST key; anything else is refused before the call is made, the same way a
//     missing credential is refused above rather than attempted and left to fail. ON PRODUCTION,
//     this check does not apply at all — whatever key is configured there is `charge.mjs`'s
//     territory (its own live-key-needs-an-approver lock), not this one's.
//
// ★★★ FIX ROUND 1, CRITICAL 1 — THREE OUTCOMES, THREE DIFFERENT MESSAGES, NOT ONE MESSAGE FOR TWO
//     FACTS. The original check refused anything that was not `sk_test_…` and said "a live Stripe
//     key is set" regardless of WHY it was refused. That was wrong twice over: (a) a restricted
//     test key `rk_test_…` — which `charge.mjs` has always accepted as a test key — was refused as
//     if it were live, blocking a legitimate configuration; (b) a malformed or truncated key was
//     ALSO reported as "a live key", sending whoever reads it hunting for a production credential
//     that was never set. `classifyStripeKeyShape()` answers "test / live / malformed" as ONE fact
//     shared with `charge.mjs`, and each of the three gets its own sentence below.
const STRIPE_LIVE_TEST_STEP = "stripe_customer";

/**
 * ★ Never the key. Only the text before the FIRST underscore, so a refusal can say "this doesn't
 *   look like sk_test_/sk_live_ shape, here's what we saw at the front" without ever printing
 *   enough of a malformed value to matter if it were, despite the name, a real credential typed
 *   into the wrong variable.
 */
function stripeKeyPrefixForMessage(key) {
  const idx = key.indexOf("_");
  return idx === -1 ? "(no underscore found in it)" : `"${key.slice(0, idx)}_"`;
}

function skipReason(step, performers, secrets, env) {
  if (step.name === PREFIX_STEP) {
    return "the prefix step is all-or-nothing and is already committed — it is never re-run";
  }
  if (step.state === "succeeded") return "already succeeded";
  // ★ S2 TASK 3 — no step name is checked here anymore (`documenso_team` is retired); the STATE
  //   alone decides. Nothing produces this state today (see `classify.mjs`), but a step landing in
  //   it must still never be auto-retried, whatever put it there.
  // ★★★ FIX ROUND 1, I3 — the previous message ("see the run's own record of what it needs") named
  //   a record that does not exist: `completeHandoff()` and the route that wrote to it are BOTH
  //   deleted with `documenso_team` (S2 Task 3), so there is nothing in the product, on this run or
  //   any other, that can act on this state. The one legacy production row already sitting in
  //   `awaiting_human` (a stranded `documenso_team`) is real and this message reaches an operator
  //   looking at it — say the true thing: nobody and nothing in-app closes it; see HANDOFF.md / Task
  //   9 for the one-time close-out this row still needs.
  if (step.state === "awaiting_human") {
    return "awaiting a person outside Workbench — nothing in the product can advance this step; an operator closes it (as migration 0131 did for the retired Documenso step)";
  }
  if (NO_INPUT_SOURCE[step.name]) return NO_INPUT_SOURCE[step.name];
  if (!performers[step.name]) {
    return `no provider call exists for "${step.name}" — it has no implementation, so nothing here can advance it`;
  }
  // ★ Checked LAST, so a step that could never run for a structural reason says THAT rather than
  //   blaming a missing key it would not use anyway.
  const need = SECRET_FOR_STEP[step.name];
  if (need && !secrets?.[need]) {
    return `no provider credential is configured — set ${SECRET_ENV[need]} in the deployment environment and try again`;
  }
  // ★★★ F478 STEP 5 — LIVE/TEST CHECK, CHECKED LAST OF ALL: a step that has a credential but the
  //   WRONG kind of credential for this deployment says that specifically, rather than being
  //   attempted and failing at Stripe with a less legible error. ★ Production is OUT OF SCOPE for
  //   this check entirely — any shape is let through there, live included; `charge.mjs` is what
  //   gates a live key, with an in-session approver, when money actually moves.
  if (step.name === STRIPE_LIVE_TEST_STEP && env?.KEYSTONE_ENVIRONMENT !== "production") {
    const key = String(secrets?.stripeApiKey ?? "");
    const shape = classifyStripeKeyShape(key);
    if (shape === "live") {
      return "a live Stripe key is set on a non-production deployment";
    }
    if (shape === "malformed") {
      return `${SECRET_ENV.stripeApiKey}'s format was not recognised — expected sk_test_… or ` +
        `rk_test_… (got the prefix ${stripeKeyPrefixForMessage(key)})`;
    }
    // shape === "test" (sk_test_… or rk_test_…) — the ONE shape allowed outside production. Falls
    // through: no skip reason, the step is attempted.
  }
  return null;
}

/**
 * Advance every actionable step of one run, then recompute the run's state.
 *
 * @param db        a client with access to the run (platform-gated at the route)
 * @param runId
 * @param secrets   { stripeApiKey, resendApiKey } — read from the secret store by the CALLER.
 *                  ★ Never defaulted and never read from `process.env` here: the step modules
 *                    already refuse a missing key loudly, and a second place that could supply one
 *                    is a second place a hardcoded fallback could be introduced.
 * @param env       ★ F478 STEP 5 — only `KEYSTONE_ENVIRONMENT` is read from it, to decide whether
 *                    the Stripe key must be a test key. Defaults to `process.env` like `secrets`
 *                    would if the caller did not supply its own via `resolveSecrets()`.
 * @returns { runId, runState, steps: [{ name, attempted, outcome | reason }] }
 */
export async function advanceRun(db, runId, {
  secrets = {}, performers = STEP_PERFORMERS, env = process.env,
} = {}) {
  // ★★ `admin_email` IS A JOIN, NOT A COLUMN. The prefix step creates the tenant AND its first
  //    admin in one transaction, so the admin is where the email lives; `provisioning_run` has no
  //    such field. ★ LATERAL + ORDER BY created_at picks the FIRST admin — the one provisioning
  //    made — rather than whoever happens to sort first after later invitations.
  const { rows: runRows } = await db.query(
    `SELECT r.id, r.tenant_id, r.requested_name, r.requested_slug, r.state, a.email AS admin_email
       FROM keystone.provisioning_run r
       LEFT JOIN LATERAL (
         SELECT u.email FROM keystone.app_user u
          WHERE u.tenant_id = r.tenant_id AND u.staff_role = 'admin'
          ORDER BY u.created_at LIMIT 1) a ON true
      WHERE r.id = $1`, [runId]);
  const run = runRows[0];
  // ★ An absent run is an error, never an empty result. "Nothing to advance" and "that run does not
  //   exist" are different facts, and a screen showing the first for the second is a dead end.
  if (!run) throw new Error(`advanceRun: no provisioning run ${runId}`);

  const { rows: steps } = await db.query(
    `SELECT name, segment, state, attempts, max_attempts
       FROM keystone.provisioning_step WHERE run_id = $1 ORDER BY ordinal`, [runId]);

  const results = [];
  for (const step of steps) {
    const reason = skipReason(step, performers, secrets, env);
    if (reason) { results.push({ name: step.name, attempted: false, reason }); continue; }
    const perform = performers[step.name];
    const outcome = await executeStep({ db, runId }, step, () => perform({ run, secrets }));
    results.push({
      name: step.name,
      attempted: true,
      // ★ `skipped` comes back from the runner's OWN guards (attempt budget, already succeeded).
      //   Passing its words through rather than re-deciding here keeps one answer to "why not".
      ...(outcome.skipped ? { attempted: false, reason: outcome.reason } : {}),
      outcome: outcome.outcome ?? null,
      ok: outcome.ok ?? false,
      retryable: outcome.retryable ?? null,
    });
  }

  // ★★★ RECONCILE EVEN WHEN NOTHING WAS ATTEMPTED. The run's own `state` is derived from its steps
  //     and can be stale for reasons that have nothing to do with this call — a step completed by
  //     the handoff route, say. Skipping this when `results` is all-skips is how a run stays
  //     `running` forever after its last step succeeded.
  const runState = await reconcileRunState(db, runId);
  return { runId, runState, steps: results };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★ S2 TASK 3 — `completeHandoff` / `completeProvisioningHandoff` ARE DELETED WITH `documenso_team`.
//   Both existed for exactly one purpose: recording that a person had created a Documenso team by
//   hand and closing that step with the id they got. There is no other human-only step in the
//   product today (see `classify.mjs`'s note on `Outcome.AWAITING_HUMAN`), so there is nothing left
//   for a generic "complete a handoff" call to do. The one PRODUCTION row still sitting in
//   `documenso_team = awaiting_human` is NOT touched by this deletion (Task 3's brief, Step 7) — it
//   is a one-off, explicitly approved production action for Task 9, not a code path this file keeps
//   alive on the row's behalf.
//
// THE ONE ROUTE ADAPTER THAT REMAINS. ★ `registerWriteRoutes` calls `fn(db, args)` where `args` is
// the body plus `actorUserId` and `tenantId`, both stamped from the SESSION last so a body cannot
// override them (`routes/writes.mjs:196`). This exists so the route table stays declarative.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export async function advanceProvisioningRun(db, { runId }) {
  if (!runId) throw new Error("advanceProvisioningRun: runId is required");
  return advanceRun(db, runId, { secrets: resolveSecrets() });
}
