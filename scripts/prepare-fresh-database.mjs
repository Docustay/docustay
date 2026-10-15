#!/usr/bin/env node
// scripts/prepare-fresh-database.mjs — Stage 1 Task 8, fix round 1 (R9 / FINDINGS F482).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ EVERYTHING A REAL FRESH DATABASE NEEDS LIVES HERE, NOT IN A TEST. Staging (Task 11) will be
//     built by running THIS script, not by copying test code, so any repair a fresh database
//     needs has to be a real, callable step of this file. It orchestrates, in order:
//       1. `scripts/bootstrap-roles.mjs`               — the 6 roles + grants + graphile-worker's
//                                                          own schema (see that file's header).
//       2. `db/migrate.mjs up --to 0009`                — the base schema, stopping BEFORE 0010.
//       3. seed ONE minimal placeholder staff row       — 0010's own positive control (0010:66-70)
//                                                          refuses a database with ZERO
//                                                          `role='staff'` rows, by design: it
//                                                          cannot tell "backfill already done"
//                                                          from "this guard is blind and its zero
//                                                          means nothing". A genuinely empty
//                                                          database always has zero on its first
//                                                          pass. HANDOFF.md D-12.0b records this
//                                                          exact precedent for how the real local
//                                                          database got past it the first time:
//                                                          "The two Y1 fixture tenants and their
//                                                          two staff rows were seeded first...
//                                                          Seeding had to be done AS THE
//                                                          SUPERUSER, not as app_owner" — `SET
//                                                          ROLE app_owner` then `INSERT` is
//                                                          refused with "new row violates row-
//                                                          level security policy", because FORCE
//                                                          applies the policy to the owner too
//                                                          (0008:8-16). So this connects with
//                                                          `KEYSTONE_BOOTSTRAP_SUPERUSER_URL`
//                                                          directly, never `SET ROLE`.
//       4. `db/migrate.mjs up` (the rest)                — 0010 onward, including the ownership-
//                                                          drift fix now inside `db/migrate.mjs`
//                                                          itself (a per-file `SET ROLE app_owner`
//                                                          re-check, not a workaround here).
//       5. archive the placeholder                        — see the note below.
//       6. verify ownership                               — every table, sequence and function in
//                                                          `keystone`/`keystone_meta` must be
//                                                          owned by `app_owner` or `auth_owner`
//                                                          — except EXACTLY the two reference
//                                                          guards, owned by `reference_guard`
//                                                          (0144, F501), asserted as a set.
//                                                          A real fresh-database preparation
//                                                          should be able to PROVE the ownership
//                                                          drift this task found is gone, not
//                                                          just hope the per-file fix in
//                                                          `db/migrate.mjs` caught it.
//
// ★★★ THE FRESHNESS PRECONDITION — fix round 2, a NEW Important finding from re-review. Without
//     it, pointing this script at an already-provisioned database would reset all 6 roles'
//     passwords (cutting every live connection using them) and insert the placeholder practice
//     into real data. Before step 1, this connects as the superuser and refuses unless the
//     target is genuinely empty:
//       · no `keystone` schema at all → genuinely fresh, proceed, OR
//       · the schema exists but the migration ledger (`keystone_meta.schema_migrations`) is
//         absent or has zero rows, AND `keystone.tenant` (if it exists) has zero rows.
//     Anything else refuses with `prepare-fresh-database: refusing — <database> is not empty
//     (<what was found>)` and exits 1. `--force` overrides it, but only after printing a one-line
//     warning naming the database — the default is refuse, always.
//
// ★★★ THE ROLE-ATTRIBUTE PRECONDITION — fix round 4, FINDINGS F484. Step 1 creates or repairs the
//     six roles and verifies them itself; this script then asserts the SAME required set AGAIN,
//     INDEPENDENTLY, BEFORE a single migration runs. Two reasons, both measured:
//       · F484 was a role attribute (`app_owner` INHERIT) that only became visible 17 migrations
//         in, when 0017's negative control aborted the run — after 16 migrations had already been
//         applied to a real database. An attribute check costs one query and moves that failure to
//         before any DDL exists to be half-applied.
//       · Roles are CLUSTER-WIDE. Something else on the cluster — another bootstrap, a hand
//         `ALTER ROLE`, an older copy of this tooling — can change them between step 1 and here.
//     It uses `findRoleAttributeProblems()` exported by `scripts/bootstrap-roles.mjs`, so there is
//     ONE definition of the required set, not two that can silently diverge. It refuses with
//     `prepare-fresh-database: refusing — role attributes are wrong on <database>` and exits 1.
//     ★ `--force` does NOT override this one. `--force` exists for "this database is not empty and
//       I mean it"; an app_owner that can read every tenant with no tenant context is not a thing
//       anyone means, and 0017 would refuse the run seventeen migrations later anyway.
//
// ★★ THE PLACEHOLDER, AND WHETHER IT CAN BE ARCHIVED. `keystone.tenant` has NO `archived_at`
//    column — migration 0088's archive list is `app_user, account, network_party, booking,
//    invoice, service, plan, subscription, document_instance`, and `tenant` is not on it. A
//    tenant cannot be archived, only closed. So this script does what the schema actually
//    allows: sets the placeholder tenant's `status` to `'closed'` (0121's own comment: "'closed'"
//    collapses into the same silence as 'provisioning' for every login/branding surface — the
//    tenant becomes unreachable through `resolve_tenant_by_slug`, `keystone_auth.
//    list_active_tenant_ids()`, and every other status='active' filter in the codebase) and, once
//    0088 has added the column, sets `archived_at = now()` on the one placeholder staff row
//    (`archived_by` stays NULL — nobody archived it; it was never a person). ★★★ IT DOES NOT
//    STAY VISIBLE: after this script, `bootstrap-placeholder` is a closed tenant with an
//    archived, unreachable staff account, exactly as inert as this schema can make one that
//    still has to have existed once for 0010's guard to have seen it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { dbSsl } from "../src/db/ssl.mjs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
// ★ ONE definition of the required role-attribute set, shared — never a second copy here.
import { findRoleAttributeProblems, ROLE_NAMES, ATTRIBUTE_COLUMNS } from "./bootstrap-roles.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");

const SUPERUSER_URL = process.env.KEYSTONE_BOOTSTRAP_SUPERUSER_URL;
if (!SUPERUSER_URL) {
  console.error("FATAL: KEYSTONE_BOOTSTRAP_SUPERUSER_URL is not set. Refusing to guess a database.");
  process.exit(1);
}
if (!process.env.KEYSTONE_BOOTSTRAP_PASSWORDS) {
  console.error("FATAL: KEYSTONE_BOOTSTRAP_PASSWORDS is not set.");
  process.exit(1);
}

const PLACEHOLDER_SLUG = "bootstrap-placeholder";
const PLACEHOLDER_EMAIL = "bootstrap-placeholder-staff@example.invalid";

// ★ Every subprocess this script spawns gets the SAME superuser URL as `KEYSTONE_DATABASE_URL` —
//   `db/migrate.mjs` connects as a superuser and does its own `SET ROLE app_owner`; it is never
//   given anything else.
const childEnv = { ...process.env, KEYSTONE_DATABASE_URL: SUPERUSER_URL };

function runNode(args, label) {
  const r = spawnSync("node", args, { cwd: REPO_ROOT, env: childEnv, encoding: "utf8" });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    console.error(`FATAL: ${label} exited ${r.status}`);
    process.exit(1);
  }
}

const FORCE = process.argv.includes("--force");

// ── 0 · refuse anything that is not genuinely empty (see the header note) ───────────────────────
{
  const admin = new pg.Client({ connectionString: SUPERUSER_URL, ssl: dbSsl() });
  await admin.connect();
  try {
    const {
      rows: [{ dbname }],
    } = await admin.query("SELECT current_database() AS dbname");

    const { rows: schemaRows } = await admin.query(
      "SELECT 1 FROM pg_namespace WHERE nspname = 'keystone'"
    );

    let notEmptyReason = null;
    if (schemaRows.length > 0) {
      const { rows: ledgerTableRows } = await admin.query(
        "SELECT 1 FROM pg_tables WHERE schemaname = 'keystone_meta' AND tablename = 'schema_migrations'"
      );
      let appliedCount = 0;
      if (ledgerTableRows.length > 0) {
        const {
          rows: [{ n }],
        } = await admin.query("SELECT count(*)::int AS n FROM keystone_meta.schema_migrations");
        appliedCount = n;
      }
      if (appliedCount > 0) {
        notEmptyReason = `${appliedCount} migration(s) already recorded in keystone_meta.schema_migrations`;
      } else {
        const { rows: tenantTableRows } = await admin.query(
          "SELECT 1 FROM pg_tables WHERE schemaname = 'keystone' AND tablename = 'tenant'"
        );
        if (tenantTableRows.length > 0) {
          const {
            rows: [{ n }],
          } = await admin.query("SELECT count(*)::int AS n FROM keystone.tenant");
          if (n > 0) {
            notEmptyReason = `keystone.tenant already has ${n} row(s)`;
          }
        }
      }
    }

    if (notEmptyReason) {
      if (FORCE) {
        console.error(`★ --force: ${dbname} was NOT confirmed empty (${notEmptyReason}) — proceeding anyway.`);
      } else {
        console.error(`prepare-fresh-database: refusing — ${dbname} is not empty (${notEmptyReason})`);
        process.exit(1);
      }
    }
  } finally {
    await admin.end();
  }
}

// ── 1 · roles, grants, graphile-worker's own schema ──────────────────────────────────────────────
runNode(["scripts/bootstrap-roles.mjs"], "scripts/bootstrap-roles.mjs");

// ── 1.5 · ASSERT THE ROLE ATTRIBUTES BEFORE ANY MIGRATION RUNS (F484 — see the header) ──────────
{
  const admin = new pg.Client({ connectionString: SUPERUSER_URL, ssl: dbSsl() });
  await admin.connect();
  try {
    const {
      rows: [{ dbname }],
    } = await admin.query("SELECT current_database() AS dbname");
    const problems = await findRoleAttributeProblems(admin);
    if (problems.length > 0) {
      console.error(`prepare-fresh-database: refusing — role attributes are wrong on ${dbname} (${problems.length} problem(s)):`);
      for (const p of problems) console.error(`  · ${p}`);
      console.error(
        "  Nothing has been migrated. Roles are CLUSTER-WIDE, so fix them on the cluster " +
          "(scripts/bootstrap-roles.mjs does exactly this) and re-run. --force does NOT override this check."
      );
      process.exit(1);
    }
    console.log(
      `prepare-fresh-database: role attributes asserted — ${ROLE_NAMES.length} role(s) x ` +
        `${ATTRIBUTE_COLUMNS.length} attribute(s), plus auth_owner\u2192app_owner and reference_guard\u2192app_owner memberships without inheritance`
    );
  } finally {
    await admin.end();
  }
}

// ── 2 · the base schema, stopping before 0010's positive control ────────────────────────────────
runNode(["db/migrate.mjs", "up", "--to", "0009"], "db/migrate.mjs up --to 0009");

// ── 3 · seed the ONE row 0010 needs to see, as superuser (D-12.0b's own precedent) ──────────────
{
  const seed = new pg.Client({ connectionString: SUPERUSER_URL, ssl: dbSsl() });
  await seed.connect();
  try {
    const {
      rows: [existingTenant],
    } = await seed.query("SELECT id FROM keystone.tenant WHERE slug = $1", [PLACEHOLDER_SLUG]);
    let tenantId = existingTenant?.id;
    if (!tenantId) {
      const {
        rows: [{ id }],
      } = await seed.query(
        `INSERT INTO keystone.tenant (slug, name, timezone, status) VALUES ($1, $2, $3, 'active') RETURNING id`,
        // ★ F779 — "UTC", not "Etc/UTC": the server's startup invariant (src/health) refuses a non-canonical IANA zone,
        //   so every database this script prepared could not boot the app it was prepared for.
        [PLACEHOLDER_SLUG, "Bootstrap Placeholder", "UTC"]
      );
      tenantId = id;
    }
    const { rows: existingStaff } = await seed.query(
      "SELECT id FROM keystone.app_user WHERE tenant_id = $1 AND email = $2",
      [tenantId, PLACEHOLDER_EMAIL]
    );
    if (existingStaff.length === 0) {
      // ★ NO `staff_role` column here — that column does not exist until migration 0010 adds it
      //   (this step runs at --to 0009, one migration before). 0010's own backfill assigns it.
      await seed.query(
        `INSERT INTO keystone.app_user (tenant_id, email, display_name, role) VALUES ($1, $2, $3, 'staff')`,
        [tenantId, PLACEHOLDER_EMAIL, "Bootstrap Placeholder Staff"]
      );
    }
  } finally {
    await seed.end();
  }
}

// ── 4 · the rest of the migrations ───────────────────────────────────────────────────────────────
runNode(["db/migrate.mjs", "up"], "db/migrate.mjs up");

// ── 5 · archive the placeholder as far as the schema allows (see the header note) ───────────────
{
  const admin = new pg.Client({ connectionString: SUPERUSER_URL, ssl: dbSsl() });
  await admin.connect();
  try {
    await admin.query("UPDATE keystone.tenant SET status = 'closed' WHERE slug = $1", [PLACEHOLDER_SLUG]);
    await admin.query(
      `UPDATE keystone.app_user SET archived_at = now()
        WHERE email = $1 AND archived_at IS NULL`,
      [PLACEHOLDER_EMAIL]
    );
  } finally {
    await admin.end();
  }
}

// ── 6 · verify ownership — the ownership-drift finding must actually be gone, not just fixed ────
{
  const admin = new pg.Client({ connectionString: SUPERUSER_URL, ssl: dbSsl() });
  await admin.connect();
  let migrationCount;
  try {
    const {
      rows: [{ n }],
    } = await admin.query("SELECT count(*)::int AS n FROM keystone_meta.schema_migrations");
    migrationCount = n;

    const ALLOWED_OWNERS = ["app_owner", "auth_owner"];
    // ★★★ EXTENSION MEMBERS ARE EXCLUDED, AND THIS WAS MEASURED, NOT ASSUMED. `0103` installs
    //    `pg_trgm` (a "trusted" extension) as `app_owner`, and the EXTENSION ITSELF is correctly
    //    owned by `app_owner` (`pg_extension.extowner` — confirmed) — but its ~200 individual
    //    C-language member functions (`similarity`, `gtrgm_in`, ...) are NOT: on this Postgres
    //    build they come out owned by the CLUSTER's own bootstrap superuser regardless of which
    //    role issued `CREATE EXTENSION`, because defining a LANGUAGE C function is inherently a
    //    superuser-level operation that "trusted extension" installation performs on the
    //    invoker's behalf, not as the invoker. [EXECUTED] this is true on the REAL local
    //    `keystone` database too (219 such functions), so it is a property of trusted-extension
    //    installation on this Postgres build, not a bug this task introduced or could fix by any
    //    role/grant discipline — `pg_depend.deptype = 'e'` marks exactly these members, so they
    //    are excluded here rather than added to the allow-list (an allow-list naming the
    //    cluster's bootstrap superuser would hide a REAL drift onto that same role).
    const { rows: badRelations } = await admin.query(
      `SELECT n.nspname, c.relname, c.relkind, r.rolname AS owner
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_roles r ON r.oid = c.relowner
        WHERE n.nspname IN ('keystone', 'keystone_meta')
          AND c.relkind IN ('r', 'v', 'S')
          AND r.rolname <> ALL ($1::text[])
          AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')`,
      [ALLOWED_OWNERS]
    );
    let { rows: badFunctions } = await admin.query(
      `SELECT n.nspname, (p.oid::regprocedure)::text AS sig, r.rolname AS owner
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         JOIN pg_roles r ON r.oid = p.proowner
        WHERE n.nspname IN ('keystone', 'keystone_meta')
          AND r.rolname <> ALL ($1::text[])
          AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')`,
      [ALLOWED_OWNERS]
    );

    // ★★★ 0144 (F501 / R54): EXACTLY two functions are owned by `reference_guard` — the reference guards — and
    //     NOTHING else may be. Not a third allowed owner for everything: a reference_guard-owned definer sees the
    //     reference practice, which is precisely what F501 was about app_owner's definers doing. Asserted as a set.
    const REFERENCE_GUARD_FUNCTIONS = ["keystone.refuse_touch_reference_rows()", "keystone.refuse_truncate_tenant()"];
    const guardOwned = badFunctions.filter((f) => f.owner === "reference_guard").map((f) => f.sig).sort();
    const missingGuards = REFERENCE_GUARD_FUNCTIONS.filter((sig) => !guardOwned.includes(sig));
    const straysOwnedByGuard = guardOwned.filter((sig) => !REFERENCE_GUARD_FUNCTIONS.includes(sig));
    const { rows: guardRelations } = await admin.query(
      `SELECT count(*)::int AS n FROM pg_class WHERE relowner = (SELECT oid FROM pg_roles WHERE rolname = 'reference_guard')`
    );
    if (missingGuards.length > 0 || straysOwnedByGuard.length > 0 || guardRelations[0].n > 0) {
      console.error(
        "FATAL: ownership verification failed — reference_guard must own exactly " +
          `${REFERENCE_GUARD_FUNCTIONS.join(", ")} and nothing else (0144). ` +
          `not owned by it: [${missingGuards.join(", ")}]; also owned by it: [${straysOwnedByGuard.join(", ")}]; ` +
          `relations owned by it: ${guardRelations[0].n}`
      );
      process.exit(1);
    }
    badFunctions = badFunctions.filter((f) => !(f.owner === "reference_guard" && REFERENCE_GUARD_FUNCTIONS.includes(f.sig)));

    if (badRelations.length > 0 || badFunctions.length > 0) {
      console.error("FATAL: ownership verification failed — objects owned by neither app_owner nor auth_owner (nor, for the two reference guards, reference_guard):");
      for (const r of badRelations) {
        console.error(`  ${r.nspname}.${r.relname} (${r.relkind}) owned by ${r.owner}`);
      }
      for (const f of badFunctions) {
        console.error(`  ${f.sig} owned by ${f.owner}`);
      }
      process.exit(1);
    }
  } finally {
    await admin.end();
  }

  console.log(`prepare-fresh-database: ready — ${migrationCount} migrations applied, ownership verified`);
}
