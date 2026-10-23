// The in-app Preview on BETA: from New document and from Templates, for a document template and a form template; Esc, Back, the link, Send and Customize inside it; no new tab; every page drawn.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { BETA_WEB, WS, contextFor } from "./pm-lib.mjs";
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg("out", "/tmp/tp-e2e"), EMAIL = arg("email", WS.free); mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0; const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const browser = await chromium.launch(); const ctx = await contextFor(browser, EMAIL); const page = await ctx.newPage();
const pages404 = []; page.on("response", (r) => { if (r.status() === 404 && /\/starters\/|\/templates\//.test(r.url())) pages404.push(r.url()); });
let newTabs = 0; ctx.on("page", () => { newTabs += 1; });
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
async function previewFrom(path, slug, label, ids) {
  await page.goto(`${BETA_WEB}${path}`, { waitUntil: "load" }); await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  if (path.startsWith("/templates")) await page.getByRole("tab", { name: /Built-in/i }).click().catch(() => page.getByText("Built-in", { exact: false }).first().click().catch(() => {}));
  const tile = page.locator(`[data-slug="${slug}"]`).first();
  if (!(await tile.count())) { // the featured twelve do not include every template: open the whole list
    await page.getByTestId("cr-door-library").click().catch(() => {}); await page.waitForTimeout(800);
  }
  const t = page.locator(`li[data-slug="${slug}"]`).first(); await t.scrollIntoViewIfNeeded(); await t.hover();
  await t.locator('a.btn:has-text("Preview")').click();
  await page.getByTestId("template-preview").waitFor({ timeout: 15000 });
  ok(`${label}: Preview opens in the app`, true); ok(`${label}: the address carries ?preview=${slug}`, page.url().includes(`preview=${slug}`));
  await page.locator(".pv-sheet img").first().waitFor({ timeout: 15000 });
  const n = await page.locator(".pv-sheet").count(); ok(`${label}: every page is a sheet (${n})`, n >= 1);
  await page.evaluate(async () => { const b = document.querySelector(".pv-body"); for (let y = 0; y <= b.scrollHeight; y += 500) { b.scrollTop = y; await new Promise((r) => setTimeout(r, 120)); } b.scrollTop = 0; });   // the lower pages load as they are scrolled to
  await page.waitForFunction(() => [...document.querySelectorAll(".pv-sheet img")].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 20000 }).then(() => ok(`${label}: page pictures load`, true)).catch(() => ok(`${label}: page pictures load`, false));
  ok(`${label}: fields are marked`, (await page.locator(".pv-f").count()) > 3);
  ok(`${label}: Send is inside it`, await page.getByTestId("pv-send").isVisible()); if (path.startsWith("/templates")) ok(`${label}: Customize is inside it`, (await page.locator('.pv-actions button:has-text("Customize")').count()) > 0);
  await shot(`${label.replace(/\W+/g, "-")}-open`);
  return slug;
}
async function closeChecks(label, slug) {
  await page.keyboard.press("Escape"); await page.getByTestId("template-preview").waitFor({ state: "detached", timeout: 8000 }).then(() => ok(`${label}: Esc closes it`, true)).catch(() => ok(`${label}: Esc closes it`, false));
  ok(`${label}: the address is clean again`, !page.url().includes("preview="));
}
// 1. New document: a document template and a form template
let s1 = await previewFrom("/create", "mutual-nda", "create document-template"); await closeChecks("create document-template");
let s2 = await previewFrom("/create", "incident-report", "create form-template"); 
await page.goBack(); await page.getByTestId("template-preview").waitFor({ state: "detached", timeout: 8000 }).then(() => ok("create form-template: Back closes it", true)).catch(() => ok("create form-template: Back closes it", false));
// 2. a shared link opens it straight away
await page.goto(`${BETA_WEB}/create?preview=vehicle-inspection-checklist`, { waitUntil: "load" }); await page.getByTestId("template-preview").waitFor({ timeout: 20000 }).then(() => ok("a shared /create?preview= link opens the Preview", true)).catch(() => ok("a shared /create?preview= link opens the Preview", false)); await shot("shared-link"); await page.keyboard.press("Escape");
// 3. Templates page
let s3 = await previewFrom("/templates", "contact-and-inquiry", "templates form-template"); await closeChecks("templates form-template");
let s4 = await previewFrom("/templates", "services-agreement", "templates document-template");
// Send inside the Preview makes a draft (a built-in is sent straight from its master)
await page.getByTestId("pv-send").click(); await page.waitForURL(/\/documents\/[0-9a-f-]+\/edit/, { timeout: 40000 }).then(() => ok("Send inside the Preview opens the new document", true)).catch(() => ok("Send inside the Preview opens the new document", false, page.url()));
ok("no new browser tab was opened", newTabs === 0, String(newTabs)); ok("no template picture or page answered 404", pages404.length === 0, pages404.slice(0, 3).join(" "));
console.log(`\n${pass} pass, ${fail} fail`); await browser.close(); process.exit(fail ? 1 : 0);
