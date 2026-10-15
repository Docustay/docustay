#!/usr/bin/env node
// The Verify picture alone: a sealed PDF checked on the Verify page (the page's own picture is removed first, or the screenshot would contain itself).   SANDBOX_BASE=http://localhost:8791 node docustay/web/scripts/build-verify.mjs /tmp/sealed.pdf
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
const pdf = process.argv[2]; const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "static", "screens");
const b = await chromium.launch({ channel: "chrome" }); const v = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await v.goto("http://localhost:5180/verify", { waitUntil: "load" }); await v.waitForTimeout(1200); await v.locator("[data-testid=verify-input]").setInputFiles(pdf); await v.waitForTimeout(3500);
await v.evaluate(() => { document.querySelectorAll("figure[data-product-visual]").forEach((f) => f.remove()); const r = document.querySelector("[data-testid=verify-result], [role=status], .result"); (r ?? document.querySelector("h1")).scrollIntoView({ block: "start" }); window.scrollBy(0, -260); }); await v.waitForTimeout(700);
await v.screenshot({ path: path.join(OUT, "verify.png") }); await b.close(); console.log("wrote verify.png");
