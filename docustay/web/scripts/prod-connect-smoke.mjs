// PRODUCTION LIGHT SMOKE for Stripe Connect (21 Oct 2026): a throwaway workspace; "Set up payments" creates one LIVE connected account, read back from the API; the browser reaches Stripe's hosted page and STOPS (nothing entered);
// "Connect my existing Stripe account" reaches Stripe's live authorize page and STOPS (nothing authorised). Then the empty connected account is deleted. No live charge.
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import { code as emailCode } from "./pm-lib.mjs";
const BASE = "https://app.docustay.app"; const EM = process.argv[2] ?? "trtheking97+smoke1@gmail.com";
let pass = 0, fail = 0; const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
let SK; for (let i = 0; i < 4 && !SK; i++) { const kv = spawnSync("railway", ["variables", "--service", "keystone-app", "--project", "00000000-0000-4000-8000-00000000000a", "--environment", "production", "--kv"], { encoding: "utf8", env: { ...process.env, RAILWAY_TOKEN: undefined } }).stdout ?? ""; SK = (kv.split("\n").find((l) => l.startsWith("KEYSTONE_DOCUSTAY_STRIPE_SECRET_KEY=")) ?? "").split("=")[1]; }
ok("live Stripe key present (not printed)", /^sk_live_/.test(SK ?? "")); if (!SK) process.exit(2);
const stripe = async (m, path) => { const r = await fetch(`https://api.stripe.com/v1${path}`, { method: m, headers: { authorization: `Bearer ${SK}` } }); return { status: r.status, json: await r.json().catch(() => null) }; };
const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage();
const api = (m, path, b) => p.evaluate(async ([m, path, b]) => { const r = await fetch(path, { method: m, headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; }, [m, path, b]);
await p.goto(`${BASE}/login`, { waitUntil: "load" }); try { await p.getByRole("button", { name: "Decline" }).click({ timeout: 2500 }); } catch {}
const t0 = Math.floor(Date.now() / 1000);
await p.getByRole("textbox", { name: "Email" }).fill(EM); await p.getByTestId("login-continue").click().catch(() => {}); await p.waitForTimeout(2500);
if (!(await p.locator("input").first().isVisible().catch(() => false)) || (await p.locator("input[type=password]").count())) { const b = p.getByRole("button", { name: /sign-in code|code instead/i }); if (await b.count()) await b.first().click(); }
const needSignup = !(await p.locator("input").first().isVisible().catch(() => false));
if (needSignup) { await p.goto(`${BASE}/signup`); await p.getByRole("textbox", { name: "Email" }).fill(EM); await p.locator("input[type=checkbox]").first().check(); await p.getByRole("button", { name: "Email me a code" }).click(); }
await p.locator("input").first().click(); await p.keyboard.type(emailCode(EM, t0)); await p.waitForURL(/\/documents/, { timeout: 90000 }); ok("signed in on production (throwaway workspace)", true);
let st = (await api("GET", "/api/product/docustay/payments")).json; console.log("  payments before:", JSON.stringify({ state: st?.state, mode: st?.mode, oauth: st?.oauthAvailable }));
ok("production Stripe is LIVE mode and OAuth is offered", st?.mode === "live" && st?.oauthAvailable === true);
let acct = null;
if (st?.state === "not_connected" && process.argv[3] === "hosted") {
  const c1 = await api("POST", "/api/product/docustay/payments/connect", { method: "hosted" }); acct = String(c1.json?.url).match(/acct_[A-Za-z0-9]+/)?.[0];
  ok("Set up payments returns Stripe's hosted onboarding link", c1.status === 200 && /^https:\/\/connect\.stripe\.com\//.test(c1.json?.url ?? ""), `${c1.status}`);
  const full = (await stripe("GET", `/accounts/${acct}`)).json; console.log("  live account controller:", JSON.stringify(full?.controller), "type:", full?.type);
  ok("full Stripe dashboard", full?.controller?.stripe_dashboard?.type === "full"); ok("the account pays its own Stripe fees", full?.controller?.fees?.payer === "account");
  ok("Stripe liable for losses", full?.controller?.losses?.payments === "stripe"); ok("Stripe collects the requirements", full?.controller?.requirement_collection === "stripe");
  const pg = await ctx.newPage(); await pg.goto(c1.json.url, { waitUntil: "load" }); await pg.waitForTimeout(3500); const t = (await pg.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 200); console.log("  stripe page:", pg.url().slice(0, 60), "|", t);
  ok("the browser reaches Stripe's live hosted page (and stops)", /connect\.stripe\.com/.test(pg.url()) && !/test account/i.test(t)); await pg.close();
  st = (await api("GET", "/api/product/docustay/payments")).json; ok("stored as pending (account_link)", st?.state === "pending" && st?.method === "account_link", JSON.stringify(st));
  const dis = await api("POST", "/api/product/docustay/payments/disconnect", {}); ok("Disconnect works", dis.status === 200, `${dis.status}`);
} else console.log("  (workspace already has payments state", st?.state, "; hosted step skipped)");
const c2 = await api("POST", "/api/product/docustay/payments/connect", { method: "oauth" }); const ou = c2.json?.url ?? ""; console.log("  oauth url:", ou.replace(/state=[^&]+/, "state=…"));
ok("OAuth URL has the LIVE client id and the production redirect", ou.includes("client_id=ca_VRDqrBnwBI9Yehv3LFBHTFZd93Q3Btix") && ou.includes(encodeURIComponent(`${BASE}/api/product/docustay/payments/callback`)), ou.slice(0, 200));
const pg2 = await ctx.newPage(); await pg2.goto(ou, { waitUntil: "domcontentloaded" }); await pg2.waitForTimeout(3500); const t2 = (await pg2.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 300); console.log("  authorize page:", pg2.url().slice(0, 90), "|", t2.slice(0, 160));
ok("Stripe's live authorize page opens with no redirect or client error (and we stop)", !/invalid|redirect uri/i.test(t2) && /stripe/i.test(pg2.url() + t2) && !/blank test account/i.test(t2)); await pg2.close();
if (acct) { const d = await stripe("DELETE", `/accounts/${acct}`); console.log("  delete live account", acct, d.status, d.json?.deleted ?? String(d.json?.error?.message).replace(/sk_live_\S+/g, "<key>").slice(0, 120)); }
console.log(`\n${pass} pass, ${fail} fail`); await browser.close(); process.exit(fail ? 1 : 0);
