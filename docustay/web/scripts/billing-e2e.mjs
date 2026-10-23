// BILLING PAGE (Option B) end to end, every state, light / dark / phone. The server's answers (status, billing details, AI usage) are stood in for with page.route, built from the REAL price list and plan cards
// (billing-fixtures.mjs), so every number on the screen is compared with the list, and every state (even "payment failed" or "card expired") is exact and costs no money. The web app, the sign-in and the rest of
// the API are the real ones at --base (the beta web, or a local dev server pointed at the beta API). Screenshots of every state go to --out.
//   node scripts/billing-e2e.mjs --base https://host.example.com --out ~/keystone/specs/v1/design-review/beta-proof/billing [--scheme dark] [--width 390]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { BETA_WEB, WS, contextFor } from "./pm-lib.mjs";
import { STATES, status, details, ai, PRICES, CARDS } from "./billing-fixtures.mjs";
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg("--base", BETA_WEB), SCHEME = arg("--scheme", "light"), WIDTH = Number(arg("--width", 1440));
const OUT = arg("--out", "/tmp/billing-e2e"); mkdirSync(OUT, { recursive: true });
const TAG = `${SCHEME}${WIDTH < 700 ? "-phone" : ""}`;
let pass = 0, fail = 0; const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const money = (m) => `$${Number.isInteger(m / 100) ? m / 100 : (m / 100).toFixed(2)}`;
const browser = await chromium.launch();
const ctx = await contextFor(browser, WS.pro, { base: BASE, width: WIDTH, height: WIDTH < 700 ? 844 : 900, colorScheme: SCHEME });
if (SCHEME === "dark") await ctx.addCookies([{ name: "docustay-theme", value: "dark", url: BASE }]);
const page = await ctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200))); page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|favicon|net::ERR/.test(m.text())) errors.push(m.text().slice(0, 200)); });
const snap = async (path) => {   // the app scrolls inside its main column, so a "full page" shot is the viewport grown to the column's height
  const h = await page.evaluate(() => { const m = document.querySelector("[data-scroll-main]"); return m ? Math.ceil(m.scrollHeight + m.getBoundingClientRect().top) : document.documentElement.scrollHeight; });
  const vp = page.viewportSize(); await page.setViewportSize({ width: vp.width, height: Math.min(4200, Math.max(vp.height, h + 8)) }); await page.waitForTimeout(250);
  await page.screenshot({ path }); await page.setViewportSize(vp);
};
const json = (b, s = 200) => ({ status: s, contentType: "application/json", body: JSON.stringify(b) });
let calls = [];
async function mock(st, det, aiu, extra = {}) {
  await page.unrouteAll({ behavior: "ignoreErrors" }); calls = [];
  await page.route("**/api/product/docustay/status", (r) => r.fulfill(json(st)));
  await page.route("**/api/product/docustay/billing-details", (r) => r.fulfill(json(det)));
  await page.route("**/api/documents/ai/usage", (r) => r.fulfill(json(aiu)));
  await page.route("**/api/product/docustay/billing-email", (r) => r.fulfill(json({ email: extra.billingEmail ?? null })));
  for (const [pat, fn] of Object.entries(extra.routes ?? {})) await page.route(pat, async (r) => { calls.push({ url: r.request().url(), method: r.request().method(), body: r.request().postData() }); await fn(r); });
}
const open = async (path = "/billing") => { await page.goto(`${BASE}${path}`, { waitUntil: "load", timeout: 60000 }); await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {}); };
const txt = async (sel) => ((await page.locator(sel).first().textContent({ timeout: 4000 }).catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
const has = async (id) => (await page.getByTestId(id).count()) > 0;
const noSideScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const SHORT = { free: "free", payg: "payg", pro: "pro", lifetime: "lifetime" };
const rowCell = async (label, short) => {   // a cell of the comparison table (desktop) or the plan's card (phone)
  if (WIDTH < 720 && label === "Price") return ((await page.locator(`[data-testid="plan-${short}"] summary .pr`).first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();   // on a phone the price sits in the card's summary
  if (WIDTH < 720) return ((await page.locator(`[data-testid="plan-${short}"] dl > div`).filter({ hasText: label }).first().locator("dd").textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
  const idx = ["free", "payg", "pro", "lifetime"].indexOf(short) + 1;
  return ((await page.locator("table.cmp tbody tr").filter({ has: page.locator("th", { hasText: new RegExp(`^${label}$`) }) }).first().locator("td").nth(idx - 1).textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
};

// ── every state: renders, the right plan is marked, the numbers equal the list ─────────────────────────────────────────────────────
for (const [name, [plan, so, dopt, aopt]] of Object.entries(STATES)) {
  const st = status(plan, so), det = details(plan, dopt), aiu = ai(plan, aopt);
  await mock(st, det, aiu); await open();
  const lab = `[${name}]`;
  await page.getByTestId("billing-plan-tab").waitFor({ timeout: 20000 }).catch(() => {});
  ok(`${lab} the Plan tab renders with its panels`, (await has("billing-strip")) && (await has("billing-usage")) && (await has("billing-plans")));
  ok(`${lab} no sideways scroll`, await noSideScroll());
  { const w = (await txt("[data-testid=billing-charge-words]")); const eff = plan === "free" || so.ended ? "free" : plan;
    ok(`${lab} says signers are never charged and team documents count like any other`, /signers are never charged/.test(w) && /count toward your monthly documents like any other/.test(w));
    ok(`${lab} person charging words match the plan (${eff})`, eff === "payg" ? new RegExp(`${money(PRICES.payg.personMonthlyMinor).replace("$", "\\$")} a month for each Owner, Admin and Member who has joined`).test(w) && /has not been accepted is not charged/.test(w) && /once a day, after an invitation is accepted/.test(w) : eff === "free" ? /Free is for one person\. An invitation that has not been accepted yet counts as that person/.test(w) && !/a month for each/.test(w) : !/for each Owner, Admin and Member/.test(w) && !/counts as that person/.test(w)); }
  const cur = plan === "free" && so.ended ? "free" : plan;
  ok(`${lab} the plan panel names ${CARDS.find((p) => p.key === `docustay_${plan}`).name} with a "Your plan" tag`, (await txt("[data-testid=billing-plan-name]")).startsWith(CARDS.find((p) => p.key === `docustay_${plan}`).name) && (await txt("[data-testid=billing-your-plan-tag]")) === "Your plan");
  ok(`${lab} the comparison marks exactly ${cur} as the current plan`, (await page.locator("[data-current=true]").count()) >= 1 && (await page.locator(`[data-testid=plan-${cur}][data-current=true]`).count()) === 1 && (await page.locator("[data-current=true]").count()) === 1, `marked=${await page.locator("[data-current=true]").count()}`);
  // numbers equal the price list
  const free = PRICES.free, payg = PRICES.payg, p = PRICES.pro, life = PRICES.lifetime;
  const want = { free: { Price: money(0), "Documents each month": String(free.docsIncluded), "AI drafts each month": String(free.draftsIncluded), "New templates": String(free.templatesPerMonth), "Fee on payments": `${free.feeBps / 100}%` },
    payg: { Price: money(payg.personMonthlyMinor), "Documents each month": `${payg.docsIncluded} included, then ${money(payg.docOverMinor)} each`, "AI drafts each month": `${payg.draftsIncluded} included, then ${money(payg.draftOverMinor)} each`, "New templates": "Unlimited", People: "Unlimited", "Fee on payments": `${payg.feeBps / 100}%` },
    pro: { Price: money(p.foundersMonthlyMinor), "Documents each month": "Unlimited", "AI drafts each month": `${p.draftsIncluded} included, then ${money(p.draftOverMinor)} each`, "New templates": "Unlimited", "Fee on payments": "0%" },
    lifetime: { Price: money(life.oneTimeMinor), "Documents each month": "Unlimited", "AI drafts each month": `${life.draftsIncluded} included, then ${money(life.draftOverMinor)} each`, "New templates": "Unlimited", "Fee on payments": "0%" } };
  if (name === "free" || name === "pro-founder") for (const short of ["free", "payg", "pro", "lifetime"]) for (const [row, v] of Object.entries(want[short])) {
    const got = await rowCell(row, short);
    ok(`${lab} ${short} · ${row} = ${v}`, got.startsWith(v), `got "${got}"`);
  }
  if (name === "free") { ok(`${lab} Free people is 1 person`, (await rowCell("People", "free")).startsWith("1 person")); ok(`${lab} own plays: Free no, Pro yes, Lifetime yes`, /Not included/.test(await rowCell("Your own plays and playbooks", "free")) && /Included/.test(await rowCell("Your own plays and playbooks", "pro")) && /Included/.test(await rowCell("Your own plays and playbooks", "lifetime"))); }
  // actions: no "Choose Free"
  ok(`${lab} there is no "Choose Free" anywhere`, (await page.getByRole("button", { name: /Choose Free/i }).count()) === 0 && (await page.getByText(/Choose Free/i).count()) === 0);
  const isFree = plan === "free" && !so.ended || (plan === "free" && so.ended === "cancelled");
  const canBuy = isFree && so.ended !== "payment";
  for (const k of ["payg", "pro", "lifetime"]) ok(`${lab} buy-${k} is ${canBuy ? "offered" : "not offered"}`, (await has(`buy-${k}`)) === canBuy);
  ok(`${lab} the switch action is ${["pro", "payg"].includes(plan) && !so.cancelsAt ? "offered" : "not offered"}`, (await has("billing-switch-open")) === (["pro", "payg"].includes(plan) && !so.cancelsAt));
  ok(`${lab} Cancel ${["pro", "payg"].includes(plan) && !so.cancelsAt ? "is offered" : "is not offered"}`, (await has("billing-cancel")) === (["pro", "payg"].includes(plan) && !so.cancelsAt));
  // what each state must show
  if (name === "free") { ok(`${lab} "You're on Free. Resets on …"`, /You're on Free\. Resets on/.test(await txt("[data-testid=billing-on-free]"))); ok(`${lab} no spend or budget block on Free`, !(await has("billing-budget")) && !(await has("billing-spend"))); }
  if (name === "payg") { ok(`${lab} seats line`, /3 of 1 included seats are in use\./.test(await txt("[data-testid=billing-people]")) && /Each extra seat is \$5 a month\./.test(await txt("[data-testid=billing-people]"))); ok(`${lab} spend meter with notches at the alert percents`, (await page.locator("[data-testid=billing-spend] .notch").count()) === PRICES.budget.alertPercents.length - 1); ok(`${lab} the alert sentence carries the percents and the early-invoice amount`, new RegExp(`${PRICES.budget.alertPercents[0]}%, ${PRICES.budget.alertPercents[1]}% and ${PRICES.budget.alertPercents[2]}%`).test(await txt("[data-testid=billing-budget]")) && (await txt("[data-testid=billing-budget]")).includes(money(PRICES.budget.earlyInvoiceMinor))); ok(`${lab} "So far" line`, /So far: \$18\.50/.test(await txt("[data-testid=billing-bill-so-far]"))); }
  if (name.startsWith("pro-")) { ok(`${lab} next payment, card and saved fees are shown`, /\$\d/.test(await txt("[data-testid=billing-next]")) && /Visa •••• 4242 · 08\/\d\d/.test(await txt("[data-testid=billing-card]")) && /\$12\.40/.test(await txt("[data-testid=billing-saved]"))); ok(`${lab} the billing-portal link is there`, await has("billing-portal")); }
  if (name === "pro-founder") ok(`${lab} founder line`, /Thanks for being a founder/.test(await txt("[data-testid=billing-on-pro]")) && /Founders price, kept for the life of your subscription/.test(await txt("[data-testid=billing-strip]")));
  if (name === "pro-regular") ok(`${lab} regular Pro has no founder line`, /You're on Pro\./.test(await txt("[data-testid=billing-on-pro]")) && !/founder/i.test(await txt("[data-testid=billing-on-pro]")));
  if (name === "lifetime") { ok(`${lab} Lifetime line and nothing to renew`, /One payment, nothing to renew/.test(await txt("[data-testid=billing-on-pro]")) && /Nothing to renew/.test(await txt("[data-testid=billing-next]"))); ok(`${lab} no card row, no billing email, no cancel for Lifetime`, !(await has("billing-card")) && !(await has("billing-email-box")) && !(await has("billing-cancel"))); }
  if (name === "cancelled-running") { ok(`${lab} "Pro ends on …" with Resume`, /Pro ends on/.test(await txt("[data-testid=billing-cancelled]")) && (await has("billing-resume"))); ok(`${lab} "Plan ends" fact`, /Plan ends/.test(await txt("[data-testid=billing-strip]"))); }
  if (name === "ended") ok(`${lab} "Your Pro subscription has ended. You can start it again at any time."`, (await has("billing-ended")) && (await has("buy-pro")));
  if (name.startsWith("payment-failed") || name === "payment-ended") { ok(`${lab} "Your last payment didn't go through." with Update card`, /Your last payment didn't go through\./.test(await txt("[data-testid=billing-failed]")) && (name === "payment-ended" ? true : await has("billing-update-card"))); }
  if (name === "payment-failed") ok(`${lab} the card says Declined (not Expired)`, /Declined/.test(await txt("[data-testid=billing-strip]")) && !/Card expired/.test(await txt("[data-testid=billing-strip]")));
  if (name === "card-expired" || name === "payment-failed-expired-card") ok(`${lab} the card says Card expired`, /Card expired/.test(await txt("[data-testid=billing-strip]")), await txt("[data-testid=billing-strip]"));
  if (name === "no-card") ok(`${lab} no card on file: a dash and the portal link`, (await txt("[data-testid=billing-card]")) === "—" && (await has("billing-portal")));
  if (name === "budget-paused") { ok(`${lab} paused alert at the top with Raise the budget`, /paused because this month's usage reached your \$50 budget/.test(await txt("[data-testid=billing-paused]"))); ok(`${lab} the budget button reads Raise the budget`, (await txt("[data-testid=billing-budget-save]")) === "Raise the budget"); ok(`${lab} the spend bar is full and red`, (await page.locator("[data-testid=billing-spend] .fill.bad").count()) === 1); }
  if (name === "own-key") ok(`${lab} own provider key note`, /Using your own provider key/.test(await txt("[data-testid=billing-usage]")));
  ok(`${lab} the animating 3D pieces are at most five`, (await page.evaluate(() => [...document.querySelectorAll(".pp .stage")].filter((s) => getComputedStyle(s).animationName !== "none").length)) <= 5);
  await snap(`${OUT}/${name}-${TAG}.png`);
}

// ── reduced motion: the pieces stand still ───────────────────────────────────────────────────────────────────────────────────────
{ await mock(status("pro", { founders: true }), details("pro"), ai("pro")); await page.emulateMedia({ reducedMotion: "reduce" }); await open();
  ok("reduced motion: every plan piece stands still", (await page.evaluate(() => [...document.querySelectorAll(".pp .stage")].every((s) => getComputedStyle(s).animationName === "none"))));
  await page.emulateMedia({ reducedMotion: "no-preference" }); await open();
  ok("motion allowed: the current plan's piece turns", (await page.evaluate(() => getComputedStyle(document.querySelector("[data-testid=plan-piece-current] .stage")).animationName)) !== "none"); }

// ── the two switch dialogs, and the switch itself ───────────────────────────────────────────────────────────────────────────────
for (const [from, to, title] of [["pro", "payg", "Switch to Pay as you go?"], ["payg", "pro", "Switch to Pro?"]]) {
  const next = status(to, to === "pro" ? { founders: true } : {}), routes = { "**/api/product/docustay/switch-plan": (r) => r.fulfill(json(next)) };
  await mock(status(from, from === "pro" ? { founders: true } : {}), details(from), ai(from), { routes }); await open();
  await page.getByTestId("billing-switch-open").click(); const dlg = page.getByTestId("billing-switch"); await dlg.waitFor({ timeout: 8000 });
  const body = (await dlg.textContent()).replace(/\s+/g, " ");
  ok(`switch ${from} → ${to}: the dialog is titled "${title}"`, body.includes(title));
  ok(`switch ${from} → ${to}: it says the truth (starts today, fresh allowance, invoiced now, no refund)`, /starts today and your allowance starts fresh/.test(body) && /does not give refunds/.test(body) && !/prorat/i.test(body));
  if (to === "pro") ok(`switch → Pro: the dialog names Pro's price from the payload`, body.includes(`Pro would be ${money(PRICES.pro.foundersMonthlyMinor)} a month`));
  else ok("switch → Pay as you go: the dialog lists its included amounts from the list", body.includes(`${PRICES.payg.docsIncluded} documents each billing month`) && body.includes(money(PRICES.payg.docOverMinor)));
  await snap(`${OUT}/switch-${from}-to-${to}-${TAG}.png`);
  await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  ok(`switch ${from} → ${to}: Esc closes it and nothing was sent`, (await dlg.count()) === 0 && calls.length === 0);
  await page.getByTestId("billing-switch-open").click(); await dlg.waitFor(); await page.getByTestId("billing-switch-confirm").click(); await page.waitForTimeout(900);
  ok(`switch ${from} → ${to}: Switch now sends one switch-plan request with the plan`, calls.length === 1 && JSON.parse(calls[0].body).plan === to, JSON.stringify(calls));
}

// ── checkout: confirming, confirmed (Welcome), expired, failed ──────────────────────────────────────────────────────────────────
{ let n = 0; const paid = status("pro", { founders: true });
  await mock(status("free"), details("free"), ai("free"), { routes: { "**/api/product/docustay/checkout/confirm": (r) => r.fulfill(json(++n < 3 ? { confirmed: false, status: "waiting" } : { confirmed: true, status: "pro" })) } });
  await open("/billing?upgrade=success&session=cs_test_1");
  await page.getByTestId("billing-confirming").waitFor({ timeout: 10000 });
  ok("checkout: Confirming your payment", /Pro switches on as soon as Stripe confirms the payment/.test(await txt("[data-testid=billing-confirming]")));
  await snap(`${OUT}/checkout-confirming-${TAG}.png`);
  await page.route("**/api/product/docustay/status", (r) => r.fulfill(json(paid)));
  await page.getByTestId("billing-welcome").waitFor({ timeout: 20000 });
  ok("checkout: Welcome to Pro, with the piece and what it switches on", /Welcome to Pro/.test(await txt("[data-testid=billing-welcome]")) && (await has("welcome-piece")) && /Unlimited documents and templates/.test(await txt("[data-testid=billing-welcome]")));
  await snap(`${OUT}/checkout-welcome-${TAG}.png`); }
{ await mock(status("free"), details("free"), ai("free"), { routes: { "**/api/product/docustay/checkout/confirm": (r) => r.fulfill(json({ confirmed: false, status: "expired" })) } });
  await open("/billing?upgrade=success&session=cs_test_2"); await page.getByTestId("billing-problem").waitFor({ timeout: 15000 });
  ok("checkout: expired says nothing was charged", /expired before it was paid\. Nothing was charged\./.test(await txt("[data-testid=billing-problem]"))); await snap(`${OUT}/checkout-expired-${TAG}.png`); }
{ await mock(status("free"), details("free"), ai("free"), { routes: { "**/api/product/docustay/checkout/confirm": (r) => r.fulfill(json({ error: { message: "That checkout could not be confirmed." } }, 400)) } });
  await open("/billing?upgrade=success&session=cs_test_3"); await page.getByTestId("billing-problem").waitFor({ timeout: 15000 });
  ok("checkout: failed says it could not be confirmed", /could not be confirmed/.test(await txt("[data-testid=billing-problem]"))); await snap(`${OUT}/checkout-failed-${TAG}.png`); }
{ await mock(status("free"), details("free"), ai("free"), { routes: { "**/api/product/docustay/checkout/confirm": (r) => r.fulfill(json({ confirmed: false, status: "waiting" })) } });
  await open("/billing?upgrade=success&session=cs_test_4"); await page.getByTestId("billing-confirming").waitFor({ timeout: 10000 }); await page.waitForTimeout(23000);
  ok("checkout: after 20 seconds the words change", /taking longer than usual/.test(await txt("[data-testid=billing-confirming]"))); await snap(`${OUT}/checkout-slow-${TAG}.png`); }

// ── self-host (no plan): nothing to bill ────────────────────────────────────────────────────────────────────────────────────────
{ await mock({ demo: null, workspace: true, plan: null }, details("free"), ai("free")); await open();
  ok("no plan: 'This workspace has no plan or charges, so there is nothing to bill.'", await has("billing-noplan")); await snap(`${OUT}/no-plan-${TAG}.png`); }

// ── invoices: every status, empty, earlier invoices unavailable ────────────────────────────────────────────────────────────────
{ await mock(status("pro", { founders: true }), details("pro"), ai("pro")); await open("/billing?tab=invoices"); await page.getByTestId("billing-invoices").waitFor({ timeout: 15000 });
  const rows = await page.getByTestId("invoice-row").allTextContents();
  ok("invoices: four rows, each with a dot-and-word status (Paid, Due, Void, Declined)", rows.length === 4 && ["Paid", "Due", "Void", "Declined"].every((w) => rows.some((r) => r.includes(w))), JSON.stringify(rows));
  ok("invoices: a Download PDF link on every row", (await page.getByTestId("invoice-pdf").count()) === 4);
  ok("invoices: the Plan tab content is not drawn on the Invoices tab", !(await has("billing-plans")));
  await snap(`${OUT}/invoices-${TAG}.png`); }
{ await mock(status("free"), details("free"), ai("free")); await open("/billing?tab=invoices"); await page.getByTestId("billing-no-invoices").waitFor({ timeout: 15000 });
  ok("invoices: the empty state words and piece", /No invoices yet\. They appear here once you're on a paid plan\./.test(await txt("[data-testid=billing-no-invoices]")) && (await has("invoices-piece"))); await snap(`${OUT}/invoices-empty-${TAG}.png`); }
{ await mock(status("pro", {}), details("pro", { stale: true, invoices: [] }), ai("pro")); await open("/billing?tab=invoices"); await page.getByTestId("billing-stale").waitFor({ timeout: 15000 });
  ok("invoices: earlier invoices not available", /earlier invoices are not available here/.test(await txt("[data-testid=billing-stale]"))); await snap(`${OUT}/invoices-stale-${TAG}.png`); }

// ── Payments tab: still there, same tab style ───────────────────────────────────────────────────────────────────────────────────
{ await mock(status("pro", { founders: true }), details("pro"), ai("pro")); await open("/billing?tab=payments"); await page.getByTestId("payments-strip").waitFor({ timeout: 20000 }).catch(() => {});
  ok("payments: the tab opens and shows this month's strip", await has("payments-strip")); await snap(`${OUT}/payments-${TAG}.png`); }

// ── cancel and cancelled pages ───────────────────────────────────────────────────────────────────────────────────────────────────
{ await mock(status("pro", { founders: true }), details("pro"), ai("pro"), { routes: { "**/api/product/docustay/cancel/prepare": (r) => r.fulfill(json({ token: "t1", at: new Date().toISOString(), notBefore: new Date().toISOString() })) } });
  await open("/billing/cancel"); await page.getByTestId("cancel-page").waitFor({ timeout: 20000 });
  ok("cancel page: the piece, what you keep, what changes, no refunds", (await has("cancel-piece")) && (await has("cancel-no-refunds")) && /What changes after that/.test(await txt("[data-testid=cancel-page]")));
  ok("cancel page: no sideways scroll", await noSideScroll()); await snap(`${OUT}/cancel-${TAG}.png`);
  await mock(status("pro", { founders: true, cancelsAt: true }), details("pro", { cancelsAt: true }), ai("pro")); await open("/billing/cancelled"); await page.getByTestId("cancelled-page").waitFor({ timeout: 20000 });
  ok("cancelled page: stays on until the date, with Resume", /stays on until/.test(await txt("[data-testid=cancelled-page]")) && (await has("cancelled-resume"))); await snap(`${OUT}/cancelled-${TAG}.png`); }

// ── keyboard: the whole page is reachable and the dialog is a proper dialog ───────────────────────────────────────────────────────
{ await mock(status("pro", { founders: true }), details("pro"), ai("pro")); await open(); await page.getByTestId("billing-switch-open").focus();
  await page.keyboard.press("Enter"); await page.getByTestId("billing-switch").waitFor({ timeout: 6000 });
  const focusInside = await page.evaluate(() => document.querySelector("[data-testid=billing-switch]")?.contains(document.activeElement));
  ok("keyboard: Enter opens the switch dialog and focus moves into it", focusInside === true);
  await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  ok("keyboard: Esc closes it and focus goes back to the Switch button", await page.evaluate(() => document.activeElement?.getAttribute("data-testid") === "billing-switch-open"));
  // screen reader: names and roles
  if (WIDTH < 720) ok("screen reader: each plan is a disclosure with a summary (name, price) and its facts as a list of terms", (await page.locator("details[data-testid^=plan-]").count()) === 4 && (await page.locator("details[data-testid^=plan-] > summary").count()) === 4 && (await page.locator("details[data-testid^=plan-] dl dt").count()) >= 24);
  else ok("screen reader: the table has a caption, column headers with scope and row headers", (await page.locator("table.cmp caption").count()) === 1 && (await page.locator("table.cmp thead th[scope=col]").count()) === 4 && (await page.locator("table.cmp tbody th[scope=row]").count()) >= 7);
  ok("screen reader: the spend meter is a progressbar with a value and words", await page.evaluate(() => { const b = document.querySelector("[data-testid=billing-spend] [role=progressbar]"); return b && b.getAttribute("aria-valuenow") !== null && /budget/.test(b.getAttribute("aria-valuetext") ?? ""); }));
  ok("screen reader: the 3D pieces are hidden from assistive technology", await page.evaluate(() => [...document.querySelectorAll(".pp")].every((e) => e.getAttribute("aria-hidden") === "true")));
  const tabs = []; for (let i = 0; i < 140 && !(tabs.includes("billing-cancel")); i++) { await page.keyboard.press("Tab"); tabs.push(await page.evaluate(() => document.activeElement?.getAttribute("data-testid") || document.activeElement?.tagName)); }
  ok("keyboard: Tab reaches the compare actions, the budget box and the cancel link, in page order", ["billing-budget-input", "billing-cancel"].every((id) => tabs.includes(id)) && tabs.indexOf("billing-budget-input") < tabs.indexOf("billing-cancel"), tabs.slice(-12).join(",")); }

ok("no page errors or console errors on the way", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(`\n${pass} pass, ${fail} fail (${TAG})`); await browser.close(); process.exit(fail ? 1 : 0);
