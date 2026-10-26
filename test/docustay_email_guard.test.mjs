// FIX PASS 3 — the bounce / spam guard ("Sending pauses by itself at 2% bounced or 0.05% reported as spam once at least 50 emails have gone out"). Real database; every pause has a control that does NOT pause.
import { setup, makeCounter, must } from "./helpers/p30Harness.mjs";
import { withTenant } from "../src/db/index.mjs";
const { t, done } = makeCounter();
const ctx = await setup({});
const { tenant, staffId, q } = ctx;
const L = await import("../src/documents/emailLog.mjs");
const as = (fn) => withTenant(tenant, fn, { userId: staffId });
let n = 0;
const seed = async (count, status = "delivered", isTest = false) => { for (let i = 0; i < count; i += 1) { n += 1; await q(`INSERT INTO keystone.document_email_log (tenant_id, kind, to_email, subject, status, provider_message_id, is_test) VALUES ($1,'invitation',$2,'s',$3,$4,$5)`, [tenant, `r${n}@example.invalid`, status, `pm-${ctx.TAG}-${n}`, isTest]); } };
const bounce = (i) => as((tx) => L.noteDelivery(tx, { tenantId: tenant, providerMessageId: `pm-${ctx.TAG}-${i}`, kind: "bounced" }));
const complain = (i) => as((tx) => L.noteDelivery(tx, { tenantId: tenant, providerMessageId: `pm-${ctx.TAG}-${i}`, kind: "complained" }));
const reset = async () => { await q(`DELETE FROM keystone.document_email_log WHERE tenant_id = $1`, [tenant]); await q(`DELETE FROM keystone.document_email_guard WHERE tenant_id = $1`, [tenant]); n = 0; };
console.log("\n=== email guard ===");
try {
  await t("under the sample (40 emails, 4 bounced = 10%) nothing pauses: the line only counts from 50 emails", async () => {
    await reset(); await seed(40); for (let i = 1; i <= 4; i += 1) await bounce(i);
    must(!(await as((tx) => L.guardState(tx))).paused, "paused under the sample");
    must(await as((tx) => L.pausedRefusal(tx)) === null, "refused under the sample");
  });
  await t("50 emails and 1 bounced is 2%: sending pauses by itself, says why, sends an event, and refuses with a sentence a person can act on", async () => {
    await reset(); await seed(50); const out = await bounce(1);
    const g = await as((tx) => L.guardState(tx));
    must(g.paused && /bounced/.test(g.reason), `not paused: ${JSON.stringify(g)}`);
    must(/Sending is paused for this workspace/.test(await as((tx) => L.pausedRefusal(tx))), "no refusal sentence");
    const ev = await q(`SELECT 1 FROM keystone.event WHERE tenant_id = $1 AND topic = 'documents.email.paused'`, [tenant]); must(ev.length >= 1, "no paused event");
  });
  await t("control: 100 emails and 1 bounced is 1%, below the line: no pause", async () => {
    await reset(); await seed(100); await bounce(1);
    must(!(await as((tx) => L.guardState(tx))).paused, "paused at 1%");
  });
  await t("spam reports: 1 of 100 is 1% (far past 0.05%): pauses; in a workspace's first 7 days the sample is 20 (21 Oct, decision 6): 20 emails with 1 report pauses, control: 19 with 1 report is under it: no pause", async () => {
    await reset(); await seed(100); await complain(1);
    const g = await as((tx) => L.guardState(tx)); must(g.paused && /spam/.test(g.reason), `not paused for spam: ${JSON.stringify(g)}`);
    await reset(); await seed(20); await complain(1); must((await as((tx) => L.guardState(tx))).paused, "a new workspace not paused at 20 emails with 1 report");
    await reset(); await seed(19); await complain(1); must(!(await as((tx) => L.guardState(tx))).paused, "paused under the new-workspace sample");
  });
  await t("test-mode emails never count (50 test emails, 10 bounced: no pause), and 'Resume' clears a pause (a list that is still bad pauses again at the next bounce)", async () => {
    await reset(); await seed(50, "delivered", true); for (let i = 1; i <= 10; i += 1) await bounce(i);
    must(!(await as((tx) => L.guardState(tx))).paused, "test emails counted");
    await reset(); await seed(50); await bounce(1); must((await as((tx) => L.guardState(tx))).paused, "setup: should be paused");
    must(!(await as((tx) => L.resume(tx, { tenantId: tenant, userId: staffId }))).paused, "resume did not clear");
    await bounce(2); must((await as((tx) => L.guardState(tx))).paused, "should pause again at the next bounce");
  });
} finally { await ctx.close(); }
done();
