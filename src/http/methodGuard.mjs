// Run 12 (Schemathesis "unsupported methods"). Two small rules, kept apart from app.mjs so a real HTTP server can test them:
//  1. A request with no body (no content-length above zero, no transfer-encoding) is not given to hono's bodyLimit: under the node adapter bodyLimit builds a second Request from it and throws
//     "Cannot read private member #state" (a Hono/undici mismatch), which answered 500 for QUERY, PATCH, OPTIONS and a bodiless DELETE. There is no body to limit.
//  2. A path that exists answers a method it does not have with 405 and an Allow header (never 404, never 500).
export const bodiless = (c) => c.req.method === "OPTIONS" || (!/^[1-9]/.test(c.req.header("content-length") ?? "") && !c.req.header("transfer-encoding"));

// the router's answer nests the handlers differently per router type; take every function in it
const functionsIn = (x, out = []) => { if (typeof x === "function") out.push(x); else if (Array.isArray(x)) for (const y of x) functionsIn(y, out); return out; };
const CANDIDATES = ["GET", "POST", "PUT", "PATCH", "DELETE"];
/** methodsFor(path): the HTTP methods the app really has a handler for at that path, asked of Hono's own router (so a parameter route and a literal route are told apart exactly as a request would be). */
export function methodIndex(app) {
  return (path) => {
    const out = [];
    for (const m of CANDIDATES) {
      const matched = new Set(functionsIn(app.router.match(m, path)?.[0] ?? []));
      if (app.routes.some((r) => r.method === m && !r.path.includes("*") && matched.has(r.handler))) out.push(m);
    }
    return out;
  };
}
/** Allow lists exactly the methods that exist (HEAD rides with GET). */
export const allowHeader = (methods) => [...methods, ...(methods.includes("GET") ? ["HEAD"] : [])].join(", ");

/** The published OpenAPI document is the truth for /api/v1: a literal path ("/documents/send") beats a parameter path ("/documents/{id}") exactly as a reader of the spec would expect, and Allow lists what the spec lists.
 *  Returns a function (path) -> methods | null, reading the document once from the app itself. */
export function specMethodIndex(app) {
  let table = null, loading = null;
  const load = async () => {
    const r = await app.request("/api/v1/openapi.json"); const doc = await r.json();
    table = Object.entries(doc.paths ?? {}).map(([tpl, ops]) => ({ tpl, params: (tpl.match(/\{/g) ?? []).length, re: new RegExp("^" + tpl.replace(/[.+?^$()|[\]\\]/g, "\\$&").replace(/\{[^}]+\}/g, "[^/]+") + "/?$"), methods: Object.keys(ops).filter((m) => ["get", "post", "put", "patch", "delete"].includes(m)).map((m) => m.toUpperCase()) }));
  };
  return async (path) => {
    try { if (!table) await (loading ??= load()); } catch { loading = null; return null; }
    const hits = table.filter((t) => t.re.test(path)).sort((a, b) => a.params - b.params || b.tpl.length - a.tpl.length);
    return hits[0]?.methods ?? null;
  };
}
