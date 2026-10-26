// Reads a PDF the way a viewer would: every text run with its page and position. The structural tests assert on THIS (what is really in the file), not on what the renderer meant to draw.
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/** @returns {Promise<Array<{page:number, str:string, x:number, y:number, w:number, h:number, font:string}>>} runs in reading order per page (top to bottom), y measured UP from the page bottom */
export async function pdfTextRuns(bytes) {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, isEvalSupported: false, disableFontFace: true, verbosity: 0 });
  const doc = await task.promise;
  const runs = [];
  for (let p = 1; p <= doc.numPages; p += 1) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    for (const it of tc.items) {
      if (!("str" in it) || it.str.trim() === "") continue;
      runs.push({ page: p, str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height || Math.abs(it.transform[3]), font: it.fontName });
    }
  }
  await task.destroy();
  return runs;
}

export async function pdfPageCount(bytes) {
  const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const doc = await task.promise;
  const n = doc.numPages; await task.destroy(); return n;
}

/** Group runs into lines (same page, y within `tol` points), each line left to right. */
export function toLines(runs, tol = 1.5) {
  const lines = [];
  for (const r of runs) {
    const line = lines.find((l) => l.page === r.page && Math.abs(l.y - r.y) <= tol);
    if (line) { line.runs.push(r); } else lines.push({ page: r.page, y: r.y, runs: [r] });
  }
  for (const l of lines) { l.runs.sort((a, b) => a.x - b.x); l.text = l.runs.map((r) => r.str).join(" ").replace(/\s+/g, " ").trim(); l.h = Math.max(...l.runs.map((r) => r.h)); }
  return lines.sort((a, b) => a.page - b.page || b.y - a.y);
}
