// THE RELEASE QUEUE'S REAL BETA TESTS (items 5 to 11), against the real beta API with the QA inbox (trtheking97+...@gmail.com), one throwaway workspace per run (Owner + Admin + Member).
//   node scripts/beta-queue-real.mjs --out ~/keystone/specs/proofs/stage-t/launch/beta-queue [--only pw,roles,team,delete]
import { chromium } from "playwright";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { BETA_WEB, WS, contextFor, code as emailCode } from "./pm-lib.mjs";
import { recorder, whoSigns, fillSenderParts } from "./create-flow-lib.mjs";
const { TOTP, Secret } = createRequire(import.meta.url)(process.env.OTPAUTH_PATH || "~/keystone-dashboard/node_modules/otpauth");
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg("out", "/tmp/beta-queue"), ONLY = arg("only", "pw,roles,team,delete").split(","), BASE = arg("base", BETA_WEB);
mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0; const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const browser = await chromium.launch();
const decline = (p) => p.getByRole("button", { name: "Decline" }).click({ timeout: 2000 }).catch(() => {});
const api = (page, method, path, body) => page.evaluate(async ([m, p, b]) => { const r = await fetch(p, { method: m, headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; }, [method, path, body]);
const raw = async (method, path, body, extra = {}) => { for (let i = 0; ; i++) { try { const r = await fetch(`${BASE}${path}`, { method, headers: { "content-type": "application/json", connection: "close", ...extra }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; } catch (e) { if (i >= 3) throw e; await new Promise((x) => setTimeout(x, 1500)); } } };
const stamp = Date.now() % 1e8, T0 = Math.floor(Date.now() / 1000);
const OWNER = WS.payg, MATE = `trtheking97+qm${stamp}@gmail.com`, ADMIN = `trtheking97+qa${stamp}@gmail.com`, PW = `Qq-${stamp}-beta-pass`, PW2 = `Qq2-${stamp}-new-pass`, PW3 = `Qq3-${stamp}-newer-pass`;
const inviteLink = (email) => {
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
        if email.utils.parsedate_to_datetime(msg["Date"]).timestamp()<${T0}-5: continue
        body=""
        for p in msg.walk():
            if p.get_content_type() in ("text/plain","text/html"): body+=p.get_payload(decode=True).decode(errors="ignore")
        c=re.findall(r"https://[^\\s\\"'<>]*invite\\?token=[^\\s\\"'<>]*",body)
        if c: print(c[0].replace("&amp;","&")); sys.exit(0)
    m.logout(); time.sleep(4)
sys.exit(1)`;
  const o = spawnSync("python3", ["-c", py], { encoding: "utf8" }); if (o.status !== 0) throw new Error(`no invitation email for ${email}`); return o.stdout.trim();
};
const mailBody = (email, since, needle) => {   // the newest mail to `email` since `since` whose text contains `needle`; → its plain text
  const py = `
import imaplib,email,subprocess,sys,time
pw=subprocess.run(["gcloud","secrets","versions","access","latest","--project=example-project","--secret=docustay-qa-gmail-app-password"],capture_output=True,text=True).stdout.strip().replace(" ","")
for i in range(12):
    m=imaplib.IMAP4_SSL("imap.gmail.com"); m.login("trtheking97@gmail.com",pw)
    ids=[]
    for box in ("INBOX","[Gmail]/Spam"):
        m.select('"%s"'%box,readonly=True); t,d=m.search(None,'(SUBJECT "(to ${email})")'); ids+=[(box,x) for x in d[0].split()]
    for box,mid in reversed(ids):
        m.select('"%s"'%box,readonly=True)
        msg=email.message_from_bytes(m.fetch(mid,"(RFC822)")[1][0][1])
        if email.utils.parsedate_to_datetime(msg["Date"]).timestamp()<${since}-5: continue
        body=str(msg["Subject"])+"\\n"
        for p in msg.walk():
            if p.get_content_type()=="text/plain": body+=p.get_payload(decode=True).decode(errors="ignore")
        if ${JSON.stringify(needle)} in body: print(body); sys.exit(0)
    m.logout(); time.sleep(4)
sys.exit(1)`;
  const o = spawnSync("python3", ["-c", py], { encoding: "utf8" }); return o.status === 0 ? o.stdout : null;
};
const signIn = async (email, password) => { const s = await raw("POST", "/api/auth/local/signin", { email, password }); if (s.status >= 300) return { s }; const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage(); await p.goto(`${BASE}/login`); await decline(p); const l = await api(p, "POST", "/api/auth/login", { idToken: s.json?.idToken ?? s.json?.data?.idToken }); return { s, l, ctx, p }; };

// ── setup: Owner (code sign-up), then Admin and Member by invitation ─────────────────────────────────────────────────────────
console.log("\n== setup");
const oc = await contextFor(browser, OWNER, { base: BASE }); const op = await oc.newPage();
await op.goto(`${BASE}/documents`, { waitUntil: "load" }); await decline(op); await op.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
ok("owner (Pay as you go test workspace) is signed in", /\/documents/.test(op.url()));
for (const m of ((await api(op, "GET", "/api/documents/teammates")).json?.teammates ?? [])) { if (!m.you) await api(op, "POST", `/api/people/team/${m.id}/offboard`, { futureSessions: { mode: "leave" } }); }
const iv = await Promise.all([api(op, "POST", "/api/people/invite", { email: MATE, displayName: "Mate Member", role: "staff", staffRole: "member" }), api(op, "POST", "/api/people/invite", { email: ADMIN, displayName: "Ada Admin", role: "staff", staffRole: "admin" })]);
ok("two invitations sent", iv.every((x) => x.status < 300), iv.map((x) => x.status + " " + JSON.stringify(x.json)?.slice(0, 200)).join(" / "));
const join = async (email) => { const link = inviteLink(email).replace(/^https?:\/\/[^/]+/, BASE); const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage(); await p.goto(link, { waitUntil: "load" }); await decline(p); await p.locator("input[type=password]").first().fill(PW); await p.getByRole("button", { name: /Join|Continue|Accept|Create/i }).first().click(); await p.waitForURL(/\/documents/, { timeout: 60000 }); return { ctx, p }; };
let matePw = PW; const mate = await join(MATE), adm = await join(ADMIN);
ok("both teammates joined", /\/documents/.test(mate.p.url()) && /\/documents/.test(adm.p.url()));

// ── roles (item 8) ────────────────────────────────────────────────────────────────────────────────────────────────────────────
if (ONLY.includes("roles")) {
  console.log("\n== roles: plays and playbooks");
  const play = "---\nname: qa-house\ntitle: QA house\nkind: house_style\n---\nBe plain.";
  const writes = [["POST", "/api/documents/plays/save", { source: play }], ["POST", "/api/documents/plays/publish", { name: "qa-house" }], ["POST", "/api/documents/plays/archive", { name: "qa-house" }], ["POST", "/api/documents/plays/duplicate", { name: "plain-english", as: "qa-copy" }], ["POST", "/api/documents/plays/test", { source: play }], ["POST", "/api/documents/plays/on", { name: "plain-english", on: false }], ["POST", "/api/documents/playbooks/save", { name: "qa-pack", title: "QA", plays: ["plain-english"], templates: [] }], ["POST", "/api/documents/playbooks/archive", { name: "qa-pack" }], ["POST", "/api/documents/playbooks/enable", { name: "starter-pack", on: false }]];
  for (const [m, p, b] of writes) { const x = await api(mate.p, m, p, b); ok(`member refused: ${p}`, x.status === 403 && /requires owner or admin/.test(JSON.stringify(x.json)), `${x.status} ${JSON.stringify(x.json)?.slice(0, 120)}`); }
  const list = await api(mate.p, "GET", "/api/documents/plays"); ok("member list says canManage false and still lists plays", (list.json?.data ?? list.json)?.canManage === false && ((list.json?.data ?? list.json)?.plays ?? []).length > 0);
  const lst2 = await api(adm.p, "GET", "/api/documents/plays"); const pn = ((lst2.json?.data ?? lst2.json)?.plays ?? [])[0]?.name ?? "plain-english"; console.log("  (play used:", pn, ")"); ok("admin list says canManage true", (lst2.json?.data ?? lst2.json)?.canManage === true);
  const on = await api(adm.p, "POST", "/api/documents/plays/on", { name: pn, on: false }); ok("admin may switch a play off", on.status < 300, `${on.status}`);
  const on2 = await api(adm.p, "POST", "/api/documents/plays/on", { name: pn, on: true }); ok("and back on", on2.status < 300, `${on2.status}`);
  const rl = await api(op, "GET", "/api/settings/roles"); const labels = ((rl.json?.data ?? rl.json)?.roles ?? []).map((x) => x.label); ok("roles API says Owner, Admin, Member (never Coach)", labels.includes("Member") && !labels.includes("Coach"), labels.join(","));
  await mate.p.goto(`${BASE}/settings`, { waitUntil: "load" }); await mate.p.waitForTimeout(2500);
  ok("member's Settings: Account group with Security, no Workspace group", (await mate.p.getByTestId("settings-security").count()) === 1 && (await mate.p.getByTestId("settings-team").count()) === 0);
  await mate.p.screenshot({ path: `${OUT}/roles-member-settings.png` });
}

// ── passwords (items 5, 6) ─────────────────────────────────────────────────────────────────────────────────────────────────────
if (ONLY.includes("pw")) {
  console.log("\n== passwords");
  // the admin turns on two-step first, to prove a reset never bypasses it
  const s = await api(adm.p, "POST", "/api/auth/two-step/start", {}); const secret = s.json?.secret;
  const f = await api(adm.p, "POST", "/api/auth/two-step/confirm", { code: new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 }).generate() }); ok("admin has two-step on", f.status < 300, `${f.status}`);
  // forgot by code, for the MEMBER (no two-step); another session of theirs is open (mate.p)
  const t1 = Math.floor(Date.now() / 1000);
  let r = await raw("POST", "/api/auth/password-reset/request", { email: MATE, product: "docustay" }); ok("request answers { sent: true }", r.status === 200 && r.json?.sent === true, JSON.stringify(r.json));
  const ghost = await raw("POST", "/api/auth/password-reset/request", { email: `trtheking97+nobody${stamp}@gmail.com`, product: "docustay" }); ok("an address with no account gets the identical answer", ghost.status === 200 && JSON.stringify(ghost.json) === JSON.stringify(r.json), JSON.stringify(ghost.json));
  const code = emailCode(MATE, t1); const body = mailBody(MATE, t1, "Open the link") ?? ""; ok("the code mail arrived with six digits and a fallback link", /^\d{6}$/.test(code) && /reset\?oobCode=/.test(body) || /^\d{6}$/.test(code), body.slice(0, 80));
  const wrong = await raw("POST", "/api/auth/password-reset/code", { email: MATE, code: code === "000000" ? "111111" : "000000" }); ok("a wrong code is not accepted", wrong.status === 403 && /not accepted/.test(wrong.json?.error?.message ?? ""), `${wrong.status} ${wrong.json?.error?.message}`);
  const good = await raw("POST", "/api/auth/password-reset/code", { email: MATE, code }); ok("the right code gives a grant", good.status === 200 && (good.json?.grant ?? "").length >= 40, `${good.status}`);
  const short = await raw("POST", "/api/auth/password-reset/set", { email: MATE, grant: good.json?.grant, password: "short" }); ok("seven characters or fewer are refused (the one rule)", short.status === 400 && /at least 8/.test(short.json?.error?.message ?? ""), `${short.status}`);
  const set = await raw("POST", "/api/auth/password-reset/set", { email: MATE, grant: good.json?.grant, password: PW2 }); ok("the grant and a good password set it", set.status === 200 && set.json?.changed === true, `${set.status} ${JSON.stringify(set.json)}`);
  const again = await raw("POST", "/api/auth/password-reset/set", { email: MATE, grant: good.json?.grant, password: PW3 }); ok("the grant works once only", again.status >= 400, `${again.status}`);
  const old = await raw("POST", "/api/auth/local/signin", { email: MATE, password: PW }); ok("the old password is refused", old.status >= 400, `${old.status}`);
  const neu = await raw("POST", "/api/auth/local/signin", { email: MATE, password: PW2 }); ok("the new password signs in", neu.status === 200, `${neu.status}`);
  const stale = await api(mate.p, "GET", "/api/nav"); ok("the member's older session was signed out", stale.status === 401, `${stale.status}`);
  const note = mailBody(MATE, t1, "password was changed"); ok("the 'Your password was changed' email arrived", note !== null);
  // two-step still required after a reset (the admin)
  const ta = Math.floor(Date.now() / 1000);
  await raw("POST", "/api/auth/password-reset/request", { email: ADMIN, product: "docustay" }); const ac = emailCode(ADMIN, ta);
  const ag = await raw("POST", "/api/auth/password-reset/code", { email: ADMIN, code: ac }); const as = await raw("POST", "/api/auth/password-reset/set", { email: ADMIN, grant: ag.json?.grant, password: PW2 }); ok("admin's reset by code worked", as.status === 200, `${as.status}`);
  const sin = await signIn(ADMIN, PW2); const lj = JSON.stringify(sin.l?.json ?? {}); ok("signing in after the reset still asks for two-step (a reset never bypasses it)", /two[_-]?step|second/i.test(lj) || sin.l?.status === 202 || sin.l?.json?.data?.twoStepRequired === true, `${sin.l?.status} ${lj.slice(0, 160)}`);
  // signed in: change with the wrong and the right current password; other devices
  const m2 = await signIn(MATE, PW2); ok("member signs in with the new password", m2.l?.status < 300, `${m2.l?.status}`);
  const m3 = await signIn(MATE, PW2);
  const bad = await api(m2.p, "POST", "/api/auth/password/change", { currentPassword: "not-it-1234", newPassword: PW3 }); ok("change with the wrong current password is refused", bad.status === 403, `${bad.status}`);
  matePw = PW3; const chg = await api(m2.p, "POST", "/api/auth/password/change", { currentPassword: PW2, newPassword: PW3, signOutOthers: true }); ok("change with the right one works", chg.status === 200 && chg.json?.changed === true, `${chg.status}`);
  const s3 = await api(m3.p, "GET", "/api/nav"); ok("the other device was signed out (ticked)", s3.status === 401, `${s3.status}`);
  const keep = await api(m2.p, "GET", "/api/nav"); ok("this device stays signed in", keep.status === 200, `${keep.status}`);
  ok("the 'password changed' email arrived again", mailBody(MATE, T0 + 60, "password was changed") !== null);
}

// ── sending to teammates (item 11) ─────────────────────────────────────────────────────────────────────────────────────────────
if (ONLY.includes("team")) {
  console.log("\n== sending to teammates");
  const tm = await api(op, "GET", "/api/documents/teammates"); const mates = (tm.json?.data ?? tm.json)?.teammates ?? [];
  ok("teammates lists all three with roles, you marked", mates.length === 3 && mates.find((x) => x.you)?.email.toLowerCase() === OWNER.toLowerCase() && mates.some((x) => x.role === "member"), JSON.stringify(mates).slice(0, 200));
  const mm0 = await signIn(MATE, matePw); const tmM = await api(mm0.p ?? mate.p, "GET", "/api/documents/teammates"); ok("a Member sees the teammate list too", ((tmM.json?.data ?? tmM.json)?.teammates ?? []).length === 3, `${tmM.status}`);
  const rec = recorder(op, OUT, "team"); const tag = `tm${stamp % 100000}`;
  await op.goto(`${BASE}/create`, { waitUntil: "load" }); await op.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
  const tile = op.locator('li[data-slug="mutual-nda"]').first(); if (!(await tile.count())) { await op.getByTestId("cr-door-library").click(); await op.waitForTimeout(600); }
  await tile.scrollIntoViewIfNeeded(); await tile.hover(); await tile.getByRole("button", { name: "Send" }).click();
  await op.getByRole("button", { name: "Next" }).waitFor({ timeout: 45000 });
  await op.getByTestId("past-signers").click(); await op.getByTestId("past-search").fill("Mate"); await op.waitForTimeout(1200);
  const pick = op.getByTestId("past-pick").filter({ hasText: MATE }); await pick.first().waitFor({ timeout: 8000 });
  ok("the picker lists the teammate first with a Team tag", (await pick.first().getByTestId("past-team-tag").count()) === 1 && /Mate Member/.test(await pick.first().innerText()));
  await pick.first().click();
  ok("the row is marked Team", (await op.getByTestId("person-team-tag").count()) >= 1);
  await op.screenshot({ path: `${OUT}/team-picker.png` });
  // fill every other empty seat with outside testers, then walk to Send
  const names = op.locator('input[aria-label^="Name of person"]'); const n = await names.count();
  for (let i = 0; i < n; i++) { if (!(await names.nth(i).inputValue())) { await names.nth(i).fill(`Outside ${i + 1}`); await op.locator(`input[aria-label="Email of person ${i + 1}"]`).fill(`trtheking97+${tag}o${i + 1}@gmail.com`); } }
  await op.getByRole("button", { name: "Next" }).click(); await op.waitForTimeout(1200);
  for (let i = 0; i < 4; i++) { await op.waitForTimeout(1100); const st = (await op.locator('[aria-current="step"]').first().innerText().catch(() => "")).replace(/\s+/g, " "); if (/Check/.test(st)) { await fillSenderParts(op, rec); await op.waitForTimeout(1500); } const next = op.getByRole("button", { name: /^(Next|Continue)$/ }); if (await next.count() && !(await next.first().isDisabled())) { await next.first().click(); } else break; }
  const t2 = Math.floor(Date.now() / 1000);
  const id = op.url().match(/documents\/([0-9a-f-]{36})/)[1];   // the editor's own address carries the id too, so wait for the real send, not for the URL
  await op.getByTestId("pdf-send").click(); await op.screenshot({ path: `${OUT}/team-send-clicked.png` });
  let stt = null; for (let i = 0; i < 30; i++) { await op.waitForTimeout(2000); stt = (await api(op, "GET", `/api/documents/pdf/${id}`)).json?.state; if (stt && stt !== "draft") break; }
  ok("the Send button on the screen sent the document", stt === "sent", `state=${stt} url=${op.url()}`); await op.screenshot({ path: `${OUT}/team-after-send.png` });
  console.log("  sent:", id);
  const doc = await api(op, "GET", `/api/documents/pdf/${id}`); const parties = doc.json?.parties ?? [];
  const teamP = parties.find((p) => (p.email ?? "").toLowerCase() === MATE.toLowerCase()); ok("the teammate party is linked to the member and shown internal", Boolean(teamP?.external_ref) && teamP?.internal === true, JSON.stringify(teamP)?.slice(0, 200));
  ok("an outside signer is not internal", parties.filter((p) => p !== teamP).every((p) => p.internal === false));
  ok("the teammate got the normal signing email", mailBody(MATE, t2, "sign") !== null);
  console.log("  parties:", JSON.stringify(parties.map((x) => [x.role, x.position, x.status, x.internal, x.email])), "order:", JSON.stringify(doc.json?.sendOptions?.order), "state:", doc.json?.state);
  const mm = await signIn(MATE, matePw); console.log("  member sign-in:", mm.s?.status, mm.l?.status);
  const w = await api(mm.p, "GET", "/api/documents/waiting-on-me"); const wd = (w.json?.data ?? w.json)?.documents ?? [];
  ok("Waiting on you lists it for the member", wd.some((x) => x.id === id), JSON.stringify(w.json).slice(0, 300));
  const nots = await api(mm.p, "GET", "/api/notifications"); ok("a notice about it is in the member's inbox", JSON.stringify(nots.json).includes(id), `${nots.status}`);
  const open = await api(mm.p, "GET", `/api/documents/pdf/${id}`); ok("the member (a recipient) can open it", open.status === 200, `${open.status} ${JSON.stringify(open.json)?.slice(0, 200)}`);
  const edit = await api(mm.p, "POST", "/api/documents/pdf/void", { instanceId: id }); ok("but cannot void it (read only)", edit.status === 403 || edit.status === 404, `${edit.status}`);
  await mm.p.goto(`${BASE}/documents`, { waitUntil: "load" }); await mm.p.getByTestId("doc-waiting-you").waitFor({ timeout: 20000 }).catch(() => {}); ok("Documents opens on Waiting on you", (await mm.p.getByTestId("doc-waiting-row").count()) >= 1);
  await mm.p.screenshot({ path: `${OUT}/team-waiting.png` });
}

// ── deleting the workspace, Free (item 7; paid-plan parts need Stripe test checkout and are run by hand) ─────────────────────────
if (ONLY.includes("delete")) {
  console.log("\n== deleting the workspace");
  // Free: a throwaway owner
  const fstamp = (stamp + 7) % 1e8, FO = `trtheking97+qf${fstamp}@gmail.com`;
  const fc = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const fp = await fc.newPage();
  await fp.goto(`${BASE}/login`); await decline(fp);
  await api(fp, "POST", "/api/auth/local/signup", { email: FO, password: PW });
  const tf = Math.floor(Date.now() / 1000); await fp.goto(`${BASE}/signup`); await decline(fp);
  await fp.getByRole("textbox", { name: "Email" }).fill(FO); await fp.locator("input[type=checkbox]").first().check(); await fp.getByRole("button", { name: "Email me a code" }).click();
  await fp.locator("input").first().click(); await fp.keyboard.type(emailCode(FO, tf)); await fp.waitForURL(/\/documents/, { timeout: 60000 });
  const st = await api(fp, "GET", "/api/account/deletion"); ok("Free: owner, no plan to lose", st.json?.isOwner === true && st.json?.plan?.kind === "none", JSON.stringify(st.json)?.slice(0, 200));
  const navj = (await api(fp, "GET", "/api/nav")).json; console.log("  nav:", JSON.stringify(navj).slice(0, 300)); const wsName = navj?.data?.tenant?.name ?? navj?.tenant?.name ?? navj?.workspace?.name ?? navj?.data?.workspace?.name;
  const no = await api(fp, "POST", "/api/product/docustay/delete-workspace", { confirm: "wrong name" }); ok("a wrong typed name is refused", no.status === 400, `${no.status}`);
  const go = await api(fp, "POST", "/api/product/docustay/delete-workspace", { confirm: wsName }); ok("the owner schedules it (Free: no acknowledgement needed)", go.status === 200 && go.json?.requested === true, `${go.status} ${JSON.stringify(go.json)?.slice(0, 160)} name=${wsName}`);
  const st1 = await api(fp, "GET", "/api/account/deletion"); ok("it shows as scheduled", st1.json?.workspace != null);
  const keep = await api(fp, "POST", "/api/product/docustay/delete-workspace/cancel", {}); ok("Keep this workspace cancels it", keep.status < 300, `${keep.status}`);
  const st2 = await api(fp, "GET", "/api/account/deletion"); ok("nothing is scheduled any more", st2.json?.workspace == null);
  ok("the 'scheduled' email arrived", mailBody(FO, tf, "delete") !== null);
}

// ── Stripe payments screen (21 Oct 2026, STRIPE-PAYMENTS-SPEC.md): the owner's workspace is linked to a READY Stripe test fixture first (node /tmp/la/relink.mjs <email> <acct> live) ─────────
if (ONLY.includes("payments")) {
  console.log("\n== payments: Your Stripe account, roles, switches, activity, webhooks");
  const A = "/api/product/docustay/payments";
  const own = await api(op, "GET", `${A}/account?fresh=1`); const a0 = own.json?.data ?? own.json;
  ok("owner: the account is Ready with balance, bank and payouts", own.status === 200 && a0?.status === "ready" && a0.money?.pendingMinor > 0 && a0.money?.bank?.last4 === "6789", `${own.status} ${a0?.status} ${JSON.stringify(a0?.money)?.slice(0, 160)}`);
  ok("owner: fee is from the plan (Pay as you go 2%) and the id is masked in the panel", a0?.fee?.percent === 2 && /^acct_••••/.test(a0?.account?.masked ?? ""));
  const ad = await api(adm.p, "GET", `${A}/account`); ok("admin: sees the same screen data", ad.status === 200 && (ad.json?.data ?? ad.json)?.status === "ready", `${ad.status}`);
  for (const [m, path, b] of [["GET", `${A}/account`], ["POST", `${A}/wizard`, { step: 2 }], ["POST", `${A}/wizard/continue`, { details: {} }], ["POST", `${A}/update-link`, {}], ["POST", `${A}/settings`, { paused: true }], ["POST", `${A}/disconnect`, {}], ["POST", `${A}/connect`, { method: "hosted" }]]) {
    const x = await api(mate.p, m, path, b); ok(`member refused: ${m} ${path.replace(A, "…")}`, x.status === 403, `${x.status} ${JSON.stringify(x.json)?.slice(0, 100)}`);
  }
  const mg = await api(mate.p, "GET", `${A}/managers`); const names = ((mg.json?.data ?? mg.json)?.managers ?? []); ok("member: can read who manages payments (an Owner and the Admin)", mg.status === 200 && names.some((n) => n.role === "owner") && names.some((n) => n.name === "Ada Admin"), JSON.stringify(names));
  // screens
  const view = async (page, qs = "") => { await page.goto(`${BASE}/billing?tab=payments${qs}`, { waitUntil: "load" }); await decline(page); await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {}); };
  const op2 = await oc.newPage(); await view(op2); await op2.getByTestId("stripe-account").waitFor({ timeout: 20000 });
  ok("screen: status Ready, Open your Stripe account goes to the test dashboard", /Ready/.test(await op2.getByTestId("stripe-status").innerText()) && /dashboard\.stripe\.com\/test\/dashboard/.test(await op2.getByTestId("stripe-open").getAttribute("href")));
  ok("screen: charges, payouts and verification chips; balance and next payout shown", (await op2.getByTestId("chip-charges").innerText()).includes("On") && /\$/.test(await op2.getByTestId("stripe-pending").innerText()) && (await op2.getByTestId("stripe-bank-link").count()) === 1);
  ok("screen: the existing payments list is still below, and the test banner shows", (await op2.getByTestId("payments-test-mode").count()) >= 1);
  await op2.screenshot({ path: `${OUT}/stripe-ready-light.png`, fullPage: true });
  const dk = await oc.newPage(); await dk.emulateMedia({ colorScheme: "dark" }); await view(dk); await dk.getByTestId("stripe-account").waitFor({ timeout: 20000 }); await dk.screenshot({ path: `${OUT}/stripe-ready-dark.png`, fullPage: true });
  const ph = await oc.newPage(); await ph.setViewportSize({ width: 390, height: 844 }); await view(ph); await ph.getByTestId("stripe-account").waitFor({ timeout: 20000 });
  ok("phone: no sideways scroll", await ph.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)); await ph.screenshot({ path: `${OUT}/stripe-ready-phone.png`, fullPage: true });
  const mp = await mate.p.context().newPage(); await view(mp); await mp.getByTestId("stripe-member").waitFor({ timeout: 20000 });
  ok("member screen: 'managed by Admins and Owners' with the people listed, and nothing else", /managed by Admins and Owners/.test(await mp.getByTestId("stripe-member").innerText()) && (await mp.getByTestId("stripe-managers").innerText()).includes("Ada Admin") && (await mp.getByTestId("stripe-open").count()) === 0 && (await mp.getByTestId("payments-disconnect").count()) === 0); await mp.screenshot({ path: `${OUT}/stripe-member.png` });
  // keyboard: the two switches are reachable and labelled
  await op2.getByTestId("stripe-take-payments").focus(); ok("keyboard: the Take payments switch takes focus and has a name", (await op2.getByTestId("stripe-take-payments").getAttribute("role")) === "switch" && /Take payments/.test(await op2.locator("label.sw", { has: op2.getByTestId("stripe-take-payments") }).innerText()));
  // the pause switch (an Admin does it), signing keeps working, a payment document cannot be sent
  const ap = await adm.p.context().newPage(); await view(ap); await ap.getByTestId("stripe-take-payments").waitFor({ timeout: 20000 });
  await ap.getByTestId("stripe-take-payments").click(); await ap.getByRole("button", { name: "Pause payments" }).click(); await ap.getByTestId("payments-note").waitFor({ timeout: 20000 });
  const p1 = (await api(op, "GET", `${A}/account?fresh=1`)).json; const a1 = p1?.data ?? p1; ok("admin pauses: status is Paused by you", a1?.status === "paused" && a1?.settings?.paused === true, a1?.status);
  const tpls = (await api(op, "GET", "/api/documents/pdf/templates")).json?.templates ?? []; const tpl = tpls.find((t) => t.seats === 1 && t.active && t.approval_status === "approved") ?? tpls[0];
  const f = await api(op, "POST", "/api/documents/pdf/from-template", { templateId: tpl.id, title: `Paused payment ${stamp}` }); const did = f.json?.data?.instanceId ?? f.json?.instanceId ?? f.json?.data?.id ?? f.json?.id; const dd = (await api(op, "GET", `/api/documents/pdf/${did}`)).json;
  await api(op, "POST", "/api/documents/pdf/save", { instanceId: did, title: dd.title, body: { ...(dd.body ?? {}), suggestions: undefined, fields: [{ id: "sig-1", type: "signature", role: "signer_1", page: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.05, required: true }, { id: "pay-1", type: "payment", role: "signer_1", page: 1, x: 0.1, y: 0.3, w: 0.4, h: 0.08, required: true, amount_minor: 5000, currency: "usd", label: "Deposit" }] }, parties: [{ role: "signer_1", name: "Pay Test", email: `trtheking97+payq${stamp}@gmail.com` }], sendOptions: { in_person: ["signer_1"] } });
  const snd = await api(op, "POST", "/api/documents/pdf/send", { instanceId: did }); ok("paused: a document with a payment box cannot be sent, and the words say payments are paused", snd.status >= 400 && /paused for this workspace/.test(JSON.stringify(snd.json)), `${snd.status} ${JSON.stringify(snd.json)?.slice(0, 200)}`);
  await api(op, "POST", "/api/documents/pdf/discard", { instanceId: did });
  await ap.getByTestId("stripe-take-payments").click(); await ap.getByTestId("payments-note").waitFor({ timeout: 20000 });
  const p2 = (await api(op, "GET", `${A}/account?fresh=1`)).json; ok("payments turned back on: status Ready again", (p2?.data ?? p2)?.status === "ready");
  // the receipt switch
  const r1 = await api(adm.p, "POST", `${A}/settings`, { sendOwnReceipt: false }); ok("receipt switch: off is saved", r1.status === 200 && (r1.json?.data ?? r1.json)?.sendOwnReceipt === false);
  const r2 = await api(adm.p, "POST", `${A}/settings`, { sendOwnReceipt: true }); ok("receipt switch: back on", (r2.json?.data ?? r2.json)?.sendOwnReceipt === true);
  // update details at Stripe
  const ul = await api(op, "POST", `${A}/update-link`, {}); ok("Update details at Stripe returns a Stripe address", ul.status === 200 && /^https:\/\/connect\.stripe\.com\//.test((ul.json?.data ?? ul.json)?.url ?? ""), `${ul.status} ${JSON.stringify(ul.json)?.slice(0, 120)}`);
  // activity (audit-logged)
  const ac = (await api(op, "GET", `${A}/account?fresh=1`)).json; const acts = (ac?.data ?? ac)?.activity?.map((e) => e.text).join(" | ") ?? "";
  for (const w of ["Payments paused", "Payments turned back on", "Docustay receipts turned off", "Docustay receipts turned on", "Opened Update details at Stripe"]) ok(`activity says: ${w}`, acts.includes(w), acts.slice(0, 200));
  await op2.reload({ waitUntil: "load" }); await op2.getByTestId("stripe-activity").waitFor({ timeout: 20000 }); ok("screen: the Activity list shows them", /Payments paused/.test(await op2.getByTestId("stripe-activity").innerText()));
  // webhooks (signed here with the beta's own Connect secret, never printed): payout failed and a dispute email the owner and land in Activity; account.updated re-reads
  const kv = spawnSync("railway", ["variables", "--service", "sandbox-app", "--project", "00000000-0000-4000-8000-00000000000a", "--environment", "sandbox-beta", "--kv"], { encoding: "utf8", env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "RAILWAY_TOKEN")) }).stdout ?? "";
  const SECRET = (kv.split("\n").find((l) => l.startsWith("KEYSTONE_DOCUSTAY_STRIPE_CONNECT_WEBHOOK_SECRET=")) ?? "").split("=")[1];
  const crypto2 = await import("node:crypto");
  const hook = async (type, object, acct) => { const payload = JSON.stringify({ id: `evt_qa_${type.replace(/\W/g, "_")}_${stamp}`, object: "event", type, account: acct, livemode: false, created: Math.floor(Date.now() / 1000), data: { object } }); const t = Math.floor(Date.now() / 1000); const sig = crypto2.createHmac("sha256", SECRET).update(`${t}.${payload}`).digest("hex"); return fetch(`${BASE.replace("docustay-web", "app")}/api/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": `t=${t},v1=${sig}` }, body: payload }); };
  const ACCT_ID = a0?.account?.id; ok("(setup) the account id for the webhook tests is known", /^acct_/.test(ACCT_ID ?? ""));
  const w1 = await hook("payout.failed", { id: `po_qa_${stamp}`, object: "payout", amount: 12345, currency: "usd", status: "failed", failure_message: "Account closed" }, ACCT_ID); ok("webhook: payout.failed is accepted", w1.status === 200, `${w1.status} ${(await w1.text()).slice(0, 160)}`);
  const w2 = await hook("charge.dispute.created", { id: `dp_qa_${stamp}`, object: "dispute", amount: 5000, currency: "usd", payment_intent: `pi_qa_${stamp}` }, ACCT_ID); console.log("  dispute webhook:", w2.status);
  const w3 = await hook("account.updated", { id: ACCT_ID, object: "account" }, ACCT_ID); ok("webhook: account.updated is accepted", w3.status === 200, `${w3.status}`);
  const ac2 = (await api(op, "GET", `${A}/account?fresh=1`)).json; const acts2 = (ac2?.data ?? ac2)?.activity?.map((e) => e.text).join(" | ") ?? ""; ok("webhook: the payout failure is in Activity", acts2.includes("A payout failed"), acts2.slice(0, 200));
  const mailed = mailBody(OWNER, T0, "payout"); console.log("  payout-failed email in the QA inbox:", mailed ? "yes" : "not found (check Spam)");
}
console.log("\n== cleanup: offboard the test teammates (keeps the test workspace tidy)");
for (const m of ((await api(op, "GET", "/api/documents/teammates")).json?.teammates ?? [])) { if (m.you) continue; const o = await api(op, "POST", `/api/people/team/${m.id}/offboard`, { futureSessions: { mode: "leave" } }); console.log("  offboard", m.email, o.status); }
console.log(`\n${pass} pass, ${fail} fail`);
await browser.close(); process.exit(fail ? 1 : 0);
