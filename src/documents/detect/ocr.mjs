// PDF FIELD DETECTION · OCR (PDF-FIELD-DETECTION-SPEC §4.3). Reads the words of a page that is only a picture, on this machine: tesseract.js (Apache-2.0) with the English model shipped in @tesseract.js-data/eng (MIT), no download at run time.
// Other languages need their model file placed in the same folder (KEYSTONE_OCR_LANG_PATH); without it a page in another script is read by shape alone and the review screen says so.
import { createRequire } from "node:module";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";

const require = createRequire(import.meta.url);
let worker = null, starting = null;

function langPath() {
  if (process.env.KEYSTONE_OCR_LANG_PATH) return process.env.KEYSTONE_OCR_LANG_PATH;
  return path.join(path.dirname(require.resolve("@tesseract.js-data/eng/package.json")), "4.0.0_best_int");
}
async function get(langs) {
  if (worker) return worker;
  starting ??= (async () => {
    const { createWorker } = await import("tesseract.js");
    const w = await createWorker(langs, 1, { langPath: langPath(), gzip: true, cacheMethod: "none", logger: () => {} });
    worker = w; return w;
  })();
  return starting;
}
export async function stopOcr() { const w = worker; worker = null; starting = null; try { await w?.terminate(); } catch { /* already gone */ } }

/** Even out the light across a photographed page (a shadow, a vignette): each pixel is divided by the paper brightness around it, then the contrast is stretched, so the text reads the same everywhere. */
function flatten({ w, h, rgba }) {
  const g = new Float32Array(w * h); for (let i = 0, j = 0; i < g.length; i += 1, j += 4) g[i] = (rgba[j] * 77 + rgba[j + 1] * 151 + rgba[j + 2] * 28) / 256;
  const ii = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y += 1) { let row = 0; for (let x = 0; x < w; x += 1) { row += g[y * w + x]; ii[(y + 1) * (w + 1) + x + 1] = ii[y * (w + 1) + x + 1] + row; } }
  const r = Math.max(20, Math.round(Math.min(w, h) / 12)), out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x += 1) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const mean = (ii[y1 * (w + 1) + x1] - ii[y0 * (w + 1) + x1] - ii[y1 * (w + 1) + x0] + ii[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
      const v = Math.max(0, Math.min(255, Math.round(((g[y * w + x] / Math.max(40, mean * 1.04)) - 0.55) * 255 / 0.45))), o = (y * w + x) * 4;
      out[o] = out[o + 1] = out[o + 2] = v; out[o + 3] = 255;
    }
  }
  return out;
}

/** `img` = { w, h, rgba }. Returns words in the same shape as pageWords(): fractions of the page, y from the top. `skew` (degrees, from the page's own lines) turns a tilted scan upright before it is read, and the words are put back where they sit on the original. */
export async function ocrWords(img, page, { langs = "eng", skew = 0 } = {}) {
  let canvas = createCanvas(img.w, img.h), ctx = canvas.getContext("2d");
  const { ImageData } = await import("@napi-rs/canvas");
  ctx.putImageData(new ImageData(flatten(img), img.w, img.h), 0, 0);
  const turn = Math.abs(skew) >= 0.4 && Math.abs(skew) <= 15 ? -skew : 0;
  if (turn) { const src = canvas; canvas = createCanvas(img.w, img.h); ctx = canvas.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, img.w, img.h); ctx.translate(img.w / 2, img.h / 2); ctx.rotate((turn * Math.PI) / 180); ctx.translate(-img.w / 2, -img.h / 2); ctx.drawImage(src, 0, 0); }
  const back = (px, py) => { if (!turn) return [px, py]; const a = (-turn * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), dx = px - img.w / 2, dy = py - img.h / 2; return [c * dx - s * dy + img.w / 2, s * dx + c * dy + img.h / 2]; };
  const w = await get(langs);
  const { data } = await w.recognize(canvas.toBuffer("image/png"), {}, { blocks: true });
  const out = [];
  for (const b of data.blocks ?? []) for (const par of b.paragraphs ?? []) for (const line of par.lines ?? []) for (const wd of line.words ?? []) {
    const t = String(wd.text ?? "").trim(); if (!t || wd.confidence < 35) continue;
    const bw = wd.bbox.x1 - wd.bbox.x0, bh = wd.bbox.y1 - wd.bbox.y0, [mx, my] = back((wd.bbox.x0 + wd.bbox.x1) / 2, (wd.bbox.y0 + wd.bbox.y1) / 2), x0 = mx - bw / 2, y0 = my - bh / 2;
    out.push({ str: t, x: x0 / img.w, y: y0 / img.h, w: bw / img.w, h: (bh / img.h) * 1.1, run: t, runX: x0 / img.w, runW: bw / img.w, page, ocr: true });
  }
  return out;
}
