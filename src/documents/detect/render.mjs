// PDF FIELD DETECTION · RENDER + WORDS. A page drawn to pixels (pdf.js onto an @napi-rs/canvas, MIT) and the page's words with positions from the text layer. Both in fractions of the page, y from the top.
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";
import { createRequire } from "node:module";
import path from "node:path";

// the decoders pdf.js keeps outside its main file (JBIG2 and CCITT-style scans, JPEG 2000, colour profiles): without the folder a scanned page drawn with them comes out blank
const PDFJS_DIR = path.dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
const WASM_URL = path.join(PDFJS_DIR, "wasm") + path.sep;
// the standard fonts (Helvetica and the rest of the base 14) pdf.js ships, so a page that does not embed them is drawn the same on every machine: without this the fallback was whatever the operating system had, and a scan test passed on one platform and failed on another
const STANDARD_FONTS_URL = path.join(PDFJS_DIR, "standard_fonts") + path.sep;

export async function openPdf(bytes) {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, standardFontDataUrl: STANDARD_FONTS_URL, isEvalSupported: false, disableFontFace: true, wasmUrl: WASM_URL, verbosity: 0 });
  return { pdf: await task.promise, task };
}

/** The page as RGBA at about `dpi`, capped so a huge page cannot exhaust memory. */
export async function renderPage(pdf, pageNo, { dpi = 150, maxPixels = 4_500_000 } = {}) {
  const page = await pdf.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  let scale = dpi / 72; if (base.width * base.height * scale * scale > maxPixels) scale = Math.sqrt(maxPixels / (base.width * base.height));
  const vp = page.getViewport({ scale }), w = Math.max(1, Math.round(vp.width)), h = Math.max(1, Math.round(vp.height));
  const canvas = createCanvas(w, h), ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
  await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
  const img = ctx.getImageData(0, 0, w, h);
  page.cleanup();
  return { w, h, rgba: img.data, pointsW: base.width, pointsH: base.height };
}

/** Words of the text layer. pdf.js hands back runs; a run is cut at spaces, each piece placed by its share of the run's width. */
export async function pageWords(pdf, pageNo) {
  const page = await pdf.getPage(pageNo), vp = page.getViewport({ scale: 1 }), tc = await page.getTextContent();
  const words = [];
  for (const it of tc.items) {
    if (!("str" in it) || !it.str.trim()) continue;
    const [a, b, , d, e, f] = it.transform;
    const [x, y] = vp.convertToViewportPoint(e, f);                      // the baseline start, in top-left points
    const hgt = Math.hypot(a, b) || Math.abs(d) || it.height || 10, total = Math.max(1, it.str.length);
    const wid = (it.width || hgt * 0.5 * total) * (vp.scale || 1);
    if (Math.abs(b) > Math.abs(a) * 0.5) continue;                      // upright text only: a turned page is read after it is turned (see engine)
    const re = /\S+/g; let m;
    while ((m = re.exec(it.str))) {
      const w0 = (m.index / total) * wid, w1 = ((m.index + m[0].length) / total) * wid;
      words.push({ str: m[0], x: (x + w0) / vp.width, y: (y - hgt) / vp.height, w: (w1 - w0) / vp.width, h: (hgt * 1.15) / vp.height, run: it.str, runX: x / vp.width, runW: wid / vp.width, page: pageNo });
    }
  }
  page.cleanup();
  return { words, rotate: page.rotate, charCount: words.reduce((n, w) => n + w.str.length, 0) };
}

/** A page picture as a PNG no wider than `maxW`, for a model to look at. */
export async function pagePng(img, maxW = 1100) {
  const { ImageData } = await import("@napi-rs/canvas");
  const full = createCanvas(img.w, img.h); full.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(img.rgba), img.w, img.h), 0, 0);
  const k = Math.min(1, maxW / img.w), w = Math.max(1, Math.round(img.w * k)), h = Math.max(1, Math.round(img.h * k));
  const small = createCanvas(w, h), ctx = small.getContext("2d"); ctx.drawImage(full, 0, 0, w, h);
  return small.toBuffer("image/png");
}
