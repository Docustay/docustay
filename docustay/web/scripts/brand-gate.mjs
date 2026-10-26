#!/usr/bin/env node
// BRAND GATE (13 Oct 2026, billing audit Part F). The final Docustay logo (specs/brand/docustay-logo) is the only mark anywhere in Docustay. This FAILS the build if the old the platform tile, the old Docustay
// tile mark, the italic-serif D or a lowercase "docustay" wordmark comes back: by file hash (the retired image files), by drawing (the tile's path data), and by words (the name "the platform" in anything a Docustay
// person can read: pages, emails, PDFs). A positive control proves the scan can see each kind.   node docustay/web/scripts/brand-gate.mjs
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const RETIRED_HASHES = {"5b4f0028ceac8f033da560ac58d898a5c65b716fb4747455d1fb4498f3e07082": "docustay-mark-180.png", "d992c56abb6fdfbd550e8610939f56e181175c084eb18bb9ffb3f8dfcd151994": "docustay-mark-192.png", "9111f1f04a8dacf9eb44c150cc92ae7b85fa6d40f12e1a45d40070e094105d72": "docustay-mark-32.png", "e308adb633fb03cf13876d117420e4a8cace3e85151302e15886fe948a4866ae": "docustay-mark-512.png", "796b035b33f574aa66a2151a20ddf0161241ae89f4d95b615dcbb575ee507013": "old favicon.svg (the tile)"};
const RETIRED_DRAWINGS = ["M200 88H330V162L222 268V305H272", "M360 175L418 218V368L326 446H201V407", "keystone-tile", "docustay-mark"];
const SCAN = ["docustay/web/src", "docustay/web/static", "src/email/docustayBilling.mjs", "src/email/authEmail.mjs", "src/product/lifecycle.mjs", "src/billing/invoicePdf.mjs", "src/documents/pdf.mjs"];
const SKIP_DIR = new Set(["node_modules", "build", ".svelte-kit", "i18n"]);
const TEXT = /\.(svelte|js|mjs|css|html|md|txt|svg|json)$/;
// words: "the platform" may appear only in a COMMENT line (a developer's note) or in the files named here, never in text a person reads
const WORD_OK = new Set(["src/email/authEmail.mjs", "docustay/web/src/lib/flow/flowDefinition.js", "docustay/web/src/lib/Logo.svelte", "docustay/web/src/lib/Mark.svelte"]);
const walk = (p, out = []) => { if (!fs.existsSync(p)) return out; const st = fs.statSync(p); if (st.isFile()) return out.push(p), out; for (const e of fs.readdirSync(p)) if (!SKIP_DIR.has(e)) walk(path.join(p, e), out); return out; };
export function scan(files, { root = ROOT } = {}) {
  const bad = [];
  for (const f of files) {
    const rel = path.relative(root, f); const buf = fs.readFileSync(f);
    const h = createHash("sha256").update(buf).digest("hex"); if (RETIRED_HASHES[h]) bad.push(`${rel}: is the retired image ${RETIRED_HASHES[h]}`);
    if (!TEXT.test(f)) continue; const text = buf.toString("utf8");
    for (const d of RETIRED_DRAWINGS) if (text.includes(d) && !/brand-gate/.test(f)) bad.push(`${rel}: carries the retired drawing "${d.slice(0, 24)}"`);
    if (/(?<!<code>|<b>|<strong>)>docustay<\/(a|span|div|h1|p|li)>/.test(text) && !/brand-gate/.test(f)) bad.push(`${rel}: a lowercase "docustay" wordmark`);
    if (!WORD_OK.has(rel)) text.split("\n").forEach((line, i) => { if (/Workbench/.test(line) && !/^\s*(\/\/|\*|\/\*|<!--|#)/.test(line) && !/\/\/.*Workbench|\*.*Workbench/.test(line.replace(/"[^"]*Workbench[^"]*"/g, ""))) bad.push(`${rel}:${i + 1}: the name "Workbench" in text a person could read`); });
  }
  return bad;
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const files = SCAN.flatMap((p) => walk(path.join(ROOT, p)));
  const bad = scan(files);
  // positive control: a scan of a temporary file carrying each kind of fault must report all of them
  const tmp = path.join(ROOT, "docustay/web/.gate-control"); fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, "a.svelte"), '<svg><path d="M200 88H330V162L222 268V305H272"/></svg><a>docustay</a>\n<p>Sent with Workbench</p>');
  const control = scan([path.join(tmp, "a.svelte")]); fs.rmSync(tmp, { recursive: true, force: true });
  const sees = control.length >= 3;
  console.log(sees ? "PASS  control: the scan sees a retired drawing, a lowercase wordmark and the name Workbench" : `FAIL  control: the scan did not see all three (${control.length})`);
  for (const b of bad) console.log("FAIL ", b);
  console.log(!bad.length && sees ? `BRAND GATE PASS (${files.length} files)` : `BRAND GATE FAIL (${bad.length})`);
  process.exit(!bad.length && sees ? 0 : 1);
}
