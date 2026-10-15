#!/usr/bin/env node
// LAUNCH step 10: the launch video, recorded from the REAL demo (never a mock-up) so it is repeatable and always matches the product. Playwright (Apache-2.0) drives the demo at 1920x1080 and records it; ffmpeg is a build tool
// only (it is not shipped); captions are drawn by an overlay in the page, so the file is muted and still tells the story. Writes mp4 + webm (each under 8 MB) and a poster.
//   WEB=http://localhost:13000 OUT=docustay/web/static/media node docustay/web/scripts/build-launch-video.mjs
// Needs the stack running with KEYSTONE_DEMO_ENABLED=1. Playwright's headless Chromium is used (no visible window). Every demo started here uses a throw-away address header, so it never eats the real hourly limit.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const WEB = process.env.WEB ?? "http://localhost:13000";
const OUT = path.resolve(process.env.OUT ?? "docustay/web/static/media");
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "docustay-video-"));
const W = 1920, H = 1080;
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ["--force-device-scale-factor=1"] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, recordVideo: { dir: WORK, size: { width: W, height: H } }, extraHTTPHeaders: { "x-forwarded-for": `198.51.100.${1 + Math.floor(Math.random() * 250)}` }, reducedMotion: "no-preference" });
const page = await ctx.newPage();
const wait = (ms) => page.waitForTimeout(ms);

// the caption bar and the cursor (the recorder does not draw a pointer) live in the page, re-added after every navigation
const OVERLAY = () => {
  if (document.getElementById("vid-cap")) return;
  const s = document.createElement("style");
  s.textContent = `#vid-cap{position:fixed;left:50%;bottom:54px;transform:translateX(-50%) translateY(10px);z-index:2147483646;max-width:1400px;padding:16px 30px;border-radius:16px;background:rgba(20,17,43,.92);color:#fff;font:600 34px/1.25 Inter,system-ui,sans-serif;letter-spacing:-.01em;opacity:0;transition:opacity .35s,transform .35s;text-align:center;box-shadow:0 18px 50px rgba(0,0,0,.35)}#vid-cap.on{opacity:1;transform:translateX(-50%)}#vid-cur{position:fixed;z-index:2147483647;width:26px;height:26px;margin:-4px 0 0 -4px;pointer-events:none;transition:transform .08s}#vid-cur svg{filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))}`;
  document.head.appendChild(s);
  const c = document.createElement("div"); c.id = "vid-cap"; document.body.appendChild(c);
  const u = document.createElement("div"); u.id = "vid-cur"; u.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M3 2l7.5 19 2.6-7.6L21 10.8z" fill="#fff" stroke="#14112b" stroke-width="1.5" stroke-linejoin="round"/></svg>'; document.body.appendChild(u);
  addEventListener("mousemove", (e) => { u.style.left = e.clientX + "px"; u.style.top = e.clientY + "px"; }, true);
};
const ensureOverlay = async () => { await page.evaluate(OVERLAY).catch(() => {}); };
const say = async (text, ms = 3200) => { await ensureOverlay(); await page.evaluate((t) => { const c = document.getElementById("vid-cap"); if (!c) return; if (!t) { c.classList.remove("on"); return; } c.textContent = t; c.classList.add("on"); }, text); if (ms) await wait(Math.round(ms * 0.55)); };
const quiet = async () => say("", 450);
let mx = 960, my = 540;
const glide = async (x, y, steps = 28) => { await page.mouse.move(x, y, { steps }); mx = x; my = y; };
const hover = async (loc, { dx = 0, dy = 0 } = {}) => { await loc.scrollIntoViewIfNeeded().catch(() => {}); await wait(250); const b = await loc.boundingBox(); if (!b) throw new Error("not on screen"); await glide(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy); return b; };
const tap = async (loc) => { await hover(loc); await wait(260); await page.mouse.down(); await wait(70); await page.mouse.up(); await wait(350); };

try {
  // 1 · the door
  await page.goto(`${WEB}/demo`, { waitUntil: "load" }); await ensureOverlay(); await glide(1200, 700, 2);
  await say("Try Docustay. No account, no card.", 3600);
  await tap(page.getByTestId("demo-start"));
  await say("A real workspace, built for you in seconds.", 2600);
  await page.waitForURL("**/documents**", { timeout: 60000 }); await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {}); await wait(800);
  // the tour starts itself on arrival (?tour=1): close it, the film tells its own story
  await page.waitForSelector(".driver-popover", { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => document.querySelector(".driver-popover-close-btn")?.click()).catch(() => {}); await wait(600);
  await ensureOverlay();
  await say("Maple Street Property Management. Leases and applications, already waiting.", 4200);
  await glide(760, 520, 40); await wait(600);

  // 2 · a document in flight
  await say("Every document, and where it stands.", 2800);
  const row = page.getByTestId("doc-row").first();
  await tap(row);
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {}); await wait(900);
  await say("Who has seen it, who has signed, and a sealed copy when everyone has.", 4200);
  await quiet();
  await page.goBack(); await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {}); await wait(700);

  // 3 · the demo inbox, and signing as the signer
  await say("Nothing is emailed in a demo. Every message lands in this inbox.", 3600);
  await tap(page.getByTestId("demo-inbox-open"));
  await wait(900);
  await say("Open the signing page and sign as the tenant.", 3000);
  const card = page.getByTestId("demo-inbox-list").locator("li").filter({ hasText: "marcus.bell@example.com" }).first();
  const open = card.getByRole("link", { name: /open the signing page/i });
  await hover(open); await wait(500);
  const href = await open.getAttribute("href");
  await page.mouse.down(); await wait(70); await page.mouse.up();
  await page.goto(href, { waitUntil: "load" }); await ensureOverlay(); await wait(1200);
  await say("This is what your signer sees. No account, any phone.", 3600);
  // the tenant's boxes, typed like a person would
  const fill = async (label, value) => { const f = page.getByLabel(label, { exact: true }).first(); if (!(await f.count())) return; await tap(f); await page.keyboard.type(value, { delay: 45 }); await wait(250); };
  await fill("Tenant’s name", "Marcus Bell"); await fill("Type, breed and size", "Small dog, 20 lb"); await fill("Pet’s name", "Biscuit"); await fill("Vehicles, with plates", "One car");
  await fill("Printed name", "Marcus Bell");
  await say("Draw your signature with a finger or a mouse.", 2400);
  await tap(page.getByTestId("signpdf-pages").getByRole("button", { name: "Tenant signature" })); await wait(600);
  const canvas = page.locator("canvas").last(); const cb = await canvas.boundingBox();
  if (cb) { const x0 = cb.x + cb.width * 0.2, y0 = cb.y + cb.height * 0.55; await glide(x0, y0, 12); await page.mouse.down(); for (let k = 0; k <= 40; k++) { const t2 = k / 40; await page.mouse.move(x0 + t2 * cb.width * 0.6, y0 + Math.sin(t2 * 9) * cb.height * 0.28 - t2 * 18, { steps: 2 }); } await page.mouse.up(); await wait(500); }
  await tap(page.getByRole("button", { name: /use this signature/i })); await wait(700);
  await say("Agree, and finish.", 2200);
  const full = page.getByLabel("Your full name", { exact: true }).first(); if (await full.count()) { await tap(full); if (!(await full.inputValue())) await page.keyboard.type("Marcus Bell", { delay: 45 }); }
  const agree = page.locator("input[type=checkbox]").last(); await tap(agree); await wait(400);
  await tap(page.getByRole("button", { name: /finish and sign/i })); await page.getByText(/you.ve signed/i).waitFor({ timeout: 15000 }).catch(() => { console.warn("the signer did not reach the signed page"); }); await wait(1500);
  await say("Signed and sealed, with a certificate of who, when and from where.", 4200);
  await quiet();

  // 4 · Scribe
  await page.goto(`${WEB}/documents`, { waitUntil: "load" }); await ensureOverlay(); await wait(900);
  await say("Ask Scribe for a document in plain words.", 2600);
  await tap(page.locator(".ask-go").first()); await wait(1200);
  const ask = page.locator("textarea, input[type=text]").filter({ visible: true }).last();
  if (await ask.count()) { await tap(ask); await page.keyboard.type("Draft a rental application for Tom Whitaker", { delay: 45 }); await page.keyboard.press("Enter"); }
  await wait(2500); await say("Scribe drafts it. You review and send.", 5200);
  await quiet();
  await page.keyboard.press("Escape").catch(() => {}); await wait(500);

  // 5 · keep it
  await say("Like it? Keep your work with one email and a code.", 3600);
  await tap(page.getByTestId("demo-keep")); await wait(900);
  await say("Free to start. Your workspace becomes yours.", 4200);
  await quiet();
} finally {
  const video = page.video(); await ctx.close(); await browser.close();
  const raw = await video.path();
  const base = path.join(WORK, "cut");
  // the recording starts with a blank frame and ends on a held frame: trim a hair from the head
  const run = (args) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });
  run(["-ss", "0.4", "-i", raw, "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "29", "-maxrate", "1100k", "-bufsize", "2200k", "-pix_fmt", "yuv420p", "-movflags", "+faststart", `${base}.mp4`]);
  run(["-ss", "0.4", "-i", raw, "-an", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "38", "-row-mt", "1", "-deadline", "good", "-cpu-used", "2", `${base}.webm`]);
  run(["-ss", "16", "-i", `${base}.mp4`, "-frames:v", "1", "-q:v", "3", `${base}.jpg`]);
  fs.copyFileSync(`${base}.mp4`, path.join(OUT, "launch.mp4")); fs.copyFileSync(`${base}.webm`, path.join(OUT, "launch.webm")); fs.copyFileSync(`${base}.jpg`, path.join(OUT, "launch.poster.jpg"));
  const mb = (f) => (fs.statSync(path.join(OUT, f)).size / 1048576).toFixed(2);
  console.log(`launch.mp4 ${mb("launch.mp4")} MB · launch.webm ${mb("launch.webm")} MB · launch.poster.jpg ${mb("launch.poster.jpg")} MB → ${OUT}`);
  fs.rmSync(WORK, { recursive: true, force: true });
}
