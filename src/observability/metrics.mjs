// src/observability/metrics.mjs — FP-H4: Prometheus metrics at GET /metrics. OFF unless KEYSTONE_METRICS_TOKEN is set; then it answers only to `Authorization: Bearer <that token>`.
// Labels are the ROUTE PATTERN (/api/v1/documents/:id), never the concrete path, so a person's id never becomes a label and cardinality stays bounded.
import { Registry, collectDefaultMetrics, Counter, Histogram } from "prom-client";
import { timingSafeEqual } from "node:crypto";

const registry = new Registry();
registry.setDefaultLabels({ app: "docustay" });
collectDefaultMetrics({ register: registry });
const requests = new Counter({ name: "docustay_http_requests_total", help: "HTTP requests by method, route pattern and status class.", labelNames: ["method", "route", "status"], registers: [registry] });
const duration = new Histogram({ name: "docustay_http_request_duration_seconds", help: "HTTP request duration by method and route pattern.", labelNames: ["method", "route"], buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10], registers: [registry] });

export const metricsEnabled = (env = process.env) => typeof env.KEYSTONE_METRICS_TOKEN === "string" && env.KEYSTONE_METRICS_TOKEN.length >= 16;

/** Hono middleware: count and time every request after it is answered. */
export function metricsMiddleware() {
  return async (c, next) => {
    const t0 = process.hrtime.bigint();
    await next();
    if (!metricsEnabled()) return;
    const route = c.req.routePath && c.req.routePath !== "/*" ? c.req.routePath : "unmatched";
    const status = `${Math.floor((c.res?.status ?? 500) / 100)}xx`;
    requests.inc({ method: c.req.method, route, status });
    duration.observe({ method: c.req.method, route }, Number(process.hrtime.bigint() - t0) / 1e9);
  };
}

const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
/** The /metrics handler: 404 when metrics are off, 401 without the right bearer token, otherwise the Prometheus text. */
export async function metricsResponse(c) {
  if (!metricsEnabled()) return c.json({ error: { kind: "not_found", message: "not found" } }, 404);
  const m = /^Bearer\s+(.+)$/i.exec(c.req.header("authorization") ?? "");
  if (!m || !same(m[1], process.env.KEYSTONE_METRICS_TOKEN)) return c.json({ error: { kind: "unauthenticated", message: "metrics need the bearer token" } }, 401);
  return c.body(await registry.metrics(), 200, { "content-type": registry.contentType });
}
