#!/usr/bin/env node
// Runs every snippet on the "Sign a PDF with …" pages against a Docustay (the sandbox by default) and checks each one made a document. Env: SNIP_ENV=/path/env.json with { key, base, templateId } (a TEST key).
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { spawnSync } from "node:child_process";
import { SIGNPDF } from "../src/lib/site/signpdf.js";
const e = JSON.parse(fs.readFileSync(process.env.SNIP_ENV ?? "/tmp/snip/env.json", "utf8"));
const only = process.argv[2] ? new Set(process.argv.slice(2)) : null;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "signpdf-")); let bad = 0;
fs.writeFileSync(path.join(dir, "package.json"), "{\"type\":\"module\"}"); fs.mkdirSync(path.join(dir, "node_modules/@docustay"), { recursive: true });
fs.symlinkSync(path.resolve("../../sdk/js"), path.join(dir, "node_modules/@docustay2026/sdk"));
for (const s of SIGNPDF) {
  if (only && !only.has(s.slug)) continue;
  const file = path.join(dir, s.file ?? `snippet.${s.ext}`); fs.writeFileSync(file, s.code);
  if (s.slug === "typescript") { const t = spawnSync(path.resolve("node_modules/.bin/tsc"), ["--noEmit", "--strict", "--module", "nodenext", "--moduleResolution", "nodenext", "--target", "es2022", "--skipLibCheck", "--typeRoots", path.resolve("../../node_modules/@types"), "--types", "node", file], { cwd: dir, encoding: "utf8" }); const tok = t.status === 0; console.log(`${tok ? "PASS" : "FAIL"}  TypeScript types  ${(t.stdout + t.stderr).trim().split("\n")[0].slice(0, 160)}`); if (!tok) bad++; }
  const [cmd, ...args] = s.run.map((a) => a.replace("{file}", file));
  const r = spawnSync(cmd, args, { cwd: dir, encoding: "utf8", timeout: 120000, env: { ...process.env, PYTHONPATH: path.resolve("../../sdk/python"), DOCUSTAY_API_KEY: e.key, DOCUSTAY_URL: e.base, DOCUSTAY_TEMPLATE_ID: e.templateId } });
  const out = (r.stdout + r.stderr).trim().split("\n").pop();
  const ok = r.status === 0 && /[0-9a-f]{8}-[0-9a-f-]{27}|"id"/.test(r.stdout);
  console.log(`${ok ? "PASS" : "FAIL"}  ${s.name}  ${out.slice(0, 140)}`); if (!ok) bad++;
}
fs.rmSync(dir, { recursive: true, force: true });
process.exit(bad ? 1 : 0);
