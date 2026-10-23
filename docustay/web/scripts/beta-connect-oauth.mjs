// STRIPE CONNECT (b), BETA TEST MODE: "Connect my existing Stripe account" through Stripe's test OAuth, using its "blank test account" shortcut.
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import { BETA_WEB as BASE, code as emailCode } from "./pm-lib.mjs";
let pass = 0, fail = 0; const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
let SK; for (let i = 0; i < 4 && !SK; i++) { const kv = spawnSync("railway", ["variables", "--service", "sandbox-app", "--project", "00000000-0000-4000-8000-00000000000a", "--environment", "sandbox-beta", "--kv"], { encoding: "utf8" }).stdout ?? ""; SK = (kv.split("\n").find((l) => l.startsWith("KEYSTONE_DOCUSTAY_STRIPE_SECRET_KEY=")) ?? "").split("=")[1]; }
ok("Stripe TEST key read", /^sk_test_/.test(SK ?? ""));
const stripe = async (m, path) => { const r = await fetch(`https://api.stripe.com/v1${path}`, { method: m, headers: { authorization: `Bearer ${SK}` } }); return { status: r.status, json: await r.json().catch(() => null) }; };
const browser = await chromium.launch(); const stamp = Date.now() % 1e8, EM = `trtheking97+qo${stamp}@gmail.com`, PW = `Qo-${stamp}-beta-pass`;
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } }); const p = await ctx.newPage();
const api = (m, path, b) => p.evaluate(async ([m, path, b]) => { const r = await fetch(path, { method: m, headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; }, [m, path, b]);
await p.goto(`${BASE}/login`); try { await p.getByRole("button", { name: "Decline" }).click({ timeout: 2000 }); } catch {}
await api("POST", "/api/auth/local/signup", { email: EM, password: PW });
const t0 = Math.floor(Date.now() / 1000); await p.goto(`${BASE}/signup`);
await p.getByRole("textbox", { name: "Email" }).fill(EM); await p.locator("input[type=checkbox]").first().check(); await p.getByRole("button", { name: "Email me a code" }).click();
await p.locator("input").first().click(); await p.keyboard.type(emailCode(EM, t0)); await p.waitForURL(/\/documents/, { timeout: 60000 });
// Stripe sends the browser back to the APP host. On production that host also serves the web, so the sign-in cookie is there; on beta the web is a separate host, so sign in on the app host too (the same person, the same password).
const APP = "https://host.example.com"; await p.goto(`${APP}/login`, { waitUntil: "load" });
const si = await api("POST", "/api/auth/local/signin", { email: EM, password: PW }); const lg = await api("POST", "/api/auth/login", { idToken: si.json?.idToken ?? si.json?.data?.idToken }); ok("signed in on the app host", lg.status < 300, `${si.status}/${lg.status}`);
const c = await api("POST", "/api/product/docustay/payments/connect", { method: "oauth" }); ok("authorize URL returned", /oauth\/authorize/.test(c.json?.url ?? ""));
await p.goto(c.json.url, { waitUntil: "load" }); await p.waitForTimeout(3000);
const t = (await p.locator("body").innerText()).replace(/\s+/g, " "); console.log("  page:", t.slice(0, 260));
ok("page offers the blank test account shortcut", /blank test account/i.test(t));
await p.screenshot({ path: "/tmp/la/oauth1.png" });
await p.getByRole("button", { name: /Use blank account/i }).click(); await p.waitForURL((u) => u.href.startsWith(APP) && /payments=/.test(u.href), { timeout: 60000 }).catch(() => {}); await p.waitForTimeout(4000);
console.log("  back at:", p.url().replace(/code=[^&]+/, "code=…").slice(0, 140));
const st = (await api("GET", "/api/product/docustay/payments")).json; console.log("  status:", JSON.stringify(st));
ok("callback stored it as an OAuth link", st?.method === "oauth" && st?.account, JSON.stringify(st));
ok("state is a real state (live or pending, not an error)", ["live", "pending", "restricted"].includes(st?.state), st?.state);
const rf = await api("POST", "/api/product/docustay/payments/refresh", {}); console.log("  refresh:", JSON.stringify(rf.json));
const dis = await api("POST", "/api/product/docustay/payments/disconnect", {}); ok("Disconnect (deauthorize) works", dis.status === 200, JSON.stringify(dis.json));
const after = (await api("GET", "/api/product/docustay/payments")).json; ok("status: not connected after", after?.state === "not_connected", JSON.stringify(after));
console.log(`\n${pass} pass, ${fail} fail`); await browser.close(); process.exit(fail ? 1 : 0);
