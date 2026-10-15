#!/usr/bin/env node
// The Certificate of Completion picture alone: the last page of a sealed PDF (docustay/web/scripts/seal-sample.mjs makes one) on a plain 1280x800 sheet.   node docustay/web/scripts/build-certificate.mjs /tmp/sealed.pdf
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const pdfPath = process.argv[2]; if (!pdfPath || !fs.existsSync(pdfPath)) throw new Error("usage: build-certificate.mjs <sealed.pdf>");
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "static", "screens");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cert-")); const base = path.join(tmp, "cert");
const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [pdfPath], { encoding: "utf8" }))?.[1] ?? 2);
execFileSync("pdftoppm", ["-png", "-r", "110", "-f", String(pages), "-l", String(pages), pdfPath, base]); const img = fs.readdirSync(tmp).find((f) => f.startsWith("cert") && f.endsWith(".png"));
const b = await chromium.launch({ channel: "chrome" }); const s = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await s.setContent(`<body style="margin:0;background:#efece4;display:flex;align-items:center;justify-content:center;height:800px"><img style="height:770px;box-shadow:0 8px 40px #0003;background:#fff" src="data:image/png;base64,${fs.readFileSync(path.join(tmp, img)).toString("base64")}"></body>`); await s.waitForTimeout(500);
await s.screenshot({ path: path.join(OUT, "certificate.png") }); await b.close(); fs.rmSync(tmp, { recursive: true, force: true }); console.log("wrote certificate.png");
