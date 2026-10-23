// PRODUCTION LIGHT SMOKE for the Your Stripe account screen and the setup wizard (21 Oct 2026): throwaway workspace trtheking97+smoke1 ONLY. Opens Billing > Payments, walks the wizard, "Set up payments" creates one LIVE connected account (no details of anyone entered),
// the browser reaches Stripe's hosted page and STOPS, then Docustay disconnects (the empty live account cannot be deleted by API; the maintainer removes it). No live charge, nothing typed into Stripe.
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import { code as emailCode } from "./pm-lib.mjs";
const BASE = "https://app.docustay.app"; const EM = process.argv[2] ?? "trtheking97+smoke1@gmail.com";
let pass = 0, fail = 0; const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
let SK; for (let i = 0; i < 4 && !SK; i++) { const kv = spawnSync("railway", ["variables", "--service", "keystone-app", "--project", "00000000-0000-4000-8000-00000000000a", "--environment", "production", "--kv"], { encoding: "utf8", env: { ...process.env, RAILWAY_TOKEN: undefined } }).stdout ?? ""; SK = (kv.split("\n").find((l) => l.startsWith("KEYSTONE_DOCUSTAY_STRIPE_SECRET_KEY=")) ?? "").split("=")[1]; }
ok("live Stripe key present (not printed)", /^sk_live_/.test(SK ?? "")); if (!SK) process.exit(2);
const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(String(e))); p.on("console", (m) => { if (m.type() === "error" && !/status of 400/.test(m.text())) errs.push(m.text()); });
const api = (m, path, b) => p.evaluate(async ([m, path, b]) => { const r = await fetch(path, { method: m, headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; }, [m, path, b]);
await p.goto(`${BASE}/login`, { waitUntil: "load" }); try { await p.getByRole("button", { name: "Decline" }).click({ timeout: 2500 }); } catch {}
const t0 = Math.floor(Date.now() / 1000);
await p.getByRole("textbox", { name: "Email" }).fill(EM); await p.getByTestId("login-continue").click().catch(() => {}); await p.waitForTimeout(2500);
if (!(await p.locator("input").first().isVisible().catch(() => false)) || (await p.locator("input[type=password]").count())) { const b = p.getByRole("button", { name: /sign-in code|code instead/i }); if (await b.count()) await b.first().click(); }
const needSignup = !(await p.locator("input").first().isVisible().catch(() => false));
if (needSignup) { await p.goto(`${BASE}/signup`); await p.getByRole("textbox", { name: "Email" }).fill(EM); await p.locator("input[type=checkbox]").first().check(); await p.getByRole("button", { name: "Email me a code" }).click(); }
await p.locator("input").first().click(); await p.keyboard.type(emailCode(EM, t0)); await p.waitForURL(/\/documents/, { timeout: 90000 }); ok("signed in on production (throwaway workspace)", true);
errs.length = 0;   // the signed-out login page makes one expected 401 (/api/account/profile)
let st = (await api("GET", "/api/product/docustay/payments")).json; console.log("  payments before:", JSON.stringify({ state: st?.state, mode: st?.mode, oauth: st?.oauthAvailable }));
ok("production Stripe is LIVE mode and OAuth is offered", st?.mode === "live" && st?.oauthAvailable === true);
ok("production Stripe is LIVE mode", st?.mode === "live");
const A = "/api/product/docustay/payments";
const a0 = (await api("GET", `${A}/account?fresh=1`)).json; if (a0?.account) { console.log("  leftover connection on the throwaway workspace: disconnecting first"); await api("POST", `${A}/disconnect`, {}); }
await p.goto(`${BASE}/billing?tab=payments`, { waitUntil: "load" }); await p.getByTestId("stripe-hero").waitFor({ timeout: 45000 });
ok("Billing > Payments: the hero offers Set up payments with the Powered by Stripe badge", (await p.getByTestId("stripe-setup").count()) === 1 && (await p.getByTestId("powered-by-stripe").count()) >= 1);
ok("no test-mode banner on production", (await p.getByText("Stripe's test mode").count()) === 0);
await p.screenshot({ path: "/tmp/la/prod-wiz-hero.png", fullPage: true });
await p.getByTestId("stripe-setup").click(); await p.getByTestId("wizard-step-1").waitFor({ timeout: 30000 });
ok("wizard step 1 shows what you will need", /photo ID/.test(await p.getByTestId("wizard-step-1").innerText()));
await p.getByTestId("wizard-start").click(); await p.getByTestId("wizard-step-2").waitFor({ timeout: 30000 });
const pf = [await p.getByTestId("wizard-name").inputValue(), await p.getByTestId("wizard-email").inputValue()]; ok("step 2: the business name and email are prefilled", pf[0].length > 0 && /@/.test(pf[1]));
await p.getByTestId("wizard-name").fill("Docustay Smoke Test"); await p.getByTestId("wizard-website").fill("docustay.app");
await p.getByTestId("wizard-continue").click(); await p.getByTestId("wizard-step-3").waitFor({ timeout: 60000 });
const a1 = (await api("GET", `${A}/account?fresh=1`)).json; const acct = a1?.account?.id ?? null; console.log("  live connected account created:", acct ? acct.slice(0, 9) + "…" : "none");
ok("a LIVE connected account exists, name and website arrived at Stripe", Boolean(acct) && a1.panel?.business === "Docustay Smoke Test", JSON.stringify(a1?.panel));
ok("the screen says Needs attention with what Stripe still needs", ["needs_attention", "verifying"].includes(a1?.status) && (a1.attention?.items?.length ?? 0) > 0, a1?.status);
const nav = p.waitForURL(/connect\.stripe\.com/, { timeout: 60000 }).then(() => true).catch(() => false);
await p.getByTestId("wizard-to-stripe").click(); ok("Continue on Stripe reaches Stripe's live page (STOP: nothing typed there)", await nav, p.url()); await p.screenshot({ path: "/tmp/la/prod-wiz-stripe.png" });
await p.goto(`${BASE}/billing?tab=payments`, { waitUntil: "load" }); await p.getByTestId("stripe-banner").waitFor({ timeout: 45000 });
ok("back in Docustay: the Needs attention banner and Continue on Stripe", (await p.getByTestId("stripe-continue").count()) === 1); await p.screenshot({ path: "/tmp/la/prod-wiz-needs.png", fullPage: true });
await p.goto(`${BASE}/settings`, { waitUntil: "load" }); await p.waitForTimeout(1500);
const rd = await api("POST", `${A}/disconnect`, {}); ok("Disconnect works and the account id is gone", rd.status === 200 && (await api("GET", `${A}/account?fresh=1`)).json?.account == null, String(rd.status));
// Stripe refuses to delete a LIVE full-dashboard connected account through the API (400), so the empty account stays at Stripe until the maintainer removes it (TY-ONLY.md).
ok("no console or page errors", errs.length === 0, errs.slice(0, 3).join(" | "));
console.log(`${pass} pass, ${fail} fail`); await browser.close(); process.exit(fail ? 1 : 0);
