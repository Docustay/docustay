// src/money/invoicePdfServer.mjs — Part 3 rebuild (the maintainer's ruling: full rebuild), 1 Oct 2026.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★ SERVER-ONLY. The shared component lives in invoicePdf.mjs (pure, importable from the browser
//   too); this file adds the Node-specific render call (`renderToBuffer`) and font-file resolution
//   from local disk — neither of those belong in the shared component, and neither is safe to
//   import into a browser bundle.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { createElement as h } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { existsSync } from "node:fs";
import path from "node:path";
import { InvoiceDocument, registerInvoiceFonts } from "./invoicePdf.mjs";

let fontsRegistered = false;

/**
 * ★ F860 (FINDINGS-OPEN.md) — MEASURED directly: @react-pdf/renderer's font embedding (fontkit
 *   2.0.4) cannot subset-embed a WOFF2 font at all (reproduced with this project's own Inter
 *   WOFF2 files AND an independent WOFF2 from a different Inter build — both crash with
 *   `RangeError: Offset is outside the bounds of the DataView`; the identical text through a
 *   plain WOFF file succeeds). So the PDF pipeline uses its OWN font files, at `fonts/pdf/`, not
 *   the website's `fonts/` (which stays WOFF2, used only by the browser's native font loader —
 *   unaffected by this bug, which is specific to fontkit's subset encoder).
 *
 *   Same resolution order the font files themselves follow in production: built output under
 *   `staticRoot` (`./web/reactdist/fonts/pdf/*`, matching src/http/app.mjs's own staticRoot
 *   default and what Vite's build copies from webreact/public/fonts/pdf verbatim) — falling back
 *   to the repo's `webreact/public/fonts/pdf` directly for local dev/tests where no build has run.
 */
function resolveFontPath(filename, { staticRoot = "./web/reactdist" } = {}) {
  const built = path.resolve(staticRoot, "fonts", "pdf", filename);
  if (existsSync(built)) return built;
  const devSource = path.resolve(import.meta.dirname, "../../webreact/public/fonts/pdf", filename);
  if (existsSync(devSource)) return devSource;
  throw new Error(`invoicePdfServer: Inter font file not found at ${built} or ${devSource}`);
}

function ensureFontsRegistered(opts) {
  if (fontsRegistered) return;
  registerInvoiceFonts((filename) => resolveFontPath(filename, opts));
  fontsRegistered = true;
}

/**
 * ★ Render the invoice PDF server-side, for the Send-time attachment and "Download PDF".
 *   Byte-parity with the browser preview depends entirely on `view` being the SAME frozen
 *   snapshot both sides render — this function adds no server-only variation of its own.
 *
 * @param {object} view a parsed InvoiceViewSchema object (src/money/invoiceView.mjs)
 * @param {object} options { pageSize, staticRoot }
 * @returns {Promise<Buffer>}
 */
export async function renderInvoicePdfBuffer(view, { pageSize = "a4", staticRoot } = {}) {
  ensureFontsRegistered({ staticRoot });
  return renderToBuffer(h(InvoiceDocument, { view, pageSize }));
}
