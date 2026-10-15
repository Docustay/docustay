// Migration 0739 — the five duplicate "Your workspace is on Pro" bell notices (the $1 live test) are cleaned up, and ONLY those. Each negative has its positive control.
// Run: node test/docustay_dedupe_notices.test.mjs (local database; the migration's own SQL is executed against fixtures)
import pg from "pg";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
const adminUrl = process.env.KEYSTONE_ADMIN_URL ?? process.env.KEYSTONE_SEED_URL;
if (!adminUrl) { console.log("no database configured — NOT RUN"); process.exit(0); }
const c = new pg.Client({ connectionString: adminUrl, ssl: process.env.PGSSLMODE === "disable" ? false : undefined }); await c.connect();
const q = async (t, p) => (await c.query(t, p)).rows;
const TAG = randomBytes(3).toString("hex");
let pass = 0, fail = 0; const must = (cond, m) => { if (!cond) throw new Error(m); };
const t = async (n, f) => { try { await f(); console.log("PASS", n); pass++; } catch (e) { console.log("FAIL", n, "-", e.message); fail++; } };
const mk = async (product) => { const tid = (await q(`INSERT INTO keystone.tenant (name, slug, is_platform, timezone, status, product) VALUES ($1,$1,false,'UTC','active',$2) RETURNING id`, [`dd${TAG}${product}`, product]))[0].id; const uid = (await q(`INSERT INTO keystone.app_user (tenant_id, display_name, email, role, staff_role) VALUES ($1,'O',$2,'staff','owner') RETURNING id`, [tid, `${TAG}${product}@example.test`]))[0].id; return { tid, uid }; };
const note = (X, title, minsAgo, topic = "settings.subscription.updated") => q(`INSERT INTO keystone.notification (tenant_id, recipient_id, topic, title, body, created_at) VALUES ($1,$2,$3,$4,'Pro is on', now() - make_interval(mins => $5)) RETURNING id`, [X.tid, X.uid, topic, title, minsAgo]);
const count = async (X, title) => Number((await q(`SELECT count(*) n FROM keystone.notification WHERE tenant_id = $1 AND title = $2`, [X.tid, title]))[0].n);
const D = await mk("docustay"), M = await mk("workbench");
try {
  for (let i = 0; i < 5; i++) await note(D, "Your workspace is on Pro", 50 - i);                // five within minutes: the bug
  await note(D, "Your workspace is on Pro", 600);                                              // the same words 10 hours earlier: a separate, real notice
  await note(D, "Pro ends on 14 November", 40);                                                // a different notice
  for (let i = 0; i < 3; i++) await note(M, "Your workspace is on Pro", 50 - i);               // a the platform workspace: not Docustay's to clean
  await c.query("BEGIN"); await c.query(fs.readFileSync("db/migrations/0739_dedupe_docustay_plan_notices.sql", "utf8")); await c.query("COMMIT");
  await t("the five duplicates become one; the same words 10 hours earlier stay (positive control: nothing else lost)", async () => { must((await count(D, "Your workspace is on Pro")) === 2, `got ${await count(D, "Your workspace is on Pro")}`); });
  await t("a different notice is untouched", async () => { must((await count(D, "Pro ends on 14 November")) === 1, "lost"); });
  await t("a Workbench workspace's three identical notices are untouched (the clean-up is for Docustay only)", async () => { must((await count(M, "Your workspace is on Pro")) === 3, `got ${await count(M, "Your workspace is on Pro")}`); });
  await t("running it again changes nothing (idempotent) and row-level security is still forced", async () => {
    await c.query("BEGIN"); await c.query(fs.readFileSync("db/migrations/0739_dedupe_docustay_plan_notices.sql", "utf8")); await c.query("COMMIT");
    must((await count(D, "Your workspace is on Pro")) === 2, "changed"); must((await q(`SELECT relforcerowsecurity f FROM pg_class WHERE oid = 'keystone.notification'::regclass`))[0].f === true, "not forced");
  });
} finally { for (const X of [D, M]) { await c.query(`DELETE FROM keystone.notification WHERE tenant_id = $1`, [X.tid]).catch(() => {}); await c.query(`DELETE FROM keystone.app_user WHERE tenant_id = $1`, [X.tid]).catch(() => {}); await c.query(`DELETE FROM keystone.tenant WHERE id = $1`, [X.tid]).catch(() => {}); } await c.end(); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
