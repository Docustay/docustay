#!/usr/bin/env node
// Pictures for the Product pages that need a real thing to show, taken from the DEPLOYED sandbox: the invitation email as a signer receives it (captured, never sent anywhere), the signing page on a phone in three languages, and the usage screen of an install.
// A fresh workspace per run, made-up people. Waits until pages are drawn with real ink.   node docustay/web/scripts/build-product-pictures.mjs
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { newWorkspace } from "../../../scripts/sandbox/p29-lib.mjs";
import { starterInstance, sendStarter, presentedFor } from "../../../scripts/sandbox/p31-starter-lib.mjs";
import { waitFor, read } from "../../../scripts/sandbox/live/mailpit.mjs";
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "static", "screens");
const WEB = process.env.DOCUSTAY_WEB ?? "https://host.example.com";
const PEOPLE = [{ name: "Rosa Alvarez", email: "rosa.alvarez@example.com" }, { name: "Daniel Okafor", email: "daniel.okafor@example.com" }];
const owner = `office+${Date.now().toString(36)}@northside-studio.example`;
const w = await newWorkspace("Northside Studio", "Northside Studio", owner);
const b = await chromium.launch({ channel: "chrome" }); const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
const keep = (n) => console.log("wrote", n);
const drawn = () => { const cs = [...document.querySelectorAll("canvas")]; if (!cs.length) return false; const c = cs[0]; if (c.width === 300 && c.height === 150) return false; const d = c.getContext("2d").getImageData(0, 0, c.width, Math.min(c.height, 500)).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] < 120) n += 1; return n > 600; };
const phoneShot = async (link) => { const c = await b.newContext({ viewport: { width: 390, height: 844 } }); const q = await c.newPage(); await q.goto(link, { waitUntil: "load" }); await q.waitForSelector("canvas", { timeout: 30000 }); await q.waitForFunction(drawn, null, { timeout: 90000 }); await q.waitForTimeout(2500); const png = await q.screenshot(); await c.close(); return png; };

// 1. the signing page on a phone in Spanish, Arabic and Japanese, side by side on one sheet
const shots = [];
for (const [lang, slug, title] of [["es", "services-agreement", "Contrato de servicios"], ["ar", "lease-addendum", "ملحق عقد الإيجار"], ["ja", "event-waiver", "イベント参加同意書"]]) {
  const st = await starterInstance(w.me, slug); const parties = await sendStarter(w.me, st, title, PEOPLE, { language: lang });
  shots.push(await phoneShot(`${WEB}/sign?t=${encodeURIComponent(await presentedFor(w.me, st, parties[0].id))}`));
}
{ const s = await ctx.newPage(); await s.setContent(`<body style="margin:0;background:#efece4;display:flex;align-items:center;justify-content:center;gap:34px;height:800px">${shots.map((p) => `<img style="height:720px;border-radius:22px;box-shadow:0 8px 40px #0003" src="data:image/png;base64,${p.toString("base64")}">`).join("")}</body>`); await s.waitForTimeout(500); await s.screenshot({ path: path.join(OUT, "phones-languages.png") }); keep("phones-languages.png"); await s.close(); }

// 2. the invitation as the signer receives it (rendered from the captured message)
{ const since = Date.now() - 2000; const st = await starterInstance(w.me, "services-agreement"); await sendStarter(w.me, st, "Services agreement", PEOPLE, { emailed: true });
  const hit = await waitFor({ to: PEOPLE[0].email, since, ms: 60000 }); const mail = await read(hit.ID ?? hit.id);
  const s = await ctx.newPage(); await s.setContent(`<body style="margin:0;background:#efece4;display:flex;align-items:center;justify-content:center;height:800px;font-family:Inter,system-ui,sans-serif"><div style="width:700px;background:#fff;border-radius:14px;box-shadow:0 8px 40px #0003;overflow:hidden"><div style="padding:14px 22px;border-bottom:1px solid #eee;font-size:13px;color:#555;line-height:1.6"><b style="color:#111;font-size:15px">${String(mail.subject).replace(/</g, "&lt;")}</b><br>To: ${PEOPLE[0].name} &lt;${PEOPLE[0].email}&gt;</div><iframe style="border:0;width:700px;height:620px;background:#fff" srcdoc="${String(mail.html).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"></iframe></div></body>`); await s.waitForTimeout(1200);
  await s.screenshot({ path: path.join(OUT, "email-invite.png") }); keep("email-invite.png"); await s.close(); }

// 3. the usage screen of an install (Settings > Usage report), signed in as the workspace owner through the real login form
{ const s = await ctx.newPage(); await s.goto(`${WEB}/login`, { waitUntil: "load" }); await s.locator("input[type=email]").fill(w.email); await s.locator("input[type=password]").fill(w.password); await s.keyboard.press("Enter"); await s.waitForURL(/\/documents/, { timeout: 30000 });
  await s.goto(`${WEB}/settings?tab=usage`, { waitUntil: "load" }); await s.locator("h1").first().waitFor({ timeout: 15000 }); await s.waitForTimeout(3000); await s.screenshot({ path: path.join(OUT, "usage-panel.png") }); keep("usage-panel.png"); await s.close(); }
await b.close(); process.exit(0);
