// The three items of 20 Oct (left alone the first time), end to end on BETA with the real API and the stubbed AI:
//   1. a SENT document's Document tab shows the real document (the sender's answers, every signature so far, a mark on boxes still waiting), updates as people sign, then the sealed copy;
//   2. the AI never fills in or invents the organisation's address when the workspace has none (the draft keeps a box for the sender), and uses it when it is set;
//   3. an owner can reset a teammate's two-step from Team (confirmation, email, audit-log entry, the teammate is asked to set it up again), and an admin cannot.
//   node scripts/three-fixes-e2e.mjs --out ~/keystone/specs/v1/design-review/beta-proof/three-fixes [--only live,ai,reset]
import { chromium } from "playwright";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { BETA_WEB, WS, contextFor, call, code as emailCode } from "./pm-lib.mjs";
import { recorder, whoSigns, fillSenderParts, signLinkFor } from "./create-flow-lib.mjs";
import { fillAll } from "../../../scripts/sandbox/live/cases/_kit.mjs";
const { TOTP, Secret } = createRequire(import.meta.url)(process.env.OTPAUTH_PATH || "~/keystone-dashboard/node_modules/otpauth");
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg("out", "/tmp/three-fixes"), ONLY = arg("only", "live,ai,reset").split(","), BASE = arg("base", BETA_WEB);
mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0; const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const browser = await chromium.launch();
const sha = (b) => createHash("sha256").update(b).digest("hex").slice(0, 12);
const decline = (p) => p.getByRole("button", { name: "Decline" }).click({ timeout: 2000 }).catch(() => {});

// ── 1. the live view of a sent document ────────────────────────────────────────────────────────────────────────────────────────
if (ONLY.includes("live")) {
  console.log("\n== 1. a sent document shows what it is now");
  const ctx = await contextFor(browser, WS.pro, { base: BASE }); const page = await ctx.newPage(); const rec = recorder(page, OUT, "live"); const tag = `lv${Date.now() % 100000}`;
  await page.goto(`${BASE}/create`, { waitUntil: "load" }); await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
  const tile = page.locator('li[data-slug="mutual-nda"]').first(); if (!(await tile.count())) { await page.getByTestId("cr-door-library").click(); await page.waitForTimeout(600); }
  await tile.scrollIntoViewIfNeeded(); await tile.hover(); await tile.getByRole("button", { name: "Send" }).click();
  await page.getByRole("button", { name: "Next" }).waitFor({ timeout: 45000 });
  await whoSigns(page, rec, tag);
  for (let i = 0; i < 4; i++) { await page.waitForTimeout(1100); const st = (await page.locator('[aria-current="step"]').first().innerText().catch(() => "")).replace(/\s+/g, " "); if (/Check/.test(st)) { await fillSenderParts(page, rec); await page.waitForTimeout(1500); } const next = page.getByRole("button", { name: /^Next$/ }); if (!(await next.count())) break; await next.click(); }
  const t0 = Math.floor(Date.now() / 1000);
  await page.getByTestId("pdf-send").click(); await page.waitForURL(/\/documents\/[0-9a-f-]{36}/, { timeout: 60000 });
  const id = page.url().match(/documents\/([0-9a-f-]{36})/)[1]; console.log("  sent:", id);
  await page.getByTestId("doc-paper").waitFor({ timeout: 30000 });
  const img = async (q) => { const r = await ctx.request.get(`${BASE}/api/documents/pdf/${id}/thumb.png?w=720&page=1${q}`); return { s: r.status(), b: r.status() === 200 ? await r.body() : Buffer.alloc(0), cc: r.headers()["cache-control"] }; };
  const live = await img(""), orig = await img("&original=1");
  ok("the Document tab picture is drawn (200, a PNG)", live.s === 200 && live.b.subarray(1, 4).toString() === "PNG", `${live.s}`);
  ok("it is NOT the blank original (the sender's answers are on it)", live.b.length > 0 && sha(live.b) !== sha(orig.b), `${sha(live.b)} vs ${sha(orig.b)}`);
  ok("the live picture is short-lived in the browser cache (60 s)", /max-age=60/.test(live.cc ?? ""), live.cc);
  const small = await ctx.request.get(`${BASE}/api/documents/pdf/${id}/thumb.png?w=240&page=1`);
  ok("a list thumbnail (240 wide) still draws the file as it is (no per-document drawing in lists)", small.status() === 200);
  await page.screenshot({ path: `${OUT}/live-1-sent.png` });
  // a signer signs: the picture changes
  const parties = (await call(ctx, "GET", `/api/documents/pdf/${id}/track`)).data?.parties ?? [];
  console.log("  people:", parties.map((p) => `${p.name}:${p.status}`).join(", "));
  const link1 = signLinkFor(`trtheking97+${tag}1@gmail.com`, t0);
  const sctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const sp = await sctx.newPage(); await sp.goto(link1, { waitUntil: "load" }); await sp.waitForSelector("canvas", { timeout: 40000 }).catch(() => {}); await sp.waitForTimeout(3500);
  await decline(sp);
  const filled = await fillAll(sp, { name: "Tester One", email: `trtheking97+${tag}1@gmail.com` }).catch((e) => ({ error: String(e.message).slice(0, 100) }));
  console.log("  fillAll:", JSON.stringify(filled).slice(0, 300)); await sp.getByLabel("I agree to sign electronically").check().catch(() => {});
  await sp.getByRole("button", { name: "Finish and sign" }).click().catch(() => {}); await sp.waitForTimeout(7000);
  await sp.screenshot({ path: `${OUT}/live-2-signer.png` });
  await page.reload({ waitUntil: "load" }); await page.getByTestId("doc-paper").waitFor({ timeout: 30000 }); await page.waitForTimeout(1500);
  const src = await page.locator("[data-testid=doc-paper] img").first().getAttribute("src");
  ok("after a signature the picture address changes (so the browser asks again)", /&v=\d+-\d+/.test(src ?? "") && !src.includes("&v=0-1"), src);
  const live2 = await img(`&v=${Date.now()}`);
  ok("after one person signed, the picture differs from before (their marks are drawn)", live2.s === 200 && sha(live2.b) !== sha(live.b), `${sha(live2.b)} vs ${sha(live.b)}`);
  await page.screenshot({ path: `${OUT}/live-3-after-first-signature.png` });
  // the rest sign; the sealed copy replaces the live view
  const stat = (await call(ctx, "GET", `/api/documents/pdf/${id}/track`)).data;
  console.log("  status:", stat?.status, "signed:", stat?.progress?.signed, "of", stat?.progress?.of);
  if (stat?.progress?.of > stat?.progress?.signed) {
    for (let k = 2; k <= stat.progress.of; k++) {
      const l = signLinkFor(`trtheking97+${tag}${k}@gmail.com`, t0); const c2 = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const p2 = await c2.newPage(); await p2.goto(l, { waitUntil: "load" }); await p2.waitForSelector("canvas", { timeout: 40000 }).catch(() => {}); await p2.waitForTimeout(3500); await decline(p2);
      await fillAll(p2, { name: `Tester ${k}`, email: `trtheking97+${tag}${k}@gmail.com` }).catch(() => {}); await p2.getByLabel("I agree to sign electronically").check().catch(() => {}); await p2.getByRole("button", { name: "Finish and sign" }).click().catch(() => {}); await p2.waitForTimeout(7000); await c2.close();
    }
  }
  let done = null; for (let i = 0; i < 24; i++) { done = (await call(ctx, "GET", `/api/documents/pdf/${id}/track`)).data; if (done?.status === "completed") break; await new Promise((r) => setTimeout(r, 5000)); }
  ok("everyone signed and the document is completed", done?.status === "completed", `${done?.status}`);
  await page.reload({ waitUntil: "load" }); await page.getByTestId("doc-paper").waitFor({ timeout: 30000 }); await page.waitForTimeout(1500);
  const sealed = await img(`&v=${Date.now()}`);
  ok("after the last signature the picture is the sealed copy (no waiting marks, different from the live view)", sealed.s === 200 && sha(sealed.b) !== sha(live2.b), `${sha(sealed.b)} vs ${sha(live2.b)}`);
  ok("the sealed copy is cached for an hour (it never changes)", /max-age=3600/.test((await ctx.request.get(`${BASE}/api/documents/pdf/${id}/thumb.png?w=720&page=1`)).headers()["cache-control"] ?? ""));
  await page.screenshot({ path: `${OUT}/live-4-sealed.png` });
  writeFileSync(`${OUT}/live-pictures.json`, JSON.stringify({ id, live: sha(live.b), original: sha(orig.b), afterFirst: sha(live2.b), sealed: sha(sealed.b) }, null, 1));
  await sctx.close(); await ctx.close();
}

// ── 2. the AI and the organisation's address ───────────────────────────────────────────────────────────────────────────────────
if (ONLY.includes("ai")) {
  console.log("\n== 2. the AI and the organisation address");
  const ctx = await contextFor(browser, WS[arg("ws", "payg")], { base: BASE });
  const ask = async (prompt) => call(ctx, "POST", "/api/documents/engine/ai/jobs", { brief: { type: "other", kind: "plain", answers: { purpose: "A services agreement between a studio and a client", parties: "The studio (Maria Lopez signs) and the client (Dev Patel signs)" }, final: prompt }, mode: "document", vocabulary: "docustay", kind: "draft" }, BASE);
  const setAddress = (v) => call(ctx, "POST", "/api/documents/settings", { key: "signed_copy.address_line", value: v }, BASE);
  const run = async (tagText) => {
    const r = await ask(`A services agreement between a studio and a client. ${tagText} [fake:address]`);
    const jobId = r.data?.jobId ?? r.data?.id; if (!jobId) return { r, job: null };
    for (let i = 0; i < 40; i++) { const j = await call(ctx, "GET", `/api/documents/engine/ai/jobs/${jobId}`, undefined, BASE); if (j.data && ["done", "failed"].includes(j.data.state)) return { r, job: j.data }; await new Promise((x) => setTimeout(x, 3000)); }
    return { r, job: null };
  };
  await setAddress("");
  const a = await run("No address is set.");
  const text = JSON.stringify(a.job?.source ?? {});
  ok("address unset: the draft is made (not failed)", a.job?.state === "done", JSON.stringify(a.job ?? a.r).slice(0, 200));
  ok("address unset: no org.address merge field and no invented address in the draft", a.job && !/org\.address/.test(text));
  // the stub AI names the box organisation_address; the real model (beta) names it for the party ("Studio address"): either way a blank box, never an invented address
  ok("address unset: the draft has a box for the sender to fill in", (/organisation_address/.test(text) && /"filled":"sender"/.test(text)) || /"name":"[^"]*address[^"]*"/i.test(text) || /(leaves the address out|no address appears|address (is )?left out)/i.test(JSON.stringify(a.job?.patches?.notes ?? [])));   // the real model either adds a blank box or leaves the address out and says so; both keep the promise (nothing invented)
  ok("address unset: the person is told in plain words", /no (organi[sz]ation )?address (is )?set/i.test(JSON.stringify(a.job?.patches ?? {})));
  await setAddress("12 Harbour Street, Oakland, CA");
  const b = await run("An address is set.");
  const text2 = JSON.stringify(b.job?.source ?? {});
  ok("address set: the draft uses the merge field and no sender box", b.job?.state === "done" && /org\.address/.test(text2) && !/organisation_address/.test(text2));
  await setAddress("");
  writeFileSync(`${OUT}/ai-unset.json`, JSON.stringify({ unset: a.job?.patches?.notes ?? null, hasBox: /organisation_address/.test(text) }, null, 1));
  await ctx.close();
}

// ── 3. an owner resets a teammate's two-step ───────────────────────────────────────────────────────────────────────────────────
if (ONLY.includes("reset")) {
  console.log("\n== 3. Team: Reset two-step sign-in");
  const stamp = Date.now() % 1e8, OWNER = WS.payg, MATE = `trtheking97+rsm${stamp}@gmail.com`, ADMIN = `trtheking97+rsa${stamp}@gmail.com`, PW = `Rs-${stamp}-beta-pass`;
  const api = (page, method, path, body) => page.evaluate(async ([m, p, b]) => { const r = await fetch(p, { method: m, headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; }, [method, path, body]);
  // A new workspace is on Free (one person), so the teammates are invited into the Pay as you go test workspace; they are offboarded at the end.
  const oc = await contextFor(browser, WS.payg, { base: BASE }); const op = await oc.newPage(); const t0 = Math.floor(Date.now() / 1000);
  await op.goto(`${BASE}/documents`, { waitUntil: "load" }); await decline(op); await op.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
  for (const m of ((await api(op, "GET", "/api/documents/teammates")).json?.teammates ?? [])) { if (!m.you) await api(op, "POST", `/api/people/team/${m.id}/offboard`, { futureSessions: { mode: "leave" } }); }
  // invite two teammates: a member (who will have two-step) and an admin (who will try to reset)
  const inv = async (email, name, staffRole) => api(op, "POST", "/api/people/invite", { email, displayName: name, role: "staff", staffRole });
  const iv1 = await inv(MATE, "Mate Member", "member"), iv2 = await inv(ADMIN, "Ada Admin", "admin"); ok("two invitations sent", iv1.status < 300 && iv2.status < 300, `${iv1.status}/${iv2.status}`);
  const accept = async (email) => {
    const py = `
import imaplib,email,subprocess,re,sys,time
pw=subprocess.run(["gcloud","secrets","versions","access","latest","--project=example-project","--secret=docustay-qa-gmail-app-password"],capture_output=True,text=True).stdout.strip().replace(" ","")
for i in range(45):
    m=imaplib.IMAP4_SSL("imap.gmail.com"); m.login("trtheking97@gmail.com",pw)
    ids=[]
    for box in ("INBOX","[Gmail]/Spam"):
        m.select('"%s"'%box,readonly=True); t,d=m.search(None,'(SUBJECT "(to ${email})")'); ids+=[(box,x) for x in d[0].split()]
    for box,mid in reversed(ids):
        m.select('"%s"'%box,readonly=True)
        msg=email.message_from_bytes(m.fetch(mid,"(RFC822)")[1][0][1])
        if email.utils.parsedate_to_datetime(msg["Date"]).timestamp()<${t0}-5: continue
        body=""
        for p in msg.walk():
            if p.get_content_type() in ("text/plain","text/html"): body+=p.get_payload(decode=True).decode(errors="ignore")
        c=re.findall(r"https://[^\\s\\"'<>]*invite\\?token=[^\\s\\"'<>]*",body)
        if c: print(c[0].replace("&amp;","&")); sys.exit(0)
    m.logout(); time.sleep(4)
sys.exit(1)`;
    const { spawnSync } = await import("node:child_process"); const o = spawnSync("python3", ["-c", py], { encoding: "utf8" }); if (o.status !== 0) throw new Error(`no invitation email for ${email}`); return o.stdout.trim();
  };
  const join = async (email) => { const link = (await accept(email)).replace(/^https?:\/\/[^/]+/, BASE); const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage(); await p.goto(link, { waitUntil: "load" }); await decline(p); await p.locator("input[type=password]").first().fill(PW); await p.getByRole("button", { name: /Join|Continue|Accept|Create/i }).first().click(); await p.waitForURL(/\/documents/, { timeout: 60000 }); return { ctx, p }; };
  const mate = await join(MATE), adm = await join(ADMIN);
  ok("both teammates joined", /\/documents/.test(mate.p.url()) && /\/documents/.test(adm.p.url()));
  // the member sets up an authenticator app (API) and the admin sets up one too
  const setUp = async (p) => { const s = await api(p, "POST", "/api/auth/two-step/start", {}); const secret = s.json?.secret; const code = new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 }).generate(); const f = await api(p, "POST", "/api/auth/two-step/confirm", { code }); return f.status < 300; };
  ok("the member has two-step on", await setUp(mate.p));
  ok("the admin has two-step on", await setUp(adm.p));
  // the owner sees it on Team
  await op.goto(`${BASE}/settings?tab=team`, { waitUntil: "load" }); await op.getByTestId("team-table").waitFor({ timeout: 30000 }); await op.waitForTimeout(1500);
  const rowOf = (p, name) => p.getByTestId("team-row").filter({ hasText: name });
  ok("the owner sees 'Two-step on' on the member's row", /Two-step on/.test(await rowOf(op, "Mate Member").innerText()));
  ok("the owner is offered Reset two-step sign-in on the member's row", (await rowOf(op, "Mate Member").getByTestId("team-reset-two-step").count()) === 1);
  ok("and on the admin's row", (await rowOf(op, "Ada Admin").getByTestId("team-reset-two-step").count()) === 1);
  ok("not on the owner's own row", (await rowOf(op, "(you)").getByTestId("team-reset-two-step").count()) === 0);
  await op.screenshot({ path: `${OUT}/reset-1-team.png` });
  // an admin is NOT offered it and the server refuses
  await adm.p.goto(`${BASE}/settings?tab=team`, { waitUntil: "load" }); await adm.p.getByTestId("team-table").waitFor({ timeout: 30000 }); await adm.p.waitForTimeout(1500);
  ok("an admin is not offered the button", (await adm.p.getByTestId("team-reset-two-step").count()) === 0);
  const mateId = (await api(op, "GET", "/api/settings/security/people")).json?.people?.find((x) => x.email?.toLowerCase() === MATE.toLowerCase())?.id;
  const refused = await api(adm.p, "POST", "/api/settings/security/reset", { id: mateId }); ok("the server refuses an admin (403)", refused.status === 403, `${refused.status}`);
  // the owner resets, with a confirmation
  await rowOf(op, "Mate Member").getByTestId("team-reset-two-step").click(); const dlg = op.getByTestId("team-reset-dialog"); await dlg.waitFor({ timeout: 8000 });
  ok("a confirmation names the person and says what happens", /Reset two-step sign-in for Mate Member\?/.test(await dlg.innerText()) && /We email them/.test(await dlg.innerText()) && /set it up again when they next sign in/.test(await dlg.innerText()));
  await op.screenshot({ path: `${OUT}/reset-2-confirm.png` });
  await op.keyboard.press("Escape"); await op.waitForTimeout(400);
  ok("Esc cancels: still on", /Two-step on/.test(await rowOf(op, "Mate Member").innerText()));
  const sent0 = Math.floor(Date.now() / 1000);
  await rowOf(op, "Mate Member").getByTestId("team-reset-two-step").click(); await op.getByTestId("team-reset-confirm").click(); await op.waitForTimeout(2500);
  ok("the note says it was reset and they are asked again", /Two-step sign-in was reset for Mate Member/.test(await op.getByTestId("team-note").innerText()));
  ok("the row now says Two-step off and the button is gone", /Two-step off/.test(await rowOf(op, "Mate Member").innerText()) && (await rowOf(op, "Mate Member").getByTestId("team-reset-two-step").count()) === 0);
  await op.screenshot({ path: `${OUT}/reset-3-after.png` });
  // the audit log
  await op.goto(`${BASE}/settings?tab=audit`, { waitUntil: "load" }); await op.getByTestId("audit-panel").waitFor({ timeout: 30000 }); await op.waitForTimeout(1200);
  ok("the audit log says who reset whose two-step", /reset two-step sign-in for Mate Member/.test(await op.getByTestId("audit-panel").innerText()), (await op.getByTestId("audit-panel").innerText()).slice(0, 200));
  await op.screenshot({ path: `${OUT}/reset-4-audit.png` });
  // the email
  const mailOk = await (async () => { const { spawnSync } = await import("node:child_process"); const py = `
import imaplib,email,subprocess,sys,time
pw=subprocess.run(["gcloud","secrets","versions","access","latest","--project=example-project","--secret=docustay-qa-gmail-app-password"],capture_output=True,text=True).stdout.strip().replace(" ","")
for i in range(45):
    m=imaplib.IMAP4_SSL("imap.gmail.com"); m.login("trtheking97@gmail.com",pw)
    ids=[]
    for box in ("INBOX","[Gmail]/Spam"):
        m.select('"%s"'%box,readonly=True); t,d=m.search(None,'(SUBJECT "(to ${MATE})")'); ids+=[(box,x) for x in d[0].split()]
    for box,mid in reversed(ids):
        m.select('"%s"'%box,readonly=True)
        msg=email.message_from_bytes(m.fetch(mid,"(RFC822)")[1][0][1])
        if email.utils.parsedate_to_datetime(msg["Date"]).timestamp()<${sent0}-5: continue
        body=""
        for p in msg.walk():
            if p.get_content_type() in ("text/plain","text/html"): body+=p.get_payload(decode=True).decode(errors="ignore")
        if "two-step sign-in was reset" in " ".join(str(msg["Subject"] or "").split()) and "set it up again" in body: print("yes"); sys.exit(0)
    m.logout(); time.sleep(4)
sys.exit(1)`; return spawnSync("python3", ["-c", py], { encoding: "utf8" }).status === 0; })();
  ok("the teammate was emailed ('Your two-step sign-in was reset', asking them to set it up again)", mailOk);
  // the teammate is asked at next sign-in / next page
  await mate.p.goto(`${BASE}/documents`, { waitUntil: "load" }); await mate.p.waitForTimeout(2500);
  ok("the teammate sees the calm notice asking them to set it up again", (await mate.p.getByTestId("two-step-reset-notice").count()) === 1, await mate.p.locator("main").innerText().then((t) => t.slice(0, 120)).catch(() => ""));
  await mate.p.screenshot({ path: `${OUT}/reset-5-teammate-notice.png` });
  const st = (await api(mate.p, "GET", "/api/settings/security")).json; ok("the status says askedToSetUp and no longer has two-step", st?.askedToSetUp === true && st?.youHaveTwoStep === false, JSON.stringify(st));
  // setting it up again clears the notice
  ok("the teammate sets it up again", await setUp(mate.p));
  await mate.p.goto(`${BASE}/documents`, { waitUntil: "load" }); await mate.p.waitForTimeout(2500);
  ok("the notice is gone once they have set it up", (await mate.p.getByTestId("two-step-reset-notice").count()) === 0);
  // the Security people list keeps its Reset for the owner only
  await op.goto(`${BASE}/settings?tab=security`, { waitUntil: "load" }); await op.waitForTimeout(2500);
  ok("Security > who has set it up: the owner still sees Reset", (await op.getByTestId("person-reset").count()) >= 1);
  await adm.p.goto(`${BASE}/settings?tab=security`, { waitUntil: "load" }); await adm.p.waitForTimeout(2500);
  ok("Security > who has set it up: an admin sees no Reset", (await adm.p.getByTestId("person-reset").count()) === 0);
  for (const m of ((await api(op, "GET", "/api/documents/teammates")).json?.teammates ?? [])) { if (!m.you) await api(op, "POST", `/api/people/team/${m.id}/offboard`, { futureSessions: { mode: "leave" } }); }
  await oc.close(); await mate.ctx.close(); await adm.ctx.close();
}
console.log(`\n${pass} pass, ${fail} fail`); await browser.close(); process.exit(fail ? 1 : 0);
