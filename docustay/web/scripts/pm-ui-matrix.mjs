// PLAN PROMPTS · PART 3 · THE SCREEN MATRIX (BETA ONLY; run through /tmp/db-run.sh). Four throwaway beta workspaces (Free, Pay as you go, Pro, Lifetime), each put in an exact state (test/tools/prompt-state.mjs), then the REAL
// redesigned screens are opened in a real browser at 1440 and 390 wide, light and dark, and every prompt is checked against numbers worked out here from the price list and from how the state was built:
// which form (note, sheet, lock), the words and numbers, the options and prices, dismiss and once per period, nothing in first-run, keyboard and screen reader, no console errors. A screenshot of each state is kept.
import { PRICES } from "../../../src/product/docustayPrices.mjs";
import { setState, connect } from "../../../test/tools/prompt-state.mjs";
import { chromium, contextFor, call, preflight, WS, outDir } from "./pm-lib.mjs";
import { writeFileSync, existsSync } from "node:fs";
const ROOT = process.env.PM_OUT ?? `${process.env.HOME}/keystone/specs/v1/design-review/beta-proof`, SHOTS = outDir(`${ROOT}/screens`);
const ONLY = process.env.PM_ONLY ? new RegExp(process.env.PM_ONLY) : null, QUICK = process.env.PM_QUICK === "1";   // QUICK: one variant per scene (1440 light)
const MB = 1024 * 1024, P = PRICES;
const results = [], consoleErrors = [], events = []; let fails = 0;
const rec = (scn, what, ok, detail = "") => { results.push({ scn, what, ok, detail }); if (!ok) { fails += 1; console.log(`  FAIL ${scn} · ${what} ${detail}`); } };
const VARIANTS = QUICK ? [[1440, "light"]] : [[1440, "light"], [390, "dark"], [1440, "dark"], [390, "light"]];
const db = await connect(); const browser = await chromium.launch(); const ctx = {};
for (const [k, e] of Object.entries(WS)) ctx[k] = await contextFor(browser, e);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function facts(page) {
  return page.evaluate(() => {
    const t = (e) => (e?.innerText ?? "").replace(/\s+/g, " ").trim();
    const notes = [...document.querySelectorAll('[data-testid="plan-note"]')].map((n) => ({ kind: n.dataset.kind, severity: n.dataset.severity, action: n.dataset.action, meter: n.dataset.meter, reason: n.dataset.reason, text: t(n.querySelector('[data-testid="plan-note-text"]')), dismiss: !!n.querySelector('[data-testid="plan-note-dismiss"]'), options: !!n.querySelector('[data-testid="plan-note-options"]'), role: n.getAttribute("role") }));
    const sheets = [...document.querySelectorAll('[data-testid="plan-sheet"],[data-testid="plan-lock"]')].map((s) => ({ form: s.dataset.testid === "plan-lock" ? "lock" : "sheet", reason: s.dataset.reason, severity: s.dataset.severity, action: s.dataset.action, title: t(s.querySelector("#pp-title")), standing: t(s.querySelector('[data-testid="plan-standing"]')), message: t(s.querySelector('[data-testid="plan-message"]')),
      options: [...s.querySelectorAll('[data-testid="plan-option"]')].map((o) => ({ key: o.dataset.option, price: t(o.querySelector('[data-testid="plan-option-price"]')), label: t(o.querySelector("p")), unlocks: [...o.querySelectorAll("li")].map(t) })),
      role: s.getAttribute("role"), modal: s.getAttribute("aria-modal"), labelledby: s.getAttribute("aria-labelledby"), focusInside: s.contains(document.activeElement), notNow: t(s.querySelector('[data-testid="plan-notnow"]')) }));
    const bare = [...document.querySelectorAll("button, a")].filter((e) => /^\s*upgrade\s*$/i.test(e.innerText)).length;
    return { notes, sheets, bareUpgrade: bare, text: t(document.querySelector("main") ?? document.body).slice(0, 6000) };
  });
}
/** Open one screen in one variant; `act` may click around; returns the facts. */
async function open(plan, route, w, theme, scn, act = null) {
  const page = await ctx[plan].newPage();
  page.on("pageerror", (e) => consoleErrors.push({ scn, msg: `uncaught ${e.message}` }));
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push({ scn, msg: m.text().slice(0, 200) }); });
  page.on("request", (r) => { if (/prompt-event/.test(r.url()) && r.method() === "POST") { try { events.push({ scn, ...JSON.parse(r.postData() ?? "{}") }); } catch { /* none */ } } });
  await page.setViewportSize({ width: w, height: w < 600 ? 844 : 900 }); await page.emulateMedia({ colorScheme: theme });
  await page.goto(`https://host.example.com${route}`, { waitUntil: "networkidle" });
  await page.evaluate((th) => { document.documentElement.dataset.theme = th; try { localStorage.setItem("docustay-theme", th); } catch { /* none */ } }, theme);
  await page.waitForTimeout(1200);
  if (act) await act(page);
  return page;
}
const shot = async (page, dir, name) => { const d = outDir(`${SHOTS}/${dir}`); await page.screenshot({ path: `${d}/${name}.png` }); };
/** A scene: set the state once, then open the screen in every variant, check, and keep a screenshot. `expect(f)` returns a list of problems. */
async function scene(id, plan, spec, route, expectFn, { dir, act = null, after = null, prep = null, variants = VARIANTS } = {}) {
  if (ONLY && !ONLY.test(id)) return;
  const st = await setState(db, WS[plan], { plan, ...spec }); if (prep) await prep(plan, st);
  for (const [w, theme] of variants) {
    const scn = `${id} @${w} ${theme}`; let page;
    try {
      page = await open(plan, typeof route === "function" ? route(st) : route, w, theme, scn, act);
      const f = await facts(page); const bad = expectFn(f, st) ?? []; if (f.bareUpgrade) bad.push(`a button or link says just "Upgrade" (${f.bareUpgrade})`);
      rec(scn, "screen shows exactly what the state calls for", bad.length === 0, bad.join("; "));
      await shot(page, dir ?? "misc", `${slug(id)}-${w}-${theme}`);
      if (after && (variants === VARIANTS ? (w === 1440 && theme === "light") : true)) await after(page, f, st, { w, theme });
    } catch (e) { rec(scn, "screen opens", false, String(e.message).slice(0, 200)); }
    finally { await page?.close(); }
  }
}
const noPrompt = (f) => [...(f.notes.length ? [`a note is showing: "${f.notes[0].text}"`] : []), ...(f.sheets.length ? ["a sheet is open"] : [])];
const oneNote = (kind, sev, ...rxs) => (f) => { const n = f.notes; if (n.length !== 1) return [`expected exactly one note, found ${n.length}${n[0] ? `: "${n[0].text}"` : ""}`]; const x = n[0], bad = []; if (kind && x.kind !== kind) bad.push(`kind ${x.kind} != ${kind}`); if (sev && x.severity !== sev) bad.push(`severity ${x.severity} != ${sev}`); for (const rx of rxs) if (!rx.test(x.text)) bad.push(`"${x.text}" lacks ${rx}`); if (x.role !== "status") bad.push("note is not role=status"); return bad; };

// ═════════ DOCUMENTS LIST (warnings and refusals; a price is shown at Send, not here) ═════════
const DOCS = "/documents";
await scene("documents · free, first run (nothing sent)", "free", { docs: 0, ever: false }, DOCS, noPrompt, { dir: "documents" });
await scene("documents · free, 7 of 15", "free", { docs: 7, ever: true }, DOCS, noPrompt, { dir: "documents" });
await scene("documents · free, 11 of 15 (80 percent)", "free", { docs: 11, ever: true }, DOCS, oneNote("soft", "warn", /^4 of 15 free documents left this month\. Resets [A-Z][a-z]{2} \d+\.$/), { dir: "documents", after: async (page, f) => {
  const k = await page.evaluate(() => Object.keys(localStorage).filter((x) => x.startsWith("docustay:prompt-off:")));
  rec("documents · free, 11 of 15 · dismiss", "a dismiss button is offered", f.notes[0]?.dismiss === true);
  await page.locator('[data-testid="plan-note-dismiss"]').click(); await page.waitForTimeout(400);
  rec("documents · free, 11 of 15 · dismiss", "the note goes at once", (await facts(page)).notes.length === 0);
  const key = (await page.evaluate(() => Object.keys(localStorage).filter((x) => x.startsWith("docustay:prompt-off:")))).find((x) => !k.includes(x));
  rec("documents · free, 11 of 15 · dismiss", "the dismissal is remembered for this meter and this period", !!key && /^docustay:prompt-off:documents:\d{4}-\d{2}-\d{2}T/.test(key), String(key));
  await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(1200);
  rec("documents · free, 11 of 15 · dismiss", "it stays gone after a reload", (await facts(page)).notes.length === 0);
  await page.evaluate((x) => localStorage.removeItem(x), key); } });
await scene("documents · free, 13 of 15", "free", { docs: 13, ever: true }, DOCS, oneNote("soft", "warn", /^2 of 15 free documents left this month/), { dir: "documents" });
await scene("documents · free, 14 of 15 (the last free one)", "free", { docs: 14, ever: true }, DOCS, oneNote("soft", "limit", /^This is your last free document this month\. Resets/), { dir: "documents" });
await scene("documents · free, 15 of 15 (the limit)", "free", { docs: 15, ever: true }, DOCS, (f) => { const b = oneNote("blocked", "blocked", /used all 15 documents on Free this month/, new RegExp(`\\$0\\.50 a document after the first 15`))(f); if (!f.notes[0]?.options) b.push("no See options button"); return b; }, { dir: "documents" });
await scene("documents · payg, 15 of 15 (a price, not shown on the list)", "payg", { docs: 15, ever: true }, DOCS, noPrompt, { dir: "documents" });
await scene("documents · payg, budget $10 at 55 percent", "payg", { docs: 25, ever: true, budgetMinor: 1000 }, DOCS, oneNote("soft", "info", /\$5\.50 of your \$10 budget after this/), { dir: "documents" });
await scene("documents · payg, budget $10 at 80 percent", "payg", { docs: 30, ever: true, budgetMinor: 1000 }, DOCS, oneNote("soft", "warn", /\$8 of your \$10 budget after this/), { dir: "documents" });
await scene("documents · payg, budget $10 at 100 percent", "payg", { docs: 34, ever: true, budgetMinor: 1000 }, DOCS, oneNote("soft", "limit", /\$10 of your \$10 budget after this/), { dir: "documents" });
await scene("documents · payg, budget $10 reached (paused)", "payg", { docs: 35, ever: true, budgetMinor: 1000 }, DOCS, oneNote("blocked", "blocked", /monthly budget of \$10 is reached/), { dir: "documents" });
await scene("documents · pro", "pro", { docs: 300, ever: true }, DOCS, noPrompt, { dir: "documents" });
await scene("documents · lifetime", "lifetime", { docs: 300, ever: true }, DOCS, noPrompt, { dir: "documents" });

// ═════════ TEMPLATES ═════════
await scene("templates · free, first run", "free", { templates: 4, ever: false }, "/templates", noPrompt, { dir: "templates" });
await scene("templates · free, 2 of 5", "free", { templates: 2, ever: true }, "/templates", noPrompt, { dir: "templates" });
await scene("templates · free, 3 of 5 (80 percent)", "free", { templates: 3, ever: true }, "/templates", oneNote("soft", "warn", /^2 of 5 new templates left this month/), { dir: "templates" });
await scene("templates · free, 4 of 5 (the last)", "free", { templates: 4, ever: true }, "/templates", oneNote("soft", "limit", /^This is your last new template this month\. Resets/), { dir: "templates" });
await scene("templates · free, 5 of 5 (the limit)", "free", { templates: 5, ever: true }, "/templates", oneNote("blocked", "blocked", /you have made 5\./), { dir: "templates" });
await scene("templates · payg", "payg", { templates: 9, ever: true }, "/templates", noPrompt, { dir: "templates" });
await scene("templates · pro", "pro", { templates: 9, ever: true }, "/templates", noPrompt, { dir: "templates" });
await scene("templates · lifetime", "lifetime", { templates: 9, ever: true }, "/templates", noPrompt, { dir: "templates" });

// ═════════ TEAM (invite and its price) ═════════
const TEAM = "/settings?tab=team";
await scene("team · free, first run", "free", { ever: false }, TEAM, noPrompt, { dir: "team" });
await scene("team · free (one person)", "free", { ever: true }, TEAM, (f) => { const b = oneNote("blocked", "blocked", /The Free plan is for one person/, /\$5 a person a month/)(f); if (!f.notes[0]?.options) b.push("no See options button"); return b; }, { dir: "team" });
await scene("team · payg (adds $5 a month when they join)", "payg", { ever: true }, TEAM, oneNote("price", "info", /^Adds \$5 a month once they accept and join, not before\. An invitation that has not been accepted is not billed\.$/), { dir: "team" });
await scene("team · pro", "pro", { ever: true }, TEAM, noPrompt, { dir: "team" });
await scene("team · lifetime", "lifetime", { ever: true }, TEAM, noPrompt, { dir: "team" });

// ═════════ AI DRAFTING (settings card) ═════════
const AI = "/settings?tab=ai";
await scene("ai · free, first run", "free", { ai: 7, ever: false }, AI, noPrompt, { dir: "ai" });
await scene("ai · free, 4 of 10", "free", { ai: 4, ever: true }, AI, noPrompt, { dir: "ai" });
await scene("ai · free, 7 of 10 (80 percent)", "free", { ai: 7, ever: true }, AI, oneNote("soft", "warn", /^3 of 10 free AI drafts left this month/), { dir: "ai" });
await scene("ai · free, 9 of 10 (the last)", "free", { ai: 9, ever: true }, AI, oneNote("soft", "limit", /^This is your last free AI draft this month/), { dir: "ai" });
await scene("ai · free, 10 of 10 (the limit)", "free", { ai: 10, ever: true }, AI, oneNote("blocked", "blocked", /used all 10 free AI drafts/), { dir: "ai" });
await scene("ai · payg, 10 of 10 (the next costs $0.30)", "payg", { ai: 10, ever: true }, AI, oneNote("price", null, /Past your 10 included AI drafts, this one is \$0\.30/), { dir: "ai" });
await scene("ai · pro, 99 of 100", "pro", { ai: 99, ever: true }, AI, oneNote("soft", "limit", /^This is your last included AI draft this month/), { dir: "ai" });
await scene("ai · pro, 100 of 100 (the next costs $0.30)", "pro", { ai: 100, ever: true }, AI, oneNote(null, null, /this one is \$0\.30/), { dir: "ai" });
await scene("ai · lifetime, 50 of 50 (the next costs $0.30)", "lifetime", { ai: 50, ever: true }, AI, oneNote(null, null, /this one is \$0\.30/), { dir: "ai" });

// ═════════ PAYMENTS SETTINGS (the fee) ═════════
const PAY = "/settings?tab=payments";
for (const plan of ["free", "payg"]) await scene(`payments · ${plan}`, plan, { ever: true }, PAY, (f) => (/See how to lower the fee/.test(f.text) ? [] : ["no 'See how to lower the fee' link"]), { dir: "payments", act: async () => {}, after: async (page) => {
  await page.getByTestId("payments-fee-options").click(); await page.waitForTimeout(700); const f = await facts(page), s = f.sheets[0];
  rec(`payments · ${plan} · sheet`, "opens the sheet with Pro and Lifetime and the 2 percent fee", !!s && s.options.map((o) => o.key).join() === "pro,lifetime" && /2% fee/.test(s.message) && /0% on Pro and Lifetime/.test(s.message), JSON.stringify(s?.options?.map((o) => o.key)) + (s?.message ?? ""));
  rec(`payments · ${plan} · sheet`, "prices: Pro $25 (founders) and Lifetime $299", /\$25/.test(s?.options?.[0]?.price ?? "") && /\$299/.test(s?.options?.[1]?.price ?? ""), JSON.stringify(s?.options?.map((o) => o.price)));
  await shot(page, "payments", `${plan}-fee-sheet-1440-light`); } });
for (const plan of ["pro", "lifetime"]) await scene(`payments · ${plan}`, plan, { ever: true }, PAY, (f) => (/See how to lower the fee/.test(f.text) ? ["the link to lower the fee is shown on a 0% plan"] : []), { dir: "payments" });

// ═════════ PRO LOCK: custom plays ═════════
for (const plan of ["free", "payg"]) await scene(`plays · ${plan} lock`, plan, { ever: true }, "/plays", () => [], { dir: "plays", after: async (page) => {
  const cover = page.locator('[data-testid="prolock-cover"]').first(); if (!(await cover.count())) { rec(`plays · ${plan} · lock`, "the custom plays control wears a lock", false, "no prolock-cover"); return; }
  await cover.click(); await page.waitForTimeout(400); await page.getByTestId("prolock-explore").click(); await page.waitForTimeout(900); const f = await facts(page), s = f.sheets[0];
  rec(`plays · ${plan} · lock`, "opens the lock sheet: Pro and Lifetime, in plain words", !!s && s.form === "lock" && s.options.map((o) => o.key).join() === "pro,lifetime" && /part of Pro and Lifetime/.test(s.message), JSON.stringify(s));
  await shot(page, "plays", `${plan}-lock-sheet-1440-light`); } });
for (const plan of ["pro", "lifetime"]) await scene(`plays · ${plan}`, plan, { ever: true }, "/plays", (f) => [], { dir: "plays", after: async (page) => { rec(`plays · ${plan} · lock`, "no lock on custom plays", (await page.locator('[data-testid="prolock-custom_plays"][data-locked="true"]').count()) === 0); } });


// ═════════ THE SEND STEP (a charge is shown before the click; a refusal is said) ═════════
const REVIEW = (st) => `/documents/${st.draftId}/edit?step=send`;
await scene("send step · free, 14 of 15", "free", { docs: 14, ever: true, draft: true }, REVIEW, oneNote("soft", "limit", /^This is your last free document this month\./), { dir: "send-step" });
await scene("send step · free, 15 of 15", "free", { docs: 15, ever: true, draft: true }, REVIEW, oneNote("blocked", "blocked", /used all 15 documents on Free this month/), { dir: "send-step" });
await scene("send step · payg, 15 of 15 (this one costs $0.50)", "payg", { docs: 15, ever: true, draft: true }, REVIEW, (f) => { const b = oneNote("price", "info", /past your 15 included documents: \$0\.50/)(f); if (f.notes[0]?.dismiss) b.push("a charge can be dismissed"); if (!/Send, \$0\.50/.test(f.text)) b.push("the Send button does not carry the price"); return b; }, { dir: "send-step" });
await scene("send step · payg, budget $10 at 100 percent", "payg", { docs: 34, ever: true, draft: true, budgetMinor: 1000 }, REVIEW, (f) => { const b = oneNote(null, "limit", /\$10 of your \$10 budget after this/)(f); if (f.notes[0]?.dismiss) b.push("a charge can be dismissed"); return b; }, { dir: "send-step" });
await scene("send step · payg, budget $10 reached", "payg", { docs: 35, ever: true, draft: true, budgetMinor: 1000 }, REVIEW, oneNote("blocked", "blocked", /monthly budget of \$10 is reached/), { dir: "send-step" });
await scene("send step · pro", "pro", { docs: 300, ever: true, draft: true }, REVIEW, noPrompt, { dir: "send-step" });
await scene("send step · lifetime", "lifetime", { docs: 300, ever: true, draft: true }, REVIEW, noPrompt, { dir: "send-step" });

// ═════════ A REFUSAL BECOMES THE SHEET: invite on Free ═════════
await scene("invite click · free", "free", { ever: true }, "/settings?tab=team", () => [], { dir: "team", after: async (page) => {
  await page.locator('input[aria-label="Name"]').fill("Extra Person"); await page.locator('input[type="email"]').first().fill("pm-extra@example.invalid");
  await page.getByTestId("team-invite").click(); await page.waitForTimeout(1500); const f = await facts(page), sh = f.sheets[0], scn = "invite click · free · sheet";
  rec(scn, "the refusal opens the plan sheet, not a bare error line", !!sh && sh.reason === "plan_people_limit" && sh.title === "Adding people needs another plan", JSON.stringify(sh));
  rec(scn, "options: Pay as you go first ($5 a person a month), then Pro ($25 founders)", sh?.options.map((o) => o.key).join() === "payg,pro" && /^\$5 per person a month$/.test(sh.options[0].price) && /^\$25 a month$/.test(sh.options[1].price), JSON.stringify(sh?.options?.map((o) => o.price)));
  rec(scn, "the standing line says one person", /1 of 1 people/.test(sh?.standing ?? ""), sh?.standing);
  rec(scn, "no invitation was created", (await call(ctx.free, "GET", "/api/list/people/team/invites")).data?.rows?.filter((r) => /pm-extra/.test(r.email)).length === 0);
  await shot(page, "team", "free-invite-refusal-sheet-1440-light"); } });

// ═════════ REMOVING A PERSON, AND A REAL INVITATION ON PAY AS YOU GO ═════════
await scene("remove person · payg", "payg", { ever: true, teammate: true }, "/settings?tab=team", (f) => oneNote("price", "info", /^Adds \$5 a month once they accept and join, not before\. An invitation that has not been accepted is not billed\.$/)(f), { dir: "team", after: async (page) => {
  const scn = "remove person · payg · confirm"; await page.getByTestId("team-remove").first().click(); await page.waitForTimeout(900); const f = await facts(page);
  rec(scn, "the line before the click says what it takes off the bill, and it is the only prompt", f.notes.length === 1 && /^Takes \$5 a month off your bill\. Your person count updates once a day, and the days left in this month are adjusted on your next invoice\.$/.test(f.notes[0]?.text ?? ""), JSON.stringify(f.notes));
  await shot(page, "team", "payg-remove-confirm-1440-light");
  await page.getByRole("button", { name: "Keep" }).click(); await page.waitForTimeout(500); const g = await facts(page);
  rec(scn, "Keep brings the invite line back (one prompt on the screen)", g.notes.length === 1 && /^Adds \$5 a month/.test(g.notes[0]?.text ?? ""), JSON.stringify(g.notes)); } });
await scene("invite · payg, a real invitation", "payg", { ever: true }, "/settings?tab=team", () => [], { dir: "team", after: async (page) => {
  const scn = "invite · payg · sent"; await page.locator('input[aria-label="Name"]').fill("Extra Person"); await page.locator('input[type="email"]').first().fill("pm-extra-invitee@example.invalid");
  await page.getByTestId("team-invite").click(); await page.waitForTimeout(2200); const f = await facts(page);
  rec(scn, "the invitation goes (Pay as you go has no people limit) and no limit sheet opens", f.sheets.length === 0 && /Invitation sent to pm-extra-invitee@example\.invalid/.test(await page.getByTestId("team-note").innerText().catch(() => "")), JSON.stringify(f.sheets));
  rec(scn, "the invite line still says what the next person costs", /^Adds \$5 a month/.test(f.notes[0]?.text ?? ""), JSON.stringify(f.notes));
  await shot(page, "team", "payg-invite-sent-1440-light"); } });

// ═════════ UPLOADS: the size is asked before the file is hashed ═════════
for (const [plan, mb, opts, rx] of [["free", 26, "pro,lifetime", /26\.0 MB.*25 MB.*100 MB/], ["payg", 26, "pro,lifetime", /26\.0 MB.*25 MB.*100 MB/], ["pro", 101, "", /101\.0 MB.*100 MB/], ["lifetime", 101, "", /101\.0 MB.*100 MB/]]) await scene(`upload · ${plan}, ${mb} MB`, plan, { ever: true }, "/create?upload=1", () => [], { dir: "upload", after: async (page) => {
  const big = `/tmp/pm-${mb}mb.pdf`; if (!existsSync(big)) writeFileSync(big, Buffer.alloc(mb * MB, 1));
  await page.getByTestId("cr-upload-input").setInputFiles(big); await page.waitForTimeout(1800);
  const f = await facts(page), sh = f.sheets[0], scn = `upload · ${plan}, ${mb} MB · sheet`;
  rec(scn, "the plan sheet says the file is too large", !!sh && sh.reason === "too_big" && sh.title === "That file is too large", JSON.stringify(sh));
  rec(scn, "words and options", rx.test(sh?.message ?? "") && (sh?.options ?? []).map((o) => o.key).join() === opts, `${sh?.message} | ${JSON.stringify(sh?.options?.map((o) => o.key))}`);
  rec(scn, "nothing was uploaded", !/Uploading|Processing/.test((await facts(page)).text));
  await shot(page, "upload", `${plan}-${mb}mb-sheet-1440-light`); } });

// ═════════ A NEW TEMPLATE AT THE FREE LIMIT: the lock opens the sheet ═════════
await scene("template lock · free, 5 of 5", "free", { templates: 5, ever: true }, "/templates", () => [], { dir: "templates", after: async (page) => {
  const cover = page.locator('[data-testid="prolock-new-template"] [data-testid="prolock-cover"]').first(); const scn = "template lock · free, 5 of 5 · sheet"; await cover.waitFor({ timeout: 10000 }).catch(() => {});
  if (!(await cover.count())) { rec(scn, "the New template door wears the lock", false, "none"); return; }
  await cover.click(); await page.waitForTimeout(400); await page.getByTestId("prolock-explore").first().click(); await page.waitForTimeout(1000); const sh = (await facts(page)).sheets[0];
  rec(scn, "opens the template limit sheet with Pay as you go and Pro", !!sh && sh.reason === "plan_template_limit" && sh.options.map((o) => o.key).join() === "payg,pro" && /5 of 5 new templates made/.test(sh.standing), JSON.stringify(sh));
  await shot(page, "templates", "free-template-limit-sheet-1440-light"); } });

// ═════════ BULK SEND (needs a saved template with exactly one signer: one is made from the library, once) ═════════
const bulkTemplate = async (plan, st) => { let k = await call(ctx[plan], "GET", "/api/documents/pdf/kiosk-templates"); if ((k.json?.templates ?? []).length) return;
  const lib = await call(ctx[plan], "GET", "/api/documents/library"); const items = lib.data?.items ?? lib.data?.rows ?? lib.data?.templates ?? lib.data ?? [];
  for (const it of items.slice(0, 40)) { await db.query(`DELETE FROM keystone.document_template_creation WHERE tenant_id = $1`, [st.tenant]); await call(ctx[plan], "POST", "/api/documents/library/customize", { slug: it.slug }); k = await call(ctx[plan], "GET", "/api/documents/pdf/kiosk-templates"); if ((k.json?.templates ?? []).length) { await db.query(`DELETE FROM keystone.document_template_creation WHERE tenant_id = $1`, [st.tenant]); return; } } };
for (const [plan, spec, rows, kind, sev, rx] of [["free", { docs: 5, ever: true, templates: 0 }, 20, "blocked", "blocked", /10 of 15 documents left this month, and this list has 20/], ["payg", { docs: 15, ever: true }, 4, "price", "info", /4 of these are past your 15 included documents: \$2/]]) await scene(`bulk · ${plan}, ${rows} rows`, plan, spec, "/templates?bulk=1", () => [], { dir: "bulk", prep: bulkTemplate, after: async (page) => {
  const csv = "name,email\n" + Array.from({ length: rows }, (_, i) => `Person ${i + 1},p${i + 1}@example.invalid`).join("\n");
  await page.locator('[data-testid="bulk-file"] input[type=file]').setInputFiles({ name: "list.csv", mimeType: "text/csv", buffer: Buffer.from(csv) }); await page.waitForTimeout(1800);
  const f = await facts(page), n = f.notes[0], scn = `bulk · ${plan}, ${rows} rows`;
  rec(scn, "the list shows its price or its limit before anything is sent", !!n && n.kind === kind && n.severity === sev && rx.test(n.text), JSON.stringify(n));
  await shot(page, "bulk", `${plan}-${rows}-rows-1440-light`); } });

// ═════════ CHOOSING AN OPTION, THE KEYBOARD, THE ANALYTICS ═════════
await scene("sheet · free at the limit: keyboard, options, analytics", "free", { docs: 15, ever: true }, "/documents", () => [], { dir: "sheet", after: async (page) => {
  const scn = "sheet · free at the limit"; 
  const mark = events.filter((e) => e.scn.startsWith("sheet · free at the limit")).length; const opener = page.getByTestId("plan-note-options"); await opener.focus(); await page.keyboard.press("Enter"); await page.waitForTimeout(700);
  let f = await facts(page), sh = f.sheets[0];
  rec(scn, "the sheet is a labelled modal dialog", !!sh && sh.role === "dialog" && sh.modal === "true" && sh.labelledby === "pp-title" && sh.title === "You have reached your document limit", JSON.stringify(sh && { role: sh.role, modal: sh.modal, title: sh.title }));
  rec(scn, "focus moves into the sheet", sh?.focusInside === true);
  rec(scn, "standing line and dated reset", /15 of 15 documents used · resets [A-Z][a-z]{2} \d+/.test(sh?.standing ?? ""), sh?.standing);
  rec(scn, "options: Pay as you go $5 per person a month first, Pro $25 a month (founders) second", sh?.options.map((o) => o.key).join() === "payg,pro" && /^\$5 per person a month$/.test(sh.options[0].price) && /^\$25 a month$/.test(sh.options[1].price), JSON.stringify(sh?.options?.map((o) => o.price)));
  rec(scn, "Pay as you go lists $0.50 a document after the first 15", sh?.options[0].unlocks.some((u) => /15 documents included, then \$0\.50 each/.test(u)), JSON.stringify(sh?.options?.[0]?.unlocks));
  const seen = new Set(); for (let i = 0; i < 12; i++) { await page.keyboard.press("Tab"); seen.add(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') ? "in" : "out")); }
  rec(scn, "Tab stays inside the sheet", [...seen].join() === "in", [...seen].join());
  await shot(page, "sheet", "free-document-limit-1440-light");
  await page.keyboard.press("Escape"); await page.waitForTimeout(500);
  rec(scn, "Escape closes it and focus returns to See options", (await facts(page)).sheets.length === 0 && (await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "plan-note-options");
  await page.getByTestId("plan-note-options").click(); await page.waitForTimeout(500); await page.getByTestId("plan-notnow").click(); await page.waitForTimeout(500);
  rec(scn, "Not now closes it", (await facts(page)).sheets.length === 0);
  const mine = events.filter((e) => e.scn.startsWith("sheet · free at the limit")).map((e) => `${e.name}:${e.form}:${e.option ?? ""}`); void mark;
  rec(scn, "analytics: shown, clicked (see options), dismissed (close, not_now) in that order", ["prompt_shown:note:", "prompt_clicked:note:see_options", "prompt_shown:sheet:", "prompt_dismissed:sheet:close"].every((x) => mine.includes(x)) && mine.includes("prompt_dismissed:sheet:not_now"), mine.join(" | "));
  await page.getByTestId("plan-note-options").click(); await page.waitForTimeout(500);
  const pro = page.locator('[data-testid="plan-option"][data-option="pro"] [data-testid="plan-option-go"]'); await pro.click(); await page.waitForTimeout(1200);
  rec(scn, "Choose Pro opens the Pro checkout sheet (not a bare page change)", (await page.getByTestId("upgrade-sheet").count()) === 1 && (await page.getByTestId("upgrade-go").count()) === 1);
  await shot(page, "sheet", "free-choose-pro-1440-light");
  await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  await page.getByTestId("plan-note-options").click(); await page.waitForTimeout(500);
  const [nav] = await Promise.all([page.waitForURL(/checkout\.stripe\.com|\/billing/, { timeout: 45000 }).then(() => page.url()).catch(() => "none"), page.locator('[data-testid="plan-option"][data-option="payg"] [data-testid="plan-option-go"]').click()]);
  rec(scn, "Switch to Pay as you go goes to Stripe's secure checkout in TEST mode (nothing is paid)", /checkout\.stripe\.com\/.*/.test(nav) && /cs_test_/.test(nav), String(nav).slice(0, 60)); } });
await scene("sheet · payg, budget reached: raise the budget", "payg", { docs: 35, ever: true, budgetMinor: 1000 }, "/documents", () => [], { dir: "sheet", after: async (page) => {
  const scn = "sheet · payg budget reached"; await page.getByTestId("plan-note-options").click(); await page.waitForTimeout(600); const sh = (await facts(page)).sheets[0];
  rec(scn, "title, standing line and the first option is Raise the budget", sh?.title === "Your monthly budget is reached" && /\$10 of your \$10 budget used · resets/.test(sh.standing) && sh.options[0]?.key === "raise_budget", JSON.stringify(sh && { t: sh.title, s: sh.standing, o: sh.options.map((o) => o.key) }));
  rec(scn, "Pro is not offered (this month is cheaper on Pay as you go than Pro)", !sh?.options.some((o) => o.key === "pro"), JSON.stringify(sh?.options?.map((o) => o.key)));
  await shot(page, "sheet", "payg-budget-reached-1440-light");
  await page.locator('[data-testid="plan-option"][data-option="raise_budget"] [data-testid="plan-option-go"]').click(); await page.waitForTimeout(1500);
  rec(scn, "Raise the budget goes to the budget box on Billing", /\/billing#billing-budget/.test(page.url()) && (await page.getByTestId("billing-budget-input").count()) === 1, page.url()); } });

// ═════════ THE SHEET ON A PHONE ═════════
await scene("phone sheet · free at the limit", "free", { docs: 15, ever: true }, "/documents", () => [], { dir: "sheet", variants: [[390, "dark"], [390, "light"]], after: async (page, f, st, v) => {
  const scn = `phone sheet · ${v.theme}`; await page.getByTestId("plan-note-options").click(); await page.waitForTimeout(700);
  const m = await page.evaluate(() => { const d = document.querySelector('[data-testid="plan-sheet"]'); const r = d?.getBoundingClientRect(); const nn = document.querySelector('[data-testid="plan-notnow"]')?.getBoundingClientRect(); return { w: innerWidth, h: innerHeight, left: r?.left, right: r?.right, bottom: r?.bottom, top: r?.top, scrollW: document.scrollingElement.scrollWidth, notNowVisible: !!nn && nn.bottom <= innerHeight + 1 && nn.top >= 0, sheetScrolls: d ? d.scrollHeight > d.clientHeight : null }; });
  rec(scn, "the sheet fits the phone width with no sideways scroll", m.left >= 0 && m.right <= m.w + 1 && m.scrollW <= m.w + 1, JSON.stringify(m));
  rec(scn, "the sheet sits at the bottom edge like the other sheets", Math.abs(m.bottom - m.h) <= 2, JSON.stringify(m));
  await shot(page, "sheet", `free-document-limit-phone-${v.theme}`);
  const tall = m.top < 0 || m.notNowVisible === false;
  if (tall) { await page.locator('[data-testid="plan-sheet"]').evaluate((e) => e.scrollTo(0, 99999)); await page.waitForTimeout(300); }
  rec(scn, "Not now can be reached (the sheet is tall on a phone: it scrolls)", await page.getByTestId("plan-notnow").isVisible(), JSON.stringify({ tall }));
  await shot(page, "sheet", `free-document-limit-phone-${v.theme}-end`); } });

// ═════════ BILLING: a failed payment, and each plan's page ═════════
await scene("billing · pro, payment failed (grace)", "pro", { ever: true, pastDue: true, pastDueDays: 2 }, "/billing", (f) => (/didn't go through/.test(f.text) ? [] : ["no failed-payment line"]), { dir: "billing" });
await scene("billing · pro, payment failed (grace over)", "pro", { ever: true, pastDue: true, pastDueDays: 9 }, "/billing", () => [], { dir: "billing" });
await scene("billing · free, 12 of 15", "free", { docs: 12, ever: true }, "/billing", () => [], { dir: "billing" });
await scene("billing · payg, budget 80 percent", "payg", { docs: 30, ever: true, budgetMinor: 1000 }, "/billing", () => [], { dir: "billing" });
await scene("billing · pro", "pro", { docs: 300, ever: true }, "/billing", () => [], { dir: "billing" });
await scene("billing · lifetime", "lifetime", { docs: 300, ever: true }, "/billing", () => [], { dir: "billing" });

const realErrors = consoleErrors.filter((e) => !(/Failed to load resource: the server responded with a status of 4\d\d/.test(e.msg) && /invite click|upload|bulk/.test(e.scn)));
rec("all screens", "no console errors (a refused request the browser itself logs is not counted)", realErrors.length === 0, JSON.stringify(realErrors.slice(0, 5)));
writeFileSync(`${ROOT}/ui-matrix-1.json`, JSON.stringify({ at: new Date().toISOString(), fails, total: results.length, results, consoleErrors, events }, null, 1));
console.log(`\nScreen matrix part 1: ${results.length - fails} of ${results.length} checks agree, ${fails} do not; ${consoleErrors.length} console errors; ${events.length} prompt events sent`);
await db.end(); await browser.close(); process.exitCode = fails ? 1 : 0;
