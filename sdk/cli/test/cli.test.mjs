import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { parseArgs, parseParty, list } from "../src/args.mjs";
import { readConfig, writeConfig, configPath, isTestKey, mask } from "../src/config.mjs";
import { forwardOne, listen } from "../src/listen.mjs";

test("arguments: flags, equals form, switches, repeats and positionals", () => {
  const a = parseArgs(["send", "--test", "T1", "--party", "a=A <a@x.co>", "--party=b=B <b@x.co>", "--json", "--title", "Hello world"]);
  assert.deepEqual(a.positional, ["send"]);
  assert.equal(a.flags.test, "T1"); assert.equal(a.flags.json, true); assert.equal(a.flags.title, "Hello world");
  assert.deepEqual(list(a.flags.party), ["a=A <a@x.co>", "b=B <b@x.co>"]);
});
test("a party must be seat=Name <email>; a malformed one names what was wrong (and a good one parses)", () => {
  assert.deepEqual(parseParty('signer_1=Pat Example <pat@example.com>'), { seat: "signer_1", name: "Pat Example", email: "pat@example.com" });
  assert.throws(() => parseParty("pat@example.com"), /must look like/);
  assert.throws(() => parseParty("signer_1=Pat <not an email>"), /must look like/);
});
test("the config file is private (mode 600), env wins, and test keys are told apart from live ones", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-cli-")); const env = { XDG_CONFIG_HOME: dir };
  writeConfig({ apiKey: "dsk_test_" + "k".repeat(30), baseUrl: "https://x.example/" }, env);
  assert.equal(fs.statSync(configPath(env)).mode & 0o777, 0o600);
  assert.equal(readConfig(env).baseUrl, "https://x.example");
  assert.equal(readConfig({ ...env, DOCUSTAY_API_KEY: "dsk_live_zzzzzzzzzzzz" }).apiKey, "dsk_live_zzzzzzzzzzzz");
  assert.equal(isTestKey("dsk_test_abc"), true); assert.equal(isTestKey("dsk_live_abc"), false); assert.equal(isTestKey("gl_test_abc"), true);
  assert.ok(!mask("dsk_test_" + "k".repeat(30)).includes("kkkkkkkkkkkk"), "the mask never prints the key");
});
test("forwardOne sends the stored headers and body untouched to the local server and reports its status; an unreachable target is reported, not thrown", async () => {
  const seen = [];
  const srv = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { seen.push({ h: req.headers, b }); res.statusCode = 204; res.end(); }); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r)); const port = srv.address().port;
  const ev = { id: "e1", topic: "documents.document.executed", headers: { "content-type": "application/json", "webhook-id": "w1", "webhook-signature": "v1,abc" }, body: '{"hello":"world"}', at: new Date().toISOString() };
  const ok = await forwardOne(ev, `http://127.0.0.1:${port}/hook`);
  assert.equal(ok.status, 204); assert.equal(seen[0].b, ev.body); assert.equal(seen[0].h["webhook-signature"], "v1,abc");
  srv.close();
  const down = await forwardOne(ev, `http://127.0.0.1:${port}/hook`);
  assert.equal(down.ok, false); assert.equal(down.status, null); assert.ok(down.error);
});
test("listen: fetches in order, remembers where it got to, forwards each once, and survives an error", async () => {
  const pages = [{ events: [{ id: "a", headers: {}, body: "1", at: "2026-10-07T00:00:00Z" }, { id: "b", headers: {}, body: "2", at: "2026-10-07T00:00:01Z" }], cursor: "b" }, "boom", { events: [{ id: "c", headers: {}, body: "3", at: "2026-10-07T00:00:02Z" }], cursor: "c" }];
  const afters = []; const stop = new AbortController(); const got = [], errors = [];
  const docustay = { async fetchRelayEvents(id, q) { afters.push(q.after); const p = pages.shift(); if (!p) { stop.abort(); return { events: [], cursor: null }; } if (p === "boom") throw new Error("network"); return p; } };
  await listen({ docustay, webhookId: "w", target: null, signal: stop.signal, backoffMs: 1, waitSeconds: 0, onEvent: (ev) => got.push(ev.id), onError: (e) => errors.push(e.message) });
  assert.deepEqual(got, ["a", "b", "c"]); assert.deepEqual(errors, ["network"]); assert.deepEqual(afters.slice(0, 3), [undefined, "b", "b"]);
});
test("verify (end to end through the real command): a signature made like the server's passes, a changed body fails with exit code 2", async () => {
  const { StandardWebhook } = await import("../../../node_modules/standardwebhooks/dist/index.js").catch(() => ({}));
  if (!StandardWebhook) return;   // the signer library lives in the main repo; skipped when this package is tested alone
  const secretBytes = Buffer.from("s".repeat(24)); const secret = "whsec_" + secretBytes.toString("base64url");
  const body = '{"a":1}', id = "evt_1", ts = Math.floor(Date.now() / 1000);
  const sig = new StandardWebhook(Uint8Array.from(secretBytes), { format: "raw" }).sign(id, new Date(ts * 1000), body);
  const bin = path.join(path.dirname(new URL(import.meta.url).pathname), "../bin/docustay.mjs");
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ds-v-")), "body.json");
  fs.writeFileSync(file, body);
  const args = ["verify", "--secret", secret, "--id", id, "--timestamp", String(ts), "--signature", sig, "--body", file];
  assert.match(execFileSync("node", [bin, ...args], { encoding: "utf8" }), /signature is valid/);
  fs.writeFileSync(file, '{"a":2}');
  const bad = spawnSync("node", [bin, ...args], { encoding: "utf8" });
  assert.equal(bad.status, 2); assert.match(bad.stdout, /not valid/);
});
// Run 9: the commands for search, contracts, payments and playbooks, run as the real command against a stand-in API that records every call
test("run 9 commands: a refund is never sent without --yes (and with it, exactly one, with the reason, the amount and an Idempotency-Key); search, contracts, payments and playbooks call their routes", async () => {
  const { execFile } = await import("node:child_process");
  const calls = [];
  const srv = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    calls.push({ method: req.method, url: req.url, body: b ? JSON.parse(b) : null, idem: req.headers["idempotency-key"] ?? null, auth: req.headers.authorization });
    const u = new URL(req.url, "http://x"); res.setHeader("content-type", "application/json");
    const send = (status, j) => { res.statusCode = status; res.end(JSON.stringify(j)); };
    if (u.pathname === "/api/v1/search") return send(200, { q: u.searchParams.get("q"), groups: { documents: [{ id: "d1", title: "Deposit agreement", state: "executed" }], templates: [], people: [{ id: "p1", name: "Pat Payer", email: "pat@example.test" }] } });
    if (u.pathname === "/api/v1/payments") return send(200, { items: [{ id: "a1", status: "paid", label: "$50.00", person: "Pat Payer", title: "Deposit", paidAt: "2026-10-02T00:00:00Z" }], month: { collected: "$50.00", refunded: "$0.00" }, next: null });
    if (/\/refund$/.test(u.pathname)) return send(201, { id: "a1", status: "partially_refunded", refundedMinor: 500, refundedLabel: "$5.00" });
    if (u.pathname === "/api/v1/playbooks") return send(200, { playbooks: [{ name: "new-tenant-pack", title: "New tenant pack", enabled: false, builtin: true, templates: ["builtin:rental-application"], plays: ["payment-terms"] }] });
    if (/^\/api\/v1\/playbooks\/.+\/enable$/.test(u.pathname)) return send(200, { name: "new-tenant-pack", enabled: JSON.parse(b).enabled, builtin: true });
    if (u.pathname === "/api/v1/templates/library") return send(200, { shown: true, templates: [{ slug: "rental-application", kind: "document", title: "Rental application" }].filter((x) => !u.searchParams.get("kind") || x.kind === u.searchParams.get("kind")) });
    send(404, { error: { kind: "not_found", message: "no" } });
  }); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const env = { ...process.env, XDG_CONFIG_HOME: fs.mkdtempSync(path.join(os.tmpdir(), "ds-r9-")), DOCUSTAY_API_KEY: "dsk_test_" + "r".repeat(30), DOCUSTAY_URL: `http://127.0.0.1:${srv.address().port}` };
  const bin = path.join(path.dirname(new URL(import.meta.url).pathname), "../bin/docustay.mjs");
  const run = (...args) => new Promise((res) => { const ch = execFile("node", [bin, ...args], { env, encoding: "utf8" }, (e, stdout, stderr) => res({ code: e ? e.code : 0, stdout, stderr })); ch.stdin.end(); });
  const PID = "11111111-2222-4333-8444-555555555555";
  try {
    // the refusal first: no --yes, no terminal to ask at → nothing reaches the API
    const no = await run("payments", "refund", PID, "--reason", "duplicate", "--amount-minor", "500");
    assert.equal(no.code, 1); assert.match(no.stderr, /add --yes/); assert.equal(calls.filter((c) => /refund/.test(c.url)).length, 0, "no refund call without --yes");
    // a bad amount is refused before any call, too
    const bad = await run("payments", "refund", PID, "--reason", "x", "--amount-minor", "5.5", "--yes");
    assert.equal(bad.code, 1); assert.match(bad.stderr, /whole number/); assert.equal(calls.filter((c) => /refund/.test(c.url)).length, 0);
    // the positive control: with --yes (in any position) exactly one call, carrying the reason, the amount and an Idempotency-Key
    const yes = await run("payments", "refund", "--yes", PID, "--reason", "duplicate", "--amount-minor", "500");
    assert.equal(yes.code, 0, yes.stderr); assert.match(yes.stdout, /refunded through Stripe — \$5\.00/);
    const r = calls.filter((c) => /refund/.test(c.url)); assert.equal(r.length, 1);
    assert.equal(r[0].method, "POST"); assert.equal(r[0].url, `/api/v1/payments/${PID}/refund`); assert.deepEqual(r[0].body, { amountMinor: 500, reason: "duplicate" }); assert.ok(r[0].idem, "a refund carries an Idempotency-Key");
    // and the reads
    const s = await run("search", "Deposit", "agreement"); assert.equal(s.code, 0, s.stderr); assert.match(s.stdout, /document {2}d1 .*Deposit agreement/); assert.match(s.stdout, /person {4}p1 {2}Pat Payer <pat@example\.test>/);
    assert.equal(new URL(calls.find((c) => c.url.startsWith("/api/v1/search")).url, "http://x").searchParams.get("q"), "Deposit agreement");
    const p = await run("payments", "list"); assert.match(p.stdout, /a1 {2}2026-10-02 {2}paid .*\$50\.00 {2}Pat Payer {2}— Deposit/);
    const pk = await run("playbooks"); assert.match(pk.stdout, /new-tenant-pack +off  1 templates, 1 skills  New tenant pack/);
    const pon = await run("playbooks", "on", "new-tenant-pack"); assert.equal(pon.code, 0, pon.stderr); assert.match(pon.stdout, /new-tenant-pack is on/);
    const lib2 = await run("templates"); assert.match(lib2.stdout, /document +rental-application +Rental application/);
    const noName = await run("playbooks", "on"); assert.notEqual(noName.code, 0, "a pack name is required (negative control)");
    assert.ok(calls.every((x) => x.auth === `Bearer ${env.DOCUSTAY_API_KEY}`), "every call carries the key");
  } finally { srv.close(); }
});

// Launch Part 7 (14 Oct 2026): `documents` and `webhooks`, run as the real command against a stand-in API that records every call
test("documents and webhooks commands: list/show/remind call their routes; void and delete never reach the API without --yes (positive control: with it, exactly one call)", async () => {
  const { execFile } = await import("node:child_process");
  const calls = [];
  const srv = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    calls.push({ method: req.method, url: req.url, body: b ? JSON.parse(b) : null, idem: req.headers["idempotency-key"] ?? null });
    const u = new URL(req.url, "http://x"); res.setHeader("content-type", "application/json");
    const send = (status, j) => { res.statusCode = status; res.end(JSON.stringify(j)); };
    if (req.method === "GET" && u.pathname === "/api/v1/documents") return send(200, { documents: [{ id: "d1", title: "NDA", state: "sent", test: true, parties: [{ name: "Pat", email: "pat@example.test" }] }], page: {} });
    if (req.method === "GET" && u.pathname === "/api/v1/documents/d1") return send(200, { id: "d1", title: "NDA", state: "sent", test: true, parties: [{ seat: "signer_1", name: "Pat", email: "pat@example.test", status: "waiting" }], events: [{ at: "2026-10-14T00:00:00Z", text: "Sent for signature" }] });
    if (/\/documents\/d1\/remind$/.test(u.pathname)) return send(200, { ok: true });
    if (/\/documents\/d1\/void$/.test(u.pathname)) return send(200, { id: "d1", state: "voided" });
    if (req.method === "GET" && u.pathname === "/api/v1/webhooks") return send(200, { webhooks: [{ id: "w1", name: "crm", url: "https://x.test/h", status: "active", eventTypes: ["documents.document.executed"] }] });
    if (req.method === "POST" && u.pathname === "/api/v1/webhooks") return send(201, { id: "w2", secret: "whsec_" + "s".repeat(24) });
    if (/\/webhooks\/w1\/test$/.test(u.pathname)) return send(200, { ok: true });
    if (/\/webhooks\/w1\/rotate$/.test(u.pathname)) return send(200, { secret: "whsec_" + "n".repeat(24) });
    if (req.method === "DELETE" && u.pathname === "/api/v1/webhooks/w1") return send(200, { deleted: true });   // the OpenAPI answer: 200 JSON
    send(404, { error: { kind: "not_found", message: "no" } });
  }); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const env = { ...process.env, XDG_CONFIG_HOME: fs.mkdtempSync(path.join(os.tmpdir(), "ds-p7-")), DOCUSTAY_API_KEY: "dsk_test_" + "p".repeat(30), DOCUSTAY_URL: `http://127.0.0.1:${srv.address().port}` };
  const bin = path.join(path.dirname(new URL(import.meta.url).pathname), "../bin/docustay.mjs");
  const run = (...args) => new Promise((res) => { const ch = execFile("node", [bin, ...args], { env, encoding: "utf8" }, (e, stdout, stderr) => res({ code: e ? e.code : 0, stdout, stderr })); ch.stdin.end(); });
  try {
    const l = await run("documents", "list"); assert.equal(l.code, 0, l.stderr); assert.match(l.stdout, /d1\s+sent\s+\[test\] NDA\s+\(Pat\)/);
    const s = await run("documents", "show", "d1"); assert.equal(s.code, 0, s.stderr); assert.match(s.stdout, /signer_1\s+Pat <pat@example\.test>\s+waiting/); assert.match(s.stdout, /Sent for signature/);
    const rm = await run("documents", "remind", "d1"); assert.equal(rm.code, 0, rm.stderr); assert.equal(calls.filter((c) => /remind$/.test(c.url)).length, 1);
    const v0 = await run("documents", "void", "d1"); assert.equal(v0.code, 1); assert.match(v0.stderr, /say why/);
    const v1 = await run("documents", "void", "d1", "--reason", "wrong person"); assert.equal(v1.code, 1); assert.match(v1.stderr, /add --yes/);
    assert.equal(calls.filter((c) => /void$/.test(c.url)).length, 0, "no void call without --yes");
    const v2 = await run("documents", "void", "d1", "--reason", "wrong person", "--yes"); assert.equal(v2.code, 0, v2.stderr);
    const vc = calls.filter((c) => /void$/.test(c.url)); assert.equal(vc.length, 1); assert.match(JSON.stringify(vc[0].body), /wrong person/); assert.ok(vc[0].idem, "an Idempotency-Key rides every write");
    const wl = await run("webhooks", "list"); assert.equal(wl.code, 0, wl.stderr); assert.match(wl.stdout, /w1\s+active\s+crm/);
    const wc0 = await run("webhooks", "create"); assert.equal(wc0.code, 1); assert.match(wc0.stderr, /--url/);
    const wc = await run("webhooks", "create", "--url", "https://x.test/hook", "--events", "documents.document.sent, documents.document.executed"); assert.equal(wc.code, 0, wc.stderr); assert.match(wc.stdout, /signing secret \(shown once\): whsec_/);
    const created = calls.find((c) => c.method === "POST" && c.url === "/api/v1/webhooks"); assert.deepEqual(created.body.eventTypes, ["documents.document.sent", "documents.document.executed"]);
    const wt = await run("webhooks", "test", "w1"); assert.equal(wt.code, 0, wt.stderr);
    const wr = await run("webhooks", "rotate", "w1"); assert.equal(wr.code, 0, wr.stderr); assert.match(wr.stdout, /new signing secret \(shown once\): whsec_/);
    const wd0 = await run("webhooks", "delete", "w1"); assert.equal(wd0.code, 1); assert.match(wd0.stderr, /add --yes/); assert.equal(calls.filter((c) => c.method === "DELETE").length, 0);
    const wd = await run("webhooks", "delete", "w1", "--yes"); assert.equal(wd.code, 0, wd.stderr); assert.equal(calls.filter((c) => c.method === "DELETE").length, 1);
    const bad = await run("documents", "frobnicate", "d1"); assert.equal(bad.code, 1); assert.match(bad.stderr, /not a documents command/);
  } finally { srv.close(); }
});

test("R10-46: the built command run THROUGH A SYMLINK (how npm installs it as .bin/docustay) prints its help; run directly it prints the same", () => {
  const dist = path.resolve(import.meta.dirname, "../dist/docustay.mjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-cli-link-")); const link = path.join(dir, "docustay");
  fs.symlinkSync(dist, link);
  const direct = spawnSync(process.execPath, [dist, "help"], { encoding: "utf8" });
  const viaLink = spawnSync(process.execPath, [link, "help"], { encoding: "utf8" });
  assert.match(direct.stdout, /the Docustay command line/);   // positive control: the program does print when run directly
  assert.equal(viaLink.stdout, direct.stdout);                  // the symlinked run prints the SAME (it printed nothing before the fix)
});

// R13-D342: the documented `listen --events X` then `trigger --topic X` works, and plain `trigger` sends the documented default
import { sameTopics, triggerTopic } from "../src/listen.mjs";
test("trigger sends executed by default when the listen webhook receives it, refuses a topic it does not receive in words, and listen spots other events", () => {
  assert.deepEqual(triggerTopic(["documents.email.paused", "documents.document.executed"]), { topic: "documents.document.executed" });
  assert.deepEqual(triggerTopic(["documents.document.sent"]), { topic: "documents.document.sent" });
  assert.deepEqual(triggerTopic(["documents.document.executed"], "documents.document.executed"), { topic: "documents.document.executed" });
  assert.match(triggerTopic(["documents.document.sent"], "documents.document.executed").error, /does not receive documents\.document\.executed\. Run  docustay listen --events documents\.document\.executed/);
  assert.match(triggerTopic([]).error, /receives no events/);
  assert.equal(sameTopics(["a", "b"], ["b", "a"]), true); assert.equal(sameTopics(["a", "b"], ["a"]), false); assert.equal(sameTopics(["a"], ["b"]), false);
});
