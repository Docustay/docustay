#!/usr/bin/env node
// Design/QA helper (BETA through the local dev proxy): sets one in-person signer on a draft, sends it, and screenshots the signing page it lands on. Usage: node scripts/drive-sign.mjs --doc <id> --email <qa plus address> --out <dir>
import { chromium } from "playwright";
import { mkdirSync, existsSync } from "node:fs";
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg("base", "http://127.0.0.1:5180"), DOC = arg("doc"), EMAIL = arg("email"), OUT = arg("out", "/tmp/shots/sign");
mkdirSync(OUT, { recursive: true });
const STATE = `/tmp/ds-state-${EMAIL.replace(/[^a-z0-9]/gi, "_")}.json`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...(existsSync(STATE) ? { storageState: STATE } : {}) });
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("console", m.text().slice(0, 160)); });
await page.goto(`${BASE}/documents/${DOC}/edit?step=people`, { waitUntil: "networkidle" });
await page.getByPlaceholder("Name").first().fill("Priya Nair");
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/1-people.png` });
const cb = page.getByLabel("on this device"); if (await cb.count()) await cb.first().check();
await page.waitForTimeout(1200);
for (const step of ["prepare", "details", "check", "send"]) {
  await page.goto(`${BASE}/documents/${DOC}/edit?step=${step}`, { waitUntil: "networkidle" }); await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/2-${step}.png` });
}
console.log(await page.locator("[data-testid=send-summary]").innerText().catch(() => "no summary"));
console.log("send enabled:", await page.getByTestId("pdf-send").isEnabled().catch(() => "no button"));
await page.getByTestId("pdf-send").click();
await page.waitForTimeout(6000);
console.log("landed", page.url().replace(/t=[^&]+/, "t=…"));
await page.screenshot({ path: `${OUT}/3-after-send.png` });
await ctx.storageState({ path: `/tmp/ds-sign-state.json` });
await browser.close();
