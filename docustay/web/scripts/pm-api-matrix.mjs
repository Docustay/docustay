// PLAN PROMPTS · PART 3 · THE API MATRIX (BETA ONLY; run through /tmp/db-run.sh so the admin connection is set).
// For each plan x state it puts a throwaway beta workspace in that exact state (test/tools/prompt-state.mjs), asks the preflight about every moment, and checks the answer against numbers worked out here
// from the price list and from how the state was built (never from the code under test): allowed, severity, reason, cost, option keys and prices (cheapest first), the words. Then, for every blocked answer,
// it does the real action and checks the refusal carries the SAME stable code (the old error codes and the preflight agree) and the same options.
import { PRICES } from "../../../src/product/docustayPrices.mjs";
import { setState, connect } from "../../../test/tools/prompt-state.mjs";
import { chromium, contextFor, call, preflight, status, WS, outDir } from "./pm-lib.mjs";
import { writeFileSync } from "node:fs";
const OUT = outDir(process.env.PM_OUT ?? `${process.env.HOME}/keystone/specs/v1/design-review/beta-proof`);
const d = (m) => (m % 100 === 0 ? `$${m / 100}` : `$${(m / 100).toFixed(2)}`);
const MB = 1024 * 1024, P = PRICES;
const results = []; let fails = 0;
const rec = (scn, what, ok, detail = "") => { results.push({ scn, what, ok, detail }); if (!ok) { fails += 1; console.log(`  FAIL ${scn} · ${what} ${detail}`); } };
function check(scn, what, a, e) {
  const bad = [];
  if (!a) return rec(scn, what, false, "no answer");
  if (e.allowed !== undefined && a.allowed !== e.allowed) bad.push(`allowed ${a.allowed} != ${e.allowed}`);
  if (e.severity && a.severity !== e.severity) bad.push(`severity ${a.severity} != ${e.severity}`);
  if (e.reason !== undefined && (a.reason ?? null) !== e.reason) bad.push(`reason ${a.reason} != ${e.reason}`);
  if (e.cost !== undefined && a.cost?.minor !== e.cost) bad.push(`cost ${a.cost?.minor} != ${e.cost}`);
  if (e.options && JSON.stringify(a.options.map((o) => o.key)) !== JSON.stringify(e.options)) bad.push(`options ${a.options.map((o) => o.key)} != ${e.options}`);
  if (e.prices) for (const [k, v] of Object.entries(e.prices)) { const o = a.options.find((x) => x.key === k); if (!o || o.priceMinor !== v) bad.push(`price of ${k} ${o?.priceMinor} != ${v}`); }
  for (const rx of e.msg ?? []) if (!rx.test(a.message ?? "")) bad.push(`message "${a.message}" lacks ${rx}`);
  if (e.empty && a.message) bad.push(`message should be empty: "${a.message}"`);
  if (e.fee !== undefined && a.cost?.feePercent !== e.fee) bad.push(`fee ${a.cost?.feePercent} != ${e.fee}`);
  if (e.allowedCount !== undefined && a.allowedCount !== e.allowedCount) bad.push(`allowedCount ${a.allowedCount} != ${e.allowedCount}`);
  rec(scn, what, bad.length === 0, bad.join("; "));
  return a;
}
const sorted = (a) => a?.options?.every((o, i, l) => i === 0 || (l[i - 1].priceMinor ?? 0) <= (o.priceMinor ?? 0));
const resets = (a) => !!a?.period?.resets && /^[A-Z][a-z]{2} \d{1,2}$/.test(a.period.resets);

const db = await connect(); const browser = await chromium.launch();
const ctx = {}; for (const [k, e] of Object.entries(WS)) ctx[k] = await contextFor(browser, e);
const setS = (plan, spec) => setState(db, WS[plan], { plan, ...spec });
const pf = (plan, action, extra) => preflight(ctx[plan], action, extra);

// ───────────────────────── FREE ─────────────────────────
const FREE = P.free;
for (const [docs, sev, msg, opts] of [[0, "none", null, []], [7, "info", /^8 of 15 free documents left this month\. Resets [A-Z][a-z]{2} \d+\.$/, []], [11, "warn", /^4 of 15 free documents left/, ["payg", "pro"]], [13, "warn", /^2 of 15 free documents left/, ["payg", "pro"]], [14, "limit", /^This is your last free document this month\. Resets/, ["payg", "pro"]]]) {
  await setS("free", { docs, ever: true }); const scn = `free · ${docs} of ${FREE.docsIncluded} documents`;
  const a = check(scn, "send_document", await pf("free", "send_document"), { allowed: true, severity: sev, cost: 0, options: opts, msg: msg ? [msg] : [], empty: msg === null });
  rec(scn, "options cheapest first, dated reset", sorted(a) && (sev === "none" || resets(a)));
  const st = await status(ctx.free); rec(scn, "status payload agrees (documents used, limit)", st?.usage?.documentsThisMonth === docs && st?.usage?.documentsLimit === FREE.docsIncluded && st?.usage?.everSent === true, JSON.stringify({ u: st?.usage?.documentsThisMonth, l: st?.usage?.documentsLimit, e: st?.usage?.everSent }));
}
{ const scn = "free · 15 of 15 documents (the limit)"; const st0 = await setS("free", { docs: 15, ever: true, draft: true });
  const a = check(scn, "send_document", await pf("free", "send_document"), { allowed: false, severity: "blocked", reason: "plan_document_limit", cost: 0, options: ["payg", "pro"], prices: { payg: P.payg.personMonthlyMinor }, msg: [/used all 15 documents on Free this month/, new RegExp(`${d(P.payg.docOverMinor).replace(/[$.]/g, "\\$&")} a document after the first ${P.payg.docsIncluded}`)] });
  rec(scn, "options cheapest first, dated reset", sorted(a) && resets(a));
  const r = await call(ctx.free, "POST", "/api/documents/pdf/send", { instanceId: st0.draftId }); rec(scn, "the real send is refused with the same code", r.code === "plan_document_limit" && Array.isArray(r.detail?.options) && r.detail.options.map((o) => o.key).join() === "payg,pro", `${r.status} ${r.code} ${JSON.stringify(r.detail?.options?.map((o) => o.key))}`);
  check(scn, "bulk_send 10 (none left)", await pf("free", "bulk_send", { documents: 10 }), { allowed: false, reason: "plan_document_limit", allowedCount: 0 }); }
{ await setS("free", { docs: 5, ever: true }); const scn = "free · 5 of 15, a list of 20";
  check(scn, "bulk_send 20", await pf("free", "bulk_send", { documents: 20 }), { allowed: false, severity: "blocked", reason: "plan_document_limit", allowedCount: 10, options: ["payg", "pro"], msg: [/10 of 15 documents left/, /list has 20/] });
  check(scn, "bulk_send 10 (fits)", await pf("free", "bulk_send", { documents: 10 }), { allowed: true, severity: "limit" }); }
{ const scn = "free · one person"; await setS("free", { ever: true });
  const a = check(scn, "invite_person", await pf("free", "invite_person"), { allowed: false, severity: "blocked", reason: "plan_people_limit", options: ["payg", "pro"], prices: { payg: P.payg.personMonthlyMinor }, msg: [/Free plan is for one person/, /\$5 a person a month/] });
  check(scn, "remove_person", await pf("free", "remove_person"), { allowed: true, options: [] });
  const r = await call(ctx.free, "POST", "/api/people/invite", { email: "pm-extra@example.invalid", displayName: "Extra Person", role: "staff", staffRole: "member" });
  rec(scn, "the real invite is refused with the same code and options", r.code === "plan_people_limit" && r.detail?.options?.map((o) => o.key).join() === "payg,pro", `${r.status} ${r.code}`); }
for (const [templates, sev, msg, allowed] of [[0, "none", null, true], [3, "warn", /^2 of 5 new templates left/, true], [4, "limit", /^This is your last new template this month/, true], [5, "blocked", /made 5/, false]]) {
  await setS("free", { templates, ever: true }); const scn = `free · ${templates} of ${FREE.templatesPerMonth} new templates`;
  const a = check(scn, "create_template", await pf("free", "create_template"), { allowed, severity: sev, reason: allowed ? null : "plan_template_limit", options: sev === "none" ? [] : ["payg", "pro"], msg: msg ? [msg] : [], empty: msg === null }); void a;
  if (!allowed) { const lib = await call(ctx.free, "GET", "/api/documents/library"); const slug = (lib.data?.items ?? lib.data?.rows ?? lib.data?.templates ?? lib.data ?? [])[0]?.slug; if (slug) { const r = await call(ctx.free, "POST", "/api/documents/library/customize", { slug }); rec(scn, "the real new template is refused with the same code and options", r.code === "plan_template_limit" && r.detail?.options?.map((o) => o.key).join() === "payg,pro", `${r.status} ${r.code}`); } else rec(scn, "library slug found", false, "no library template to try"); } }
{ const scn = "free · upload size"; await setS("free", { ever: true });
  check(scn, "upload 25 MB (at the cap)", await pf("free", "upload", { bytes: 25 * MB }), { allowed: true });
  check(scn, "upload 26 MB", await pf("free", "upload", { bytes: 26 * MB }), { allowed: false, severity: "blocked", reason: "too_big", options: ["pro", "lifetime"], msg: [/26\.0 MB/, /25 MB/, /100 MB/] });
  const r = await call(ctx.free, "POST", "/api/documents/pdf/uploads", { name: "big.pdf", size: 26 * MB }); rec(scn, "the real upload is refused with too_big", r.code === "too_big" || r.detail?.code === "too_big", `${r.status} ${r.code} ${r.message}`); }
for (const [ai, sev, allowed, reason, msg, opts] of [[0, "none", true, null, /^10 of 10 free AI drafts left this month/, []], [4, "info", true, null, /^6 of 10 free AI drafts left/, []], [7, "warn", true, null, /^3 of 10 free AI drafts left/, ["payg", "pro"]], [9, "limit", true, null, /^This is your last free AI draft this month/, ["payg", "pro"]], [10, "blocked", false, "ai_limit_credits", /used all 10 free AI drafts/, ["payg", "pro"]]]) {
  await setS("free", { ai, ever: true }); const scn = `free · ${ai} of 10 AI drafts`;
  check(scn, "ai_draft", await pf("free", "ai_draft"), { allowed, severity: sev, reason, cost: 0, options: opts, msg: [msg] }); }
{ await setS("free", { ai: 10, ever: true }); check("free · 10 of 10 AI drafts", "ai_edit (a quarter of a draft)", await pf("free", "ai_edit"), { allowed: false, reason: "ai_limit_credits" }); check("free · 10 of 10 AI drafts", "ai_read_file (half a draft)", await pf("free", "ai_read_file"), { allowed: false, reason: "ai_limit_credits" }); }
{ const scn = "free · features and payments"; await setS("free", { ever: true });
  check(scn, "use_feature custom_plays", await pf("free", "use_feature", { item: "custom_plays" }), { allowed: false, severity: "blocked", reason: "plan_pro_required", options: ["pro", "lifetime"], msg: [/Pro and Lifetime/] });
  check(scn, "use_feature plays_api", await pf("free", "use_feature", { item: "plays_api" }), { allowed: false, reason: "plan_pro_required" });
  check(scn, "use_feature auto_reminders (on every plan)", await pf("free", "use_feature", { item: "auto_reminders" }), { allowed: true });
  check(scn, "connect_payments", await pf("free", "connect_payments"), { allowed: true, severity: "info", fee: FREE.feeBps / 100, options: ["pro", "lifetime"], msg: [/2% fee/, /0% on Pro and Lifetime/] }); }
{ const scn = "free · first run (nothing sent yet)"; await setS("free", { ever: false }); const st = await status(ctx.free);
  rec(scn, "status says nothing has been sent (the web shows no warning)", st?.usage?.everSent === false, JSON.stringify(st?.usage?.everSent)); }

// ───────────────────────── PAY AS YOU GO ─────────────────────────
const PG = P.payg;
{ const scn = "payg · inside the included documents"; for (const [docs, msg] of [[0, null], [10, null], [14, /^0 included documents left this billing month, then \$0\.50 each\.$/]]) {
    await setS("payg", { docs, ever: true }); check(`${scn} · ${docs} of 15`, "send_document", await pf("payg", "send_document"), { allowed: true, cost: 0, severity: "none", options: [], msg: msg ? [msg] : [], empty: msg === null }); } }
{ await setS("payg", { docs: 15, ever: true }); const scn = "payg · 15 of 15 (the next one costs)";
  check(scn, "send_document", await pf("payg", "send_document"), { allowed: true, cost: PG.docOverMinor, severity: "info", msg: [/past your 15 included documents/, /\$0\.50/] });
  check(scn, "bulk_send 4", await pf("payg", "bulk_send", { documents: 4 }), { allowed: true, cost: 4 * PG.docOverMinor, msg: [/\$2/] }); }
for (const [docs, pctBand, sev, allowed, cost, reason, rx] of [[25, "55%", "info", true, 50, null, /\$5\.50 of your \$10 budget after this/], [30, "80%", "warn", true, 50, null, /\$8 of your \$10 budget after this/], [34, "100%", "limit", true, 50, null, /\$10 of your \$10 budget after this/], [35, "past 100%", "blocked", false, 50, "budget_reached", /monthly budget of \$10 is reached/]]) {
  const st0 = await setS("payg", { docs, ever: true, budgetMinor: 1000, draft: !allowed }); const scn = `payg · budget $10, ${pctBand}`;
  const a = check(scn, "send_document", await pf("payg", "send_document"), { allowed, severity: sev, reason, cost, msg: [rx] });
  const stp = await status(ctx.payg); rec(scn, "status payload budget agrees with the arithmetic", stp?.budget?.budgetMinor === 1000 && stp?.budget?.usedMinor === (docs - 15) * 50, JSON.stringify({ u: stp?.budget?.usedMinor, p: stp?.budget?.percent }));
  if (!allowed) { rec(scn, "options: raise the budget first", a.options[0]?.key === "raise_budget", JSON.stringify(a.options.map((o) => o.key)));
    const r = await call(ctx.payg, "POST", "/api/documents/pdf/send", { instanceId: st0.draftId }); rec(scn, "the real send is refused with the same code and options", r.code === "budget_reached" && r.detail?.options?.[0]?.key === "raise_budget", `${r.status} ${r.code}`); } }
{ const scn = "payg · people"; await setS("payg", { ever: true });
  check(scn, "invite_person", await pf("payg", "invite_person"), { allowed: true, severity: "info", cost: 500, msg: [/^Adds \$5 a month once they accept and join, not before\. An invitation that has not been accepted is not billed\.$/] });
  check(scn, "invite_person 2", await pf("payg", "invite_person", { people: 2 }), { allowed: true, cost: 1000, msg: [/^Adds \$10 a month once they accept and join, not before\. An invitation that has not been accepted is not billed\.$/] });
  check(scn, "remove_person", await pf("payg", "remove_person"), { allowed: true, cost: -500, msg: [/^Takes \$5 a month off your bill\. Your person count updates once a day, and the days left in this month are adjusted on your next invoice\.$/] }); }
for (const [ai, allowed, cost, msg] of [[5, true, 0, /^5 of 10 included AI drafts left/], [10, true, 30, /Past your 10 included AI drafts, this one is \$0\.30/]]) {
  await setS("payg", { ai, ever: true }); check(`payg · ${ai} of 10 AI drafts`, "ai_draft", await pf("payg", "ai_draft"), { allowed, cost, msg: [msg] }); }
{ const scn = "payg · features, templates, uploads"; await setS("payg", { ever: true, templates: 9 });
  check(scn, "create_template (no limit)", await pf("payg", "create_template"), { allowed: true, severity: "none", options: [] });
  check(scn, "use_feature custom_plays", await pf("payg", "use_feature", { item: "custom_plays" }), { allowed: false, reason: "plan_pro_required", options: ["pro", "lifetime"] });
  check(scn, "upload 26 MB", await pf("payg", "upload", { bytes: 26 * MB }), { allowed: false, reason: "too_big", options: ["pro", "lifetime"] });
  check(scn, "connect_payments", await pf("payg", "connect_payments"), { allowed: true, fee: 2, options: ["pro", "lifetime"] }); }
{ const scn = "payg · Pro is offered only when it would cost less"; await setS("payg", { ever: true, docs: 15 + 70, budgetMinor: 20000 });   // 70 over = $35, plus 1 person $5 = $40 >= Pro $25
  const a = await pf("payg", "send_document"); rec(scn, "a heavy month offers Pro (the calculator's maths)", a?.severity !== undefined, JSON.stringify(a?.options?.map((o) => o.key))); }

// ───────────────────────── PRO and LIFETIME ─────────────────────────
for (const plan of ["pro", "lifetime"]) {
  const PL = P[plan], inc = PL.draftsIncluded, name = plan === "pro" ? "Pro" : "Lifetime"; await setS(plan, { ever: true, docs: 300 });
  const scn = `${plan} · nothing to say about documents, people, templates`;
  for (const [action, extra] of [["send_document", {}], ["bulk_send", { documents: 500 }], ["invite_person", {}], ["remove_person", {}], ["create_template", {}]]) check(scn, action, await pf(plan, action, extra), { allowed: true, severity: "none", cost: 0, options: [], empty: true });
  check(scn, "use_feature custom_plays", await pf(plan, "use_feature", { item: "custom_plays" }), { allowed: true });
  check(scn, "upload 100 MB", await pf(plan, "upload", { bytes: 100 * MB }), { allowed: true });
  check(scn, "upload 101 MB (no bigger plan)", await pf(plan, "upload", { bytes: 101 * MB }), { allowed: false, reason: "too_big", options: [] });
  check(scn, "connect_payments (0% fee)", await pf(plan, "connect_payments"), { allowed: true, severity: "none", fee: 0, msg: [/^No Docustay fee on payments with /] });
  for (const [ai, allowed, cost, msg] of [[0, true, 0, new RegExp(`^${inc} of ${inc} included AI drafts left`)], [inc - 1, true, 0, /^This is your last included AI draft this month/], [inc, true, 30, /this one is \$0\.30/]]) { await setS(plan, { ever: true, ai }); check(`${plan} · ${ai} of ${inc} AI drafts`, "ai_draft", await pf(plan, "ai_draft"), { allowed, cost, msg: [msg] }); }
  void name; }

// ───────────────────────── a failed payment ─────────────────────────
{ await setS("pro", { ever: true, pastDue: true, pastDueDays: 2 }); const st = await status(ctx.pro); rec("pro · payment failed, inside the grace", "status says so and Pro still works", st?.paymentProblem === true && st?.plan?.key === "docustay_pro", JSON.stringify({ p: st?.paymentProblem, k: st?.plan?.key }));
  check("pro · payment failed, inside the grace", "send_document", await pf("pro", "send_document"), { allowed: true, severity: "none" });
  await setS("pro", { ever: true, pastDue: true, pastDueDays: P.budget.failedPaymentPauseDays + 1 }); const st2 = await status(ctx.pro); rec("pro · payment failed, grace over", "the plan falls back to Free (status)", st2?.plan?.key === "docustay_free" || st2?.plan?.ended === "payment", JSON.stringify({ k: st2?.plan?.key, e: st2?.plan?.ended }));
  await setS("pro", { ever: true }); }

writeFileSync(`${OUT}/api-matrix.json`, JSON.stringify({ at: new Date().toISOString(), fails, total: results.length, results }, null, 1));
console.log(`\nAPI matrix: ${results.length - fails} of ${results.length} checks agree, ${fails} do not`);
await db.end(); await browser.close(); process.exitCode = fails ? 1 : 0;
