// Pins the indexing rule on the web server's own front door (frame-guard.mjs): production names are NEVER noindex; every other host is, on every path, with a disallow-all robots.txt.
import test from "node:test"; import assert from "node:assert/strict"; import http from "node:http";
await import("../frame-guard.mjs");
const server = http.createServer((req, res) => { res.setHeader("content-type", "text/html"); res.end("<h1>page</h1>"); });
await new Promise((r) => server.listen(0, "127.0.0.1", r)); const port = server.address().port;
const get = (host, path = "/", method = "GET", extra = {}) => new Promise((resolve, reject) => { const q = http.request({ host: "127.0.0.1", port, path, method, headers: { host, ...extra } }, (r) => { let b = ""; r.on("data", (d) => (b += d)); r.on("end", () => resolve({ status: r.statusCode, headers: r.headers, body: b })); }); q.on("error", reject); q.end(); });
test.after(() => server.close());
for (const h of ["docustay.app", "www.docustay.app", "app.docustay.app", "DOCUSTAY.APP", "docustay.app:443"]) test(`production name ${h} is NEVER noindex`, async () => {
  for (const path of ["/", "/pricing", "/robots.txt", "/sitemap.xml"]) { const r = await get(h, path); assert.equal(r.headers["x-robots-tag"], undefined, `${h}${path} sent x-robots-tag`); }
  const r = await get(h, "/robots.txt"); assert.ok(!/^Disallow: \/\s*$/m.test(r.body) || r.body.includes("<h1>"), "production robots.txt must not be disallow-all");
});
for (const h of ["host.example.com", "host.example.com", "host.example.com", "sign.docustay.app", "host.example.com", "localhost", "sign.somecustomer.com", "docustay.app.evil.example"]) test(`${h} is noindex everywhere and robots.txt is disallow-all`, async () => {
  for (const path of ["/", "/pricing", "/docs/quickstart"]) { const r = await get(h, path); assert.equal(r.headers["x-robots-tag"], "noindex, nofollow", `${h}${path}`); }
  const r = await get(h, "/robots.txt"); assert.equal(r.status, 200); assert.equal(r.body, "User-agent: *\nDisallow: /\n"); assert.equal(r.headers["x-robots-tag"], "noindex, nofollow");
});
test("x-forwarded-host decides when a proxy sits in front", async () => {
  assert.equal((await get("internal.railway.app", "/", "GET", { "x-forwarded-host": "docustay.app" })).headers["x-robots-tag"], undefined);
  assert.equal((await get("docustay.app", "/", "GET", { "x-forwarded-host": "staging.host.example.com" })).headers["x-robots-tag"], "noindex, nofollow");
});
