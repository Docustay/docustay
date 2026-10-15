// Run 10 OI-012: `docustay documents list` crashed ("(d.parties ?? []).map is not a function": the list API returns the NUMBER of people) and `docustay automations list`
// crashed ("Cannot read properties of undefined": the API returns a bare array). Each runs the real CLI file against a local fake API; the old shapes keep working (control).
import test from "node:test"; import assert from "node:assert/strict"; import http from "node:http"; import { spawn } from "node:child_process"; import path from "node:path"; import os from "node:os"; import fs from "node:fs";
const bin = path.resolve(import.meta.dirname, "../bin/docustay.mjs");
const serve = (routes) => new Promise((res) => { const s = http.createServer((q, r) => { const b = routes[q.url.split("?")[0]]; r.setHeader("content-type", "application/json"); r.end(JSON.stringify(b ?? {})); }).listen(0, "127.0.0.1", () => res(s)); });
const run = async (routes, args) => { const s = await serve(routes); const home = fs.mkdtempSync(path.join(os.tmpdir(), "ds-cli-")); try { return await new Promise((res) => { const c = spawn("node", [bin, ...args], { env: { PATH: process.env.PATH, HOME: home, DOCUSTAY_API_KEY: "dsk_test_aaaaaaaaaaaaaaaa", DOCUSTAY_URL: `http://127.0.0.1:${s.address().port}` } }); let o = ""; c.stdout.on("data", (d) => (o += d)); c.stderr.on("data", (d) => (o += d)); c.on("close", () => res(o)); }); } finally { s.close(); } };
test("documents list prints a count of people when the API gives a number, and names when it gives a list", async () => {
  const num = await run({ "/api/v1/documents": { documents: [{ id: "d1", title: "Lease", state: "sent", test: true, parties: 2 }], page: {} } }, ["documents", "list"]);
  assert.match(num, /d1\s+sent\s+\[test\] Lease\s+\(2 people\)/);
  const arr = await run({ "/api/v1/documents": { documents: [{ id: "d2", title: "NDA", state: "sent", parties: [{ name: "Ann" }, { email: "b@x.test" }] }], page: {} } }, ["documents", "list"]);
  assert.match(arr, /d2\s+sent\s+NDA\s+\(Ann, b@x\.test\)/);
});
test("automations list accepts a bare array and the older {automations}", async () => {
  const bare = await run({ "/api/v1/automations": [{ id: "00000000-0000-0000-0000-000000000001", enabled: true, name: "Thank you", runCount: 3 }] }, ["automations", "list"]);
  assert.match(bare, /on\s+ran 3×\s+Thank you/);
  assert.match(await run({ "/api/v1/automations": [] }, ["automations", "list"]), /No automations yet/);
  assert.match(await run({ "/api/v1/automations": { automations: [{ id: "00000000-0000-0000-0000-000000000002", enabled: false, name: "Old shape" }] } }, ["automations", "list"]), /off\s+ran 0×\s+Old shape/);
});
