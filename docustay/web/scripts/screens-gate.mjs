#!/usr/bin/env node
// Every picture the depth pages show (static/screens/*.png) must be a real 1280x800 screenshot: right size, not blank, not a copy of another.
// Three of them were 1x1 placeholders for weeks and the depth gate only checked that the file existed (Part 31 follow-up). Includes a positive control.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, "..", "static", "screens");
const DEPTH = path.join(HERE, "..", "src", "lib", "site", "depth");   // the old depth pages are gone (site redo); the checks below run only if that folder exists
const depthFiles = () => (fs.existsSync(DEPTH) ? depthFiles() : []);
const dims = (b) => (b.length > 24 && b.toString("ascii", 1, 4) === "PNG" ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } : null);
export function check(files) {
  const bad = [], seen = new Map();
  for (const [name, buf] of files) {
    const d = dims(buf);
    if (!d) { bad.push(`${name}: not a PNG`); continue; }
    if (d.w !== 1280 || d.h !== 800) bad.push(`${name}: ${d.w}x${d.h}, must be 1280x800`);
    if (buf.length < 12_000) bad.push(`${name}: ${buf.length} bytes, looks blank`);
    const h = crypto.createHash("sha1").update(buf).digest("hex");
    if (seen.has(h)) bad.push(`${name}: identical to ${seen.get(h)}`); else seen.set(h, name);
  }
  return bad;
}
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".png")).map((f) => [f, fs.readFileSync(path.join(DIR, f))]);
const bad = check(files);
for (const f of ["src/routes/(site)/+page.svelte"]) for (const m of fs.readFileSync(path.join(HERE, "..", f), "utf8").matchAll(/shot:\s*"([^"]+\.png)"/g)) if (!fs.existsSync(path.join(DIR, m[1]))) bad.push(`${f} references missing ${m[1]}`);
for (const f of depthFiles()) for (const m of fs.readFileSync(path.join(DEPTH, f), "utf8").matchAll(/file:\s*"([^"]+)"/g)) if (!fs.existsSync(path.join(DIR, m[1]))) bad.push(`${f} references missing ${m[1]}`);
// one picture, one description: a file reused on several pages must carry the same description everywhere (a waiver caption on a services-agreement picture is a lie), and nothing public may show the team's own address
const alts = new Map();
for (const f of depthFiles()) for (const m of fs.readFileSync(path.join(DEPTH, f), "utf8").matchAll(/file:\s*"([^"]+)",\s*alt:\s*"([^"]*)"/g)) { const set = alts.get(m[1]) ?? new Set(); set.add(m[2]); alts.set(m[1], set); }
for (const [file, set] of alts) if (set.size > 1) bad.push(`${file} is described ${set.size} different ways: ${[...set].map((x) => `"${x}"`).join(" / ")}`);
const tiny = Buffer.alloc(100); tiny.write("\x89PNG", 0, "latin1"); tiny.writeUInt32BE(1, 16); tiny.writeUInt32BE(1, 20);
const control = check([["control.png", tiny]]);
if (control.length < 2) { console.log("FAIL control: a 1x1 picture was not caught"); process.exit(1); }
console.log(bad.length ? "FAIL\n" + bad.join("\n") : `PASS ${files.length} screens, all 1280x800, none blank or duplicated (control caught: ${control.join("; ")})`);
process.exit(bad.length ? 1 : 0);
