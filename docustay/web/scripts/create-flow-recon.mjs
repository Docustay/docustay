// RECON (read-only on the product, BETA workspaces): every way to make a document or a template, started from its door and followed as far as it goes without a signer, on each plan.
//   node scripts/create-flow-recon.mjs [--plans free,payg,pro,life] [--only upload,ai,...] [--out DIR]
// Writes <out>/recon.json and a screenshot at the end of each walk. Anything it cannot do is recorded as a finding rather than skipped.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { BETA_WEB, WS, contextFor } from "./pm-lib.mjs";
import { recorder, whoSigns, fillSenderParts } from "./create-flow-lib.mjs";
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg("out", "/tmp/cf-recon"), PLANS = arg("plans", "free,pro").split(","), ONLY = arg("only", "").split(",").filter(Boolean);
mkdirSync(OUT, { recursive: true });
const PDF = new URL("../starters/change-order.pdf", import.meta.url).pathname, BIG = "/tmp/big.pdf";
const results = [];
const browser = await chromium.launch();
const sizes = async (page) => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: innerWidth }));
async function scenario(plan, name, fn) {
  if (ONLY.length && !ONLY.some((o) => name.includes(o))) return;
  const ctx = await contextFor(browser, WS[plan]); const page = await ctx.newPage(); const tag = `${plan}-${name}`.replace(/[^\w-]+/g, "-");
  const rec = recorder(page, OUT, tag); const t0 = Date.now(); let outcome = "ok", url = "";
  console.log(`\n== ${plan} · ${name}`);
  try { await fn(page, rec, tag); } catch (e) { outcome = `STOPPED: ${String(e.message).split("\n")[0].slice(0, 160)}`; rec.note("problem", outcome); }
  url = page.url().replace(BETA_WEB, ""); const sz = await sizes(page).catch(() => null); if (sz && sz.sw > sz.vw + 1) rec.note("layout", `scrolls sideways (${sz.sw} in ${sz.vw})`);
  await rec.shot("end"); results.push({ plan, name, outcome, url, secs: Math.round((Date.now() - t0) / 1000), log: rec.log, errors: rec.errs }); await ctx.close();
}
const startAt = (page, path) => page.goto(`${BETA_WEB}${path}`, { waitUntil: "load" }).then(() => page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {}));
const alerts = async (page, rec) => { for (const a of await page.locator('[role="alert"]:visible, .notice:visible').allInnerTexts().catch(() => [])) rec.note("alert", a.trim().replace(/\s+/g, " ").slice(0, 200)); };
async function builtIn(page, rec, slug, mode, action) {
  await startAt(page, `/create${mode === "template" ? "?mode=template" : ""}`);
  const tile = page.locator(`li[data-slug="${slug}"]`).first();
  if (!(await tile.count())) { await page.getByTestId("cr-door-library").click(); await page.waitForTimeout(600); }
  await tile.scrollIntoViewIfNeeded(); await tile.hover(); await alerts(page, rec);
  const btn = tile.getByRole("button", { name: action }); if (!(await btn.count())) { rec.note("problem", `no "${action}" button on the tile in ${mode} mode`); return false; }
  await btn.click(); return true;
}
async function walkDocument(page, rec, tag, { people = true } = {}) {
  await page.getByRole("button", { name: "Next" }).waitFor({ timeout: 45000 }); rec.note("info", `editor open at ${page.url().replace(BETA_WEB, "")}`);
  if (people) await whoSigns(page, rec, tag.slice(0, 8)); else await page.getByRole("button", { name: "Next" }).click();
  for (let i = 0; i < 4; i++) { await page.waitForTimeout(1100); const st = (await page.locator('[aria-current="step"]').first().innerText().catch(() => "")).replace(/\s+/g, " "); rec.note("stage", st); await alerts(page, rec);
    if (/Check/.test(st)) { await fillSenderParts(page, rec); await page.waitForTimeout(1200); const bad = await page.getByTestId("send-check-row").evaluateAll((r) => r.filter((x) => x.dataset.ok === "false").map((x) => x.innerText.trim().slice(0, 100))).catch(() => []); for (const b of bad) rec.note("check", b); }
    const next = page.getByRole("button", { name: /^Next$/ }); if (!(await next.count())) break; await next.click(); }
  await page.waitForTimeout(1500); await alerts(page, rec);
  const send = page.getByTestId("pdf-send"), save = page.getByTestId("pdf-make-template").or(page.getByRole("button", { name: /^Save template$/ }));
  if (await send.count()) { rec.note("info", `Send button reads "${(await send.innerText()).trim()}"`); await rec.shot("send-stage"); await send.click(); await page.waitForTimeout(5000); await alerts(page, rec); rec.note("info", `after Send: ${page.url().replace(BETA_WEB, "")}`); }
  else if (await save.count()) { await rec.shot("save-stage"); await save.click(); await page.waitForTimeout(5000); await alerts(page, rec); rec.note("info", `after Save template: ${page.url().replace(BETA_WEB, "")}`); }
  else rec.note("problem", "neither Send nor Save template on the last stage");
}
for (const plan of PLANS) {
  await scenario(plan, "doc-builtin-document-template", async (p, r, tag) => { if (await builtIn(p, r, "mutual-nda", "document", "Send")) await walkDocument(p, r, tag); });
  await scenario(plan, "doc-builtin-form-template", async (p, r, tag) => { if (await builtIn(p, r, "incident-report", "document", "Send")) await walkDocument(p, r, tag); });
  await scenario(plan, "tpl-builtin-customize", async (p, r, tag) => { if (await builtIn(p, r, "services-agreement", "template", "Customize")) { await p.waitForURL(/\/create\/flow|\/documents\//, { timeout: 40000 }); await walkDocument(p, r, tag, { people: false }); } });
  await scenario(plan, "doc-scratch-write", async (p, r, tag) => { await startAt(p, "/create"); await p.getByTestId("cr-door-write").click(); await p.getByTestId("cr-blank").click(); await p.waitForURL(/\/create\/flow/, { timeout: 30000 }); r.note("info", `landed ${p.url().replace(BETA_WEB, "")}`); await p.locator("input").first().fill("A document written from scratch").catch(() => {}); await walkDocument(p, r, tag); });
  await scenario(plan, "doc-upload-pdf", async (p, r, tag) => { await startAt(p, "/create"); await p.getByTestId("cr-door-upload").click(); await p.getByTestId("cr-upload-input").setInputFiles(PDF); await p.waitForURL(/\/documents\/.*\/edit/, { timeout: 60000 }); await walkDocument(p, r, tag); });
  await scenario(plan, "tpl-upload-pdf", async (p, r, tag) => { await startAt(p, "/create?mode=template"); await p.getByTestId("cr-door-upload").click(); await p.getByTestId("cr-upload-input").setInputFiles(PDF); await p.waitForURL(/\/documents\/.*\/edit/, { timeout: 60000 }); r.note("info", `url ${p.url().replace(BETA_WEB, "")}`); await walkDocument(p, r, tag, { people: false }); });
  await scenario(plan, "doc-upload-over-limit", async (p, r) => { await startAt(p, "/create"); await p.getByTestId("cr-door-upload").click(); await p.getByTestId("cr-upload-input").setInputFiles(BIG); await p.waitForTimeout(8000); await alerts(p, r); r.note("info", `url ${p.url().replace(BETA_WEB, "")}`); });
  await scenario(plan, "doc-upload-not-pdf", async (p, r) => { await startAt(p, "/create"); await p.getByTestId("cr-door-upload").click(); await p.getByTestId("cr-upload-input").setInputFiles({ name: "notes.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("PK not really a docx") }).catch((e) => r.note("problem", `the picker would not take it: ${String(e).slice(0, 80)}`)); await p.waitForTimeout(6000); await alerts(p, r); r.note("info", `url ${p.url().replace(BETA_WEB, "")}`); });
  await scenario(plan, "doc-ai-describe", async (p, r, tag, rec = r) => { await startAt(p, "/create"); await p.getByTestId("ai-prompt").fill("A mutual NDA with a new contractor"); await p.getByRole("button", { name: /Draft it/ }).click(); await p.getByTestId("ai-open").waitFor({ timeout: 90000 }); await rec.shot("ai-draft"); await p.getByTestId("ai-open").click(); await p.waitForURL(/\/create\/flow|\/documents\//, { timeout: 60000 }); r.note("info", `url ${p.url().replace(BETA_WEB, "")}`); await walkDocument(p, r, tag); });
  await scenario(plan, "tpl-ai-describe", async (p, r, tag, rec = r) => { await startAt(p, "/create?mode=template"); await p.getByTestId("ai-prompt").fill("A photo release for event attendees"); await p.getByRole("button", { name: /Draft it/ }).click(); await p.getByTestId("ai-open").waitFor({ timeout: 90000 }); await p.getByTestId("ai-open").click(); await p.waitForURL(/\/create\/flow|\/documents\//, { timeout: 60000 }); r.note("info", `url ${p.url().replace(BETA_WEB, "")}`); await walkDocument(p, r, tag, { people: false }); });
  await scenario(plan, "doc-guided", async (p, r) => { await startAt(p, "/create"); await p.getByTestId("cr-guided-link").click(); await p.waitForTimeout(1500); await alerts(p, r); r.note("info", `guided form fields: ${(await p.locator("input:visible, select:visible, textarea:visible").count())}`); });
}
writeFileSync(`${OUT}/recon.json`, JSON.stringify(results, null, 1));
console.log("\nSUMMARY"); for (const x of results) console.log(`${x.plan.padEnd(5)} ${x.name.padEnd(30)} ${x.outcome.slice(0, 70).padEnd(70)} ${x.secs}s  ${x.log.filter((l) => ["problem", "alert", "layout", "check"].includes(l.kind)).length} notes  ${x.errors.length} errs`);
await browser.close();
