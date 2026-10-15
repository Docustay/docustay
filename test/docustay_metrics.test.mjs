// FP-H4 — /metrics is off without a token, needs the bearer token with one, counts by ROUTE PATTERN (never a concrete id), and counts correctly.
import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { metricsMiddleware, metricsResponse, metricsEnabled } from "../src/observability/metrics.mjs";

const TOKEN = "t".repeat(24);
const make = () => { const app = new Hono(); app.use("*", metricsMiddleware()); app.get("/docs/:id", (c) => c.text("ok")); app.get("/metrics", metricsResponse); return app; };

test("metrics are off (404) when no token is configured, and a short token does not count as configured", async () => {
  delete process.env.KEYSTONE_METRICS_TOKEN;
  assert.equal(metricsEnabled(), false);
  assert.equal((await make().request("/metrics")).status, 404);
  process.env.KEYSTONE_METRICS_TOKEN = "short"; assert.equal(metricsEnabled(), false);
});

test("with a token: 401 without it or with a wrong one (positive control: 200 with the right one), and the text counts by route pattern", async () => {
  process.env.KEYSTONE_METRICS_TOKEN = TOKEN;
  const app = make();
  await app.request("/docs/aaa-111"); await app.request("/docs/bbb-222");
  assert.equal((await app.request("/metrics")).status, 401);
  assert.equal((await app.request("/metrics", { headers: { authorization: "Bearer " + "u".repeat(24) } })).status, 401);
  const ok = await app.request("/metrics", { headers: { authorization: `Bearer ${TOKEN}` } });
  assert.equal(ok.status, 200);
  const text = await ok.text();
  assert.match(text, /docustay_http_requests_total\{method="GET",route="\/docs\/:id",status="2xx",app="docustay"\} 2/);
  assert.doesNotMatch(text, /aaa-111|bbb-222/);
  assert.match(text, /docustay_http_request_duration_seconds_bucket/);
  assert.match(text, /process_cpu_user_seconds_total/);
  delete process.env.KEYSTONE_METRICS_TOKEN;
});
