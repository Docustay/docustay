#!/usr/bin/env node
// Turns each starter's printed PDF (starters/<slug>.pdf) into page pictures for the website: static/starters/<slug>/p<n>-sm.webp, -lg.webp and -lg.jpg (the fallback), plus -sm.jpg.
// pdfjs-dist (Apache-2.0) draws the page, @napi-rs/canvas (MIT) encodes it. The pictures are generated in the build and kept out of git (static/starters is ignored); starters/ (the PDFs and the manifest) is what is committed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "..", "starters"), OUT = path.join(HERE, "..", "static", "starters");
const SIZES = { sm: 440, lg: 1000 };
const manifest = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
const stats = { files: 0, bytes: 0, pages: 0 };
for (const slug of Object.keys(manifest)) {
  const dir = path.join(OUT, slug); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const task = getDocument({ data: new Uint8Array(fs.readFileSync(path.join(SRC, `${slug}.pdf`))), isEvalSupported: false, verbosity: 0, disableFontFace: true, useSystemFonts: false }); const pdf = await task.promise;
  if (pdf.numPages !== manifest[slug].pages) throw new Error(`${slug}: the PDF has ${pdf.numPages} pages but the manifest says ${manifest[slug].pages}`);
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n); const base = page.getViewport({ scale: 1 });
    for (const [name, width] of Object.entries(SIZES)) {
      const vp = page.getViewport({ scale: width / base.width }); const canvas = createCanvas(Math.round(vp.width), Math.round(vp.height)); const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
      const files = { [`p${n}-${name}.webp`]: canvas.toBuffer("image/webp", name === "sm" ? 70 : 78), [`p${n}-${name}.jpg`]: canvas.toBuffer("image/jpeg", name === "sm" ? 62 : 72) };
      for (const [f, buf] of Object.entries(files)) { fs.writeFileSync(path.join(dir, f), buf); stats.files += 1; stats.bytes += buf.length; }
    }
    stats.pages += 1;
  }
  await task.destroy();
}
console.log(`starter pictures: ${Object.keys(manifest).length} starters, ${stats.pages} pages, ${stats.files} files, ${(stats.bytes / 1048576).toFixed(1)} MB`);
