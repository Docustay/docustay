// A document's page drawn as a PNG (a thumbnail at 240 px, the document page's preview at 480 or 720 px) (the portal's lists and galleries show it; COMBINED-STYLE-SPEC section 4). Reuses the field-detection page renderer
// (pdf.js onto @napi-rs/canvas, both MIT). Small in-memory cache keyed by the file's own hash, so a sealed or unchanged file is drawn once; at most two pages render at the same time so a
// long list cannot starve the server. Nothing here is stored.
import { openPdf, renderPage, pagePng } from "./detect/render.mjs";

const MAX_ENTRIES = 300, MAX_BYTES = 40 * 1024 * 1024;
const cache = new Map(); let held = 0, running = 0; const queue = [];
const slot = () => new Promise((go) => { const t = () => { running += 1; go(() => { running -= 1; queue.shift()?.(); }); }; running < 2 ? t() : queue.push(t); });

/** @returns {Promise<Buffer|null>} a PNG about `width` px wide, or null when the file has no drawable first page. `key` identifies the file's content (its sha256, or its id and size). */
export async function pageThumb(key, bytes, { width = 240, page = 1 } = {}) {
  const k = `${key}:${width}:${page}`;
  if (cache.has(k)) { const v = cache.get(k); cache.delete(k); cache.set(k, v); return v; }
  const release = await slot();
  try {
    const { pdf, task } = await openPdf(bytes);
    try {
      if (page < 1 || page > pdf.numPages) return null;
      const img = await renderPage(pdf, page, { dpi: Math.max(24, Math.round((width / 8.5) * 1.15)), maxPixels: Math.max(600_000, width * width * 1.6) });
      const png = await pagePng(img, width);
      cache.set(k, png); held += png.length;
      while (cache.size > MAX_ENTRIES || held > MAX_BYTES) { const [old, v] = cache.entries().next().value; cache.delete(old); held -= v.length; }
      return png;
    } finally { try { await task.destroy(); } catch { /* the document is already gone */ } }
  } catch { return null; } finally { release(); }
}
