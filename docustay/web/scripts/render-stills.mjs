// Renders each still object (src/lib/site/3d/objects.js) OFFLINE and deterministically: three.js in headless Chromium (SwiftShader), transparent background, drawn at 3x, then downscaled to 2x (2080x1600)
// with a Lanczos filter, and written as static/stills/hero-<name>.{avif,webp,png}. No bloom, dust, stars or glare. Needs the dev server with DOCUSTAY_DESIGN_PREVIEW=1 (default http://127.0.0.1:5199).
// Usage: node scripts/render-stills.mjs [name ...] [--base URL]    The manifest static/stills/manifest.json lists every still, its source and the pages that use it (from src/lib/site/visuals/registry.js).
import { chromium } from "~/keystone/node_modules/playwright/index.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs"; import path from "node:path"; import os from "node:os";
const args = process.argv.slice(2); const bi = args.indexOf("--base"); const base = bi >= 0 ? args[bi + 1] : "http://127.0.0.1:5199";
const want = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--base");
const out = path.resolve("static/stills"); fs.mkdirSync(out, { recursive: true });
const src = fs.readFileSync("src/lib/site/3d/objects.js", "utf8"); const names = [...src.matchAll(/^export const OBJECTS = \{([\s\S]*?)\n\};/gm)][0][1].split(/,\s*(?=["a-zA-Z])/).map((s) => s.trim().match(/^"?([a-z0-9-]+)"?\s*(:|$)/)?.[1]).filter(Boolean);
const exe = process.env.CHROMIUM_PATH ?? ["1248", "1247"].map((v) => `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-${v}/chrome-headless-shell-mac-arm64/chrome-headless-shell`).find((f) => fs.existsSync(f));
const b = await chromium.launch({ executablePath: exe, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await b.newContext({ viewport: { width: 1100, height: 860 }, deviceScaleFactor: 1 }); const manifest = {};
for (const n of want.length ? want : names) {
  const page = await ctx.newPage();
  await page.goto(`${base}/design/still-solo?name=${n}&scale=3`, { waitUntil: "load", timeout: 120000 });
  await page.waitForSelector('#still[data-ready="true"]', { timeout: 120000 });
  const err = await page.getAttribute("#still", "data-err"); if (err) throw new Error(n + ": " + err);
  const url = await page.evaluate(() => document.getElementById("still").toDataURL("image/png")); await page.close();
  const big = path.join(os.tmpdir(), `still-${n}-3x.png`), png = path.join(out, `hero-${n}.png`);
  fs.writeFileSync(big, Buffer.from(url.split(",")[1], "base64"));
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", big, "-vf", "scale=2080:1600:flags=lanczos", "-pix_fmt", "rgba", png]);
  execFileSync("cwebp", ["-q", "92", "-alpha_q", "100", "-m", "6", "-quiet", png, "-o", path.join(out, `hero-${n}.webp`)]);
  execFileSync("avifenc", ["--min", "14", "--max", "28", "-s", "6", "-j", "4", "--qalpha", "90", png, path.join(out, `hero-${n}.avif`)], { stdio: "ignore" });
  fs.rmSync(big, { force: true }); manifest[n] = { width: 1040, height: 800, source: "src/lib/site/3d/objects.js", bytes: { avif: fs.statSync(path.join(out, `hero-${n}.avif`)).size, webp: fs.statSync(path.join(out, `hero-${n}.webp`)).size, png: fs.statSync(png).size } };
  console.log(n, manifest[n].bytes);
}
await b.close();
const mp = path.join(out, "manifest.json"); const old = fs.existsSync(mp) ? JSON.parse(fs.readFileSync(mp, "utf8")) : {}; fs.writeFileSync(mp, JSON.stringify({ ...old, ...manifest }, null, 1) + "\n");
