#!/usr/bin/env node
// Screenshots of the signed-in app for design work (headless; never touches the user's browser). The sign-in state is kept in /tmp so a code is asked for once.
//   node scripts/shoot-app.mjs --base http://127.0.0.1:5180 --email trtheking97+p29@gmail.com --out /tmp/shots --routes /documents,/templates --widths 1440,390 --themes light,dark
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg("base", "http://127.0.0.1:5180").replace(/\/+$/, ""), EMAIL = arg("email"), OUT = arg("out", "/tmp/shots");
const ROUTES = arg("routes", "/documents").split(","), WIDTHS = arg("widths", "1440").split(",").map(Number), THEMES = arg("themes", "light").split(",");
const CLICK = arg("click", "");   // optional: click the tab or button with this name before the shot
const SCROLL = arg("scroll", "");   // optional: scroll the main column by this many px before the shot
if (!EMAIL) { console.error("--email required"); process.exit(2); }
mkdirSync(OUT, { recursive: true });
const STATE = `/tmp/ds-state-${EMAIL.replace(/[^a-z0-9]/gi, "_")}.json`;
const code = (since) => { const py = `
import imaplib,email,subprocess,re,sys,time
pw=subprocess.run(["gcloud","secrets","versions","access","latest","--project=example-project","--secret=docustay-qa-gmail-app-password"],capture_output=True,text=True).stdout.strip().replace(" ","")
for i in range(15):
    m=imaplib.IMAP4_SSL("imap.gmail.com"); m.login("trtheking97@gmail.com",pw); m.select("INBOX")
    t,d=m.search(None,'(SUBJECT "${EMAIL}")'); ids=d[0].split()
    if not ids: t,d=m.search(None,'(TO "${EMAIL}")'); ids=d[0].split()
    if ids:
        msg=email.message_from_bytes(m.fetch(ids[-1],"(RFC822)")[1][0][1]); body=""
        for p in msg.walk():
            if p.get_content_type()=="text/plain": body+=p.get_payload(decode=True).decode(errors="ignore")
        c=re.findall(r"\\b\\d{6}\\b",body)
        if c and email.utils.parsedate_to_datetime(msg["Date"]).timestamp()>=${since}-5: print(c[0]); sys.exit(0)
    m.logout(); time.sleep(4)
sys.exit(1)`; const r = spawnSync("python3", ["-c", py], { encoding: "utf8" }); if (r.status !== 0) throw new Error("no sign-in code arrived"); return r.stdout.trim(); };
const browser = await chromium.launch();
let ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...(existsSync(STATE) ? { storageState: STATE } : {}) });
let page = await ctx.newPage();
await page.goto(`${BASE}/documents`, { waitUntil: "networkidle" });
if (!/\/documents/.test(page.url())) {
  const t0 = Math.floor(Date.now() / 1000);
  await page.goto(`${BASE}/signup`); try { await page.getByRole("button", { name: "Decline" }).click({ timeout: 3000 }); } catch {}
  await page.getByRole("textbox", { name: "Email" }).fill(EMAIL); await page.locator("input[type=checkbox]").first().check(); await page.getByRole("button", { name: "Email me a code" }).click();
  const c = code(t0); await page.locator("input").first().click(); await page.keyboard.type(c); await page.waitForURL(/\/documents/, { timeout: 60000 });
  await ctx.storageState({ path: STATE });
}
const problems = [];
page.on("pageerror", (e) => problems.push(`uncaught ${e.message}`)); page.on("console", (m) => { if (m.type() === "error") problems.push(`console ${m.text().slice(0, 140)}`); });
for (const theme of THEMES) for (const w of WIDTHS) {
  await page.setViewportSize({ width: w, height: w < 600 ? 844 : 900 });
  await page.emulateMedia({ colorScheme: theme });
  for (const r of ROUTES) {
    await page.goto(`${BASE}${r}`, { waitUntil: "networkidle" });
    await page.evaluate((th) => { document.documentElement.dataset.theme = th; try { localStorage.setItem("docustay-theme", th); } catch {} }, theme);
    await page.waitForTimeout(900);
    if (CLICK) { await page.getByRole("tab", { name: new RegExp(`^${CLICK}`) }).or(page.getByRole("button", { name: CLICK })).first().click(); await page.waitForTimeout(1500); }
    if (SCROLL) await page.evaluate((y) => { (document.querySelector("[data-scroll-main]") ?? window).scrollTo(0, Number(y)); }, SCROLL);
    const f = `${OUT}/${r.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "root"}${CLICK ? "-" + CLICK.replace(/\W+/g, "") : ""}-${w}-${theme}.png`;
    await page.screenshot({ path: f, fullPage: false }); console.log(f);
  }
}
if (problems.length) console.log("problems:", [...new Set(problems)].slice(0, 8).join(" | "));
await browser.close();
