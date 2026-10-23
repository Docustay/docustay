import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHmac } from "node:crypto";
import { Docustay, DocustayError, verifyWebhook } from "../src/index.js";

function stub(handler) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const call = { method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : undefined }; calls.push(call);
    handler(call, res, calls.length);
  });
  return new Promise((r) => server.listen(0, () => r({ calls, base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}
const json = (res, status, obj, headers = {}) => { res.writeHead(status, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(obj)); };

test("sends the bearer key and an idempotency key on a POST, none on a GET", async () => {
  const s = await stub((c, res) => json(res, 200, { id: "d1", state: "sent" }));
  const d = new Docustay("gl_test_abc", { baseUrl: s.base });
  assert.equal(d.testMode, true);
  await d.sendDocument({ templateId: "t", parties: [{ seat: "signer_1", name: "A", email: "a@x.test" }] });
  await d.getDocument("d1");
  assert.equal(s.calls[0].headers.authorization, "Bearer gl_test_abc");
  assert.ok(s.calls[0].headers["idempotency-key"].length >= 8);
  assert.equal(s.calls[1].headers["idempotency-key"], undefined); // positive control: GET has none
  s.close();
});

test("a retry after a 503 reuses the SAME idempotency key (never sends twice)", async () => {
  const s = await stub((c, res, n) => n === 1 ? json(res, 503, { error: { kind: "dependency", message: "x", retryable: true } }) : json(res, 200, { id: "d1", state: "sent" }));
  const d = new Docustay("gl_live_k", { baseUrl: s.base, maxRetries: 2 });
  const out = await d.sendDocument({ templateId: "t", parties: [] });
  assert.equal(out.id, "d1"); assert.equal(s.calls.length, 2);
  assert.equal(s.calls[0].headers["idempotency-key"], s.calls[1].headers["idempotency-key"]);
  s.close();
});

test("a 429 honours Retry-After; a 404 is thrown as DocustayError without retry", async () => {
  const s = await stub((c, res, n) => c.url.includes("missing") ? json(res, 404, { error: { kind: "not_found", message: "no such document", requestId: "r1", retryable: false } }) : n === 1 ? json(res, 429, { error: { kind: "rate_limited", message: "slow", retryable: true } }, { "retry-after": "1" }) : json(res, 200, { teams: [] }));
  const d = new Docustay("gl_live_k", { baseUrl: s.base });
  const t0 = Date.now(); await d.listTeams(); assert.ok(Date.now() - t0 >= 900);
  const before = s.calls.length;
  await assert.rejects(() => d.getDocument("missing"), (e) => e instanceof DocustayError && e.status === 404 && e.kind === "not_found" && e.requestId === "r1");
  assert.equal(s.calls.length, before + 1);
  s.close();
});

test("eachDocument follows the cursor to the last page", async () => {
  const s = await stub((c, res) => { const cur = new URL(c.url, "http://x").searchParams.get("cursor"); json(res, 200, cur ? { documents: [{ id: "b" }], page: { nextCursor: null, hasMore: false } } : { documents: [{ id: "a" }], page: { nextCursor: "c2", hasMore: true } }); });
  const d = new Docustay("gl_live_k", { baseUrl: s.base }); const ids = [];
  for await (const x of d.eachDocument({ state: "executed" })) ids.push(x.id);
  assert.deepEqual(ids, ["a", "b"]); assert.match(s.calls[0].url, /state=executed/);
  s.close();
});

test("file template: bytes go as base64; PDF and CSV come back raw", async () => {
  const s = await stub((c, res) => c.method === "POST" ? json(res, 201, { templateId: "t", fields: 6, warnings: [] }) : (res.writeHead(200, { "content-type": "application/pdf" }), res.end(Buffer.from("%PDF-1.7 x"))));
  const d = new Docustay("gl_live_k", { baseUrl: s.base });
  await d.createTemplateFromFile({ name: "n", fileName: "n.pdf", file: new Uint8Array([1, 2, 3]) });
  assert.equal(s.calls[0].body.file, "AQID");
  const pdf = new Uint8Array(await d.downloadSignedPdf("d1")); assert.equal(String.fromCharCode(...pdf.slice(0, 4)), "%PDF");
  s.close();
});

const secret = "whsec_" + Buffer.from("0123456789abcdef0123456789abcdef").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
const sign = (id, ts, body) => "v1," + createHmac("sha256", Buffer.from("0123456789abcdef0123456789abcdef")).update(`${id}.${ts}.${body}`).digest("base64");
test("verifyWebhook accepts a good signature and refuses a bad body, a bad secret and an old timestamp", async () => {
  const body = JSON.stringify({ topic: "documents.document.executed" }); const ts = String(Math.floor(Date.now() / 1000));
  const headers = { "webhook-id": "e1", "webhook-timestamp": ts, "webhook-signature": sign("e1", ts, body) };
  assert.deepEqual(await verifyWebhook(secret, headers, body), { topic: "documents.document.executed" });
  await assert.rejects(() => verifyWebhook(secret, headers, body + " "), /does not match/);
  await assert.rejects(() => verifyWebhook("whsec_" + Buffer.from("x".repeat(32)).toString("base64"), headers, body), /does not match/);
  await assert.rejects(() => verifyWebhook("whsec_not a secret!", headers, body), /not in the whsec_… form/);
  await assert.rejects(() => verifyWebhook("whsec_", headers, body), /not in the whsec_… form/);
  const old = String(Number(ts) - 3600);
  await assert.rejects(() => verifyWebhook(secret, { ...headers, "webhook-timestamp": old, "webhook-signature": sign("e1", old, body) }, body), /tolerance/);
});

import { readFileSync } from "node:fs";
test("verifyWebhook accepts a delivery signed by the real server code (shared vector)", async () => {
  const v = JSON.parse(readFileSync(new URL("./server_vector.json", import.meta.url)));
  assert.equal((await verifyWebhook(v.secret, v.headers, v.body, { now: (v.ts + 5) * 1000 })).id, "e9");
});

test("a 200 answer that is not JSON (a web page, a wrong baseUrl) is a typed error that says what to check, never a raw JSON parse error (D-023)", async () => {
  const s = await stub((call, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end("<!DOCTYPE html><html><body>Not the API</body></html>"); });
  const d = new Docustay("gl_test_x", { baseUrl: s.base, maxRetries: 0 });
  await assert.rejects(() => d.getDocument("abc"), (e) => e instanceof DocustayError && e.kind === "bad_response" && e.status === 200 && /baseUrl/.test(e.message) && /not Docustay/i.test(e.message));
  // positive control: a real JSON answer on the same client still parses
  const ok = await stub((call, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ id: "abc", state: "sent" })); });
  assert.equal((await new Docustay("gl_test_x", { baseUrl: ok.base }).getDocument("abc")).state, "sent"); s.close(); ok.close();
});
