// PDF FIELD DETECTION · THE DOOR (PDF-FIELD-DETECTION-SPEC §4, §5 safety). One call that runs the engine in a worker thread with a time limit, caches by the file's hash, and never throws into an upload:
// a file that cannot be read gives { ok:false, reason }, and the editor simply has no suggestions (the person places fields by hand, as before).
import { Worker } from "node:worker_threads";
import { createHash } from "node:crypto";
import { DETECT_MAX_PAGES } from "./engine.mjs";

const CACHE = new Map(), CACHE_MAX = 40;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

/**
 * @param {Uint8Array} bytes
 * @param {{ timeoutMs?:number, maxPages?:number, ocr?:boolean, dpi?:number }} o
 * @returns {Promise<{ok:true, result, cached:boolean} | {ok:false, reason:string}>}
 */
export async function detect(bytes, { timeoutMs = 60_000, maxPages = DETECT_MAX_PAGES, ocr = true, dpi = 150, hashOnly = false, minConfidence = 0.6 } = {}) {
  const key = `${sha(bytes)}:${maxPages}:${ocr ? 1 : 0}:${dpi}:${hashOnly ? "h" : "f"}:${minConfidence}`;
  if (CACHE.has(key)) { const v = CACHE.get(key); CACHE.delete(key); CACHE.set(key, v); return { ok: true, result: v, cached: true }; }
  const copy = new Uint8Array(bytes).buffer;
  return new Promise((resolve) => {
    const w = new Worker(new URL("./workerMain.mjs", import.meta.url), { workerData: { bytes: copy, options: { maxPages, ocr, dpi, hashOnly, minConfidence, deadlineMs: Math.max(5000, timeoutMs - 8000) } }, resourceLimits: { maxOldGenerationSizeMb: 1536 } }, [copy]);
    let done = false;
    const end = (v) => { if (done) return; done = true; clearTimeout(timer); w.terminate().catch(() => {}); resolve(v); };
    const timer = setTimeout(() => end({ ok: false, reason: "timeout" }), timeoutMs);
    w.on("message", (m) => {
      if (!m.ok) return end({ ok: false, reason: m.error });
      CACHE.set(key, m.result); if (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
      end({ ok: true, result: m.result, cached: false });
    });
    w.on("error", (e) => end({ ok: false, reason: String(e?.message ?? e) }));
    w.on("exit", () => end({ ok: false, reason: "stopped" }));
  });
}
export const clearDetectionCache = () => CACHE.clear();
