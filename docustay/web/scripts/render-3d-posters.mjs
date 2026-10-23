// Renders each Docustay 3D scene at a fixed moment with the same scene code the site runs, and writes static/3d/<name>.webp (poster, 2400x1500) and .avif.
// Needs a dev server with DOCUSTAY_DESIGN_PREVIEW=1 (default http://127.0.0.1:5199). Usage: node scripts/render-3d-posters.mjs [name ...] [--base URL] [--loops]
// --loops also writes static/3d/<name>.mp4 (H.264) and .webm (VP9), a 6 s loop of 1200x750 frames that fades the last second into the first so it repeats without a jump (phones play these instead of live WebGL).
import { chromium } from "~/keystone/node_modules/playwright/index.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const args = process.argv.slice(2); const bi = args.indexOf("--base"); const base = bi >= 0 ? args[bi + 1] : "http://127.0.0.1:5199";
const loops = args.includes("--loops"); const names = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--base");
const ALL = { hero: 2.4, D: 1.6, cube: 2.2, papers: 5.2, lattice: 3.1, seal: 2.0, cards: 2.6, rings: 2.2, bg: 3.0 };
const out = path.resolve("static/3d"); fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ["--use-gl=angle", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await b.newContext({ viewport: { width: 1200, height: 750 }, deviceScaleFactor: 2 });
for (const n of names.length ? names : Object.keys(ALL)) {
  const page = await ctx.newPage(); const t0 = ALL[n] ?? 2;
  const shoot = async (t, file) => {
    await page.goto(`${base}/design/scene-solo?solo=${n}&t=${t}`, { waitUntil: "load", timeout: 90000 });
    await page.waitForSelector('#solo[data-ready="true"]', { timeout: 90000 });
    const err = await page.getAttribute("#solo", "data-err"); if (err) throw new Error(n + ": " + err);
    await page.addStyleTag({ content: "header.dh, .consent, footer { display: none !important }" }); await page.waitForTimeout(250); await page.locator("#solo").screenshot({ path: file });
  };
  const png = path.join(os.tmpdir(), `post-${n}.png`);
  await shoot(t0, png);
  execFileSync("cwebp", ["-q", "86", "-m", "6", "-quiet", png, "-o", path.join(out, n + ".webp")]);
  execFileSync("avifenc", ["--min", "20", "--max", "34", "-s", "6", "-j", "4", png, path.join(out, n + ".avif")], { stdio: "ignore" });
  console.log(n, fs.statSync(path.join(out, n + ".webp")).size, "B webp", fs.statSync(path.join(out, n + ".avif")).size, "B avif");
  if (loops) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loop-")); const FPS = 24, LEN = 6, FADE = 1; const total = (LEN + FADE) * FPS; const t00 = t0;
    const pg2 = await ctx.newPage(); await pg2.goto(`${base}/design/scene-solo?solo=${n}&t=${t00}`, { waitUntil: "load" });
    await pg2.close();
    for (let f = 0; f < total; f++) await shoot(+(t00 + f / FPS).toFixed(4), path.join(dir, `f${String(f).padStart(4, "0")}.png`));
    // blend the last FADE seconds into the first FADE seconds, then keep LEN seconds
    const fadeN = FADE * FPS; const lenN = LEN * FPS;
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(dir, "f%04d.png"), "-filter_complex",
      `[0:v]split[a][b];[a]trim=start_frame=${lenN}:end_frame=${total},setpts=PTS-STARTPTS[tail];[b]trim=start_frame=0:end_frame=${lenN},setpts=PTS-STARTPTS[main];[main]split[m1][m2];[m1]trim=start_frame=0:end_frame=${fadeN},setpts=PTS-STARTPTS[head];[m2]trim=start_frame=${fadeN},setpts=PTS-STARTPTS[rest];[tail][head]blend=all_expr='A*(1-T)+B*T':shortest=1,setpts=N/${FPS}/TB[x];[x][rest]concat=n=2:v=1:a=0,scale=1200:750,format=yuv420p[v]`,
      "-map", "[v]", "-c:v", "libx264", "-crf", "30", "-preset", "slow", "-movflags", "+faststart", path.join(out, n + ".mp4")]);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", path.join(out, n + ".mp4"), "-c:v", "libvpx-vp9", "-crf", "38", "-b:v", "0", path.join(out, n + ".webm")]);
    fs.rmSync(dir, { recursive: true, force: true }); console.log(n, "loop", fs.statSync(path.join(out, n + ".mp4")).size, "B mp4");
  }
  await page.close();
}
await b.close();
