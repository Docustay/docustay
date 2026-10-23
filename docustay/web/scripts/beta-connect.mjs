// STRIPE CONNECT, BETA (Stripe TEST mode). Throwaway Free workspace; the connected account it creates is read back from Stripe's API and deleted at the end.
//   node scripts/beta-connect.mjs
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import { BETA_WEB, code as emailCode } from "./pm-lib.mjs";
const BASE = BETA_WEB; let pass = 0, fail = 0; const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const kv = spawnSync("railway", ["variables", "--service", "sandbox-app", "--project", "00000000-0000-4000-8000-00000000000a", "--environment", "sandbox-beta", "--kv"], { encoding: "utf8" }).stdout;   // read inside this process, never printed
const V = Object.fromEntries(kv.split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const SK = V.KEYSTONE_DOCUSTAY_STRIPE_SECRET_KEY || V.KEYSTONE_STRIPE_SECRET_KEY;
ok("beta Stripe key is a TEST key", /^sk_test_/.test(SK ?? ""));
ok("OAuth switch and TEST client id are set on beta", V.KEYSTONE_STRIPE_OAUTH_ENABLED === "true" && /^ca_/.test(V.KEYSTONE_DOCUSTAY_STRIPE_CONNECT_CLIENT_ID || V.KEYSTONE_STRIPE_CONNECT_CLIENT_ID || ""), `oauth=${V.KEYSTONE_STRIPE_OAUTH_ENABLED}`);
const stripe = async (method, path, form) => { const r = await fetch(`https://api.stripe.com/v1${path}`, { method, headers: { authorization: `Bearer ${SK}`, ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}) }, body: form }); return { status: r.status, json: await r.json().catch(() => null) }; };
const browser = await chromium.launch(); const stamp = Date.now() % 1e8, EM = `trtheking97+qc${stamp}@gmail.com`, PW = `Qc-${stamp}-beta-pass`;
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage();
const api = (m, path, b) => p.evaluate(async ([m, path, b]) => { const r = await fetch(path, { method: m, headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; }, [m, path, b]);
await p.goto(`${BASE}/login`); try { await p.getByRole("button", { name: "Decline" }).click({ timeout: 2000 }); } catch {}
await api("POST", "/api/auth/local/signup", { email: EM, password: PW });
const t0 = Math.floor(Date.now() / 1000); await p.goto(`${BASE}/signup`);
await p.getByRole("textbox", { name: "Email" }).fill(EM); await p.locator("input[type=checkbox]").first().check(); await p.getByRole("button", { name: "Email me a code" }).click();
await p.locator("input").first().click(); await p.keyboard.type(emailCode(EM, t0)); await p.waitForURL(/\/documents/, { timeout: 60000 });
let st = await api("GET", "/api/product/docustay/payments"); console.log("  status:", JSON.stringify(st.json));
ok("status: nothing connected, Stripe available in test mode, OAuth offered", st.json?.state === "not_connected" && st.json?.stripeAvailable === true && st.json?.mode === "test" && st.json?.oauthAvailable === true);
// (a) Set up payments
const c1 = await api("POST", "/api/product/docustay/payments/connect", { method: "hosted" }); console.log("  connect:", c1.status, (c1.json?.url ?? JSON.stringify(c1.json)).slice(0, 90));
ok("Set up payments returns a Stripe-hosted onboarding link", c1.status === 200 && /^https:\/\/connect\.stripe\.com\//.test(c1.json?.url ?? ""));
st = await api("GET", "/api/product/docustay/payments"); ok("workspace now has a pending account (method account_link)", st.json?.state === "pending" && st.json?.method === "account_link", JSON.stringify(st.json));
const row = await api("GET", "/api/product/docustay/payments"); const masked = row.json?.account;
// find the connected account in Stripe by listing the newest accounts for this email
const acctId = (c1.json?.url ?? "").match(/acct_[A-Za-z0-9]+/)?.[0]; const acct = acctId ? { id: acctId } : null; console.log("  connected account (test):", acctId);
ok("the account exists at Stripe", Boolean(acct) && (await stripe("GET", `/accounts/${acct.id}`)).status === 200);
if (acct) {
  const full = (await stripe("GET", `/accounts/${acct.id}`)).json;
  console.log("  controller:", JSON.stringify(full.controller), "type:", full.type, "country:", full.country);
  ok("full Stripe dashboard", full.controller?.stripe_dashboard?.type === "full");
  ok("the account pays its own Stripe fees", full.controller?.fees?.payer === "account");
  ok("Stripe is liable for losses", full.controller?.losses?.payments === "stripe");
  ok("Stripe collects the requirements (hosted page)", full.controller?.requirement_collection === "stripe");
  const page = await fetch(c1.json.url, { redirect: "follow" }); ok("the hosted onboarding page loads", page.status === 200, `${page.status}`);
  // return from Stripe with nothing finished: status stays needs info
  const ret = await fetch(`${BASE}/api/product/docustay/payments/return`, { redirect: "manual", headers: { cookie: (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ") } }); console.log("  return:", ret.status, ret.headers.get("location"));
  ok("coming back unfinished sends the person to Payments with a plain note", ret.status >= 300 && ret.status < 400);
  const rf = await api("POST", "/api/product/docustay/payments/refresh", {}); console.log("  refresh:", JSON.stringify(rf.json)); ok("refresh reads the account (still not ready)", rf.status === 200 && rf.json?.state !== "live", JSON.stringify(rf.json));
  // (d) payments not finished: the sender is told so, nothing breaks
  const pre = await api("GET", "/api/product/docustay/payments"); ok("status says information is needed", pre.json?.needsInfo === true);
  // (b-prep) disconnect
  const dis = await api("POST", "/api/product/docustay/payments/disconnect", {}); console.log("  disconnect:", dis.status, JSON.stringify(dis.json)?.slice(0, 160)); ok("Disconnect works on an unfinished account", dis.status === 200, `${dis.status}`);
  const after = await api("GET", "/api/product/docustay/payments"); ok("status after: not connected, remembers it was disconnected", after.json?.state === "not_connected", JSON.stringify(after.json));
  const del = await stripe("DELETE", `/accounts/${acct.id}`); ok("test account deleted at Stripe", del.status === 200 || del.json?.deleted === true, `${del.status} ${JSON.stringify(del.json)?.slice(0, 120)}`);
}
// (b) OAuth
const c2 = await api("POST", "/api/product/docustay/payments/connect", { method: "oauth" }); const ou = c2.json?.url ?? ""; console.log("  oauth url:", ou.replace(/state=[^&]+/, "state=…").slice(0, 300));
const CID = V.KEYSTONE_DOCUSTAY_STRIPE_CONNECT_CLIENT_ID || V.KEYSTONE_STRIPE_CONNECT_CLIENT_ID;
ok("Connect my existing account returns Stripe's authorize URL with the TEST client id and the beta redirect", c2.status === 200 && ou.startsWith("https://connect.stripe.com/oauth/authorize") && ou.includes(`client_id=${CID}`) && ou.includes(encodeURIComponent(`${V.KEYSTONE_STRIPE_RETURN_ORIGIN ?? "https://host.example.com"}/api/product/docustay/payments/callback`)), ou.slice(0, 160));
const pg = await ctx.newPage(); const resp = await pg.goto(ou, { waitUntil: "domcontentloaded" }).catch((e) => ({ status: () => 0, e })); await pg.waitForTimeout(2500);
const txt = (await pg.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 400); console.log("  authorize page:", resp.status?.(), pg.url().slice(0, 100), "|", txt.slice(0, 200));
ok("Stripe's authorize page opens (no invalid client or redirect error)", !/invalid|not a valid|redirect_uri|Redirect URI/i.test(txt) && txt.length > 0, txt.slice(0, 200));
await pg.screenshot({ path: "/tmp/la/connect-authorize.png" });
console.log(`\n${pass} pass, ${fail} fail`); await browser.close(); process.exit(fail ? 1 : 0);
