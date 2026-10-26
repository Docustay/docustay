// P2.5 — THE CRITICAL PREFIX: organisation + admin user, all-or-nothing, in ONE LOCAL TRANSACTION.
//
// ★★ THIS IS THE ONLY STEP THAT CAN BE A REAL TRANSACTION, because it is the only one that is
// entirely local. Every later step is a remote call that cannot join it. That asymmetry is the
// whole shape of Phase 2: a transactional prefix, then a forward-only suffix that may sit partial.
//
// ★★★ WHAT "ALL-OR-NOTHING" BUYS, and why it must be this step specifically:
// A tenant row WITHOUT an admin user is unreachable — nobody can log in to it — yet it holds the
// subdomain. It is the worst possible partial state: invisible to the customer, permanent from
// the outside, and indistinguishable from a live tenant to anything scanning for name collisions.
// An admin user without a tenant is an orphan row. Neither may exist alone, so both commit
// together or neither does.
//
// ★ It runs BEFORE any tenant context exists — there is no tenant to set a GUC to yet. It is
// therefore the ONE code path that legitimately connects as a privileged role, and it is written
// as its own module so that fact is greppable rather than buried in a helper.

import { randomUUID } from "node:crypto";
import { parse, CreateTenant, CreateAdminUser } from "../http/validate.mjs";
import { conflict, internal } from "../http/errors.mjs";
import { seedBuiltinRoles } from "../permissions/writes.mjs";
import { STAFF_ROLE_TO_ROLE_KEY } from "../permissions/defaults.mjs";
// ★ 16.19 — every new practice gets the six "living list" segments (0455's seed set), same
//   footing as seedBuiltinRoles/seed_units immediately below: seeded ONCE, in THIS transaction,
//   not lazily on first read of /growth/lists.
import { seedLivingSegments } from "../growth/campaigns.mjs";
import { CURRENT_POLICY_VERSION } from "../legal/policies.mjs";

/**
 * @param privilegedClient  a pg client connected as a role able to create the first tenant.
 *                          NOT app_rw — app_rw cannot insert a tenant with no context.
 */
/**
 * ★★★ EXTENDED AT P17.9, ADDITIVELY. Three optional inputs, every one defaulting to exactly the
 * previous behaviour, so `test/p2_05_prefix.test.mjs`'s seven cases are unaffected.
 *
 * @param firebaseUid  ★★★ WRITTEN INSIDE THIS TRANSACTION, AND THAT IS THIS MODULE'S OWN ARGUMENT
 *   APPLIED ONE STEP FURTHER. The header above says a tenant without an admin is "the worst possible
 *   partial state — unreachable, yet it holds the subdomain." An admin row **without a firebase_uid
 *   is equally unreachable**: P13.4 matches by uid and never by email, so that person could never
 *   log in to the organisation they just created, while the subdomain stayed claimed. Same failure,
 *   same remedy — it commits with the other two or not at all.
 * @param isPlatform   D-17.10. The platform tenant is designated at creation and never afterwards;
 *   there is deliberately no UPDATE path for it (0025 grants INSERT only).
 * @param staffRole    'admin' by default — see the long note below on why not `coach`. 'super_admin_1'
 *   is permitted ONLY because the DATABASE decides whether it is legal: `enforce_super_admin_1()`
 *   refuses it outside the platform tenant and `app_user_single_super_admin_1_idx` makes it globally
 *   singular. This parameter states intent; the schema holds the rule.
 * @param policyAcceptance  ★★★ [TY, RULED 1 Oct 2026] `{ ip, userAgent } | null`. `null` (the
 *   default) is BYTE-FOR-BYTE the previous behaviour — no row written, every existing caller and
 *   `test/p2_05_prefix.test.mjs`'s seven cases unaffected. When the signup route passes it (after
 *   confirming `body.policyAccepted === true` — see src/routes/signup.mjs), this writes three
 *   `keystone.policy_acceptance` rows (terms/privacy/dpa, migration 0556) in THIS transaction,
 *   against `CURRENT_POLICY_VERSION` (src/legal/policies.mjs) — the same "commits with the tenant
 *   or not at all" reasoning as the admin user row two paragraphs up: an account that exists
 *   without a recorded acceptance is the same unreachable-proof-of-consent problem one level over.
 */
export async function runCriticalPrefix(
  privilegedClient,
  { runId, tenant, admin, firebaseUid = null, isPlatform = false, staffRole = "admin", policyAcceptance = null }
) {
  // ★ Validate BEFORE opening the transaction. A validation failure inside the transaction would
  // roll back a run row we want to keep as a record of the attempt.
  const t = parse(CreateTenant, tenant, "tenant");
  const a = parse(CreateAdminUser, admin, "admin user");

  const db = privilegedClient;
  await db.query("BEGIN");
  try {
    // ── the organisation ──────────────────────────────────────────────────
    // ★★★ THE ID IS GENERATED, NOT RETURNED — D-17.17. `INSERT … RETURNING` is subject to RLS: the
    //     new row must be VISIBLE under a SELECT policy, and `app_signup` deliberately has none, so
    //     RETURNING fails with a message about WITH CHECK that points at the wrong thing entirely.
    //     [EXECUTED] the same insert succeeds without RETURNING and fails with it.
    // ★★ `keystone.uuid_generate_v7()`, NOT `randomUUID()`. Every id in this schema is v7 and the
    //    time-ordering is load-bearing for index locality; a v4 here would be silently worse forever.
    // ★ It also removes a read the signup role would otherwise need permanently, to serve one
    //   statement's convenience. See 0026.
    const newId = async () =>
      (await db.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;

    let tenantId = await newId();
    try {
      await db.query(
        // ★ `status` stays the literal 'provisioning'. 0025's WITH CHECK admits nothing else for
        //   `app_signup`, so a signup CANNOT mint a live tenant — activation is the suffix's job.
        `INSERT INTO keystone.tenant (id, slug, name, timezone, status, is_platform)
         VALUES ($1,$2,$3,$4,'provisioning',$5)`,
        [tenantId, t.slug.toLowerCase(), t.name, t.timezone, isPlatform === true]
      );
    } catch (err) {
      if (err.code === "23505") {
        // ★ Unique violation on slug. This is NOT the `already_exists = success` case from P2.4 —
        // that rule is about OUR object at a REMOTE provider. This is a different customer's
        // subdomain in OUR database, and reusing it would hand them someone else's tenant.
        throw conflict(`the subdomain "${t.slug}" is already taken`, { field: "slug" });
      }
      throw err;
    }

    // ★★★ THE CHICKEN-AND-EGG IS ABOUT THE TENANT *ROW*, NOT THE WHOLE TRANSACTION — D-17.18.
    //     The tenant now EXISTS, so from here on we legitimately ARE in its context, and the GUC is
    //     set to say so. Everything after this line satisfies the ORDINARY tenant policies.
    //
    // ★★ WITHOUT THIS THE ADMIN INSERT DEPENDS ON UNDEFINED BEHAVIOUR. `app_user`'s pre-existing
    //    `tenant_insert` policy is `WITH CHECK (tenant_id = require_tenant_id())`, and
    //    `require_tenant_id()` **RAISES** when the GUC is unset rather than returning false. Postgres
    //    ORs permissive policies, and OR SHORT-CIRCUITS — so whether the raise happens at all
    //    depends on which policy is evaluated first, which is not a guarantee. [EXECUTED] the same
    //    insert passed in one probe and failed with "no tenant context" in another. A write that
    //    works or raises depending on policy evaluation order is not a working write.
    // ★ So this does not rely on 0025's `signup_insert_admin` at all — that policy is now a second,
    //   independent reason the row is admissible, not the load-bearing one.
    await db.query(`SELECT set_config('keystone.tenant_id', $1, true)`, [tenantId]);

    // ── the admin user, same transaction ──────────────────────────────────
    const adminUserId = await newId();
    await db.query(
      `INSERT INTO keystone.app_user (id, tenant_id, email, display_name, role, staff_role, firebase_uid)
       VALUES ($6,$1,$2,$3,'staff',$4,$5)`,
      // ★ 'staff' is a literal here, and `role` is deliberately NOT an accepted input — see
      // CreateAdminUser. Taking a role and overwriting it is how a caller's intent disappears.
      //
      // ★★★ `staff_role` ADDED 2026-09-12 (P12.0, the first full-suite run on a database this
      // machine can reach). Migration 0010 added `staff_role_shape` — role='staff' REQUIRES a
      // rank — AFTER this code was written, so every signup has been inserting a row the
      // schema now refuses. [EXECUTED] the P2.5 suite failed with
      //   'new row for relation "app_user" violates check constraint "staff_role_shape"'
      // on two of its seven cases. This is the documented full-suite lesson arriving in
      // PRODUCTION code rather than in a fixture: "each phase passed when written" is a weaker
      // claim than it sounds.
      //
      // ★★ 'admin', NOT `coach`. 0010's BACKFILL chose the least-privileged rank because it was
      // guessing at rows nobody granted. This is the opposite case and the reasoning inverts:
      // this person is the human who just signed the organisation up, and a brand-new tenant
      // whose only staff member is a coach is a tenant with NOBODY who can administer it —
      // locked out at creation. ★ It is deliberately not 'super_admin'/'super_admin_1': those
      // are PLATFORM ranks, and enforce_super_admin_1() (0010:133) refuses the latter outside
      // the platform tenant anyway.
      // ★★ `staffRole` defaults to 'admin', so every existing caller is byte-for-byte unchanged.
      //    `firebaseUid` defaults to null, which is exactly what the column held before — the
      //    difference is that the SIGNUP ROUTE now supplies it, so the person can actually log in.
      [tenantId, a.email.toLowerCase(), a.displayName, staffRole, firebaseUid, adminUserId]
    );

    // ── bind the run to the tenant it just created ────────────────────────
    await db.query(
      `UPDATE keystone.provisioning_run SET tenant_id = $2, state = 'running' WHERE id = $1`,
      [runId, tenantId]
    );
    // ★ TWO STATEMENTS, AND THE GUC ABOVE IS WHAT MAKES THE SECOND ONE LEGAL. D-17.18.
    //   The first binds the steps while they are still unbound (0025's `signup_bind_step`,
    //   `USING (tenant_id IS NULL)`). The second then matches them under the ORDINARY
    //   `tenant_isolation` policy, because `keystone.tenant_id` is now set to this tenant.
    // ★★ WITHOUT THE GUC THE SECOND STATEMENT WOULD MATCH ZERO ROWS AND RAISE NOTHING — an UPDATE
    //    that affects no rows is not an error — and the prefix step would sit `pending` forever
    //    while the run looked permanently incomplete. That silent window is why the GUC is set
    //    before this point rather than after, and the probe below asserts the step reached
    //    'succeeded' rather than assuming it.
    // ★ A CASE-merged single statement was tried and rejected: `ELSE state` / `ELSE attempts` READ
    //   those columns, which would have required granting the signup role SELECT on four more
    //   columns purely to avoid a second UPDATE. Two narrow statements beat one wide grant.
    await db.query(
      `UPDATE keystone.provisioning_step SET tenant_id = $2 WHERE run_id = $1`,
      [runId, tenantId]
    );
    await db.query(
      `UPDATE keystone.provisioning_step
          SET state='succeeded', completed_at=now(), attempts = attempts + 1
        WHERE run_id=$1 AND name='organisation_and_admin'`,
      [runId]
    );

    // ★★★ ACTIVATE, IN THIS TRANSACTION, AS THE LAST ACT — D-17.21.
    //     `resolve_tenant_by_slug` admits ONLY `status = 'active'`, and [MEASURED by sweeping all of
    //     src/ and db/migrations/] NOTHING ELSE IN THE CODEBASE EVER SETS THAT STATUS. Leaving the
    //     row 'provisioning' for the suffix to finish meant every workspace created through the real
    //     flow was permanently un-loginable — signup returned 201 and the owner's next request came
    //     back `invalid credential`. ★ The comment on the INSERT above used to say activation "is the
    //     suffix's job"; that was true as an intention and false as a fact, and the fact is what the
    //     owner experiences.
    // ★★ IN THE SAME TRANSACTION, deliberately. A tenant that exists but cannot be entered is
    //    exactly the unreachable half-state this whole function exists to make impossible; splitting
    //    activation out would reintroduce it one line later.
    // ★ Through a definer that can ONLY do provisioning → active (0028). The signup role gets no
    //   UPDATE policy on `tenant` and no read of it — the insert still writes the literal
    //   'provisioning', so 0025's WITH CHECK is untouched and a signup still cannot mint a live
    //   tenant directly.
    // ★★★ P1.2 — THE PRACTICE GETS ITS ROLES, AND THE FOUNDER GETS ONE, IN THIS TRANSACTION.
    //     Same argument as activation two paragraphs down, and it is the same failure shape: a
    //     tenant that exists but whose only human holds no role is a tenant where every screen is
    //     empty and nothing says why. ★ Seeding it later, or lazily on first read, would reintroduce
    //     that window — and a write on a read path is its own problem.
    //   ★★ Through `keystone.seed_builtin_roles()`, a SECURITY DEFINER, because `app_signup` has no
    //      SELECT policy on anything and so cannot read back the id of the role it just created.
    //      0067/0068 put the privilege in the function rather than on the role, so this path stays
    //      as blind as 0025/0026 built it.
    await seedBuiltinRoles(db, {
      tenantId,
      grantUserId: adminUserId,
      // ★ `staffRole` is 'admin' by default (see the INSERT above for why it is not `coach` and not
      //   'super_admin'). The map is in defaults.mjs so the correspondence between the old rank and
      //   the new role is written down in one place rather than inferred here.
      grantRoleKey: STAFF_ROLE_TO_ROLE_KEY[staffRole] ?? "admin",
    });

    // ★★★ TASK 14.16 — EVERY NEW PRACTICE GETS ITS SEVEN UNITS, IN THIS SAME TRANSACTION. Same
    //     argument as `seedBuiltinRoles` immediately above: a practice whose catalogue has no units
    //     to sell services by is a catalogue screen with a broken dropdown, and seeding it later (or
    //     lazily on first read) would reopen that window.
    //   ★★ `keystone.seed_units` is a SECURITY DEFINER (0409, task 14.2) on the same "app_signup
    //      cannot read back what it inserts" footing as `seed_builtin_roles` above — and it refuses
    //      to seed any tenant other than the one THIS transaction is already inside (0409's copy of
    //      0367's `seed_builtin_roles` refusal). ★ MEASURED: that refusal is already satisfied here —
    //      `set_config('keystone.tenant_id', $1, true)` (`:101`, above) put this transaction into
    //      `tenantId`'s own context BEFORE `seedBuiltinRoles` ran, so `keystone.current_tenant_id()`
    //      already equals `tenantId` at this line; no extra GUC line is needed.
    await db.query(`SELECT keystone.seed_units($1)`, [tenantId]);

    // ★★★ TASK 16.19 — EVERY NEW PRACTICE GETS ITS SIX LIVING LISTS, IN THIS SAME TRANSACTION. Same
    //     argument as `seed_units` immediately above: `/growth/lists` with nothing seeded is a
    //     screen with nothing on it, and seeding it later (or lazily on first read) reopens the
    //     exact window 0455's backfill closed for every EXISTING practice.
    await seedLivingSegments(db, tenantId);

    // ★★★ [TY, RULED 1 Oct 2026] THE SIGNUP ACCEPTANCE, IN THIS SAME TRANSACTION — see the
    //   `policyAcceptance` param's own doc comment above for why. Three rows, one per document, all
    //   at the one version this deploy currently serves (src/legal/policies.mjs) — a future version
    //   bump changes what the NEXT signup records; it does not rewrite history for this one.
    if (policyAcceptance) {
      for (const policyType of ["terms", "privacy", "dpa"]) {
        await db.query(
          `INSERT INTO keystone.policy_acceptance
             (tenant_id, user_id, policy_type, version, ip_address, user_agent)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [tenantId, adminUserId, policyType, CURRENT_POLICY_VERSION,
           policyAcceptance.ip ?? null, policyAcceptance.userAgent ?? null]
        );
      }
    }

    await db.query(`SELECT keystone.activate_provisioning_tenant($1)`, [tenantId]);

    await db.query("COMMIT");
    // ★ Both ids are the ones WE generated — there is no RETURNING to read them back from, and the
    //   signup role could not read them even if there were (0026).
    return { tenantId, adminUserId };
  } catch (err) {
    await db.query("ROLLBACK").catch(() => {});
    // ★ After the rollback NOTHING exists — no tenant, no user, no claimed subdomain. That is the
    // point of doing these two together, and it is why this step is safe to retry outright while
    // no later step is.
    throw err;
  }
}

/**
 * The step list. Order matters; `segment` marks where all-or-nothing ends.
 * ★★★ S2 TASK 3 — `documenso_team` REMOVED (01 default 9: "Documenso is retired: the provisioning
 *     step `documensoTeam` is removed; no new practice creates a Documenso team."). It was ordinal
 *     5, always `awaiting_human`, and never completed by anything a machine could do (§P2.7). The
 *     three remaining suffix steps keep the ordinals they already had — nothing else re-numbers.
 */
export const STEPS = [
  { name: "organisation_and_admin", ordinal: 1, segment: "prefix" },
  // ── everything below is the SUFFIX: remote, forward-only, may sit partial ──
  { name: "stripe_customer",        ordinal: 2, segment: "suffix" },
  { name: "form_workspace",         ordinal: 3, segment: "suffix" },
  { name: "resend_domain",          ordinal: 4, segment: "suffix" },
];

/** Create the run and its steps. Returns the run id. */
export async function createRun(privilegedClient, { slug, name }) {
  const db = privilegedClient;
  await db.query("BEGIN");
  try {
    // ★★★ NO `RETURNING` — D-17.17. `INSERT … RETURNING` requires the new row to be VISIBLE under a
    //     SELECT policy, and the signup role has none, so it fails with a message about WITH CHECK
    //     that names the wrong mechanism. The id is generated instead.
    const runId = (await db.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
    await db.query(
      `INSERT INTO keystone.provisioning_run (id, requested_slug, requested_name, state)
       VALUES ($1,$2,$3,'running')`,
      [runId, slug, name]
    );
    // ★ S2 TASK 3 — every step of a new run starts `pending`. The one exception (`documenso_team`
    //   forced to `awaiting_human`, because it could never run automatically) no longer exists.
    for (const s of STEPS) {
      await db.query(
        `INSERT INTO keystone.provisioning_step (run_id, name, ordinal, segment, state)
         VALUES ($1,$2,$3,$4,'pending')`,
        [runId, s.name, s.ordinal, s.segment]
      );
    }
    await db.query("COMMIT");
    return runId;
  } catch (err) {
    await db.query("ROLLBACK").catch(() => {});
    if (err.code === "23505") {
      throw conflict(`a signup for "${slug}" is already in progress`, { field: "slug" });
    }
    throw err;
  }
}
