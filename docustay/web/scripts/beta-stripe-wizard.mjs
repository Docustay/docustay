// BETA, STRIPE TEST MODE: the setup wizard end to end on a workspace with no Stripe account (WS.lifetime), the Needs attention screen it leaves behind, resume, Stripe's own page, and Disconnect.
// No onboarding form is filled in (the maintainer, 20 Oct): the run STOPS at Stripe's hosted page. The throwaway Stripe test account it makes is deleted at the end.
//   node scripts/beta-stripe-wizard.mjs [out-dir]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { BETA_WEB as BASE, WS, contextFor, call } from "./pm-lib.mjs";
const OUT = process.argv[2] ?? "/tmp/la/wiz"; mkdirSync(OUT, { recursive: true });
let fail = 0; const ok = (n, c, x = "") => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${c ? "" : "  " + x}`); };
const b = await chromium.launch(); const ctx = await contextFor(b, WS.lifetime, { base: BASE }); const A = "/api/product/docustay/payments";
// start clean: if an earlier run left a connection, disconnect it
const s0 = (await call(ctx, "GET", `${A}/account?fresh=1`)).data; if (s0?.account) { await call(ctx, "POST", `${A}/disconnect`, {}); }
const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(String(e))); p.on("console", (m) => { if (m.type() === "error" && !/status of 400/.test(m.text())) errs.push(m.text()); });
await p.goto(`${BASE}/billing?tab=payments`, { waitUntil: "load" }); await p.getByTestId("stripe-hero").waitFor({ timeout: 30000 });
ok("not connected: the hero offers Set up payments with the Powered by Stripe badge", (await p.getByTestId("stripe-setup").count()) === 1 && (await p.getByTestId("powered-by-stripe").count()) >= 1);
await p.screenshot({ path: `${OUT}/hero.png`, fullPage: true });
await p.getByTestId("stripe-setup").click(); await p.getByTestId("wizard-step-1").waitFor({ timeout: 20000 });
ok("step 1: what you will need, Safe by design, ribbon at step 1", /photo ID/.test(await p.getByTestId("wizard-step-1").innerText()) && (await p.getByTestId("wizard-ribbon").locator("li.cur").innerText()).includes("Before you start"));
await p.screenshot({ path: `${OUT}/step1.png`, fullPage: true });
await p.getByTestId("wizard-start").click(); await p.getByTestId("wizard-step-2").waitFor({ timeout: 20000 });
const pf = [await p.getByTestId("wizard-company").isChecked(), await p.getByTestId("wizard-name").inputValue(), await p.getByTestId("wizard-email").inputValue()];
ok("step 2: company is the default and the email and name are prefilled from the workspace", pf[0] && pf[1].length > 0 && /@/.test(pf[2]), JSON.stringify(pf));
// validation says what is wrong
await p.getByTestId("wizard-name").fill(""); await p.getByTestId("wizard-continue").click(); await p.getByTestId("wizard-problem").waitFor({ timeout: 20000 });
ok("step 2: an empty business name is refused in plain words", /business name/i.test(await p.getByTestId("wizard-problem").innerText()));
await p.getByTestId("wizard-name").fill("Docustay QA Test LLC"); await p.getByTestId("wizard-website").fill("docustay.app"); await p.getByTestId("wizard-purpose").selectOption("deposits");
ok("step 2: nothing asks for an SSN, ID, date of birth, address or bank number", !/ssn|social security|date of birth|routing|account number/i.test(await p.getByTestId("wizard-step-2").locator("label, legend, input").evaluateAll((els) => els.map((e) => (e.textContent ?? "") + (e.getAttribute("placeholder") ?? "")).join(" "))));
await p.screenshot({ path: `${OUT}/step2.png`, fullPage: true });
await p.getByTestId("wizard-continue").click(); await p.getByTestId("wizard-step-3").waitFor({ timeout: 60000 });
ok("step 3: Finish on Stripe's secure page, with what Stripe will ask for", /Stripe will ask for/.test(await p.getByTestId("wizard-step-3").innerText()));
await p.screenshot({ path: `${OUT}/step3.png`, fullPage: true });
const a1 = (await call(ctx, "GET", `${A}/account?fresh=1`)).data;
ok("the account was created at Stripe with the details as pre-fill (name and website arrive)", a1?.account && a1.panel?.business === "Docustay QA Test LLC" && /docustay\.app/.test(a1.panel?.website ?? ""), JSON.stringify(a1?.panel));
ok("the screen says Needs attention and lists what Stripe still needs in plain words", ["needs_attention", "verifying"].includes(a1?.status) && (a1.attention?.items?.length ?? 0) > 0, `${a1?.status} ${JSON.stringify(a1?.attention)}`);
ok("the wizard step and the non-sensitive details were saved on the server", a1?.wizard?.step === 3 && a1.wizard.details?.name === "Docustay QA Test LLC" && !JSON.stringify(a1.wizard).match(/ssn|dob|routing/i));
// resume: close and reopen
await p.goto(`${BASE}/billing/payments/setup`, { waitUntil: "load" }); await p.getByTestId("pay-wizard").waitFor({ timeout: 30000 }); await p.locator('[data-testid="pay-wizard"][data-step="3"]').waitFor({ timeout: 30000 }).catch(() => {});
ok("resume: reopening the wizard lands on step 3", (await p.getByTestId("pay-wizard").getAttribute("data-step")) === "3");
// Continue on Stripe reaches Stripe's hosted page, and stops
const nav = p.waitForURL(/connect\.stripe\.com/, { timeout: 60000 }).then(() => true).catch(() => false);
await p.getByTestId("wizard-to-stripe").click(); ok("Continue on Stripe opens Stripe's own page (and the run stops there)", await nav, p.url());
await p.screenshot({ path: `${OUT}/stripe-page.png` });
// back in Docustay (as if Stripe's return address was used): the screen shows Needs attention with a banner
await p.goto(`${BASE}/billing?tab=payments&payments=needs_info`, { waitUntil: "load" }); await p.getByTestId("stripe-account").waitFor({ timeout: 30000 });
await p.getByTestId("stripe-banner").waitFor({ timeout: 30000 }); ok("back from Stripe: a Needs attention banner with the list and Continue on Stripe", (await p.getByTestId("stripe-needs").count()) === 1 && (await p.getByTestId("stripe-continue").count()) === 1);
ok("the return message is shown once and the address is cleaned", (await p.getByTestId("payments-note").count()) === 1 && !/payments=/.test(p.url()));
await p.screenshot({ path: `${OUT}/needs-attention.png`, fullPage: true });
const dk = await ctx.newPage(); await dk.emulateMedia({ colorScheme: "dark" }); await dk.goto(`${BASE}/billing?tab=payments`, { waitUntil: "load" }); await dk.getByTestId("stripe-banner").waitFor({ timeout: 30000 }); await dk.screenshot({ path: `${OUT}/needs-attention-dark.png`, fullPage: true });
const ph = await ctx.newPage(); await ph.setViewportSize({ width: 390, height: 844 }); await ph.goto(`${BASE}/billing/payments/setup`, { waitUntil: "load" }); await ph.getByTestId("pay-wizard").waitFor({ timeout: 30000 });
ok("phone: the wizard has no sideways scroll", await ph.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)); await ph.screenshot({ path: `${OUT}/wizard-phone.png`, fullPage: true });
// Disconnect: confirmation text, then Disconnected with a way back
await p.getByTestId("payments-disconnect").click(); await p.locator('[data-scope="dialog"] button').filter({ hasText: "Disconnect Stripe" }).click(); await p.getByTestId("stripe-hero").waitFor({ timeout: 30000 });
const a2 = (await call(ctx, "GET", `${A}/account?fresh=1`)).data;
ok("Disconnect: the screen says Disconnected, offers Reconnect, and the account id is gone", a2?.status === "disconnected" && a2.account == null && /Reconnect/.test(await p.getByTestId("stripe-setup").innerText()), a2?.status);
await p.screenshot({ path: `${OUT}/disconnected.png`, fullPage: true });
ok("no console or page errors", errs.length === 0, errs.slice(0, 3).join(" | "));
// delete the throwaway Stripe test account
const acct = a1?.account?.id; if (acct) { const kv = spawnSync("railway", ["variables", "--service", "sandbox-app", "--project", "00000000-0000-4000-8000-00000000000a", "--environment", "sandbox-beta", "--kv"], { encoding: "utf8", env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "RAILWAY_TOKEN")) }).stdout ?? ""; const SK = (kv.split("\n").find((l) => l.startsWith("KEYSTONE_DOCUSTAY_STRIPE_SECRET_KEY=")) ?? "").split("=")[1]; if (/^sk_test_/.test(SK ?? "")) { const r = await fetch(`https://api.stripe.com/v1/accounts/${acct}`, { method: "DELETE", headers: { authorization: `Bearer ${SK}` } }); console.log("cleanup: test account deleted:", r.status === 200); } }
console.log(fail ? `FAILED ${fail}` : "ALL PASS"); await b.close(); process.exit(fail ? 1 : 0);
