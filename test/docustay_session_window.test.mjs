// Migration 0738 + the idle default (the maintainer, 13 Oct 2026): a Docustay workspace stays signed in while active (30 days at most, 7 days idle); the platform is unchanged (12 hours, never idle unless set).
// PROPERTY: a browser session minted for a Docustay workspace expires about 30 days out, for any the platform workspace about 12 hours out — on both paths that make an 'app' session (direct, and the two-step partial -> app upgrade).
// EVERY NEGATIVE HAS A POSITIVE CONTROL IN THE SAME TEST. Run: node test/docustay_session_window.test.mjs (local database)
import pg from "pg";
import { randomBytes } from "node:crypto";
import { createSession, hashSecret, parsePresented } from "../src/auth/session.mjs";
import { workspaceSecurityRules, DOCUSTAY_IDLE_MINUTES } from "../src/auth/requireTwoStep.mjs";
import { withTenant } from "../src/db/index.mjs";

const adminUrl = process.env.KEYSTONE_ADMIN_URL ?? process.env.KEYSTONE_SEED_URL;
if (!adminUrl || !process.env.KEYSTONE_DATABASE_URL) { console.log("no local database configured — NOT RUN"); process.exit(0); }
const admin = new pg.Client({ connectionString: adminUrl, ssl: process.env.PGSSLMODE === "disable" ? false : undefined }); await admin.connect();
const q = async (t, p) => (await admin.query(t, p)).rows;
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); console.log("PASS", n); pass++; } catch (e) { console.log("FAIL", n, "—", e.message); fail++; } };
const ok = (c, m) => { if (!c) throw new Error(m); };
const TAG = randomBytes(3).toString("hex");
const mk = async (product) => {
  const tid = (await q(`INSERT INTO keystone.tenant (name, slug, is_platform, timezone, status, product) VALUES ($1,$1,false,'UTC','active',$2) RETURNING id`, [`sw${TAG}${product}`, product]))[0].id;
  const uid = (await q(`INSERT INTO keystone.app_user (tenant_id, email, display_name, role, staff_role) VALUES ($1,$2,'Owner','staff','owner') RETURNING id`, [tid, `${TAG}-${product}@example.test`]))[0].id;
  return { tid, uid };
};
const hoursLeft = async (token) => { const p = parsePresented(token); const r = (await q(`SELECT extract(epoch from (expires_at - now()))/3600 AS h FROM keystone_auth.session WHERE token_id = $1`, [p.tokenId]))[0]; return Number(r.h); };
const D = await mk("docustay"), M = await mk("mainstay");
try {
  await t("a Docustay browser session lasts about 30 days (720 hours)", async () => {
    const s = await createSession({ tenantId: D.tid, appUserId: D.uid, firebaseUid: `fb-d-${TAG}`, kind: "app" });
    const h = await hoursLeft(s.token); ok(h > 719 && h <= 720.1, `hours left ${h}`);
  });
  await t("a Workbench browser session still lasts 12 hours (positive control: same call, other product)", async () => {
    const s = await createSession({ tenantId: M.tid, appUserId: M.uid, firebaseUid: `fb-m-${TAG}`, kind: "app" });
    const h = await hoursLeft(s.token); ok(h > 11 && h <= 12.1, `hours left ${h}`);
  });
  await t("a Docustay two-step sign-in (partial, 1 hour) becomes a 30-day app session when upgraded; a Workbench one becomes 12 hours", async () => {
    for (const [X, want] of [[D, 720], [M, 12]]) {
      const s = await createSession({ tenantId: X.tid, appUserId: X.uid, firebaseUid: `fb-p-${TAG}-${want}`, kind: "partial", ttlHours: 1 });
      const before = await hoursLeft(s.token); ok(before <= 1.01, `partial should be short, got ${before}`);
      const p = parsePresented(s.token);
      await q(`SELECT * FROM keystone.upgrade_session($1,$2)`, [p.tokenId, hashSecret(p.secret)]);
      const h = await hoursLeft(s.token); ok(h > want - 1 && h <= want + 0.1, `after upgrade ${h}, wanted about ${want}`);
    }
  });
  await t("an operator, client and partial session of a Docustay workspace are NOT stretched to 30 days", async () => {
    for (const kind of ["client", "partial"]) {
      const s = await createSession({ tenantId: D.tid, appUserId: D.uid, firebaseUid: `fb-k-${TAG}-${kind}`, kind, ttlHours: 1 });
      const h = await hoursLeft(s.token); ok(h <= 1.01, `${kind} ${h}`);
    }
  });
  await t("idle default: a Docustay workspace signs out after 7 days idle, Workbench never unless set, and an owner's own limit wins", async () => {
    const idle = (X) => withTenant(X.tid, (tx) => workspaceSecurityRules(tx, X.tid, { now: Date.now() + 1e9 + Math.random() }), { userId: X.uid });
    ok((await idle(D)).idleMinutes === DOCUSTAY_IDLE_MINUTES && DOCUSTAY_IDLE_MINUTES === 10080, "docustay default");
    ok((await idle(M)).idleMinutes === 0, "workbench default stays never");
    await q(`INSERT INTO keystone.tenant_setting (tenant_id, key, value) VALUES ($1,'security.idle_minutes','60')`, [D.tid]);
    ok((await withTenant(D.tid, (tx) => workspaceSecurityRules(tx, D.tid, { now: Date.now() + 5e9 + Math.random() }), { userId: D.uid })).idleMinutes === 60, "owner's setting wins");
  });
} finally {
  for (const X of [D, M]) {
    await admin.query(`DELETE FROM keystone_auth.session WHERE tenant_id = $1`, [X.tid]).catch(() => {});
    for (const tb of ["tenant_setting", "audit_entry", "app_user"]) await admin.query(`DELETE FROM keystone.${tb} WHERE tenant_id = $1`, [X.tid]).catch(() => {});
    await admin.query(`DELETE FROM keystone.tenant WHERE id = $1`, [X.tid]).catch(() => {});
  }
  await admin.end();
}
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
