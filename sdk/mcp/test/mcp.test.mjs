import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const calls = [];
const api = http.createServer(async (req, res) => {
  let body = ""; for await (const c of req) body += c; calls.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : undefined, auth: req.headers.authorization });
  const j = (s, o) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
  if (req.url.includes("00000000-0000-4000-8000-00000000dead")) return j(404, { error: { kind: "not_found", message: "no such document", requestId: "req-1", retryable: false } });
  if (req.url === "/api/v1/documents/ai/draft") return j(403, { error: { kind: "forbidden", message: "AI drafting is switched off for this workspace", detail: { code: "ai_off" }, requestId: "req-2", retryable: false } });
  if (req.url.endsWith("/signed.pdf")) { res.writeHead(200, { "content-type": "application/pdf" }); return res.end(Buffer.from("%PDF-1.7 hi")); }
  if (req.url === "/api/v1/documents/send") return j(201, { id: "11111111-1111-4111-8111-111111111111", state: "sent" });
  if (req.method === "GET" && req.url.startsWith("/api/v1/documents/1111")) return j(200, { id: "11111111-1111-4111-8111-111111111111", title: "Lease", state: "sent", test: true });
  if (req.url.endsWith("/void")) return j(200, { id: "x", state: "void" });
  if (req.url.endsWith("/remind")) return j(200, { id: "x", reminded: 1 });
  if (req.method === "GET" && req.url.startsWith("/api/v1/templates/")) return j(200, { id: "t1", name: "Lease" });
  if (req.url.startsWith("/api/v1/documents/templates")) return j(200, { templates: [{ id: "t1", name: "Lease" }] });
  j(200, {});
});
await new Promise((r) => api.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${api.address().port}`;
const KEY = "gl_test_secretsecretsecret";
async function connect(env = {}) {
  const client = new Client({ name: "test", version: "1" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [new URL("../src/server.js", import.meta.url).pathname], env: { ...process.env, DOCUSTAY_API_KEY: KEY, DOCUSTAY_BASE_URL: base, ...env } }));
  return client;
}
const call = async (c, name, args) => { const r = await c.callTool({ name, arguments: args }); return { isError: r.isError === true, text: r.content.map((x) => x.text).join("") }; };
const ID = "11111111-1111-4111-8111-111111111111";

test("lists its tools; a read-only server has none that change anything (positive control: the normal server has them)", async () => {
  const full = await connect(); const names = (await full.listTools()).tools.map((t) => t.name); await full.close();
  for (const n of ["send_document", "remind", "void_document", "create_template_from_html", "list_templates", "get_document"]) assert.ok(names.includes(n), n);
  const ro = await connect({ DOCUSTAY_READ_ONLY: "1" }); const roNames = (await ro.listTools()).tools.map((t) => t.name); await ro.close();
  assert.ok(roNames.includes("get_document") && roNames.includes("list_templates"));
  for (const n of ["send_document", "remind", "void_document", "create_template_from_html"]) assert.ok(!roNames.includes(n), `${n} must not exist when read-only`);
});

test("send_document does NOTHING until confirmed: the first call is a preview and makes no request; the confirmed call sends", async () => {
  const c = await connect(); calls.length = 0;
  const args = { templateId: "22222222-2222-4222-8222-222222222222", parties: [{ seat: "signer_1", name: "Tess", email: "tess@example.com" }], title: "Lease" };
  const pre = await call(c, "send_document", args);
  assert.ok(/TEST MODE/.test(pre.text) && /tess@example\.com/.test(pre.text) && /sent": false/.test(pre.text), pre.text);
  assert.equal(calls.filter((x) => x.method === "POST").length, 0, "no POST before confirmation");
  const sent = await call(c, "send_document", { ...args, confirm: true });
  assert.ok(/"sent": true/.test(sent.text) && /"mode": "test"/.test(sent.text), sent.text);
  const post = calls.find((x) => x.url === "/api/v1/documents/send"); assert.ok(post); assert.equal(post.auth, `Bearer ${KEY}`); assert.equal(post.body.parties[0].email, "tess@example.com");
  await c.close();
});

test("void_document and remind are previews until confirmed (nothing is called), then act", async () => {
  const c = await connect(); calls.length = 0;
  const v1 = await call(c, "void_document", { documentId: ID }); const r1 = await call(c, "remind", { documentId: ID });
  assert.ok(/CANCEL/.test(v1.text) && /cannot be undone/.test(v1.text) && /Would remind/.test(r1.text));
  assert.equal(calls.filter((x) => x.method === "POST").length, 0, "no write request was made by a preview");
  await call(c, "void_document", { documentId: ID, reason: "mistake", confirm: true }); await call(c, "remind", { documentId: ID, confirm: true });
  assert.ok(calls.some((x) => x.url.endsWith("/void") && x.body.reason === "mistake") && calls.some((x) => x.url.endsWith("/remind")));
  await c.close();
});

test("an API error comes back as a readable error with its request id; the key never appears in any output", async () => {
  const c = await connect(); const out = [];
  const e = await call(c, "get_document", { documentId: "00000000-0000-4000-8000-00000000dead" }); out.push(e.text);
  assert.ok(e.isError && /not_found/.test(e.text) && /req-1/.test(e.text), e.text);
  for (const [n, a] of [["list_templates", {}], ["get_document", { documentId: ID }], ["send_document", { templateId: ID, parties: [{ seat: "s", name: "n", email: "a@b.co" }] }]]) out.push((await call(c, n, a)).text);
  assert.ok(!out.join("\n").includes("secretsecret"), "the key is never returned");
  await c.close();
});

test("save_signed_pdf writes the file and returns the path and size, not the bytes", async () => {
  const c = await connect(); const p = path.join(os.tmpdir(), `docustay-mcp-${Date.now()}.pdf`);
  const r = await call(c, "save_signed_pdf", { documentId: ID, path: p });
  assert.ok(/"bytes": 11/.test(r.text), r.text); assert.equal(fs.readFileSync(p, "utf8"), "%PDF-1.7 hi"); fs.unlinkSync(p);
  await c.close();
});

test("without a key the server refuses to start and says what to set", async () => {
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(process.execPath, [new URL("../src/server.js", import.meta.url).pathname], { env: { PATH: process.env.PATH }, encoding: "utf8" });
  assert.notEqual(r.status, 0); assert.match(r.stderr, /DOCUSTAY_API_KEY/);
});
test.after(() => api.close());

test("a refusal with a code but no meter never says undefined (R13-D207)", async () => {
  const c = await connect();
  const e = await call(c, "draft_document_with_ai", { prompt: "an NDA" });
  assert.ok(e.isError && /switched off/.test(e.text) && /req-2/.test(e.text), e.text);
  assert.ok(!/undefined/.test(e.text), e.text);
  await c.close();
});

test("the send preview names the template and refuses one that does not exist (R13-D207)", async () => {
  const c = await connect();
  const ok = await call(c, "send_document", { templateId: ID, parties: [{ seat: "s", name: "n", email: "a@b.co" }] });
  assert.ok(!ok.isError && /Lease/.test(ok.text), ok.text);
  const gone = await call(c, "send_document", { templateId: "00000000-0000-4000-8000-00000000dead", parties: [{ seat: "s", name: "n", email: "a@b.co" }] });
  assert.ok(gone.isError && /not_found/.test(gone.text), gone.text);
  await c.close();
});
