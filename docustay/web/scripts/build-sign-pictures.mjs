#!/usr/bin/env node
// Every picture of the SIGNING PAGE (phone and desktop) and the embed picture, from the DEPLOYED sandbox: its Gotenberg prints the starters, so the field boxes sit exactly on the document text (the local stand-in prints with different line breaks and the boxes drift).
// A new workspace per run, every seat in person (no email), made-up signers. Waits until the pages are drawn with real ink, never until a canvas merely exists.
//   node docustay/web/scripts/build-sign-pictures.mjs        (SANDBOX_BASE unset = the deployed sandbox)
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { newWorkspace } from "../../../scripts/sandbox/p29-lib.mjs";
import { starterInstance, sendStarter, presentedFor } from "../../../scripts/sandbox/p31-starter-lib.mjs";
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "static", "screens");
const WEB = process.env.DOCUSTAY_WEB ?? "https://host.example.com";
const PEOPLE = [{ name: "Rosa Alvarez", email: "rosa.alvarez@example.com" }, { name: "Daniel Okafor", email: "daniel.okafor@example.com" }];
const w = await newWorkspace("Northside Studio", "Northside Studio", `office+${Date.now().toString(36)}@northside-studio.example`);
const b = await chromium.launch({ channel: "chrome" }); const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
const written = []; const keep = (n) => { written.push(n); console.log("wrote", n); };
const linkFor = async (slug, title) => { const st = await starterInstance(w.me, slug); const parties = await sendStarter(w.me, st, title, PEOPLE); return `${WEB}/sign?t=${encodeURIComponent(await presentedFor(w.me, st, parties[0].id))}`; };
const drawn = () => { const cs = [...document.querySelectorAll("canvas")]; if (!cs.length) return false; const c = cs[0]; if (c.width === 300 && c.height === 150) return false; const d = c.getContext("2d").getImageData(0, 0, c.width, Math.min(c.height, 500)).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] < 120) n += 1; return n > 600; };
const signPage = async (link, viewport, scale = 1) => { const c = await b.newContext({ viewport, deviceScaleFactor: scale }); const q = await c.newPage(); await q.goto(link, { waitUntil: "load" }); await q.waitForSelector("canvas", { timeout: 30000 }); await q.waitForFunction(drawn, null, { timeout: 90000 }); await q.waitForTimeout(2500); return { q, done: () => c.close() }; };
const onSheet = async (png, name, h = 760) => { const sheet = await ctx.newPage(); await sheet.setContent(`<body style="margin:0;background:#efece4;display:flex;align-items:center;justify-content:center;height:800px"><img style="height:${h}px;border-radius:24px;box-shadow:0 8px 40px #0003" src="data:image/png;base64,${png.toString("base64")}"></body>`); await sheet.waitForTimeout(400); await sheet.screenshot({ path: path.join(OUT, name) }); keep(name); await sheet.close(); };
// one phone picture per use case, each from the real starter that use case sends
const PHONES = { "sign-phone.png": ["services-agreement", "Services agreement"], "phone-waiver.png": ["event-waiver", "Event waiver"], "phone-intake.png": ["intake-form", "Client intake form"], "phone-permission-slip.png": ["permission-slip", "Permission slip"] };
for (const [file, [slug, title]] of Object.entries(PHONES)) {
  const { q, done } = await signPage(await linkFor(slug, title), { width: 390, height: 844 });
  await onSheet(await q.screenshot(), file); await done();
}
// the signing page on a desktop, to sit inside a made-up customer's own web page (the embed picture)
{ const { q, done } = await signPage(await linkFor("lease-addendum", "Lease addendum"), { width: 760, height: 590 }); const inner = await q.screenshot(); await done();
  const s = await ctx.newPage(); await s.setContent(`<body style="margin:0;background:#efece4;font-family:Inter,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:800px"><div style="width:1100px;height:720px;background:#fff;border-radius:14px;box-shadow:0 8px 40px #0003;overflow:hidden;display:flex;flex-direction:column"><div style="background:#e8e4da;padding:10px 16px;display:flex;gap:10px;align-items:center"><span style="width:11px;height:11px;border-radius:50%;background:#e57"></span><span style="width:11px;height:11px;border-radius:50%;background:#eb4"></span><span style="width:11px;height:11px;border-radius:50%;background:#6c6"></span><span style="margin-left:14px;background:#fff;border-radius:8px;padding:5px 14px;font-size:13px;color:#555;flex:1">northside-lettings.example/tenants/sign</span></div><div style="padding:18px 34px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;font-weight:700;font-size:18px"><span>Northside Lettings</span><span style="font-weight:400;font-size:14px;color:#666">Homes · Tenants · Contact</span></div><div style="display:flex;flex:1;gap:30px;padding:26px 34px"><div style="width:270px"><h2 style="margin:0 0 10px;font-size:24px">Sign your lease addendum</h2><p style="color:#666;line-height:1.5;font-size:15px">Read it, fill in your details and sign here. No account needed. You get a signed copy by email.</p></div><img style="width:690px;height:535px;object-fit:cover;object-position:top;border:1px solid #e6e2d8;border-radius:10px" src="data:image/png;base64,${inner.toString("base64")}"></div></div></body>`); await s.waitForTimeout(500);
  await s.screenshot({ path: path.join(OUT, "embedding.png") }); keep("embedding.png"); await s.close(); }

// the signing page on a desktop for the use cases that had a picture of something else
const DOCS = { "doc-nda.png": ["mutual-nda", "Mutual NDA"], "doc-offer-letter.png": ["offer-letter", "Offer letter"], "doc-lease.png": ["lease-addendum", "Lease addendum"], "doc-contractor.png": ["contractor-agreement", "Independent contractor agreement"] };
for (const [file, [slug, title]] of Object.entries(DOCS)) { const { q, done } = await signPage(await linkFor(slug, title), { width: 1280, height: 800 }); await q.screenshot({ path: path.join(OUT, file) }); keep(file); await done(); }
await b.close(); console.log(`done: ${written.length} pictures`); process.exit(0);
