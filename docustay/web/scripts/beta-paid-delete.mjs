// ITEM 7, REAL: a throwaway beta workspace buys Pro through Stripe TEST checkout (Stripe's published test card), then deletes the workspace.
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import { BETA_WEB as BASE, code as emailCode } from "./pm-lib.mjs";
let pass = 0, fail = 0; const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const kv = spawnSync("railway", ["variables", "--service", "sandbox-app", "--project", "00000000-0000-4000-8000-00000000000a", "--environment", "sandbox-beta", "--kv"], { encoding: "utf8" }).stdout;
const SK = (kv.split("\n").find((l) => l.startsWith("KEYSTONE_DOCUSTAY_STRIPE_SECRET_KEY=")) ?? "").split("=")[1];
ok("Stripe is in TEST mode", /^sk_test_/.test(SK ?? ""));
const stripe = async (path) => (await fetch(`https://api.stripe.com/v1${path}`, { headers: { authorization: `Bearer ${SK}` } })).json();
const browser = await chromium.launch(); const stamp = Date.now() % 1e8, EM = `trtheking97+qd${stamp}@gmail.com`, PW = `Qd-${stamp}-beta-pass`;
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } }); const p = await ctx.newPage();
const api = (m, path, b) => p.evaluate(async ([m, path, b]) => { const r = await fetch(path, { method: m, headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; }, [m, path, b]);
await p.goto(`${BASE}/login`); try { await p.getByRole("button", { name: "Decline" }).click({ timeout: 2000 }); } catch {}
await api("POST", "/api/auth/local/signup", { email: EM, password: PW });
const t0 = Math.floor(Date.now() / 1000); await p.goto(`${BASE}/signup`);
await p.getByRole("textbox", { name: "Email" }).fill(EM); await p.locator("input[type=checkbox]").first().check(); await p.getByRole("button", { name: "Email me a code" }).click();
await p.locator("input").first().click(); await p.keyboard.type(emailCode(EM, t0)); await p.waitForURL(/\/documents/, { timeout: 60000 });
const ck = await api("POST", "/api/product/docustay/checkout", { plan: "pro" }); console.log("  checkout:", ck.status, (ck.json?.url ?? JSON.stringify(ck.json)).slice(0, 80));
ok("checkout link from Stripe", /checkout\.stripe\.com/.test(ck.json?.url ?? ""));
await p.goto(ck.json.url, { waitUntil: "load" }); await p.waitForTimeout(4000);
await p.screenshot({ path: "/tmp/la/co1.png" });
const fill = async (sel, v) => { const l = p.locator(sel).first(); await l.waitFor({ timeout: 20000 }); await l.fill(v); };
await fill('#cardNumber, input[name="cardNumber"]', "4242424242424242"); await fill('#cardExpiry, input[name="cardExpiry"]', "1234"); await fill('#cardCvc, input[name="cardCvc"]', "123");
await fill('#billingName, input[name="billingName"]', "Test Person");
const zip = p.locator('#billingPostalCode, input[name="billingPostalCode"]').first(); if (await zip.count()) await zip.fill("94105");
const link = p.getByRole("checkbox", { name: /Save my information/i }); if (await link.count() && await link.isChecked()) await link.uncheck();
await p.getByRole("button", { name: /^Subscribe$/ }).click({ timeout: 20000 });
await p.waitForURL((u) => u.href.startsWith(BASE), { timeout: 120000 }).catch(() => {}); await p.waitForTimeout(5000); console.log("  back at:", p.url().slice(0, 100));
let st; for (let i = 0; i < 20; i++) { st = (await api("GET", "/api/product/docustay/status")).json; if (st?.plan?.key === "docustay_pro" || st?.plan === "docustay_pro") break; await p.waitForTimeout(3000); }
ok("the workspace is on Pro", (st?.plan?.key ?? st?.plan) === "docustay_pro", JSON.stringify(st?.plan));
const d = await api("GET", "/api/account/deletion"); console.log("  notice:", JSON.stringify(d.json?.plan));
ok("the notice names Pro with days left", d.json?.plan?.kind === "subscription" && d.json.plan.planName === "Pro" && d.json.plan.daysLeft >= 28, JSON.stringify(d.json?.plan));
await p.goto(`${BASE}/settings?tab=data`); await p.waitForTimeout(3000); const label = await p.locator("label[for=del-workspace]").innerText().catch(() => ""); const nm = label.match(/\((.+)\)/)?.[1] ?? "Trtheking97's workspace"; console.log("  name:", nm);
const no = await api("POST", "/api/product/docustay/delete-workspace", { confirm: nm }); ok("without the tick: refused (409), nothing cancelled", no.status === 409, `${no.status} ${JSON.stringify(no.json)?.slice(0, 200)}`);
const subs = await api("GET", "/api/product/docustay/status"); ok("still Pro after the refusal", (subs.json?.plan?.key ?? subs.json?.plan) === "docustay_pro");
const go = await api("POST", "/api/product/docustay/delete-workspace", { confirm: nm, acknowledgePlanLoss: true }); ok("with the tick: scheduled", go.status === 200 && go.json?.requested === true, `${go.status} ${JSON.stringify(go.json)?.slice(0, 200)}`);
const st2 = (await api("GET", "/api/product/docustay/status")).json; ok("the plan ended at once: Free", (st2?.plan?.key ?? st2?.plan) === "docustay_free", JSON.stringify(st2?.plan));
const cust = (await stripe(`/customers?email=${encodeURIComponent(EM)}&limit=3`)).data?.[0]; const subsS = cust ? (await stripe(`/subscriptions?customer=${cust.id}&status=all&limit=5`)).data ?? [] : [];
ok("the Stripe test subscription is cancelled", subsS.length > 0 && subsS.every((s) => s.status === "canceled"), JSON.stringify(subsS.map((s) => s.status)));
if (cust) { const inv = (await stripe(`/invoices?customer=${cust.id}&limit=5`)).data ?? []; const cn = (await stripe(`/credit_notes?customer=${cust.id}&limit=5`)).data ?? []; ok("no refund and no credit note", cn.length === 0, `${cn.length} credit notes`); console.log("  invoices:", inv.map((i) => `${i.status}:${i.amount_paid}`).join(",")); }
ok("the 'scheduled' email arrived", spawnSync("python3", ["-c", `
import imaplib,email,subprocess,sys,time
pw=subprocess.run(["gcloud","secrets","versions","access","latest","--project=example-project","--secret=docustay-qa-gmail-app-password"],capture_output=True,text=True).stdout.strip().replace(" ","")
for i in range(30):
    m=imaplib.IMAP4_SSL("imap.gmail.com"); m.login("trtheking97@gmail.com",pw)
    for box in ("INBOX","[Gmail]/Spam"):
        m.select('"%s"'%box,readonly=True); t,d=m.search(None,'(SUBJECT "(to ${EM})")')
        for mid in d[0].split():
            msg=email.message_from_bytes(m.fetch(mid,"(RFC822)")[1][0][1]); b=str(msg["Subject"])
            for q in msg.walk():
                if q.get_content_type()=="text/plain": b+=q.get_payload(decode=True).decode(errors="ignore")
            if "Pro" in b and ("delet" in b.lower()): print(b[:600]); sys.exit(0)
    m.logout(); time.sleep(4)
sys.exit(1)`], { encoding: "utf8" }).status === 0);
const keep = await api("POST", "/api/product/docustay/delete-workspace/cancel", {}); ok("Keep this workspace", keep.status < 300, `${keep.status}`);
const st3 = (await api("GET", "/api/product/docustay/status")).json; ok("kept, and on Free (Pro is not brought back)", (st3?.plan?.key ?? st3?.plan) === "docustay_free");
console.log(`\n${pass} pass, ${fail} fail`); await browser.close(); process.exit(fail ? 1 : 0);
