// ITEM 10 (c), BETA, Stripe TEST mode: a payment inside signing, DIRECT CHARGE on the linked connected account. One workspace per run: --ws payg (2% fee) or --ws pro (0%).
// Card numbers are Stripe's published test cards. The connected accounts are the sandbox's own test accounts, linked as fixtures (see the queue file).
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { BETA_WEB as BASE, WS, contextFor, call } from "./pm-lib.mjs";
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const W = arg("ws", "payg"), FEE = W === "payg" ? 250 : 0, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
let SK; for (let i = 0; i < 4 && !SK; i++) { const kv = spawnSync("railway", ["variables", "--service", "sandbox-app", "--project", "00000000-0000-4000-8000-00000000000a", "--environment", "sandbox-beta", "--kv"], { encoding: "utf8", env: { ...process.env, RAILWAY_TOKEN: undefined } }).stdout ?? ""; SK = (kv.split("\n").find((l) => l.startsWith("KEYSTONE_DOCUSTAY_STRIPE_SECRET_KEY=")) ?? "").split("=")[1]; }
ok("Stripe TEST key read", /^sk_test_/.test(SK ?? "")); if (!SK) process.exit(2);
const stripe = async (path, acct) => (await fetch(`https://api.stripe.com/v1${path}`, { headers: { authorization: `Bearer ${SK}`, ...(acct ? { "Stripe-Account": acct } : {}) } })).json();
const browser = await chromium.launch(); const ctx = await contextFor(browser, WS[W], { base: BASE });
const pub = async (path, body) => { const r = await fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, connection: "close" }, body: JSON.stringify(body) }); const t = await r.text(); let json = null; try { json = JSON.parse(t); } catch { /* text */ } return { status: r.status, json, text: t }; };
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const pstat = (await call(ctx, "GET", "/api/product/docustay/payments")).data; ok(`${W}: payments status is live (fixture linked)`, pstat?.state === "live", JSON.stringify(pstat)); const ACCT = ({ payg: "acct_1URjU0IRCHp0TTGx", pro: "acct_1URjU0IRCHwOFmOt" })[W];
const tpls = (await call(ctx, "GET", "/api/documents/pdf/templates")).json?.templates ?? []; const tpl = tpls.find((t) => t.seats === 1 && t.active && t.approval_status === "approved") ?? tpls[0];
const fromT = await call(ctx, "POST", "/api/documents/pdf/from-template", { templateId: tpl.id, title: `Beta payment proof ${W} ${Date.now() % 1e6}` }); const id = fromT.data?.instanceId ?? fromT.data?.id; ok("a draft from a one-seat template", Boolean(id), JSON.stringify(fromT.json)?.slice(0, 200));
const d = (await call(ctx, "GET", `/api/documents/pdf/${id}`)).json;
const body = { ...(d.body ?? {}), suggestions: undefined, fields: [{ id: "sig-1", type: "signature", role: "signer_1", page: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.05, required: true }, { id: "pay-1", type: "payment", role: "signer_1", page: 1, x: 0.1, y: 0.3, w: 0.4, h: 0.08, required: true, amount_minor: 5000, currency: "usd", label: "Deposit" }] };
const sv = await call(ctx, "POST", "/api/documents/pdf/save", { instanceId: id, title: d.title, body, parties: [{ role: "signer_1", name: "Test Payer", email: `trtheking97+pay${W}@gmail.com` }], sendOptions: { in_person: ["signer_1"] } }); ok("saved with a signature and a $50.00 payment", sv.status < 300, `${sv.status} ${JSON.stringify(sv.json)?.slice(0, 200)}`);
const sent = await call(ctx, "POST", "/api/documents/pdf/send", { instanceId: id }); ok("Send is allowed (payments connected)", sent.status < 300, `${sent.status} ${JSON.stringify(sent.json)?.slice(0, 200)}`);
const party = ((await call(ctx, "GET", `/api/documents/pdf/${id}`)).json?.parties ?? [])[0]; const now = await call(ctx, "POST", "/api/documents/pdf/sign-now", { instanceId: id, partyId: party?.id });
const link = now.json?.presented ?? ""; const presented = decodeURIComponent(link.split("t=")[1] ?? link); ok("signing link minted", presented.length > 20, JSON.stringify(now.json)?.slice(0, 160));
const pg = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); await pg.goto(`${BASE}/login`, { waitUntil: "load" });
const startIn = () => pg.evaluate(async (presented) => { const r = await fetch("/api/public/pdf/payment/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ presented, fieldId: "pay-1", returnOrigin: location.origin, returnPath: "/sign/proof" }) }); return { status: r.status, text: await r.text() }; }, presented);
const s1r = await startIn(); const s1 = JSON.parse(s1r.text || "{}"); const url = s1.checkoutUrl ?? s1.url; ok("start returns Stripe's hosted Checkout page", s1r.status === 200 && /^https:\/\/checkout\.stripe\.com\//.test(url ?? ""), `${s1r.status} ${s1r.text.slice(0, 200)}`);
const sid = (String(url).match(/cs_test_[A-Za-z0-9]+/) ?? [])[0]; const sess = await stripe(`/checkout/sessions/${sid}`, ACCT);
ok("the Checkout session lives ON THE CONNECTED ACCOUNT (a direct charge), 5000 usd, unpaid", sess.id === sid && sess.amount_total === 5000 && sess.payment_status === "unpaid", JSON.stringify({ id: sess.id, amt: sess.amount_total, err: sess.error?.message?.replace(/sk_test_\S+/g, "<key>") }));
async function inFrames(fn) { for (let i = 0; i < 40; i++) { for (const f of pg.frames()) { try { const r = await fn(f); if (r) return r; } catch { /* next frame */ } } await sleep(500); } return null; }
async function pay(card) {
  await pg.goto(url, { waitUntil: "load" }); await pg.waitForSelector("input[name=email]", { timeout: 60000 });
  const mail = pg.locator("input[name=email]"); if (await mail.first().isVisible()) await mail.first().fill(`trtheking97+pay${W}@gmail.com`);
  const link = pg.getByRole("checkbox", { name: /Save my information/i }); if (await link.count() && await link.isChecked()) await link.uncheck();
  await pg.waitForTimeout(1500); await pg.getByTestId("card-accordion-item-button").first().evaluate((b) => b.click()).catch(() => {}); await pg.waitForTimeout(1500);
  const num = await inFrames(async (f) => { const l = f.locator("input[name=cardnumber], input[placeholder*='1234'], #cardNumber").first(); return (await l.count()) && (await l.isVisible()) ? l : null; }); if (!num) { await pg.screenshot({ path: "/tmp/la/checkout-fail.png" }); console.log("inputs:", JSON.stringify(await pg.locator("input").evaluateAll((e) => e.map((x) => [x.name, x.id, x.type, x.placeholder, x.checked, x.offsetParent !== null])))); throw new Error("no card number box"); }
  await num.fill(card);
  const exp = await inFrames(async (f) => { const l = f.locator("input[name=exp-date], input[placeholder*='MM'], #cardExpiry").first(); return (await l.count()) ? l : null; }); await exp.fill("1234");
  const cvc = await inFrames(async (f) => { const l = f.locator("input[name=cvc], input[placeholder*='CVC'], #cardCvc").first(); return (await l.count()) ? l : null; }); await cvc.fill("123");
  const nm = pg.locator("input[name=billingName], #billingName"); if (await nm.count()) await nm.first().fill("Test Payer");
  const z = pg.locator("input[name=billingPostalCode], #billingPostalCode"); if (await z.count() && await z.first().isVisible()) await z.first().fill("94103");
  { const lk = pg.getByRole("checkbox", { name: /Save my information/i }); if (await lk.count() && await lk.isChecked()) await lk.uncheck(); }
  await pg.locator("button.SubmitButton, button[type=submit], [data-testid=hosted-payment-submit-button]").first().click();
}
await pay("4000000000000002"); let dt = ""; for (let i = 0; i < 20 && !/declined/i.test(dt); i++) { await sleep(1000); dt = (await Promise.all(pg.frames().map((f) => f.locator("body").innerText().catch(() => "")))).join(" "); } await pg.screenshot({ path: "/tmp/la/declined.png" }); ok("a DECLINED card (4000 0000 0000 0002) is declined by Stripe", /declined/i.test(dt), dt.replace(/\s+/g, " ").slice(0, 200));
  { const pi0 = (await stripe(`/payment_intents?limit=3`, ACCT)).data?.[0]; console.log("  latest payment_intent:", pi0?.id, pi0?.status, pi0?.last_payment_error?.decline_code ?? ""); }
const c0 = await pub("/api/public/pdf/payment/confirm", { presented, fieldId: "pay-1" }); ok("the app does NOT treat it as paid", c0.status === 200 && c0.json?.paid === false, JSON.stringify(c0.json)?.slice(0, 120));
const early = await pub("/api/public/pdf/sign", { presented, typedName: "Test Payer", consent: true, marks: { signature: PNG }, values: {} }); ok("signing while unpaid is HELD (not completed) until the payment clears", early.status < 300 && early.json?.held === true, `${early.status} ${early.text.slice(0, 160)}`);
const mid = (await call(ctx, "GET", `/api/documents/pdf/${id}/track`)).data; ok("the document is NOT completed while the payment is unpaid", mid?.status !== "completed", `${mid?.status}`);
await pay("4242424242424242"); await pg.waitForURL((u) => !/checkout\.stripe\.com/.test(u.href), { timeout: 90000 }).catch(() => {}); await sleep(2500); ok("the good card (4242) is accepted and Stripe sends the person back", !/checkout\.stripe\.com/.test(pg.url()), pg.url().slice(0, 90));
const c1 = await pub("/api/public/pdf/payment/confirm", { presented, fieldId: "pay-1" }); console.log("  confirm:", c1.status, JSON.stringify(c1.json)?.slice(0, 160));
const s2 = await stripe(`/checkout/sessions/${sid}?expand[]=payment_intent.latest_charge`, ACCT); const pi = s2.payment_intent, ch = pi?.latest_charge;
ok("Stripe: paid, 5000 usd, on the connected account", s2.payment_status === "paid" && pi?.status === "succeeded" && pi?.amount === 5000, JSON.stringify({ ps: s2.payment_status, pis: pi?.status }));
ok(`application fee ${FEE ? "2% (100)" : "none (0%)"}: ${pi?.application_fee_amount ?? 0} on the PaymentIntent`, (pi?.application_fee_amount ?? 0) === (W === "payg" ? 100 : 0), `fee=${pi?.application_fee_amount}`);
ok("a receipt exists (receipt_url on the charge)", /^https:\/\/pay\.stripe\.com\/receipts\//.test(ch?.receipt_url ?? ""), String(ch?.receipt_url));
let track; for (let i = 0; i < 30; i++) { track = (await call(ctx, "GET", `/api/documents/pdf/${id}/track`)).data; if (track?.status === "completed") break; await sleep(3000); }
ok("the document is completed (sealed)", track?.status === "completed", `${track?.status}`); const payRow = (track?.payments ?? [])[0]; ok("Track records the payment as paid", payRow?.status === "paid" || payRow?.paid === true, JSON.stringify(payRow)?.slice(0, 160));
// the webhook: the connected account's payment_intent.succeeded was sent to the beta
const evs = await stripe(`/events?type=payment_intent.succeeded&limit=10`, ACCT); const ev = (evs.data ?? []).find((e) => e.data?.object?.id === pi?.id); ok("Stripe produced the payment_intent.succeeded event for it", Boolean(ev), `events=${evs.data?.length} ${evs.error?.message ?? ""}`);
console.log("  document:", id, " payment_intent:", pi?.id, " charge:", ch?.id);
console.log(`\n${pass} pass, ${fail} fail`); await browser.close(); process.exit(fail ? 1 : 0);
