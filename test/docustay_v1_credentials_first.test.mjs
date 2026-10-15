// OI-010 (Schemathesis, 15 Oct 2026): a request with no bearer key must get 401 before any 400 about its body or its Idempotency-Key.
// No database: the key check is stubbed exactly as test/p30_api_v1.test.mjs does; what is under test is the ORDER of the answers.
import { Hono } from "hono";
import assert from "node:assert/strict";
import { registerDocumentsV1 } from "../src/routes/developerDocuments.mjs";
import { unauthenticated } from "../src/http/errors.mjs";
const tokenRoute = async (c) => { if (c.req.header("authorization") !== "Bearer good") throw unauthenticated("the API token is not valid"); throw new Error("reached the handler body"); };
const app = new Hono();
app.onError((e, c) => c.json({ error: { kind: e.kind ?? "internal", message: e.message } }, e.statusCode ?? 500));
registerDocumentsV1(app, { tokenRoute });
const post = (path, { auth, idem, body = { name: "x", html: "<p>x</p>" } } = {}) => app.request(path, { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}), ...(idem ? { "idempotency-key": idem } : {}) }, body: JSON.stringify(body) });
let failed = 0; const t = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.log("FAIL", name, "-", e.message); } };
await t("no key, no Idempotency-Key, valid body -> 401 (was 400)", async () => assert.equal((await post("/api/v1/templates/html")).status, 401));
await t("no key, invalid body -> 401 (was 400)", async () => assert.equal((await post("/api/v1/templates/html", { body: { nope: 1 } })).status, 401));
await t("a non-bearer Authorization header -> 401", async () => assert.equal((await post("/api/v1/documents/send", { auth: "Basic abc" })).status, 401));
await t("POSITIVE CONTROL: with a bearer key and an invalid body the body check still answers 400", async () => assert.equal((await post("/api/v1/templates/html", { auth: "Bearer good", body: { nope: 1 } })).status, 400));
await t("POSITIVE CONTROL: with a bearer key and a valid body but no Idempotency-Key the answer is still the 400 about the key", async () => { const r = await post("/api/v1/templates/html", { auth: "Bearer good" }); assert.equal(r.status, 400); assert.match((await r.json()).error.message, /Idempotency-Key/); });
await t("a wrong key still gets the single 401 from the key check", async () => assert.equal((await post("/api/v1/templates/html", { auth: "Bearer bad", idem: "12345678" })).status, 401));
await t("the published OpenAPI document stays open without a key", async () => assert.equal((await app.request("/api/v1/openapi.json")).status, 200));
console.log(failed ? `${failed} FAILED` : "all passed"); process.exit(failed ? 1 : 0);
