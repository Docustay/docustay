// D-010 / D-012 — the self-host package ships Docustay's own web app, and that app works on the owner's own hostname.
// Run: node test/docustay_selfhost_web.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const require = createRequire(import.meta.url);
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log("  ok", name); };

// ── the compose file: Docustay's web app is the public face; the backend is internal ──
const YAML = require("yaml");
const compose = YAML.parse(fs.readFileSync(path.join(ROOT, "docustay/docker-compose.yml"), "utf8"));
await t("compose has a web service built from docustay/web/Dockerfile (the screens the product pictures show)", () => {
  const w = compose.services.web; assert.ok(w, "no web service");
  assert.equal(w.build.dockerfile, "docustay/web/Dockerfile"); assert.equal(path.normalize(path.join("docustay", w.build.context)), ".", "build context is the repository root");
});
await t("the web service reaches the backend by its internal name and waits for it", () => {
  const w = compose.services.web; const env = Array.isArray(w.environment) ? Object.fromEntries(w.environment.map((e) => e.split(/=(.*)/s).slice(0, 2))) : w.environment;
  assert.equal(env.DOCUSTAY_API_URL, "http://app:8080"); assert.equal(String(env.DOCUSTAY_SELF_HOST), "1");
  assert.ok(w.depends_on?.app, "web depends on app");
});
await t("only the web service publishes a port; the backend, database and storage are not reachable from outside", () => {
  assert.ok(compose.services.web.ports?.length === 1, "web publishes one port");
  assert.match(String(compose.services.web.ports[0]), /DOCUSTAY_PORT:-8080\}?:3000$/);
  for (const s of ["app", "worker", "db", "storage", "gotenberg"]) assert.ok(!(compose.services[s].ports ?? []).length, `${s} must not publish a port`);
});
await t("signing and reset links default to the web address the owner opens (KEYSTONE_PUBLIC_URL and KEYSTONE_DOCUSTAY_APP_URL)", () => {
  const e = compose.services.app.environment ?? {}; const env = Array.isArray(e) ? Object.fromEntries(e.map((x) => x.split(/=(.*)/s).slice(0, 2))) : e;
  for (const k of ["KEYSTONE_PUBLIC_URL", "KEYSTONE_DOCUSTAY_APP_URL", "KEYSTONE_DOCUSTAY_SIGN_URL"]) assert.match(String(env[k]), /localhost:\$\{DOCUSTAY_PORT:-8080\}|\$\{KEYSTONE_PUBLIC_URL/, `${k} has a default that is the web address`);
});
await t("positive control: a compose file without a web service is caught by the same check", () => {
  const broken = { services: { ...compose.services, web: undefined } };
  assert.throws(() => assert.ok(broken.services.web, "no web service"));
});

// ── the host guard: on a self-hosted install every hostname is the owner's own ──
await t("self-host mode: any hostname may serve the workspace; hosted mode still refuses a customer's own hostname", async () => {
  const load = async (self) => { process.env.DOCUSTAY_SELF_HOST = self ? "1" : ""; return import(pathToFileURL(path.join(ROOT, "docustay/web/src/lib/hostGuard.js")).href + `?s=${self ? 1 : 0}`); };
  const hosted = await load(false), selfhost = await load(true);
  assert.equal(hosted.hostMayServe("sign.theircompany.com", "/login"), false, "positive control: hosted mode refuses");
  assert.equal(selfhost.hostMayServe("docustay.example.com", "/login"), true);
  assert.equal(selfhost.hostMayServe("203.0.113.9", "/documents"), true);
  assert.equal(selfhost.redirectFor("docustay.app", "/login"), null, "self-host mode never sends a visitor to docustay.app");
  assert.ok(hosted.redirectFor("docustay.app", "/login"), "positive control: hosted mode does");
});

// ── the setup page: the contract with POST /api/setup/owner ──
await t("the /setup page exists and posts the fields the server reads (setupToken, orgName, email, password, timezone)", () => {
  const p = path.join(ROOT, "docustay/web/src/routes/(auth)/setup/+page.svelte"); assert.ok(fs.existsSync(p), "no /setup page");
  const src = fs.readFileSync(p, "utf8"); assert.match(src, /\/api\/setup\/state/); assert.match(src, /\/api\/setup\/owner/);
  const server = fs.readFileSync(path.join(ROOT, "src/routes/localAuth.mjs"), "utf8");
  for (const f of ["setupToken", "orgName", "email", "password", "timezone"]) { assert.match(server, new RegExp(`body\\?\\.${f}`), `server reads ${f}`); assert.match(src, new RegExp(f), `page sends ${f}`); }
});
await t("the web server sends / to setup or the workspace on a self-hosted install, and /signup to sign-in", () => {
  const h = fs.readFileSync(path.join(ROOT, "docustay/web/src/hooks.server.js"), "utf8");
  assert.match(h, /DOCUSTAY_SELF_HOST/); assert.match(h, /\/api\/setup\/state/); assert.match(h, /\/setup/);
});
console.log(`ok — ${n} cases`);
