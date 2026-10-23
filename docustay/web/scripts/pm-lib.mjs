// Shared by the plan-prompt matrix (scripts/pm-*.mjs): four throwaway BETA workspaces (one per plan), their sign-in, and the helpers that set a plan state and read the app's own answers.
// Sign-in state is kept in /tmp so the emailed code is asked for once per workspace. BETA ONLY.
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
export const BETA_WEB = "https://host.example.com";
export const WS = { free: "trtheking97+pm-free@gmail.com", payg: "trtheking97+pm-payg@gmail.com", pro: "trtheking97+pm-pro@gmail.com", lifetime: "trtheking97+pm-life@gmail.com" };
export const code = (email, since) => { const py = `
import imaplib,email,subprocess,re,sys,time
pw=subprocess.run(["gcloud","secrets","versions","access","latest","--project=example-project","--secret=docustay-qa-gmail-app-password"],capture_output=True,text=True).stdout.strip().replace(" ","")
for i in range(15):
    m=imaplib.IMAP4_SSL("imap.gmail.com"); m.login("trtheking97@gmail.com",pw); m.select("INBOX")
    t,d=m.search(None,'(SUBJECT "${email}")'); ids=d[0].split()
    if not ids: t,d=m.search(None,'(TO "${email}")'); ids=d[0].split()
    if ids:
        msg=email.message_from_bytes(m.fetch(ids[-1],"(RFC822)")[1][0][1]); body=""
        for p in msg.walk():
            if p.get_content_type()=="text/plain": body+=p.get_payload(decode=True).decode(errors="ignore")
        c=re.findall(r"\\b\\d{6}\\b",body)
        if c and email.utils.parsedate_to_datetime(msg["Date"]).timestamp()>=${since}-5: print(c[0]); sys.exit(0)
    m.logout(); time.sleep(4)
sys.exit(1)`; const r = spawnSync("python3", ["-c", py], { encoding: "utf8" }); if (r.status !== 0) throw new Error("no sign-in code arrived"); return r.stdout.trim(); };
export const stateFile = (email, base = BETA_WEB) => `/tmp/ds-state-${email.replace(/[^a-z0-9]/gi, "_")}${base === BETA_WEB ? "" : "-" + base.replace(/[^a-z0-9]/gi, "_")}.json`;
/** A signed-in browser context for one workspace; signs up (code from the QA inbox) the first time. */
export async function contextFor(browser, email, { base = BETA_WEB, width = 1440, height = 900, colorScheme = "light" } = {}) {
  const STATE = stateFile(email, base);
  let ctx = await browser.newContext({ viewport: { width, height }, colorScheme, ...(existsSync(STATE) ? { storageState: STATE } : {}) });
  let page = await ctx.newPage();
  await page.goto(`${base}/documents`, { waitUntil: "load", timeout: 90000 }); await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});   // the live-update stream never goes quiet on a busy host, so "idle" is best effort
  if (!/\/documents/.test(page.url())) {
    const t0 = Math.floor(Date.now() / 1000);
    await page.goto(`${base}/signup`); try { await page.getByRole("button", { name: "Decline" }).click({ timeout: 3000 }); } catch {}
    await page.getByRole("textbox", { name: "Email" }).fill(email); await page.locator("input[type=checkbox]").first().check(); await page.getByRole("button", { name: "Email me a code" }).click();
    const c = code(email, t0); await page.locator("input").first().click(); await page.keyboard.type(c); await page.waitForURL(/\/documents/, { timeout: 60000 });
    await ctx.storageState({ path: STATE });
  }
  await page.close();
  return ctx;
}
/** The app's own JSON, fetched as the signed-in person. */
export async function call(ctx, method, path, body, base = BETA_WEB) {
  const r = await ctx.request.fetch(`${base}${path}`, { method, headers: { accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}), "idempotency-key": crypto.randomUUID() }, ...(body !== undefined ? { data: JSON.stringify(body) } : {}) });
  let json = null; try { json = await r.json(); } catch { /* not JSON */ }
  return { status: r.status(), ok: r.ok(), json, data: json?.data ?? json, code: json?.error?.detail?.code ?? null, message: json?.error?.message ?? null, detail: json?.error?.detail ?? null };
}
export const preflight = (ctx, action, extra = {}) => call(ctx, "POST", "/api/product/docustay/preflight", { action, ...extra }).then((r) => r.data);
export const status = (ctx) => call(ctx, "GET", "/api/product/docustay/status").then((r) => r.data);
export const outDir = (p) => { mkdirSync(p, { recursive: true }); return p; };
export { chromium };
