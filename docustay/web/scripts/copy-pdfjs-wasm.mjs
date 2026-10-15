// Copies the decoders pdf.js keeps outside its worker (JBIG2 and JPEG 2000 images, colour profiles) from the INSTALLED pdfjs-dist into static/pdfjs/wasm/, so the browser can draw scans that use them (a copier's JBIG2 scan drew blank without them).
// Run at the start of the build: the files always match the worker's version, and nothing here is committed.
import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module";
const dir = path.join(path.dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json")), "wasm");
const out = path.join(import.meta.dirname, "..", "static", "pdfjs", "wasm"); fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
let n = 0; for (const f of fs.readdirSync(dir)) if (/^(jbig2|openjpeg|qcms)|^LICENSE/.test(f)) { fs.copyFileSync(path.join(dir, f), path.join(out, f)); n += 1; }
console.log(`copied ${n} pdf.js decoder files`);
