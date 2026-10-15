// The typeset look for documents the product writes itself (the starter templates): US Letter, one-inch margins, an OFL serif for the body (Source Serif 4) with Inter for small labels,
// a title block, hanging clause numbers, tables with light rules, signature lines, and a running footer with the form reference, "Page X of Y" and initials boxes.
// ★ TRUSTED CSS: it lives here, never in a customer's HTML (the sanitiser strips every <style>). A customer's HTML may name these classes (`class="cl"`), nothing more.
// Imports only node:fs: a document that is printed through the host's converter looks the same wherever the island runs.
import fs from "node:fs";

const b64 = (f) => fs.readFileSync(new URL(`./fonts/${f}`, import.meta.url)).toString("base64");
let cache = null;

/** The classes a document's HTML may use (anything else on a class attribute is removed). */
export const TYPESET_CLASSES = Object.freeze(["tb", "sub", "meta", "cl", "n", "sl", "t", "lbl", "sig", "sigrow", "pb", "keep", "rec", "right", "center", "nowrap", "kv", "term", "wit", "sched", "ack", "money", "blank", "inl"]);

export const PAGE_MARGIN_IN = Object.freeze({ top: 1, bottom: 1, left: 1, right: 1 });

function fonts() {
  if (cache) return cache;
  const face = (family, weight, style, file) => `@font-face{font-family:"${family}";font-weight:${weight};font-style:${style};src:url(data:font/woff2;base64,${b64(file)}) format("woff2")}`;
  cache = [
    face("Source Serif 4", 400, "normal", "source-serif-4-latin-400-normal.woff2"), face("Source Serif 4", 400, "italic", "source-serif-4-latin-400-italic.woff2"),
    face("Source Serif 4", 700, "normal", "source-serif-4-latin-700-normal.woff2"), face("Source Serif 4", 700, "italic", "source-serif-4-latin-700-italic.woff2"),
    face("Inter", "100 900", "normal", "inter-latin-wght-normal.woff2"),
  ].join("\n");
  return cache;
}

export const typesetCss = () => `${fonts()}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:"Source Serif 4",Georgia,"Times New Roman",serif;font-size:10pt;line-height:1.42;color:#1b1b1f;margin:0;font-variant-ligatures:common-ligatures}
p{margin:0 0 5.5pt;text-align:left;orphans:3;widows:3}
strong,b{font-weight:700}
.tb{text-align:center;margin:0 0 18pt;padding-bottom:12pt;border-bottom:.9pt solid #1b1b1f}
.tb h1{font-size:19pt;line-height:1.2;font-weight:700;margin:0 0 5pt;letter-spacing:.005em}
.tb .sub{font-family:Inter,Helvetica,Arial,sans-serif;font-size:7.8pt;letter-spacing:.16em;text-transform:uppercase;color:#55555e;margin:0;text-align:center}
.meta{font-family:Inter,Helvetica,Arial,sans-serif;font-size:8.2pt;color:#55555e;margin:0 0 12pt}
h2{font-size:11.2pt;line-height:1.3;font-weight:700;margin:15pt 0 5pt;break-after:avoid;page-break-after:avoid}
h2.sched{font-size:13pt;margin:0 0 4pt}
h3{font-size:10.5pt;font-weight:700;font-style:italic;margin:9pt 0 3pt;break-after:avoid}
.cl{position:relative;padding-left:32pt}
.cl .n{position:absolute;left:0;top:0;width:32pt;font-variant-numeric:tabular-nums}
.sl{position:relative;padding-left:54pt;margin-bottom:4pt}
.sl .n{position:absolute;left:32pt;top:0;width:22pt}
.rec{position:relative;padding-left:22pt}
.rec .n{position:absolute;left:0;top:0;width:22pt;font-weight:700}
ul,ol{margin:0 0 7pt;padding-left:22pt}li{margin:0 0 3pt}
.lbl{font-family:Inter,Helvetica,Arial,sans-serif;font-size:7.2pt;color:#6a6a74;text-transform:uppercase;letter-spacing:.09em;margin:0}
.kv{font-family:Inter,Helvetica,Arial,sans-serif;font-size:9pt}
table.t{border-collapse:collapse;width:100%;table-layout:fixed;font-size:9.6pt;margin:4pt 0 10pt;break-inside:auto}
table.t th{font-family:Inter,Helvetica,Arial,sans-serif;font-size:7.4pt;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:#44444c;text-align:left;border-top:.9pt solid #1b1b1f;border-bottom:.6pt solid #8a8a94;padding:5pt 7pt}
table.t td{padding:6pt 7pt;border-bottom:.45pt solid #cfcfd6;vertical-align:top}
table.t tr{break-inside:avoid}
table.t td,table.t th{overflow-wrap:anywhere}
a[href^="https://docustay.invalid/field/"]{max-width:100%;box-sizing:border-box}
table.t tr:last-child td{border-bottom:.9pt solid #1b1b1f}
.sig{width:100%;border-collapse:collapse;margin:8pt 0 4pt;break-inside:avoid}
.sig td{width:50%;vertical-align:top;padding:0 18pt 14pt 0}
.sig p{margin:0 0 9pt}
.sig .lbl{margin-top:2pt}
.pb{break-before:page;page-break-before:always}
.keep{break-inside:avoid;page-break-inside:avoid}
.keep h2,.keep p{break-after:avoid;page-break-after:avoid}.keep p:last-child{break-after:auto;page-break-after:auto}.keep p.lbl{break-before:avoid;page-break-before:avoid}
.keep>p{break-inside:avoid;page-break-inside:avoid}
.center{text-align:center}.right{text-align:right}.nowrap{white-space:nowrap}
.money{font-variant-numeric:tabular-nums}
.ack{padding-left:22pt;text-indent:-22pt}
.wit{margin-top:10pt;padding-top:8pt;border-top:.45pt solid #cfcfd6}
`;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** The running footer Chromium repeats on every page. `initialsCells` is the number of initials boxes at the right (0 for a short document); each box is a marked link the renderer reads back as a field. */
export function footerHtml({ ref, initialsLabels = [] }) {
  const cell = (label, k) => `<span style="display:inline-block;margin-left:9px;text-align:left"><span style="display:inline-block;width:auto;margin-right:5px;font-size:7.5px;letter-spacing:.05em;text-transform:uppercase;color:#6a6a74;vertical-align:bottom">${esc(label)}</span><a href="https://docustay.invalid/initials/${k}" style="display:inline-block;width:62px;height:24px;border-bottom:.6px solid #777;text-decoration:none;vertical-align:bottom">&nbsp;</a></span>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${fonts().split("\n").filter((l) => l.includes('"Inter"')).join("\n")}
html,body{margin:0;padding:0}</style></head><body><div style="width:100%;box-sizing:border-box;padding:0 96px;font-family:Inter,Helvetica,Arial,sans-serif;font-size:9px;color:#6a6a74;display:flex;justify-content:space-between;align-items:flex-end;-webkit-print-color-adjust:exact">
<span style="padding-bottom:2px">${esc(ref)}</span><span style="padding-bottom:2px">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span><span style="white-space:nowrap">${initialsLabels.map(cell).join("")}</span></div></body></html>`;
}
