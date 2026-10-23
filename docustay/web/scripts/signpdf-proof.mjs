#!/usr/bin/env node
// Runs every snippet on the "Sign a PDF with …" pages against a Docustay (the sandbox by default) and checks each one made a document. Env: SNIP_ENV=/path/env.json with { key, base, templateId } (a TEST key).
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { spawnSync } from "node:child_process";
import { SIGNPDF } from "../src/lib/site/signpdf.js";
const e = JSON.parse(fs.readFileSync(process.env.SNIP_ENV ?? "/tmp/snip/env.json", "utf8"));
const only = process.argv[2] ? new Set(process.argv.slice(2)) : null;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "signpdf-")); let bad = 0;
fs.writeFileSync(path.join(dir, "package.json"), "{\"type\":\"module\"}"); fs.mkdirSync(path.join(dir, "node_modules/@docustay2026"), { recursive: true });
fs.symlinkSync(path.resolve("../../sdk/js"), path.join(dir, "node_modules/@docustay2026/sdk"));
for (const s of SIGNPDF) {
  if (only && !only.has(s.slug)) continue;
  const file = path.join(dir, s.file ?? `snippet.${s.ext}`); fs.writeFileSync(file, s.code);
  if (s.slug === "typescript") { const t = spawnSync(path.resolve("node_modules/.bin/tsc"), ["--noEmit", "--strict", "--module", "nodenext", "--moduleResolution", "nodenext", "--target", "es2022", "--skipLibCheck", "--typeRoots", path.resolve("../../node_modules/@types"), "--types", "node", file], { cwd: dir, encoding: "utf8" }); const tok = t.status === 0; console.log(`${tok ? "PASS" : "FAIL"}  TypeScript types  ${(t.stdout + t.stderr).trim().split("\n")[0].slice(0, 160)}`); if (!tok) bad++; }
  if (s.container) { // Go, PHP and C# run in a container under the home folder (Colima mounts only $HOME); the package is installed from its REAL registry
    const d2 = fs.mkdtempSync(path.join(os.homedir(), ".signpdf-")); fs.writeFileSync(path.join(d2, s.file ?? `snippet.${s.ext}`), s.code);
    const r2 = spawnSync("docker", ["run", "--rm", "-e", "DOCUSTAY_API_KEY", "-e", "DOCUSTAY_URL", "-e", "DOCUSTAY_TEMPLATE_ID", "-v", `${d2}:/w`, "-w", "/w", s.container.image, "sh", "-c", s.container.run], { encoding: "utf8", timeout: 600000, env: { ...process.env, DOCUSTAY_API_KEY: e.key, DOCUSTAY_URL: e.base, DOCUSTAY_TEMPLATE_ID: e.templateId } }); fs.rmSync(d2, { recursive: true, force: true });
    const out2 = (r2.stdout + r2.stderr).trim().split("\n").pop(); const ok2 = r2.status === 0 && /[0-9a-f]{8}-[0-9a-f-]{27}/.test(r2.stdout);
    console.log(`${ok2 ? "PASS" : "FAIL"}  ${s.name} (container, real registry)  ${out2.slice(0, 140)}`); if (!ok2) bad++; continue;
  }
  const [cmd, ...args] = s.run.map((a) => a.replace("{file}", file));
  const r = spawnSync(cmd, args, { cwd: dir, encoding: "utf8", timeout: 120000, env: { ...process.env, PYTHONPATH: path.resolve("../../sdk/python"), DOCUSTAY_API_KEY: e.key, DOCUSTAY_URL: e.base, DOCUSTAY_TEMPLATE_ID: e.templateId } });
  const out = (r.stdout + r.stderr).trim().split("\n").pop();
  const ok = r.status === 0 && /[0-9a-f]{8}-[0-9a-f-]{27}|"id"/.test(r.stdout);
  console.log(`${ok ? "PASS" : "FAIL"}  ${s.name}  ${out.slice(0, 140)}`); if (!ok) bad++;
}
fs.rmSync(dir, { recursive: true, force: true });
process.exit(bad ? 1 : 0);
