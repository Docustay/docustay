// FP-H1/H2 — the one-click deploy files parse, name the six pieces, and every setting they set is a setting the code actually reads (so a rename cannot leave a deploy file pointing at nothing).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parse } from "yaml";

const read = (f) => fs.readFileSync(new URL(`../docustay/deploy/${f}`, import.meta.url), "utf8");
const code = (() => { const out = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = `${d}/${e.name}`; if (e.isDirectory() && e.name !== "node_modules") walk(p); else if (/\.mjs$/.test(e.name)) out.push(fs.readFileSync(p, "utf8")); } }; walk(new URL("../src", import.meta.url).pathname); out.push(fs.readFileSync(new URL("../docustay/entrypoint.mjs", import.meta.url), "utf8")); return out.join("\n"); })();
const reads = (k) => code.includes(`.${k}`) || code.includes(`"${k}"`) || ["DOCUSTAY_API_URL", "PORT"].includes(k);   // DOCUSTAY_API_URL is read by the web app, PORT by node itself

test("render.yaml: web, app, worker, converter, store and a database", () => {
  const r = parse(read("render.yaml"));
  assert.deepEqual(r.services.map((s) => s.name).sort(), ["docustay-app", "docustay-gotenberg", "docustay-storage", "docustay-web", "docustay-worker"]);
  assert.equal(r.databases.length, 1);
  assert.equal(r.services.filter((s) => s.type === "web").length, 1, "only the web app is public");
  for (const s of r.services.filter((x) => ["docustay-app", "docustay-worker"].includes(x.name))) assert.ok(s.envVars.some((v) => v.key === "KEYSTONE_TOKEN_PEPPER" && v.generateValue), `${s.name} generates its own pepper`);
  for (const s of r.services) for (const v of s.envVars ?? []) if (v.key.startsWith("KEYSTONE_") || v.key === "RESEND_API_KEY") assert.ok(reads(v.key) || ["KEYSTONE_DB_PASSWORD"].includes(v.key), `${v.key} is not read by the code`);
});

test("fly.toml: three process groups and a public web service only", () => {
  const raw = read("fly.toml");
  for (const p of ["app = ", "worker = ", "web = "]) assert.ok(raw.includes(p));
  assert.match(raw, /processes = \["web"\][\s\S]*?port = 443/);
  for (const m of raw.matchAll(/^\s*(KEYSTONE_[A-Z0-9_]+) =/gm)) assert.ok(reads(m[1]), `${m[1]} is not read by the code`);
});

test("the Helm chart declares the same secrets the compose file generates", () => {
  const values = parse(read("helm/docustay/values.yaml"));
  for (const k of ["dbPassword", "tokenPepper", "localAuthSecret", "masterKey", "setupToken", "s3AccessKeyId", "s3SecretAccessKey"]) assert.ok(k in values.secrets, k);
  const tpl = read("helm/docustay/templates/app.yaml") + read("helm/docustay/templates/_helpers.tpl");
  for (const m of tpl.matchAll(/name: (KEYSTONE_[A-Z0-9_]+)/g)) assert.ok(reads(m[1]) || m[1] === "KEYSTONE_DB_PASSWORD", `${m[1]} is not read by the code`);
});

// D-010: the self-host web container reaches the API as host "app"; the API must not 404 it as a stranger's hostname (found by running the compose package for real, 7 Oct 2026)
import { isPlatformHost } from "../src/http/customHost.mjs";
test("a self-hosted install treats every hostname as its own; the hosted one still does not", () => {
  const before = process.env.KEYSTONE_SELF_HOST;
  try {
    delete process.env.KEYSTONE_SELF_HOST;
    assert.equal(isPlatformHost("app", "docustay.app"), false);              // hosted: an unknown name is not ours
    assert.equal(isPlatformHost("docustay.app", "docustay.app"), true);      // positive control
    process.env.KEYSTONE_SELF_HOST = "1";
    assert.equal(isPlatformHost("app", "docustay.app"), true);
    assert.equal(isPlatformHost("sign.example.com", ""), true);
  } finally { if (before === undefined) delete process.env.KEYSTONE_SELF_HOST; else process.env.KEYSTONE_SELF_HOST = before; }
});
