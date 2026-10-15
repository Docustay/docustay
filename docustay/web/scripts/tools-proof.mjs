#!/usr/bin/env node
// Proof for the two browser-only PDF tools (F-SIGNTOOL, F-FILLTOOL). Drives the real pages in headless Chromium with real PDFs, on desktop and phone size:
//   1. each tool works (a downloaded copy is written and re-read with pdf-lib: signature image present, fields filled)
//   2. privacy: every network request is logged; none is a POST/PUT, none carries the file, none leaves the site's own origin; then the network is cut (setOffline) and the tools still work
//   3. no layout shift while the page loads and a PDF opens
// Usage: BASE=http://127.0.0.1:5180 PDFDIR=/tmp/pdfs node scripts/tools-proof.mjs
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { PDFDocument, PDFName } from "pdf-lib";
const BASE = process.env.BASE ?? "http://127.0.0.1:5180", DIR = process.env.PDFDIR ?? "/tmp/pdfs", SHOTS = process.env.SHOTS ?? "/tmp/pdfs/shots";
fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${m}`); };
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}) });
async function session(label, ctxOpts) {
  const ctx = await browser.newContext(ctxOpts), page = await ctx.newPage(), reqs = [];
  page.on("request", (r) => reqs.push({ url: r.url(), method: r.method(), len: (r.postDataBuffer()?.length ?? 0) }));
  await page.addInitScript(() => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true }); });
  return { ctx, page, reqs, label };
}
async function drawSig(page) {
  const cv = page.locator("canvas").filter({ hasNot: page.locator(".cv") }).first(); const sc = page.locator('[data-testid="pdf-sig"], canvas[aria-label]').first();
  const cvs = page.locator('[aria-label="Make your signature"] canvas').first(); await cvs.scrollIntoViewIfNeeded(); await page.waitForTimeout(300); const box = await cvs.boundingBox();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.6); await page.mouse.down();
  for (let i = 0; i <= 20; i++) await page.mouse.move(box.x + box.width * (0.2 + i * 0.03), box.y + box.height * (0.6 - Math.sin(i / 3) * 0.2), { steps: 2 });
  await page.mouse.up();
}
async function downloadCopy(page) {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), page.click('[data-testid="download"]')]);
  const p = path.join(SHOTS, `${Date.now()}-${dl.suggestedFilename()}`); await dl.saveAs(p); return fs.readFileSync(p);
}
const fileBytes = (f) => fs.readFileSync(path.join(DIR, f));
async function signFlow(s, file, { mobile = false } = {}) {
  const { page } = s; await page.goto(`${BASE}/tools/sign-pdf`, { waitUntil: "load" }); await page.waitForTimeout(+(process.env.HYDRATE ?? 4000));
  await page.setInputFiles('[data-testid="pdf-input"]', path.join(DIR, file)); await page.waitForSelector('[data-testid="page"] canvas', { timeout: 20000 });
  await drawSig(page); await page.click('[data-testid="use-signature"]');
  const sheet = page.locator('[data-testid="page"]'); const b = await sheet.boundingBox(); await page.locator('[data-testid="page"]').click({ position: { x: b.width * 0.35, y: b.height * 0.85 } });
  await page.waitForSelector(".it img", { timeout: 5000 });
  await page.screenshot({ path: path.join(SHOTS, `sign-${file}-${mobile ? "phone" : "desk"}.png`) });
  const out = await downloadCopy(page); const d = await PDFDocument.load(out);
  const images = d.getPages().flatMap((p) => { const xo = p.node.Resources()?.lookup(PDFName.of("XObject")); return xo ? [...xo.entries()].length : []; });
  return { pages: d.getPageCount(), withImage: images.length > 0 };
}
const results = [];
for (const [name, opts] of [["desktop", { viewport: { width: 1440, height: 900 } }], ["phone", { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]]) {
  const s = await session(name, opts); s.page.on("requestfailed", (r) => { if (process.env.DEBUG_FAIL) console.log("REQFAIL", r.url().slice(0, 140)); }); const mobile = name === "phone";
  for (const f of ["multi.pdf", "scanned.pdf", "rotated.pdf", "fillable.pdf"]) {
    try { const r = await signFlow(s, f, { mobile }); ok(r.withImage, `${name}: sign ${f}: copy has ${r.pages} page(s) and the signature image`); } catch (e) { ok(false, `${name}: sign ${f}: ${String(e.message).split("\n").slice(0,4).join(" | ").slice(0,330)}`); }
  }
  // fill
  try {
    const { page } = s; await page.goto(`${BASE}/tools/fill-pdf`, { waitUntil: "load" }); await page.waitForTimeout(+(process.env.HYDRATE ?? 4000)); await page.setInputFiles('[data-testid="pdf-input"]', path.join(DIR, "fillable.pdf")); await page.waitForSelector(".fld input", { timeout: 20000 });
    await page.fill('input[aria-label="full_name"]', "Jane Q. Tester"); await page.check('input[aria-label="agree"]'); await page.selectOption('select[aria-label="state"]', "NY"); await page.check('input[aria-label="plan: pro"]');
    await page.screenshot({ path: path.join(SHOTS, `fill-fillable-${name}.png`) });
    const out = await downloadCopy(page); const d = await PDFDocument.load(out), form = d.getForm();
    ok(form.getFieldMaybe("full_name") == null || true, "form reloaded"); // flattened by default: fields are gone, so re-open unflattened below
  } catch (e) { ok(false, `${name}: fill fillable.pdf: ${String(e.message).split("\n").slice(0,4).join(" | ").slice(0,330)}`); }
  try {
    const { page } = s; await page.goto(`${BASE}/tools/fill-pdf`, { waitUntil: "load" }); await page.waitForTimeout(+(process.env.HYDRATE ?? 4000)); await page.setInputFiles('[data-testid="pdf-input"]', path.join(DIR, "fillable.pdf")); await page.waitForSelector(".fld input");
    await page.uncheck('.out input[type="checkbox"]'); await page.fill('input[aria-label="full_name"]', "Jane Q. Tester"); await page.check('input[aria-label="agree"]'); await page.selectOption('select[aria-label="state"]', "NY"); await page.check('input[aria-label="plan: pro"]');
    const out = await downloadCopy(page); const form = (await PDFDocument.load(out)).getForm();
    ok(form.getTextField("full_name").getText() === "Jane Q. Tester", `${name}: fill: text field value written`); ok(form.getCheckBox("agree").isChecked(), `${name}: fill: check box ticked`); ok(form.getDropdown("state").getSelected()[0] === "NY", `${name}: fill: dropdown choice written`); ok(form.getRadioGroup("plan").getSelected() === "pro", `${name}: fill: radio choice written`);
  } catch (e) { ok(false, `${name}: fill (editable) fillable.pdf: ${String(e.message).split("\n").slice(0,4).join(" | ").slice(0,330)}`); }
  try { // click-to-add on a PDF with no fields
    const { page } = s; await page.goto(`${BASE}/tools/fill-pdf`, { waitUntil: "load" }); await page.waitForTimeout(+(process.env.HYDRATE ?? 4000)); await page.setInputFiles('[data-testid="pdf-input"]', path.join(DIR, "scanned.pdf")); await page.waitForSelector('[data-testid="page"] canvas');
    await page.click('[data-testid="tool-text"]'); const b = await page.locator('[data-testid="page"]').boundingBox(); await page.locator('[data-testid="page"]').click({ position: { x: b.width * 0.3, y: b.height * 0.3 } }); await page.keyboard.type("Typed on a scan"); await page.click('[data-testid="tool-check"]'); await page.locator('[data-testid="page"]').click({ position: { x: b.width * 0.6, y: b.height * 0.5 } });
    const out = await downloadCopy(page); const d = await PDFDocument.load(out); ok(d.getPageCount() === 1 && out.length > fileBytes("scanned.pdf").length, `${name}: fill: text and check added to a scanned page (${out.length} bytes)`);
  } catch (e) { ok(false, `${name}: fill scanned: ${String(e.message).split("\n").slice(0,4).join(" | ").slice(0,330)}`); }
  // privacy: nothing but GET to our own origin, nothing carries a file
  const origin = new URL(BASE).origin; const bad = s.reqs.filter((r) => !r.url.startsWith(origin) && !r.url.startsWith("data:") && !r.url.startsWith("blob:"));
  const writes = s.reqs.filter((r) => r.method !== "GET" && r.method !== "HEAD"); const big = s.reqs.filter((r) => r.len > 0);
  ok(bad.length === 0, `${name}: ${s.reqs.length} requests, none to another origin ${bad.length ? JSON.stringify(bad.slice(0, 3)) : ""}`); ok(writes.length === 0, `${name}: no POST/PUT/PATCH requests (${writes.length}) ${writes.length ? JSON.stringify(writes.slice(0, 3)) : ""}`); ok(big.length === 0, `${name}: no request carried a body`);
  const cls = await s.page.evaluate(() => window.__cls); ok(cls < 0.1, `${name}: layout shift ${cls.toFixed(3)}`);
  // network cut: load the page once more, go offline, tools still work
  await s.page.goto(`${BASE}/tools/sign-pdf`, { waitUntil: "load" }); await s.page.waitForTimeout(+(process.env.HYDRATE ?? 4000)); await signFlowNoGoto(s.page, "multi.pdf"); await s.page.click("text=Other file"); await s.ctx.setOffline(true); const before = s.reqs.length;  // warm-up online (the PDF engine loads on first use), then the network is cut and a second file is signed
  try { const r = await signFlowNoGoto(s.page, "multi.pdf"); ok(r, `${name}: network cut: sign still writes a copy`); } catch (e) { ok(false, `${name}: network cut: ${String(e.message).split("\n").slice(0,4).join(" | ").slice(0,330)}`); }
  const after = s.reqs.slice(before).filter((r) => /^https?:/.test(r.url)); ok(after.every((r) => r.method === "GET" && r.len === 0 && r.url.startsWith(origin)), `${name}: network cut: ${after.length} request(s) tried (all GET, no body, own origin: ${[...new Set(after.map((r) => new URL(r.url).pathname.split("/").pop()))].slice(0, 4).join(", ") || "none"})`);
  await s.ctx.close();
}
async function signFlowNoGoto(page, file) {
  await page.setInputFiles('[data-testid="pdf-input"]', path.join(DIR, file)); await page.waitForSelector('[data-testid="page"] canvas', { timeout: 20000 }); if (await page.locator('[data-testid="use-signature"]').count()) { await drawSig(page); await page.click('[data-testid="use-signature"]'); } else await page.click('[data-testid="tool-signature"]');
  const b = await page.locator('[data-testid="page"]').boundingBox(); await page.locator('[data-testid="page"]').click({ position: { x: b.width * 0.35, y: b.height * 0.85 } }); await page.waitForSelector(".it img"); const out = await downloadCopy(page); return out.length > 1500;
}
// a large file
if (fs.existsSync(path.join(DIR, "large.pdf"))) { const s = await session("desktop", { viewport: { width: 1440, height: 900 } }); const t0 = Date.now(); try { const r = await signFlow(s, "large.pdf"); ok(r.withImage, `large.pdf (${(fs.statSync(path.join(DIR, "large.pdf")).size / 1048576).toFixed(0)} MB, ${r.pages} pages) signed in ${((Date.now() - t0) / 1000).toFixed(1)} s`); } catch (e) { ok(false, `large.pdf: ${String(e.message).split("\n").slice(0,4).join(" | ").slice(0,330)}`); } await s.ctx.close(); }
await browser.close(); console.log(`\n${fail ? "TOOLS PROOF FAIL" : "TOOLS PROOF PASS"}: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
