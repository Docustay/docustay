#!/usr/bin/env node
// Proof for the Verify page's "Seal covers" line, on a REAL sealed PDF made by seal-sample.mjs (argv[2]).
//   1 intact file: valid, and covers the whole file (the seal, the timestamped certificate page and the validation data are all Docustay's own revisions)
//   2 one byte changed inside the sealed range: NOT valid (positive control: the check can fail)
//   3 a page appended after everything: still a valid seal, but "covers the whole file" must be FALSE (positive control for the wording)
import fs from "node:fs";
import { verifyPdfBytes } from "../src/lib/site/verify.js";
const src = process.argv[2]; if (!src) throw new Error("usage: verify-proof.mjs <sealed.pdf>");
const good = new Uint8Array(fs.readFileSync(src)); let failed = 0;
const fact = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); if (!ok) failed += 1; };
const a = await verifyPdfBytes(good); fact("intact sealed file: valid", a.valid && a.signed, JSON.stringify({ signer: a.signer, timestamped: a.timestamped }));
fact("intact sealed file: covers the whole file", a.coversWholeFile === true);
const bad = good.slice(); bad[500] = bad[500] ^ 1; const b = await verifyPdfBytes(bad); fact("one byte changed inside the sealed range: NOT valid", b.signed && b.valid === false);
const page = new TextEncoder().encode("\n99 0 obj\n<< /Type /Page /Parent 1 0 R /MediaBox [0 0 612 792] >>\nendobj\nxref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 100 /Prev 67020 >>\nstartxref\n67400\n%%EOF\n");
const grown = new Uint8Array(good.length + page.length); grown.set(good); grown.set(page, good.length);
const c = await verifyPdfBytes(grown); fact("a page appended after everything: seal still valid", c.valid === true); fact("a page appended after everything: does NOT claim to cover the whole file", c.coversWholeFile === false);
console.log(failed ? `\nVERIFY PROOF FAIL (${failed})` : "\nVERIFY PROOF PASS"); process.exit(failed ? 1 : 0);
