#!/usr/bin/env node
// scripts/bootstrap-roles.mjs — 08 §5.3 / §12 "fresh database". Stage 1 Task 8, fix round 1 (R9 /
// FINDINGS F482): everything a real fresh database needs lives HERE, in the product script — never
// in a test. `test/s1_bootstrap_fresh_database.test.mjs` (via `scripts/prepare-fresh-database.mjs`)
// exercises this file and repairs nothing.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ WHY THIS EXISTS. Roles cannot be created by a migration: `db/migrate.mjs` connects as a
//     superuser and immediately `SET ROLE app_owner`, and a session loses the superuser attribute
//     the moment it assumes a non-superuser role (0044:27-32) — so role creation cannot live in
//     the migration stream at all. This script is the one place it happens, run once against a
//     database's superuser connection before `db/migrate.mjs up`.
//
// ★★ THE EXACT ROLE LIST — six, sourced, not invented. HANDOFF.md D-12.0a plus the RAISE
//    EXCEPTION messages in `db/migrations/0025_signup_boundary.sql:39-49` and
//    `db/migrations/0044_worker_tenant_lister.sql:37-48`, PLUS `app_embed` (below):
//      app_owner   NOLOGIN NOBYPASSRLS  — owns every object; reachable only by SET ROLE, so
//                                          there is no credential for it to leak (D-12.0a).
//      app_rw      LOGIN   NOBYPASSRLS  — the application's own connection (D-12.0a).
//      auth_owner  NOLOGIN NOBYPASSRLS  — owns keystone_auth; SET ROLE only (D-12.0a / P13.0b).
//      app_signup  LOGIN   NOBYPASSRLS  — the signup boundary (0025's message, verbatim).
//      app_worker  LOGIN                — 0044's message literally says NOLOGIN ("the worker
//                                          still connects as app_rw today"). ★★★ THAT TEXT IS
//                                          SUPERSEDED: HANDOFF.md's P18.9 post-mortem, defect #4,
//                                          [EXECUTED on the deployed database] found `app_worker`
//                                          NOLOGIN meant the worker "could not connect to the
//                                          database at all", and the corrected, current state —
//                                          provisioned out of band, exactly as this script now
//                                          does — is LOGIN with a password. Implemented as LOGIN.
//      app_embed   LOGIN   NOBYPASSRLS  — D-12.0a's own snippet ("CREATE ROLE app_embed LOGIN
//                                          NOBYPASSRLS PASSWORD '…'; -- P19.8"), and 0045/0048
//                                          both `GRANT ... TO app_embed` with NO bootstrap guard
//                                          (unlike 0025/0044's friendly RAISE for app_signup/
//                                          app_worker) — a fresh cluster with no app_embed would
//                                          fail those two migrations outright with no clue why.
//                                          It is a request-serving role (a publishable key reaches
//                                          it directly, `.env.local`'s `KEYSTONE_EMBED_URL`), so
//                                          it needs LOGIN like `app_rw`, not NOLOGIN like the
//                                          owner roles.
//    `keystone_admin` (the superuser used to run this script) is the only role NOT in this list —
//    it is the connecting credential, never created by it.
//
// ★★ THE GRANTS THIS SCRIPT ISSUES GO BEYOND 0025/0044's TWO MESSAGES, AND EVERY ONE OF THEM WAS
//    MEASURED, NOT ASSUMED — each confirmed by making `db/migrate.mjs up` actually fail on a real
//    scratch database without it, then adding exactly the grant that made the next failure appear
//    (task-8-report.md has the full trail):
//      1. `app_owner` needs `CREATE, CONNECT, TEMPORARY ON DATABASE` (D-12.0a) — DATABASE-level
//         grants do not carry over from any other database in the same cluster, even though
//         roles do. Without it, `db/migrate.mjs`'s own `ensureRegistry()` fails at
//         `CREATE SCHEMA keystone_meta` with `permission denied for database`.
//      2. The `keystone` schema itself must be created — nothing else does (0001 assumes it, per
//         D-12.0a's own trailing comment: "-- 0001 assumes it already exists").
//      3. `auth_owner` needs `USAGE, CREATE` (not just `USAGE`) on `keystone` — 0017's
//         `SET LOCAL ROLE auth_owner; CREATE FUNCTION keystone.tenant_timezones_for_health()`
//         needs CREATE because auth_owner is creating an object in a schema it does not own.
//      4. `GRANT auth_owner TO app_owner` (membership, not a privilege grant) — gates the three
//         migrations that literally `ALTER FUNCTION ... OWNER TO auth_owner` (0031, 0106, 0121 —
//         verified with `grep -n "OWNER TO auth_owner" db/migrations/*.sql`; 0017's own text
//         matching that string is inside a COMMENT describing what NOT to do, not executed SQL),
//         which requires the CURRENT role to be a MEMBER of the role ownership is moving to. This
//         is 0121's own "TRAP 1", verbatim: "It is a MEMBER of auth_owner, which is why
//         ALTER ... OWNER TO auth_owner is permitted at all — that check uses membership."
//         (It is NOT needed for `SET ROLE auth_owner` / `SET LOCAL ROLE auth_owner` themselves —
//         used far more widely, by 0017, 0018, 0020, 0044, 0045, 0046, 0063, 0096, 0097, 0101,
//         0102, 0121, 0124, 0125 (verified with `grep -ln "SET ROLE auth_owner\|SET LOCAL ROLE
//         auth_owner" db/migrations/*.sql`) — those always succeed regardless of membership,
//         because the connection's SESSION USER is a superuser for its entire life: "if the
//         session user is a superuser, any role can be selected," regardless of what the CURRENT
//         role has been SET to.)
//
//         ★ THE SAME MIGRATIONS THAT DO THE `RESET ROLE` DRIFT `db/migrate.mjs`'s per-file
//         restore now fixes are a related but SEPARATE list — the full set, verified with
//         `grep -ln "^RESET ROLE" db/migrations/*.sql`, is 0044, 0045, 0046, 0047, 0048, 0049,
//         0050, 0051, 0063, 0096, 0097, 0101, 0102, 0103, 0124, 0125. `db/migrate.mjs`'s own
//         per-file `SET ROLE app_owner` (see its header there) restores app_owner before EVERY
//         one of these, not only the ones this script's grants happen to depend on.
//      5. `app_worker` needs `CREATE` on the database, not just `CONNECT` — independently
//         documented at HANDOFF.md P18.9 defect #5: graphile-worker 0.18 has no skip-migrations
//         option, so every worker boot calls `CREATE SCHEMA IF NOT EXISTS graphile_worker`, and
//         "Postgres checks the CREATE privilege BEFORE the IF NOT EXISTS test... required whether
//         or not the schema already exists" (HANDOFF, verbatim).
//    `REVOKE ALL ON SCHEMA public FROM PUBLIC` from D-12.0a is deliberately NOT included: no
//    migration touches the `public` schema, so it is orthogonal hardening outside this script's
//    stated job of "can a fresh database run the migrations".
//
// ★★★ GRAPHILE-WORKER'S OWN SCHEMA, BOOTSTRAPPED THE WAY PRODUCTION BOOTSTRAPS IT — AS
//    app_worker, THROUGH THE LIBRARY'S OWN MIGRATION API, NEVER HAND-WRITTEN. `graphile_worker.*`
//    is created lazily the first time the WORKER PROCESS connects (P18.9 defect #5) — never by
//    any migration or by `db/migrate.mjs` — and migration 0104 later does
//    `SET LOCAL ROLE app_worker; GRANT ... ON SCHEMA graphile_worker ...`, which requires
//    `app_worker` to already OWN that schema (0104's own header, MEASURED on deployed:
//    "graphile_worker and its jobs view are owned by app_worker"). So this script connects AS
//    app_worker (not the superuser — ownership follows the connecting role) and calls
//    graphile-worker's own exported `runMigrations()`, the documented entry point for installing
//    its schema without starting a worker loop (`node_modules/graphile-worker/dist/runner.js`:
//    `export const runMigrations = async (options) => { const [, release] =
//    await getUtilsAndReleasersFromOptions(options); await release(); };` — it IS the
//    install-only path `makeWorkerUtils`/`run` both go through). Passed as `pgPool` (a plain
//    `pg.Pool`, `ssl: dbSsl()` to match every other connection this
//    codebase makes to a Railway proxy — see `db/migrate.mjs`'s own `connect()`), because
//    `runMigrations({ connectionString })` does not forward an `ssl` option itself
//    (`node_modules/graphile-worker/dist/lib.js`'s recognized option keys have no `ssl` case, but
//    `pgPool` is one of them). `src/queue/runner.mjs` already has a `migrateQueue()` doing this
//    same call for the running application — not reused here only because it does not accept
//    `ssl`, and this script must also work through Railway's public proxy for staging (Task 11).
//
// ★★★ PASSWORDS NEVER TOUCH JS STRING CONCATENATION, AND NEVER APPEAR IN A QUERY'S SQL TEXT.
//    Postgres does not allow a bind parameter ($1) inside a `DO $$ ... $$` body — the dollar-quoted
//    text is lexed as one opaque string before bind parameters are ever substituted, so
//    `DO $$ ... $1 ... $$` is a syntax error, not a safe parameterization (confirmed empirically
//    while building this: "bind message supplies 1 parameters, but prepared statement requires
//    0"). So the password is staged into the session with `SELECT set_config($1, $2, false)` —
//    an ordinary parameterized query, exactly like every other query in this codebase — and the
//    DO block (a static string, written once, in this file, with no interpolation) reads it back
//    with `current_setting()` and hands it to `format('%L', ...)`, which does the literal-quoting
//    SERVER-SIDE. The role name takes the same path. Nothing this script sends to Postgres is
//    built by concatenating a role name or password into a SQL string in this file. The one
//    password handed to `pg.Pool` for the graphile-worker bootstrap travels the ordinary way any
//    `pg` connection option does — never written to a log, never concatenated into SQL text.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ FIX ROUND 4 — FINDINGS F484, MEASURED ON THE FIRST REAL FRESH DATABASE (Railway staging).
//     THIS SCRIPT CREATED `app_owner` WITH NO ATTRIBUTE LIST AT ALL — so it got Postgres's
//     DEFAULTS, and the default is **INHERIT**. Then it ran `GRANT auth_owner TO app_owner`.
//     Migration 0017 creates a permissive policy `tenant_health_read ON keystone.tenant
//     FOR SELECT TO auth_owner USING (true)` — and an RLS policy written `TO <role>` applies to
//     every role that INHERITS that role. An INHERITing `app_owner` therefore picked that policy
//     up and could read `keystone.tenant` WITH NO TENANT CONTEXT AT ALL. 0017's own negative
//     control caught it and aborted the run, exactly as it was written to:
//       "tenant_isolation is not filtering app_owner: a direct read with no tenant context
//        returned 1 row(s). The health resolver would be masking a broken policy."
//     [MEASURED] staging `pg_roles.rolinherit = t` for app_owner; the hand-built local cluster
//     has `f`. Everything else matched. The local test never caught it because the local roles
//     ALREADY EXISTED with the right attributes and this script's ALTER path only set PASSWORD —
//     it never set an attribute, so an existing wrong role stayed wrong forever.
//
// ★★★ SO: BOTH PATHS NOW SET THE FULL ATTRIBUTE SET (see `REQUIRED_ROLE_ATTRIBUTES` below) —
//     `CREATE ROLE … <every attribute>` AND, for an existing role, `ALTER ROLE … <every
//     attribute>`. Nothing is left to a default, and nothing is left to whatever a previous
//     hand-provisioning happened to do. And after the run this script READS pg_roles BACK and
//     fails loudly, naming every role/attribute that differs — a bootstrap that cannot prove what
//     it built is the thing that let F484 reach a real database.
//
// ★★★ AND THE ATTRIBUTE ALONE IS NOT ENOUGH — THE *GRANT* CARRIES ITS OWN INHERIT FLAG.
//     [EXECUTED here, PostgreSQL 17.11, with throwaway roles] PG16+ fixes the INHERIT option
//     **PER GRANT, AT GRANT TIME**, from the member's `rolinherit` as it stood in that instant:
//         CREATE ROLE m INHERIT; GRANT g TO m;            → pg_auth_members.inherit_option = t
//         ALTER ROLE m NOINHERIT;                          → inherit_option STILL t   ← the trap
//         GRANT g TO m WITH INHERIT FALSE;                 → inherit_option = f
//     So `ALTER ROLE app_owner NOINHERIT` does NOT reach back and close an existing membership,
//     and a database bootstrapped by the broken version of this script would STAY broken after an
//     attribute-only repair. `db/gates/catalog-conformance.mjs:492-505` already records this same
//     rule for `app_rw` verbatim. Therefore: attributes are set BEFORE the membership grant, and
//     the membership grant is re-issued explicitly `WITH INHERIT FALSE` on every run (PG16+; on an
//     older server the plain grant follows `rolinherit` dynamically and needs no clause).
//     The verification below asserts the EFFECT, not the syntax: `pg_has_role('app_owner',
//     'auth_owner','USAGE')` must be FALSE — with `…'MEMBER'` TRUE as its positive control, so
//     "does not inherit" can never pass by the membership simply being absent.
//
// ★★ WHERE THE REQUIRED SET COMES FROM — sources named per attribute, none invented:
//     · NOSUPERUSER, every role   — `db/gates/catalog-conformance.mjs:496` ("role X is a
//       SUPERUSER — it bypasses every policy"), `db/gates/p21a_rls_pgtap.mjs:62`, 0025:27.
//     · NOBYPASSRLS, every role   — 0025:45, 0020:29, 0045:14, catalog-conformance:488/496/523,
//       p21a_rls_pgtap.mjs:205/216-220 ("no non-superuser login role has BYPASSRLS").
//     · NOCREATEROLE, every role  — 0025:44 and 0044:29-31, both verbatim: "migrations run as
//       app_owner (no CREATEROLE)". Extended to the other five under "never widen".
//     · NOCREATEDB, NOREPLICATION — no source demands either; "never widen", and [MEASURED] the
//       live local cluster has `f` for all six.
//     · app_owner   NOLOGIN NOINHERIT — NOLOGIN: D-12.0a, and p21a_rls_pgtap.mjs:225-227 asserts
//       `rolcanlogin = false` ("FORCE and NOLOGIN are two independent barriers"). NOINHERIT:
//       0121:98 TRAP 1, verbatim — "`app_owner` IS **NOINHERIT** (`\du app_owner` → 'No
//       inheritance')" — plus F484 above, which is what an INHERITing one actually costs.
//     · auth_owner  NOLOGIN INHERIT  — NOLOGIN: catalog-conformance:487, 0017:30, 0063:35.
//     · app_rw, app_signup, app_worker, app_embed: LOGIN INHERIT — D-12.0a; 0025:45 verbatim
//       ("CREATE ROLE app_signup LOGIN NOBYPASSRLS PASSWORD '…'"); p19_embed_grant.mjs:166-167
//       asserts app_embed `rolcanlogin`; and for app_worker, 0044's own RAISE text ends "Granting
//       LOGIN + a password is the deploy-time step that wires it", which HANDOFF.md P18.9 defect
//       #4 then did [EXECUTED on the deployed database: NOLOGIN meant the worker "could not
//       connect to the database at all"].
//     · INHERIT for the other five — [MEASURED] the live local cluster (`rolinherit = t` for all
//       but app_owner). No migration guard demands otherwise, and no membership is granted to any
//       of them by this script, so the flag is inert for them; it is set explicitly anyway so
//       that "the full attribute set" means all of it and the verification can be exhaustive.
//   ★ THE MIGRATIONS' GUARDS AND THE LIVE LOCAL CLUSTER DO NOT DISAGREE ANYWHERE. The one place
//     they look like they might — 0044's RAISE text showing `CREATE ROLE app_worker NOLOGIN` —
//     is resolved by that same message's own closing line (above), not overruled.
//
// ★★★ THE SEVENTH ROLE — `reference_guard` (FINDINGS F501, controller ruling R54, migration 0144).
//     NOLOGIN NOINHERIT, no password, owns exactly two functions: the reference-practice guards
//     `keystone.refuse_touch_reference_rows()` and `keystone.refuse_truncate_tenant()`.
//   ★★ WHY A ROLE OF ITS OWN. Those guards are SECURITY DEFINER and must SEE the reference practice's
//      rows through FORCE row-level security. 0100/0133 did that with permissive `reference_guard_read`
//      policies TO app_owner — and Postgres OR-combines permissive policies, so EVERY app_owner-owned
//      SECURITY DEFINER function saw the reference practice too. [MEASURED] account_seat_counts()
//      reported a fresh practice's 3 people as 8. Only a role that owns NOTHING ELSE can hold that
//      visibility without lending it to anything else.
//   ★★ THE MEMBERSHIP `reference_guard → app_owner`, WITH BOTH PG16 OPTIONS SET EXPLICITLY:
//      · INHERIT FALSE — so app_owner (and every definer it owns) does NOT borrow reference_guard's
//        policies. An inheriting grant would re-create F501 exactly, through membership.
//      · SET TRUE — [MEASURED, PostgreSQL 17.11, throwaway roles] `ALTER FUNCTION … OWNER TO g` run as
//        a member with SET FALSE fails "must be able to SET ROLE "g"", with or without INHERIT. The
//        migration that transfers the guards (0144) runs as app_owner, so it needs SET. (The same
//        measurement: the new owner also needs CREATE on the schema AT TRANSFER TIME — 0144 grants it
//        and revokes it again in the same transaction; ownership survives the revoke.)
//   ★ NO PASSWORD. It is NOLOGIN and nothing ever authenticates as it, so KEYSTONE_BOOTSTRAP_PASSWORDS
//     does not name it (`PASSWORDLESS_ROLES` below) and it is created/altered `PASSWORD NULL`.
//   ★ On an EXISTING database (production) the same step is `scripts/repair-role-and-owner-drift.mjs
//     --apply`, which calls `ensureReferenceGuardRole()` from this file — one definition, two callers.
//
// USAGE: KEYSTONE_BOOTSTRAP_SUPERUSER_URL=<superuser url for the target database>
//        KEYSTONE_BOOTSTRAP_PASSWORDS='{"app_owner":"...","app_rw":"...","auth_owner":"...",
//                                        "app_signup":"...","app_worker":"...","app_embed":"..."}' \
//        node scripts/bootstrap-roles.mjs
//
// ★ This file is ALSO a module: `REQUIRED_ROLE_ATTRIBUTES`, `REQUIRED_MEMBERSHIPS` and
//   `findRoleAttributeProblems()` are exported so `scripts/prepare-fresh-database.mjs` asserts the
//   SAME set from the SAME definition rather than keeping a second, silently-diverging copy of it.
//   The executable part below runs only when this file is the process entry point.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { dbSsl } from "../src/db/ssl.mjs";
import pg from "pg";
import { runMigrations } from "graphile-worker";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE REQUIRED ATTRIBUTE SET — THE SINGLE DEFINITION. Sources per attribute are in the header
//     above. Both the CREATE path and the ALTER path write EXACTLY this, and the verification at
//     the end reads pg_roles back and compares against EXACTLY this.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
export const ATTRIBUTE_COLUMNS = [
  "rolsuper",
  "rolbypassrls",
  "rolinherit",
  "rolcanlogin",
  "rolcreatedb",
  "rolcreaterole",
  "rolreplication",
];

// ★ Every role: NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, NOREPLICATION. The only two
//   columns that vary are rolcanlogin and rolinherit.
const NEVER = { rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false };

export const REQUIRED_ROLE_ATTRIBUTES = {
  // ★★★ app_owner is the F484 role: NOLOGIN **and NOINHERIT** (0121:98 TRAP 1).
  app_owner: { ...NEVER, rolcanlogin: false, rolinherit: false },
  app_rw: { ...NEVER, rolcanlogin: true, rolinherit: true },
  auth_owner: { ...NEVER, rolcanlogin: false, rolinherit: true },
  app_signup: { ...NEVER, rolcanlogin: true, rolinherit: true },
  app_worker: { ...NEVER, rolcanlogin: true, rolinherit: true },
  app_embed: { ...NEVER, rolcanlogin: true, rolinherit: true },
  // ★★★ F501 / R54 / 0144 — owns ONLY the two reference guards. NOLOGIN (nothing connects as it) and
  //     NOINHERIT (it is a member of nothing and borrows nothing). See the header.
  reference_guard: { ...NEVER, rolcanlogin: false, rolinherit: false },
};

// ★ Roles that are created with NO password and are never named in KEYSTONE_BOOTSTRAP_PASSWORDS.
//   Every other role keeps the existing contract (a password per role, NOLOGIN or not).
export const PASSWORDLESS_ROLES = ["reference_guard"];

export const ROLE_NAMES = Object.keys(REQUIRED_ROLE_ATTRIBUTES);

// ★★★ MEMBERSHIP IS A SECOND, INDEPENDENT FACT — see the header. `app_owner` must BE a member of
//     `auth_owner` (0121 TRAP 1: that is what permits `ALTER … OWNER TO auth_owner` at all) and
//     must NOT INHERIT it (F484: inheriting it picks up 0017's `tenant_health_read` policy).
//     ★★★ AND app_owner must BE a member of `reference_guard` (F501/0144: that is what permits 0144's
//     `ALTER FUNCTION … OWNER TO reference_guard`), must NOT INHERIT it (inheriting it would hand every
//     app_owner definer the reference practice's rows — F501 again), and MUST be able to SET it
//     (`set: true` — MEASURED: ownership transfer requires it on PG16+).
export const REQUIRED_MEMBERSHIPS = [
  { group: "auth_owner", member: "app_owner", inherit: false },
  { group: "reference_guard", member: "app_owner", inherit: false, set: true },
];

const MEMBERSHIP_REASON = {
  auth_owner:
    "FINDINGS F484: an inheriting app_owner picks up 0017's tenant_health_read policy and reads keystone.tenant with no tenant context",
  reference_guard:
    "FINDINGS F501: an inheriting app_owner picks up reference_guard_read and every app_owner SECURITY DEFINER function sees the reference practice's rows",
};

const KEYWORDS = {
  rolsuper: ["NOSUPERUSER", "SUPERUSER"],
  rolbypassrls: ["NOBYPASSRLS", "BYPASSRLS"],
  rolinherit: ["NOINHERIT", "INHERIT"],
  rolcanlogin: ["NOLOGIN", "LOGIN"],
  rolcreatedb: ["NOCREATEDB", "CREATEDB"],
  rolcreaterole: ["NOCREATEROLE", "CREATEROLE"],
  rolreplication: ["NOREPLICATION", "REPLICATION"],
};

// ★ A fixed keyword table indexed by a fixed column list and a boolean — there is no path here for
//   anything caller-supplied to reach the SQL text. (The role NAME and the PASSWORD never travel
//   this way at all; see the header's note on set_config/current_setting/format('%L').)
export function attributeClause(roleName) {
  const attrs = REQUIRED_ROLE_ATTRIBUTES[roleName];
  if (!attrs) throw new Error(`no required attribute set defined for role ${roleName}`);
  return ATTRIBUTE_COLUMNS.map((col) => KEYWORDS[col][attrs[col] ? 1 : 0]).join(" ");
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE VERIFICATION. Reads pg_roles back and returns a list of human-readable problems —
//     EMPTY means the cluster matches the required set exactly. Exported so
//     `scripts/prepare-fresh-database.mjs` can assert the same thing from the same definition
//     before it migrates anything (two copies of a required set is how one of them goes stale).
//
// ★★ THE MEMBERSHIP CHECK TESTS THE EFFECT, NOT THE CATALOG COLUMN: `pg_has_role(member, group,
//    'USAGE')` is what the POLICY ENGINE itself reads, it is correct on every supported Postgres
//    version (`pg_auth_members.inherit_option` only exists on PG16+), and it follows chains this
//    script does not know about. Its POSITIVE CONTROL is `…'MEMBER'`, asserted in the same check:
//    without it, "app_owner does not inherit auth_owner" would pass just as happily on a database
//    where the membership had never been granted at all.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
export async function findRoleAttributeProblems(client) {
  const problems = [];

  const { rows } = await client.query(
    `SELECT rolname, ${ATTRIBUTE_COLUMNS.join(", ")} FROM pg_roles WHERE rolname = ANY($1::text[])`,
    [ROLE_NAMES]
  );
  const byName = new Map(rows.map((r) => [r.rolname, r]));

  for (const name of ROLE_NAMES) {
    const actual = byName.get(name);
    if (!actual) {
      problems.push(`role ${name} does not exist`);
      continue;
    }
    const required = REQUIRED_ROLE_ATTRIBUTES[name];
    for (const col of ATTRIBUTE_COLUMNS) {
      if (actual[col] !== required[col]) {
        problems.push(
          `role ${name}: ${col} is ${actual[col]}, required ${required[col]} ` +
            `(${KEYWORDS[col][required[col] ? 1 : 0]})`
        );
      }
    }
  }

  const {
    rows: [{ vnum }],
  } = await client.query("SELECT current_setting('server_version_num')::int AS vnum");

  for (const m of REQUIRED_MEMBERSHIPS) {
    // ★ A group that does not exist is already reported above; pg_has_role would THROW on it.
    const { rows: exists } = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [m.group]);
    if (exists.length === 0) continue;
    const {
      rows: [r],
    } = await client.query(
      `SELECT pg_has_role($1, $2, 'MEMBER') AS is_member, pg_has_role($1, $2, 'USAGE') AS inherits`,
      [m.member, m.group]
    );
    if (!r.is_member) {
      problems.push(
        `role ${m.member} is NOT a member of ${m.group} — ALTER … OWNER TO ${m.group} ` +
          `(${m.group === "auth_owner" ? "0031, 0106, 0121" : "0144"}) cannot work`
      );
    }
    if (r.inherits !== m.inherit) {
      problems.push(
        `role ${m.member} ${r.inherits ? "INHERITS" : "does not inherit"} ${m.group}, required ` +
          `${m.inherit ? "INHERITS" : "does NOT inherit"} — ${MEMBERSHIP_REASON[m.group]}. ` +
          `NOTE PG16+ fixes this PER GRANT at grant time: ALTER ROLE ${m.member} NOINHERIT alone does ` +
          `NOT fix it — re-issue GRANT ${m.group} TO ${m.member} WITH INHERIT FALSE.`
      );
    }
    // ★ The SET option exists only on PG16+ (before that every member may SET ROLE to its group).
    if (m.set !== undefined && vnum >= 160000) {
      const {
        rows: [s],
      } = await client.query(`SELECT pg_has_role($1, $2, 'SET') AS can_set`, [m.member, m.group]);
      if (s.can_set !== m.set) {
        problems.push(
          `role ${m.member} ${s.can_set ? "CAN" : "can NOT"} SET ROLE ${m.group}, required ${m.set ? "CAN" : "can NOT"} — ` +
            `ALTER … OWNER TO ${m.group} requires the SET option on PG16+ (MEASURED, PG 17.11). ` +
            `Re-issue GRANT ${m.group} TO ${m.member} WITH INHERIT FALSE, SET TRUE.`
        );
      }
    }
  }

  return problems;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE reference_guard ROLE AND ITS MEMBERSHIP — ONE DEFINITION, TWO CALLERS: `main()` below (a
//     fresh database) and `scripts/repair-role-and-owner-drift.mjs --apply` (an existing one, i.e.
//     production, before migration 0144). Superuser connection required (CREATE ROLE). Idempotent:
//     an existing role is ALTERed to the full attribute set (F484's lesson — never trust a role that
//     already exists), and the grant is re-issued with BOTH options explicit, which updates an
//     existing membership in place on PG16+ [EXECUTED, PG 17.11, for auth_owner's grant].
//     Returns the statements it issued, for the caller to print. No secret is involved.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
export async function ensureReferenceGuardRole(client, serverVersionNum) {
  const issued = [];
  const attrs = attributeClause("reference_guard");
  const { rows: existing } = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'reference_guard'");
  const stmt = `${existing.length === 0 ? "CREATE" : "ALTER"} ROLE reference_guard ${attrs} PASSWORD NULL`;
  await client.query(stmt);
  issued.push(stmt);
  const grant =
    serverVersionNum >= 160000
      ? "GRANT reference_guard TO app_owner WITH INHERIT FALSE, SET TRUE"
      : "GRANT reference_guard TO app_owner"; // ★ pre-16: app_owner is NOINHERIT and every member may SET
  await client.query(grant);
  issued.push(grant);
  return issued;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// The executable part. Runs only when this file is the process entry point (see the header note).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
async function main() {
  const SUPERUSER_URL = process.env.KEYSTONE_BOOTSTRAP_SUPERUSER_URL;
  if (!SUPERUSER_URL) {
    console.error("FATAL: KEYSTONE_BOOTSTRAP_SUPERUSER_URL is not set. Refusing to guess a database.");
    process.exit(1);
  }

  const PASSWORDS_RAW = process.env.KEYSTONE_BOOTSTRAP_PASSWORDS;
  if (!PASSWORDS_RAW) {
    console.error("FATAL: KEYSTONE_BOOTSTRAP_PASSWORDS is not set.");
    process.exit(1);
  }

  let passwords;
  try {
    passwords = JSON.parse(PASSWORDS_RAW);
  } catch {
    console.error("FATAL: KEYSTONE_BOOTSTRAP_PASSWORDS is not valid JSON.");
    process.exit(1);
  }

  const missingPasswords = ROLE_NAMES.filter(
    (n) => !PASSWORDLESS_ROLES.includes(n) && (typeof passwords[n] !== "string" || passwords[n].length === 0)
  );
  if (missingPasswords.length > 0) {
    // ★ Names only — never a value, per CLAUDE.md, even to say what is missing.
    console.error(`FATAL: KEYSTONE_BOOTSTRAP_PASSWORDS is missing a password for: ${missingPasswords.join(", ")}`);
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: SUPERUSER_URL, ssl: dbSsl() });
  await client.connect();

  try {
    const {
      rows: [{ dbname }],
    } = await client.query("SELECT current_database() AS dbname");
    const {
      rows: [{ server_version_num }],
    } = await client.query("SELECT current_setting('server_version_num')::int AS server_version_num");

    for (const name of ROLE_NAMES) {
      // ★ The passwordless role (reference_guard) is created by ensureReferenceGuardRole() below, AFTER
      //   app_owner's attributes are settled — the same order F484 requires for auth_owner's grant.
      if (PASSWORDLESS_ROLES.includes(name)) continue;
      const { rows: existing } = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [name]);

      // ★ Stage the two values as ORDINARY BOUND PARAMETERS. See the header note on why this is
      //   the only safe way to get a password into a dynamic CREATE/ALTER ROLE.
      await client.query("SELECT set_config('keystone_bootstrap.role_name', $1, false)", [name]);
      await client.query("SELECT set_config('keystone_bootstrap.role_password', $1, false)", [passwords[name]]);

      // ★★★ F484: THE SAME FULL ATTRIBUTE LIST ON BOTH PATHS. The old ALTER path set PASSWORD and
      //     nothing else, so a role that already existed with the WRONG attributes stayed wrong —
      //     which is precisely how staging ended up with an INHERITing app_owner.
      const attrs = attributeClause(name);
      const verb = existing.length === 0 ? "CREATE ROLE" : "ALTER ROLE";
      await client.query(`
        DO $do$
        BEGIN
          EXECUTE format(
            '${verb} %I ${attrs} PASSWORD %L',
            current_setting('keystone_bootstrap.role_name'),
            current_setting('keystone_bootstrap.role_password')
          );
        END
        $do$;
      `);
    }

    // ★ Clear the staged password out of the session setting now that role work is done — it has
    //   no further use and there is no reason for it to sit in session state any longer than it did.
    await client.query("SELECT set_config('keystone_bootstrap.role_password', '', false)");

    // ── Database-level grants — D-12.0a plus 0025/0044's messages, against THIS database. ────────
    // ★ `current_database()` inside `format('%I', ...)`, never the JS-side URL path or a hard-coded
    //   name — the interface promises the database name comes from the connection, not a literal.
    await client.query(`
      DO $do$
      BEGIN
        EXECUTE format('GRANT CREATE, CONNECT, TEMPORARY ON DATABASE %I TO app_owner', current_database());
        EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_rw',     current_database());
        EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_signup', current_database());
        EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_embed',  current_database());
        -- app_worker needs CREATE, not just CONNECT (finding 5 above) — graphile-worker checks
        -- the CREATE privilege before its own IF-NOT-EXISTS test, on every boot.
        EXECUTE format('GRANT CREATE, CONNECT ON DATABASE %I TO app_worker', current_database());
      END
      $do$;
    `);

    // ★★★ MEMBERSHIP, NOT JUST A GRANT (finding 4 above): gates `ALTER FUNCTION ... OWNER TO
    //    auth_owner`, which several migrations use, not `SET LOCAL ROLE auth_owner` itself.
    //    Role membership is cluster-wide, so a machine with history already carries this — a
    //    genuinely fresh cluster (staging, Task 11) does not, and the first such ALTER would fail.
    // ★★★ F484 / FIX ROUND 4: `WITH INHERIT FALSE` EXPLICITLY, AND ISSUED **AFTER** THE ATTRIBUTE
    //    WORK ABOVE. PG16+ fixes the inherit option per grant at grant time, so (a) the grant must
    //    come after `ALTER ROLE app_owner NOINHERIT` for even the implicit default to be right, and
    //    (b) a grant made earlier by the BROKEN version of this script is not repaired by the
    //    attribute change at all — only by re-issuing it with this clause. Re-issuing an existing
    //    membership with a different inherit option UPDATES it in place [EXECUTED, PG 17.11].
    //    Pre-16 servers have no per-grant option and follow `rolinherit` dynamically, so the plain
    //    grant is already correct there and the clause would be a syntax error.
    if (server_version_num >= 160000) {
      await client.query("GRANT auth_owner TO app_owner WITH INHERIT FALSE");
    } else {
      await client.query("GRANT auth_owner TO app_owner");
    }

    // ★★★ F501 / R54 — the seventh role and its membership (INHERIT FALSE, SET TRUE). See the header.
    await ensureReferenceGuardRole(client, server_version_num);

    // ── The one schema nothing else creates. 0001 assumes it exists (D-12.0a's own comment). ─────
    await client.query("CREATE SCHEMA IF NOT EXISTS keystone AUTHORIZATION app_owner");
    await client.query("GRANT USAGE ON SCHEMA keystone TO app_rw");
    await client.query("GRANT USAGE ON SCHEMA keystone TO app_signup");
    // auth_owner needs CREATE, not just USAGE, on keystone (finding 3 above) — 0017 creates a
    // function there as auth_owner, inside a schema auth_owner does not own.
    await client.query("GRANT USAGE, CREATE ON SCHEMA keystone TO auth_owner");

    // ═════════════════════════════════════════════════════════════════════════════════════════
    // ★★★ VERIFY — READ pg_roles BACK AND FAIL LOUDLY. F484 reached a real database because this
    //     script asserted nothing about what it had just built. This runs BEFORE the graphile-
    //     worker step below on purpose: that step CONNECTS AS app_worker, so if the attributes are
    //     wrong the useful message is this one, not a confusing authentication failure after it.
    // ═════════════════════════════════════════════════════════════════════════════════════════
    const problems = await findRoleAttributeProblems(client);
    if (problems.length > 0) {
      console.error(
        `FATAL: bootstrap-roles verification failed on database ${dbname} — ` +
          `${problems.length} role attribute problem(s) remain AFTER this script ran:`
      );
      for (const p of problems) console.error(`  · ${p}`);
      process.exit(1);
    }

    // ── graphile-worker's own schema, installed as app_worker through its own migration API. ─────
    // See the header note. This is idempotent (graphile-worker's `runMigrations` is itself a
    // migration runner) and safe to call on every bootstrap, not only the first.
    const workerUrl = new URL(SUPERUSER_URL);
    workerUrl.username = "app_worker";
    workerUrl.password = passwords.app_worker;
    const workerPool = new pg.Pool({ connectionString: workerUrl.toString(), ssl: dbSsl() });
    // ★ A short-lived pool used once and released — an idle-client error after that has nothing
    //   useful to do but crash the process via Node's default "Unhandled 'error' event" behaviour.
    workerPool.on("error", () => {});
    workerPool.on("connect", () => {});
    try {
      await runMigrations({ pgPool: workerPool });
    } finally {
      await workerPool.end();
    }

    console.log(`bootstrap-roles: ${ROLE_NAMES.length} role(s) ready on database ${dbname}`);
    console.log(`bootstrap-roles: role attributes verified against the required set (${ROLE_NAMES.length} role(s), ${ATTRIBUTE_COLUMNS.length} attribute(s) each, plus auth_owner→app_owner and reference_guard→app_owner memberships without inheritance)`);
  } finally {
    await client.end();
  }
}

// ★ Entry-point guard: `realpathSync` on both sides so a symlinked invocation still matches.
const invokedDirectly =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  await main();
}
