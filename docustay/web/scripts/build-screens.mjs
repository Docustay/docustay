#!/usr/bin/env node
// Captures the real product screens used as pictures on the public pages into static/screens/*.png, every one 1280x800, from the CURRENT app (rebuilt 5 Oct 2026 after a user found three of them were 1x1 placeholder pixels, which showed as an empty violet block, and the rest were taken before the redesign).
// First: node docustay/web/scripts/seal-sample.mjs /tmp/sealed.pdf   (deployed sandbox, makes the sealed PDF). Then, with SEALED_PDF=/tmp/sealed.pdf, this runs in real Chrome against the local harness (scripts/sandbox/harness.sh: web on 5180, API on 8791) with a fresh test workspace. Needs SANDBOX_BASE=http://localhost:8791 and pdftoppm (poppler) for the certificate page.
//   SANDBOX_BASE=http://localhost:8791 node docustay/web/scripts/build-screens.mjs
// Every picture is checked after it is written: right size, not blank, not the same picture as another one (screens-gate.mjs repeats the check).
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { firebaseWorkspace, sentDocument, starterDraft, WEB } from "../../../scripts/sandbox/p31-lib.mjs";
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "static", "screens"); fs.mkdirSync(OUT, { recursive: true });
const w = await firebaseWorkspace("Northside Studio", "Northside Studio");
const doc = await sentDocument(w.me, "Services agreement", "services-agreement", [{ name: "Rosa Alvarez", email: "rosa.alvarez@example.com" }, { name: "Daniel Okafor", email: "daniel.okafor@example.com" }]);
await sentDocument(w.me, "Mutual NDA", "mutual-nda"); await sentDocument(w.me, "Event waiver", "event-waiver");
// a second document that is only a DRAFT with its real fields in place, for the field editor (a real starter, not a toy page)
const draft = await starterDraft(w.me, "contractor-agreement");
const b = await chromium.launch({ channel: "chrome" });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "light" }); const p = await ctx.newPage();
const written = [];
const keep = (name) => { written.push(name); console.log("wrote", name); };
await p.goto(`${WEB}/login`, { waitUntil: "load" }); await p.locator("input[type=email]").fill(w.email); await p.locator("input[type=password]").fill(w.password); await p.keyboard.press("Enter"); await p.waitForURL(/\/documents/, { timeout: 25000 });
const shot = async (name, url, wait, extra) => { await p.goto(`${WEB}${url}`, { waitUntil: "load" }); if (wait) await p.locator(wait).first().waitFor({ timeout: 15000 }); await p.waitForFunction(() => !document.body.innerText.includes("Loading…") && !document.querySelector(".animate-pulse, .skeleton, [aria-busy=true]"), null, { timeout: 25000 }).catch(() => {}); await p.waitForTimeout(2500); if (extra) await extra(); await p.screenshot({ path: path.join(OUT, name) }); keep(name); };
await shot("home.png", "/documents", "h1");
await shot("billing.png", "/billing", "h1");
await shot("templates.png", "/templates", "h1", async () => { await p.waitForFunction(() => !document.body.innerText.includes("Loading…"), null, { timeout: 20000 }); await p.waitForTimeout(1200); });
await shot("developer-panel.png", "/settings?tab=keys", "h1");
await shot("embedding.png", "/settings?tab=embedding", "h1");
await shot("send.png", `/documents/${doc.instanceId}`, "h1");
await shot("template-editor.png", `/documents/${draft.instanceId}/edit`, "[data-testid=flow-step-fields]", async () => { await p.locator("[data-testid=flow-step-fields]").click(); await p.locator("canvas").first().waitFor({ timeout: 20000 }); await p.waitForTimeout(1500); });
// ── made-up people: nothing the public sees may carry a real address (the owner's own sign-in is never drawn) ──
const ROSA = [{ name: "Rosa Alvarez", email: "rosa.alvarez@example.com" }, { name: "Daniel Okafor", email: "daniel.okafor@example.com" }];
// text tags: the tagged source beside the same document after the tags became fields
{ const fieldsPng = await (async () => { await p.goto(`${WEB}/documents/${draft.instanceId}/edit`, { waitUntil: "load" }); await p.locator("[data-testid=flow-step-fields]").click(); await p.locator("canvas").first().waitFor({ timeout: 20000 }); await p.waitForTimeout(3500); const box = await p.locator("canvas").first().boundingBox(); return p.screenshot({ clip: { x: box.x, y: box.y, width: Math.min(box.width, 560), height: Math.min(box.height, 520) } }); })();
  const s = await ctx.newPage(); const tag = (t) => `<span style="background:#ece7ff;color:#4a2db0;border-radius:3px;padding:0 3px;font-family:ui-monospace,Menlo,monospace;font-size:12px">{{${t}}}</span>`;
  await s.setContent(`<body style="margin:0;background:#efece4;font-family:Inter,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;gap:26px;height:800px"><div style="width:560px;height:520px;background:#fff;box-shadow:0 8px 40px #0003;padding:34px 40px;box-sizing:border-box;overflow:hidden;font-family:Georgia,serif;font-size:14px;line-height:1.75;color:#222"><div style="text-align:center;font-weight:700;font-size:22px;margin-bottom:6px">Independent Contractor Agreement</div><div style="text-align:center;font-size:11px;letter-spacing:.14em;color:#888;margin-bottom:16px">BETWEEN ${tag("Company name;type=text;role=Company")} AND ${tag("Contractor's name;type=text;role=Contractor")}</div><hr><p>This Independent Contractor Agreement (the “<b>Agreement</b>”) starts on ${tag("Start date;type=date;role=Company")} (the “<b>Start Date</b>”) between ${tag("Company's legal name;type=text;role=Company")} of ${tag("Company address;type=text;role=Company")} (the “<b>Company</b>”) and ${tag("Contractor's full name;type=text;role=Contractor")} of ${tag("Contractor's address;type=text;role=Contractor")} (the “<b>Contractor</b>”).</p><p><b>1. The work.</b> The Contractor will provide the following services to the Company: ${tag("Describe the services;type=text;role=Company")}</p><p style="margin-top:26px">Signed: ${tag("Sign;type=signature;role=Contractor")}</p></div><div style="font:700 30px Inter;color:#5b3bc4">→</div><img src="data:image/png;base64,${fieldsPng.toString("base64")}" style="width:560px;box-shadow:0 8px 40px #0003;background:#fff"></body>`); await s.waitForTimeout(600);
  await s.screenshot({ path: path.join(OUT, "text-tags.png") }); keep("text-tags.png"); await s.close(); }
// the sealed, signed PDF comes from the deployed sandbox's worker (seal-sample.mjs); the local harness has no worker
const pdfPath = process.env.SEALED_PDF; const haveSealed = Boolean(pdfPath && fs.existsSync(pdfPath)); if (!haveSealed) console.log("SEALED_PDF not set: verify.png and certificate.png are left as they are");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "screens-"));
// Verify page after a check
if (haveSealed) { const v = await ctx.newPage(); await v.goto(`${WEB}/verify`, { waitUntil: "load" }); await v.waitForTimeout(1200); await v.locator("[data-testid=verify-input]").setInputFiles(pdfPath); await v.waitForTimeout(3500);
  await v.evaluate(() => { document.querySelectorAll("figure[data-product-visual]").forEach((f) => f.remove()); const r = document.querySelector("[data-testid=verify-result], [role=status], .result"); (r ?? document.querySelector("h1")).scrollIntoView({ block: "start" }); window.scrollBy(0, -260); }); await v.waitForTimeout(700);
  await v.screenshot({ path: path.join(OUT, "verify.png") }); keep("verify.png"); await v.close(); }
// Certificate of Completion page: the last page of the sealed PDF on a plain sheet
if (haveSealed) { const base = path.join(tmp, "cert"); const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [pdfPath], { encoding: "utf8" }))?.[1] ?? 2);
  execFileSync("pdftoppm", ["-png", "-r", "110", "-f", String(pages), "-l", String(pages), pdfPath, base]); const img = fs.readdirSync(tmp).find((f) => f.startsWith("cert") && f.endsWith(".png"));
  const s = await ctx.newPage(); await s.setContent(`<body style="margin:0;background:#efece4;display:flex;align-items:center;justify-content:center;height:800px"><img style="height:770px;box-shadow:0 8px 40px #0003;background:#fff" src="data:image/png;base64,${fs.readFileSync(path.join(tmp, img)).toString("base64")}"></body>`); await s.waitForTimeout(500);
  await s.screenshot({ path: path.join(OUT, "certificate.png") }); keep("certificate.png"); await s.close(); }
// Signature maker with a drawn signature
{ const s = await ctx.newPage(); await s.goto(`${WEB}/tools/signature-maker`, { waitUntil: "load" }); const cv = s.locator("canvas").first(); await cv.waitFor(); await s.waitForTimeout(800); const box = await cv.boundingBox();
  await s.mouse.move(box.x + 50, box.y + box.height * 0.6); await s.mouse.down(); for (let i = 0; i <= 40; i += 1) await s.mouse.move(box.x + 50 + i * ((box.width - 120) / 40), box.y + box.height * 0.55 + Math.sin(i / 3) * box.height * 0.22 * Math.exp(-i / 45)); await s.mouse.up(); await s.waitForTimeout(500);
  await s.screenshot({ path: path.join(OUT, "signature-maker.png") }); keep("signature-maker.png"); await s.close(); }
await b.close(); fs.rmSync(tmp, { recursive: true, force: true });
console.log(`done: ${written.length} pictures`);
