#!/usr/bin/env node
// Licence gate (Part 31 Part B). Reads what the site is built from with license-checker, classifies every package, and writes src/lib/licences.json (the data behind the Third-party notices page) and static/THIRD-PARTY-NOTICES.txt.
// Fails when: a package that ships (production dependencies) has a licence that is not on the allowed list and has no recorded exception; a package has no licence at all; the committed notices file is stale (--check); a font file in static/fonts has no licence text beside it; a media clip is missing its Pexels id.
// Dev-only tools (build, test) may carry weaker-copyleft licences (MPL-2.0) because nothing of them ships; they are listed separately so nobody has to guess.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const ALLOWED_SHIP = new Set(["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "CC0-1.0", "Unlicense", "BlueOak-1.0.0", "OFL-1.1", "Python-2.0", "Zlib"]);   // Zlib added 8 Oct 2026 (pass 2): pako, a pdf-lib dependency, is "MIT AND Zlib"; the zlib licence is permissive and needs only its notice kept (THIRD-PARTY-NOTICES)
const ALLOWED_DEV = new Set([...ALLOWED_SHIP, "MPL-2.0", "CC-BY-4.0"]);
const EXCEPTIONS = {};   // "name@version": "why this licence may ship", e.g. a written permission. Empty on purpose.
const run = (scope) => JSON.parse(execFileSync("npx", ["license-checker-rseidelsohn", `--${scope}`, "--json", "--excludePrivatePackages"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
const branches = (expr) => String(expr).replace(/[()*]/g, "").split(/\s+(?:OR|AND)\s+/i).map((s) => s.trim());
const okFor = (expr, set) => (/\sAND\s/i.test(expr) ? branches(expr).every((b) => set.has(b)) : branches(expr).some((b) => set.has(b)));
const norm = (d) => Object.entries(d).map(([k, v]) => { const i = k.lastIndexOf("@"); return { name: k.slice(0, i), version: k.slice(i + 1), licence: String(v.licenses ?? "UNKNOWN"), repository: v.repository ?? null, publisher: v.publisher ?? null }; }).sort((a, b) => a.name.localeCompare(b.name));
const ship = norm(run("production")), dev = norm(run("development")).filter((d) => !ship.some((s) => s.name === d.name && s.version === d.version));
const problems = [];
for (const p of ship) { if (!okFor(p.licence, ALLOWED_SHIP) && !EXCEPTIONS[`${p.name}@${p.version}`]) problems.push(`ships with ${p.licence}: ${p.name}@${p.version}`); if (/UNKNOWN|UNLICENSED|SEE LICENSE/i.test(p.licence)) problems.push(`no licence: ${p.name}@${p.version}`); }
for (const p of dev) if (!okFor(p.licence, ALLOWED_DEV)) problems.push(`dev tool with ${p.licence}: ${p.name}@${p.version}`);
const fonts = fs.readdirSync(path.join(ROOT, "static/fonts")).filter((f) => /\.woff2?$/.test(f)); const fontLic = fs.readdirSync(path.join(ROOT, "static/fonts")).filter((f) => /^LICENSE/.test(f));
if (fonts.length && !fontLic.length) problems.push("fonts without a licence text in static/fonts");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "static/media/manifest.json"), "utf8")); const clips = (manifest.clips_used ?? []).map((c) => ({ id: c.pexels_id, page: c.page })); for (const c of clips) if (!c.id || !c.page) problems.push(`media clip without a Pexels id/page: ${JSON.stringify(c)}`);
const out = { fonts: fonts.map((f) => ({ file: f, licence: "OFL-1.1", text: fontLic })), media: { source: "Pexels", licence: "Pexels License (free to use, attribution not required)", clips }, shipped: ship, devOnly: dev };
const txt = () => `THIRD-PARTY NOTICES — Docustay\n\nThis lists the open-source software Docustay's website is built from, with each package's licence. Each package's own licence text is in its package; nothing here changes those terms.\n\n== Shipped with the site (${ship.length} packages) ==\n${ship.map((p) => `${p.name}@${p.version}  ${p.licence}${p.repository ? "  " + p.repository : ""}`).join("\n")}\n\n== Fonts ==\nInter and Fraunces, SIL Open Font Licence 1.1 (texts in /fonts/LICENSE-OFL-*.txt)\n\n== Film and clips ==\nPexels footage, Pexels License. Clip ids: ${clips.map((c) => c.id).join(", ")}\n\n== Build and test tools, not shipped (${dev.length} packages) ==\n${dev.map((p) => `${p.name}@${p.version}  ${p.licence}`).join("\n")}\n`;
const files = [["src/lib/licences.json", JSON.stringify(out, null, 1) + "\n"], ["static/THIRD-PARTY-NOTICES.txt", txt()]];
if (process.argv.includes("--check")) { for (const [f, t] of files) if (!fs.existsSync(path.join(ROOT, f)) || fs.readFileSync(path.join(ROOT, f), "utf8") !== t) problems.push(`${f} is stale: run node scripts/licence-gate.mjs`); }
else for (const [f, t] of files) fs.writeFileSync(path.join(ROOT, f), t);
const byLic = (a) => Object.entries(a.reduce((m, p) => ((m[p.licence] = (m[p.licence] ?? 0) + 1), m), {})).map(([l, n]) => `${l} ${n}`).join(", ");
console.log(`shipped ${ship.length}: ${byLic(ship)}\ndev-only ${dev.length}: ${byLic(dev)}\nfonts ${fonts.length}, clips ${clips.length}`);
if (problems.length) { for (const p of problems) console.log("  FAIL " + p); console.log("LICENCE GATE FAIL"); process.exit(1); }
console.log("LICENCE GATE PASS");
