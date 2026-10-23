#!/usr/bin/env node
// ROUTE CRAWL: opens every signed-in app route on a workspace that has REAL data (an own template, drafts, a plan chooser, Payments, Billing) and fails on any uncaught exception,
// any console error, any 5xx, or any visible "undefined"/"NaN"/"[object". Run after every deploy: on the beta, and on production with a throwaway workspace (delete it after).
//   node scripts/route-crawl.mjs --base https://app.docustay.app --email trtheking97+crawl1@gmail.com [--keep] [--layout]   (--layout also runs scripts/layout-audit.mjs, the layout gate)
// The sign-in code is read from the QA Gmail inbox (secret docustay-qa-gmail-app-password) with Python's imaplib. Born from the Templates crash of 17 Oct 2026 (an empty throwaway workspace never rendered a template row).
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const BASE = (arg("base", "https://app.docustay.app")).replace(/\/+$/, ""), EMAIL = arg("email");
if (!EMAIL) { console.error("--email is required (a plus address of the QA inbox)"); process.exit(2); }
const code = (since) => { const py = `
import imaplib,email,subprocess,re,sys,time
pw=subprocess.run(["gcloud","secrets","versions","access","latest","--project=example-project","--secret=docustay-qa-gmail-app-password"],capture_output=True,text=True).stdout.strip().replace(" ","")
for i in range(15):
    m=imaplib.IMAP4_SSL("imap.gmail.com"); m.login("trtheking97@gmail.com",pw); m.select("INBOX")
    t,d=m.search(None,'(TO "${EMAIL}")'); ids=d[0].split()
    if not ids: t,d=m.search(None,'(SUBJECT "${EMAIL}")'); ids=d[0].split()
    if ids:
        msg=email.message_from_bytes(m.fetch(ids[-1],"(RFC822)")[1][0][1]); body=""
        for p in msg.walk():
            if p.get_content_type()=="text/plain": body+=p.get_payload(decode=True).decode(errors="ignore")
        c=re.findall(r"\\b\\d{6}\\b",body)
        if c and email.utils.parsedate_to_datetime(msg["Date"]).timestamp()>=${since}-5: print(c[0]); sys.exit(0)
    m.logout(); time.sleep(4)
sys.exit(1)`; const r = spawnSync("python3", ["-c", py], { encoding: "utf8" }); if (r.status !== 0) throw new Error("no sign-in code arrived"); return r.stdout.trim(); };
const W = Number(arg("width", 1280)), THEME = arg("theme", "light");   // the crawl also runs phone width and dark: --width 390 --theme dark
const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: W, height: W < 600 ? 844 : 900 }, colorScheme: THEME }); const page = await ctx.newPage();
await page.addInitScript((th) => { try { localStorage.setItem("docustay-theme", th); } catch { /* none */ } }, THEME);
const problems = []; let where = "login";
page.on("pageerror", (e) => problems.push(`${where}: uncaught ${e.message}`));
page.on("console", (m) => { if (m.type() === "error" && !/chrome-extension|Receiving end does not exist/.test(m.text())) problems.push(`${where}: console error ${m.text().slice(0, 160)}`); });
page.on("response", (r) => { if (r.status() >= 500) problems.push(`${where}: ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); else if (r.status() >= 400 && new URL(r.url()).pathname.startsWith("/api/") ) problems.push(`${where}: ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
const api = (path, body) => page.evaluate(async ([p, b]) => { const r = await fetch(p, { method: b ? "POST" : "GET", credentials: "include", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json(); } catch {} return { s: r.status, j }; }, [path, body]);
// sign in (or up) by emailed code
const t0 = Math.floor(Date.now() / 1000);
await page.goto(`${BASE}/signup`); try { await page.getByRole("button", { name: "Decline" }).click({ timeout: 3000 }); } catch {}
await page.getByRole("textbox", { name: "Email" }).fill(EMAIL); await page.locator("input[type=checkbox]").first().check(); await page.getByRole("button", { name: "Email me a code" }).click();
const c = code(t0); await page.locator("input").first().click(); await page.keyboard.type(c); await page.waitForURL(/\/documents/, { timeout: 60000 });
problems.length = 0;   // the sign-in itself is not under test
// seed real data: an own template and drafts (the library's first built-in template, three times)
where = "seed";
const lib = await api("/api/documents/library"); const builtin = (lib.j?.data?.templates ?? lib.j?.templates ?? lib.j?.data ?? []).find?.((x) => x.slug || x.id);
const slug = builtin?.slug ?? builtin?.id; let draftId = null, ownTpl = false;
if (slug) {
  const own = await api("/api/documents/library/customize", { slug }); ownTpl = own.s < 300 && Boolean((own.j?.data ?? own.j)?.templateId);   // an own template: the row that crashed the Templates page
  for (let i = 0; i < 2; i++) { const u = await api("/api/documents/library/use", { slug }); draftId = (u.j?.data ?? u.j)?.instanceId ?? draftId; }
}
console.log(`seeded: built-in=${slug ?? "none"} draft=${draftId ?? "none"} ownTemplate=${ownTpl}`);
if (!draftId || !ownTpl) problems.push("seed: could not create a draft and an own template (the crash case needs a template row)");
problems.length && 0;
const ROUTES = ["/documents", draftId && `/documents/${draftId}`, draftId && `/documents/${draftId}/edit`, "/templates", "/templates/rich", "/contacts", "/plays", "/billing", "/billing/cancel", "/upgrade", "/payments", "/create?mode=document", "/settings?tab=account", "/settings?tab=team", "/settings?tab=security", "/settings?tab=branding", "/settings?tab=data", "/settings?tab=audit", "/settings?tab=documents", "/settings?tab=developers", "/settings?tab=payments", "/settings?tab=ai", "/settings?tab=notifications", "/contact"].filter(Boolean);
for (const r of ROUTES) {
  where = r; let status = 0;
  try { const resp = await page.goto(`${BASE}${r}`, { waitUntil: r === "/upgrade" ? "domcontentloaded" : "networkidle", timeout: 45000 }); status = resp?.status() ?? 0; } catch (e) { problems.push(`${r}: did not load (${e.message.slice(0, 80)})`); continue; }
  if (r === "/upgrade") { await page.waitForURL(/checkout\.stripe\.com|\/billing/, { timeout: 30000 }).catch(() => problems.push("/upgrade: neither Stripe checkout nor Billing opened")); continue; }   // Stripe's own page never goes network-idle; reaching it is the proof (nothing is paid)
  await page.waitForTimeout(1200);
  if (status >= 400) problems.push(`${r}: page answered ${status}`);
  const bad = await page.evaluate(() => (document.body.innerText.match(/\bundefined\b|\bNaN\b|\[object \w+\]/g) ?? []).slice(0, 3));
  if (bad.length) problems.push(`${r}: visible ${bad.join(", ")}`);
  if (r === "/templates") { await page.waitForSelector('[data-testid="tpl-row"]', { timeout: 10000 }).catch(() => {}); const rows = await page.locator('[data-testid="tpl-row"]').count(); if (ownTpl && rows < 1) problems.push(`/templates: no template rows rendered although an own template exists (page says: ${(await page.evaluate(() => document.querySelector("main")?.innerText ?? "")).replace(/\s+/g, " ").slice(0, 160)})`); }
  if (r === "/billing") { const t = await page.evaluate(() => document.body.innerText); if (!/Pay as you go/.test(t) || !/\$5\s*per team member a month/.test(t)) problems.push("/billing: plan chooser is missing or wrong"); }
}
if (process.argv.includes("--layout")) {   // the LAYOUT GATE (COMBINED-STYLE-SPEC.md section 8) on the same workspace: gutters, ragged edges, sideways scroll, narrow blocks, at four widths
  where = "layout"; const r = spawnSync("node", [new URL("../../../scripts/layout-audit.mjs", import.meta.url).pathname, "--base", BASE, "--email", EMAIL, "--widths", "1280,1440,1920,390", "--themes", "light", "--shots", "none", "--out", "/tmp/route-crawl-layout"], { encoding: "utf8", timeout: 40 * 60 * 1000 });
  if (r.status !== 0) problems.push(`layout gate failed:\n${(r.stdout + r.stderr).split("\n").filter((l) => /^FAIL|did not load/.test(l)).slice(0, 12).join("\n")}`);
}
if (process.argv.includes("--delete")) {   // schedule deletion of the throwaway workspace (the app's own 7-day deletion)
  where = "delete"; try { await page.goto(`${BASE}/settings?tab=data`, { waitUntil: "networkidle" }); await page.getByRole("button", { name: /^Delete this workspace/ }).click();
    const box = page.getByRole("textbox", { name: /Type the workspace name/ }); const label = await box.getAttribute("aria-label") ?? await page.locator("label", { hasText: "Type the workspace name" }).innerText(); const name = (label.match(/\(([^)]+)\)\s*$/) ?? [])[1]; await box.fill(name ?? ""); await page.getByRole("button", { name: "Schedule deletion" }).click(); await page.waitForTimeout(2500);
    console.log("deletion:", ((await page.evaluate(() => document.querySelector("main")?.innerText ?? "")).match(/will be deleted on [A-Za-z]+ \d+, \d+/) ?? ["not confirmed"])[0]); } catch (e) { problems.push(`delete: ${e.message.slice(0, 100)}`); }
}
await browser.close();
console.log(`${BASE}: ${ROUTES.length} routes crawled as ${EMAIL}, ${problems.length} problem(s)`);
for (const p of [...new Set(problems)]) console.log(`  FAIL ${p}`);
process.exit(problems.length ? 1 : 0);
