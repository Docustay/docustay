// Runs one detection in a worker thread, so a big or hostile file cannot stall the server's own thread. Started by index.mjs; reports { ok, result } or { ok:false, error }.
import { parentPort, workerData } from "node:worker_threads";
import { detectFields } from "./engine.mjs";
import { ocrWords, stopOcr } from "./ocr.mjs";

try {
  const { bytes, options } = workerData;
  const result = await detectFields(new Uint8Array(bytes), { ...options, ocr: options.ocr === false ? null : ocrWords });
  await stopOcr();
  parentPort.postMessage({ ok: true, result });
} catch (e) {
  parentPort.postMessage({ ok: false, error: String(e?.message ?? e) });
}
