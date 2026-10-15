// A short fingerprint of everything that decides how a starter prints: its HTML, options, the typeset look and the footer. The printed form (docustay/web/starters/manifest.json) records it; the website build fails when they differ.
import crypto from "node:crypto";
import { typesetCss, footerHtml } from "../typeset.mjs";
export const fingerprint = (s) => crypto.createHash("sha256").update(JSON.stringify({ html: s.html, paper: s.paper, initials: s.initials ?? [], title: s.title, css: typesetCss(), footer: footerHtml({ ref: `Form: ${s.slug}`, initialsLabels: (s.initials ?? []).map((r) => r.slice(0, 11)) }) })).digest("hex").slice(0, 16);
