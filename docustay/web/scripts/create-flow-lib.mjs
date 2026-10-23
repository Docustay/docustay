// Walks the document editor's six stages (Start → Who signs → Prepare → Details → Check → Send) the way a person does, on BETA, and records what it sees. Shared by the create-flow recon and matrix.
import { BETA_WEB } from "./pm-lib.mjs";
export const QA = "trtheking97@gmail.com";
export function recorder(page, out, tag) {
  const log = []; const note = (kind, msg) => { log.push({ kind, msg }); console.log(`  [${kind}] ${msg}`); };
  const shot = async (n) => { await page.waitForTimeout(500); await page.screenshot({ path: `${out}/${tag}-${n}.png` }).catch(() => {}); };
  const errs = []; page.on("pageerror", (e) => errs.push(String(e).slice(0, 200))); page.on("response", (r) => { if (r.status() >= 500) errs.push(`${r.status()} ${r.url().slice(0, 100)}`); });
  return { log, note, shot, errs };
}
const stageOf = async (page) => (await page.locator('[aria-current="step"]').first().innerText().catch(() => "")).replace(/\s+/g, " ").trim();
/** Who signs: give each person a name and an email (QA inbox plus-addresses), then Next. */
export async function whoSigns(page, rec, tag) {
  const names = page.locator('input[aria-label^="Name of person"]'); const n = await names.count();
  for (let i = 0; i < n; i++) {
    await names.nth(i).fill(`Tester ${i + 1}`);
    await page.locator(`input[aria-label="Email of person ${i + 1}"]`).fill(`trtheking97+${tag}${i + 1}@gmail.com`);
  }
  rec.note("info", `Who signs: ${n} people`); await rec.shot("2-who"); 
  await page.getByRole("button", { name: "Next" }).click(); await page.waitForTimeout(1200);
}
/** Click Next until the Send stage; returns the stage names visited and any message shown. */
export async function throughToSend(page, rec) {
  const seen = [];
  for (let i = 0; i < 6; i++) {
    const st = await stageOf(page); seen.push(st); rec.note("stage", st);
    await rec.shot(`stage-${i + 3}`);
    const alerts = await page.locator('[role="alert"]:visible').allInnerTexts().catch(() => []); for (const a of alerts) rec.note("alert", a.trim().slice(0, 160));
    if (/Send/.test(st) && !/Check/.test(st)) break;
    const next = page.getByRole("button", { name: /^(Next|Continue)$/ }); if (!(await next.count())) { rec.note("problem", `no Next button on stage "${st}"`); break; }
    if (await next.first().isDisabled()) { rec.note("problem", `Next is disabled on stage "${st}"`); break; }
    await next.first().click(); await page.waitForTimeout(1500);
  }
  return seen;
}
/** Fill every box in "Your parts to fill in" (text boxes with a sample, choices with their first real choice). */
export async function fillSenderParts(page, rec) {
  const rows = page.locator('[data-testid="sender-field"]'); const n = await rows.count();
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i); const inp = row.locator('[data-testid="sender-field-input"]');
    const tag = await inp.evaluate((e) => e.tagName);
    if (tag === "SELECT") { const opts = await inp.locator("option").evaluateAll((o) => o.map((x) => x.value).filter(Boolean)); if (opts[0]) await inp.selectOption(opts[0]); }
    else if ((await inp.inputValue()) === "") { const ty = await inp.getAttribute("type"); await inp.fill(ty === "date" ? "2026-11-01" : ty === "email" ? "sender@example.test" : ty === "tel" ? "+1 555 010 0100" : "Sample answer"); }
  }
  rec.note("info", `filled ${n} sender boxes`);
}
import { spawnSync } from "node:child_process";
/** The signing link from the email sent to one QA address (read from the QA inbox; waits up to a minute). */
export function signLinkFor(to, sinceEpoch) {
  const py = `
import imaplib,email,subprocess,re,sys,time
pw=subprocess.run(["gcloud","secrets","versions","access","latest","--project=example-project","--secret=docustay-qa-gmail-app-password"],capture_output=True,text=True).stdout.strip().replace(" ","")
for i in range(30):
    m=imaplib.IMAP4_SSL("imap.gmail.com"); m.login("trtheking97@gmail.com",pw)
    ids=[]
    for box in ("INBOX","[Gmail]/Spam"):
        m.select('"%s"'%box,readonly=True); t,d=m.search(None,'(SUBJECT "(to ${to})")'); ids+=[(box,x) for x in d[0].split()]
    for box,mid in reversed(ids):
        m.select('"%s"'%box,readonly=True)
        msg=email.message_from_bytes(m.fetch(mid,"(RFC822)")[1][0][1])
        if email.utils.parsedate_to_datetime(msg["Date"]).timestamp()<${sinceEpoch}-5: continue
        body=""
        for p in msg.walk():
            if p.get_content_type() in ("text/plain","text/html"): body+=p.get_payload(decode=True).decode(errors="ignore")
        c=re.findall(r"https://[^\\s\\"'<>]*(?:/sign|/s/)[^\\s\\"'<>]*",body)
        if c: print(c[0].replace("&amp;","&")); sys.exit(0)
    m.logout(); time.sleep(4)
sys.exit(1)`;
  const r = spawnSync("python3", ["-c", py], { encoding: "utf8" }); if (r.status !== 0) throw new Error(`no signing email arrived for ${to}`); return r.stdout.trim();
}
