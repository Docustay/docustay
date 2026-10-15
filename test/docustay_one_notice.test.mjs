// Launch Part 4 (migration 0740 + createNotification): one business event = ONE in-app notice per person for Docustay's topics. A retry/second listener gets the existing notice back and fans out nothing again.
// Each negative has its positive control. Run: node test/docustay_one_notice.test.mjs (local database)
import pg from "pg";
import { randomBytes } from "node:crypto";
import { withTenant } from "../src/db/index.mjs";
import { emit } from "../src/events/outbox.mjs";
import { createNotification } from "../src/notifications/writes.mjs";
const adminUrl = process.env.KEYSTONE_ADMIN_URL ?? process.env.KEYSTONE_SEED_URL;
if (!adminUrl || !process.env.KEYSTONE_DATABASE_URL) { console.log("no database configured — NOT RUN"); process.exit(0); }
const c = new pg.Client({ connectionString: adminUrl, ssl: process.env.PGSSLMODE === "disable" ? false : undefined }); await c.connect();
const q = async (t, p) => (await c.query(t, p)).rows;
const TAG = randomBytes(3).toString("hex"); let pass = 0, fail = 0;
const must = (x, m) => { if (!x) throw new Error(m); };
const t = async (n, f) => { try { await f(); console.log("PASS", n); pass++; } catch (e) { console.log("FAIL", n, "-", e.message); fail++; } };
const tid = (await q(`INSERT INTO keystone.tenant (name, slug, is_platform, timezone, status, product) VALUES ($1,$1,false,'UTC','active','docustay') RETURNING id`, [`on${TAG}`]))[0].id;
const uid = (await q(`INSERT INTO keystone.app_user (tenant_id, display_name, email, role, staff_role) VALUES ($1,'O',$2,'staff','owner') RETURNING id`, [tid, `${TAG}@example.test`]))[0].id;
const uid2 = (await q(`INSERT INTO keystone.app_user (tenant_id, display_name, email, role, staff_role) VALUES ($1,'P',$2,'staff','admin') RETURNING id`, [tid, `p${TAG}@example.test`]))[0].id;
const as = (fn) => withTenant(tid, fn, { userId: uid });
const mkEvent = (topic, subject) => as((tx) => emit(tx, { tenantId: tid, emittedBy: topic.startsWith("documents") ? "documents" : "settings", topic, subjectType: topic.startsWith("documents") ? "document" : "workbench_subscription", subjectId: subject, actor: "system", payload: {} }));
const count = async (eid, rid) => Number((await q(`SELECT count(*) n FROM keystone.notification WHERE tenant_id = $1 AND event_id = $2 AND recipient_id = $3`, [tid, eid, rid]))[0].n);
try {
  const ev = await mkEvent("documents.document.signed", "11111111-1111-4111-8111-111111111111");
  const eid = ev?.id ?? ev?.eventId ?? ev;
  const mk = (rid, e = eid, topic = "documents.document.signed") => as((tx) => createNotification(tx, { tenantId: tid, recipientId: rid, eventId: e, topic, title: "Signed" }));
  await t("the first notice is written; asking again for the same event and person returns the SAME notice and writes no second row", async () => {
    const a = await mk(uid); const b = await mk(uid);
    must(a.id && b.id === a.id && b.duplicate === true, JSON.stringify({ a: a.id, b }));
    must((await count(eid, uid)) === 1, `rows ${await count(eid, uid)}`);
  });
  await t("positive control: another person for the same event, and another event for the same person, each get their own notice", async () => {
    await mk(uid2); must((await count(eid, uid2)) === 1, "second person");
    const ev2 = await mkEvent("documents.document.signed", "22222222-2222-4222-8222-222222222222"); const e2 = ev2?.id ?? ev2?.eventId ?? ev2;
    await mk(uid, e2); must((await count(e2, uid)) === 1, "second event");
  });
  await t("the database itself refuses a second row (not just the code): a direct insert fails with the named index", async () => {
    let err = null; try { await c.query(`INSERT INTO keystone.notification (tenant_id, recipient_id, event_id, topic, title) VALUES ($1,$2,$3,'documents.document.signed','dup')`, [tid, uid, eid]); } catch (e) { err = e; }
    must(err && err.code === "23505" && /notification_one_per_event_docustay/.test(err.message + (err.constraint ?? "")), `${err?.code} ${err?.message}`);
  });
  await t("a topic outside Docustay's set is NOT constrained (Workbench may notify one person twice for one event): positive control for the index scope", async () => {
    const ev3 = await mkEvent("settings.subscription.updated", "33333333-3333-4333-8333-333333333333"); const e3 = ev3?.id ?? ev3?.eventId ?? ev3;
    await c.query(`INSERT INTO keystone.notification (tenant_id, recipient_id, event_id, topic, title) VALUES ($1,$2,$3,'booking.waitlist.offered','a')`, [tid, uid, e3]);
    await c.query(`INSERT INTO keystone.notification (tenant_id, recipient_id, event_id, topic, title) VALUES ($1,$2,$3,'booking.waitlist.offered','b')`, [tid, uid, e3]);
    must((await count(e3, uid)) === 2, "both allowed");
  });
} finally { await c.query(`DELETE FROM keystone.notification_delivery WHERE tenant_id = $1`, [tid]).catch(() => {}); await c.query(`DELETE FROM keystone.notification WHERE tenant_id = $1`, [tid]).catch(() => {}); await c.query(`DELETE FROM keystone.event WHERE tenant_id = $1`, [tid]).catch(() => {}); await c.query(`DELETE FROM keystone.app_user WHERE tenant_id = $1`, [tid]).catch(() => {}); await c.query(`DELETE FROM keystone.tenant WHERE id = $1`, [tid]).catch(() => {}); await c.end(); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
