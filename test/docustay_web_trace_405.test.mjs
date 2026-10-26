// OI-010: the web server answers TRACE with 405 (was a bare 400 from SvelteKit's Request builder), and still serves everything else.
import assert from "node:assert/strict"; import http from "node:http";
await import("../docustay/web/frame-guard.mjs");
const srv = http.createServer((req, res) => { res.setHeader("content-type", "text/plain"); res.end("hello " + req.method); }); await new Promise((r) => srv.listen(0, "127.0.0.1", r)); const port = srv.address().port;
const call = (method) => new Promise((resolve, reject) => { const r = http.request({ port, host: "127.0.0.1", method, path: "/x" }, (res) => { let b = ""; res.on("data", (d) => (b += d)); res.on("end", () => resolve({ status: res.statusCode, allow: res.headers.allow, body: b })); }); r.on("error", reject); r.end(); });
let failed = 0; const t = async (n, f) => { try { await f(); console.log("ok  ", n); } catch (e) { failed++; console.log("FAIL", n, "-", e.message); } };
await t("TRACE -> 405 with an Allow header that does not list TRACE", async () => { const r = await call("TRACE"); assert.equal(r.status, 405); assert.ok(r.allow && !/TRACE/.test(r.allow)); });
await t("POSITIVE CONTROL: GET and POST still reach the handler", async () => { assert.equal((await call("GET")).body, "hello GET"); assert.equal((await call("POST")).body, "hello POST"); });
srv.close(); console.log(failed ? `${failed} FAILED` : "all passed"); process.exit(failed ? 1 : 0);
