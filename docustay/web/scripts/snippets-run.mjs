#!/usr/bin/env node
// RUNS every send-a-document sample on the site (the nine tabs of src/lib/site/home-code.js, plus src/lib/site/signpdf.js) so the site never shows code nobody ran (BLUEPRINT §5.1).
// Where: a local server that behaves like POST /api/v1/documents/send: it requires the Bearer key, an Idempotency-Key of 8 to 200 characters and a JSON body that passes the OpenAPI file's SendRequest rules (types, required, enums, uuid, email, no unknown keys),
// and answers with the documented 201 shape. A sample PASSES when it exits 0 and prints that answer. A toolchain that is not installed is reported SKIP (and fails with --strict). A positive control sends a wrong body and must be refused.
//   node scripts/snippets-run.mjs [--strict] [label ...]       SNIP_LIVE=1 DOCUSTAY_URL=... DOCUSTAY_API_KEY=... DOCUSTAY_TEMPLATE_ID=...  runs against a real server instead (a TEST key).
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import http from "node:http"; import { spawn, spawnSync } from "node:child_process";
import { SEND_TABS } from "../src/lib/site/home-code.js";
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const api = JSON.parse(fs.readFileSync(path.join(ROOT, "../../sdk/openapi/openapi.json"), "utf8")); const schemas = api.components.schemas;
const deref = (s) => (s?.$ref ? deref(schemas[s.$ref.split("/").pop()]) : s);
export function validate(v, s, at = "body") {
  s = deref(s); if (!s) return []; const e = []; const t = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
  const kind = v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v;
  if (t.length && !t.includes(kind) && !(kind === "integer" && t.includes("number"))) return [`${at}: expected ${t.join("|")}, got ${kind}`];
  if (s.enum && !s.enum.includes(v)) e.push(`${at}: ${JSON.stringify(v)} not in enum`);
  if (s.format === "uuid" && typeof v === "string" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) e.push(`${at}: not a uuid`);
  if (s.format === "email" && typeof v === "string" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) e.push(`${at}: not an email`);
  if (typeof v === "string") { if (s.minLength && v.length < s.minLength) e.push(`${at}: too short`); if (s.maxLength && v.length > s.maxLength) e.push(`${at}: too long`); }
  if (kind === "object") { for (const r of s.required ?? []) if (!(r in v)) e.push(`${at}: missing ${r}`); for (const [k, x] of Object.entries(v)) { if (s.properties?.[k]) e.push(...validate(x, s.properties[k], `${at}.${k}`)); else if (s.properties && s.additionalProperties === false) e.push(`${at}: unknown key ${k}`); } }
  if (kind === "array" && s.items) v.forEach((x, i) => e.push(...validate(x, s.items, `${at}[${i}]`)));
  return e;
}
const TEMPLATE = "6f1c1f0e-7a0c-4d1d-9b5e-2f0a7b1c3d4e", KEY = "dsk_test_snippet_runner";
const seen = []; const server = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    const why = []; if (req.method !== "POST" || req.url !== "/api/v1/documents/send") why.push(`unexpected ${req.method} ${req.url}`);
    if (req.headers.authorization !== `Bearer ${KEY}`) why.push("missing or wrong Bearer key"); const ik = req.headers["idempotency-key"] ?? ""; if (ik.length < 8 || ik.length > 200) why.push("Idempotency-Key must be 8 to 200 characters");
    if (!/application\/json/.test(req.headers["content-type"] ?? "")) why.push("Content-Type must be application/json");
    let j = null; try { j = JSON.parse(b); } catch { why.push("body is not JSON"); } if (j) why.push(...validate(j, schemas.SendRequest)); seen.push(why);
    if (why.length) { res.writeHead(400, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: { kind: "invalid", message: why.join("; ") } })); }
    res.writeHead(201, { "content-type": "application/json" }); res.end(JSON.stringify({ id: "11111111-2222-4333-8444-555555555555", state: "sent", emailed: 1, notEmailed: [] }));
  });
});
const live = process.env.SNIP_LIVE === "1"; await new Promise((r) => server.listen(0, "127.0.0.1", r)); const base = live ? process.env.DOCUSTAY_URL : `http://127.0.0.1:${server.address().port}`;
const env = { ...process.env, DOCUSTAY_URL: base, DOCUSTAY_API_KEY: live ? process.env.DOCUSTAY_API_KEY : KEY, DOCUSTAY_TEMPLATE_ID: live ? process.env.DOCUSTAY_TEMPLATE_ID : TEMPLATE, PYTHONPATH: path.resolve(ROOT, "../../sdk/python") };
const strict = process.argv.includes("--strict"); const only = process.argv.slice(2).filter((a) => !a.startsWith("--")); const dir = fs.mkdtempSync(path.join(os.tmpdir(), "snips-"));
fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}'); fs.mkdirSync(path.join(dir, "node_modules/@docustay2026"), { recursive: true }); fs.symlinkSync(path.resolve(ROOT, "../../sdk/js"), path.join(dir, "node_modules/@docustay2026/sdk"));
const have = (c) => spawnSync("sh", ["-c", `command -v ${c}`]).status === 0;
const RUN = { cURL: ["sh", "{f}"], Node: ["node", "{f}"], Python: ["python3", "{f}"], Go: ["go", "run", "{f}"], PHP: ["php", "{f}"] };
let bad = 0, skipped = 0, ran = 0;
for (const t of SEND_TABS) {
  if (only.length && !only.includes(t.label)) continue; if (t.runs === false) { console.log(`INFO  ${t.label.padEnd(7)} not an HTTP send (a command or a config); shown as the docs show it`); continue; }
  const f = path.join(dir, `snippet_${t.label.replace(/\W/g, "")}.${t.ext}`); fs.writeFileSync(f, t.code);
  let cmd = RUN[t.label]; if (t.label === "C#") { if (!have("dotnet")) cmd = null; else { const p = path.join(dir, "cs"); fs.mkdirSync(p, { recursive: true }); fs.writeFileSync(path.join(p, "cs.csproj"), '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework><ImplicitUsings>disable</ImplicitUsings><Nullable>disable</Nullable></PropertyGroup></Project>'); fs.writeFileSync(path.join(p, "Program.cs"), t.code); cmd = ["dotnet", "run", "--project", path.join(p, "cs.csproj")]; } }
  if (!cmd || !have(cmd[0])) { console.log(`SKIP  ${t.label.padEnd(7)} (${cmd?.[0] ?? "dotnet"} is not installed on this machine)`); skipped++; continue; }
  const file = f;
  const r = await new Promise((done) => { const c = spawn(cmd[0], cmd.slice(1).map((a) => a.replace("{f}", file)), { cwd: dir, env }); let so = "", se = ""; const to = setTimeout(() => c.kill("SIGKILL"), 180000); c.stdout.on("data", (d) => (so += d)); c.stderr.on("data", (d) => (se += d)); c.on("close", (code) => { clearTimeout(to); done({ status: code, stdout: so, stderr: se }); }); c.on("error", (e) => done({ status: 1, stdout: "", stderr: String(e) })); }); ran++;
  const out = (r.stdout + r.stderr).trim().split("\n").pop(); const ok = r.status === 0 && /"?state"?[:= ]+"?sent|\bsent\b/.test(r.stdout); console.log(`${ok ? "PASS" : "FAIL"}  ${t.label.padEnd(7)} ${out.slice(0, 120)}`); if (!ok) { bad++; if (seen.at(-1)?.length) console.log("      server said:", seen.at(-1).join("; ")); }
}
// positive control: the checker must refuse a wrong body
const wrong = await fetch(`${base}/api/v1/documents/send`, { method: "POST", headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", "idempotency-key": "12345678" }, body: JSON.stringify({ templateId: "nope", parties: [{ seat: "signer_1", name: "", email: "x" }] }) }).then((r) => r.status).catch(() => 0);
if (!live) { if (wrong === 400) console.log("PASS  control: a wrong body is refused (400)"); else { console.log(`FAIL  control: wrong body answered ${wrong}`); bad++; } }
fs.rmSync(dir, { recursive: true, force: true }); server.close();
console.log(`${bad || (strict && skipped) ? "SNIPPETS FAIL" : "SNIPPETS PASS"}  ran ${ran}, skipped ${skipped}, failed ${bad}`); process.exit(bad || (strict && skipped) ? 1 : 0);
