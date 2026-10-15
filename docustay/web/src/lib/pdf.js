// pdf.js (Mozilla, Apache-2.0 — the one licence exception, D11) draws the pages of the document in the browser. The worker file ships with the app.
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
export async function loadPdf(bytes) { return pdfjs.getDocument({ data: new Uint8Array(bytes), wasmUrl: "/pdfjs/wasm/" }).promise; }
/** Draw one page of `pdf` into `canvas` at `width` CSS pixels; returns the height used. */
export async function drawPage(pdf, pageNumber, canvas, width) {
  const page = await pdf.getPage(pageNumber), base = page.getViewport({ scale: 1 }), scale = width / base.width, vp = page.getViewport({ scale }), dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(vp.width * dpr); canvas.height = Math.round(vp.height * dpr); canvas.style.width = `${vp.width}px`; canvas.style.height = `${vp.height}px`;
  await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp, transform: dpr === 1 ? null : [dpr, 0, 0, dpr, 0, 0] }).promise;
  return vp.height;
}
