// Which API scopes each MCP tool needs, DERIVED, not written by hand: every tool is run once against a recording client, the route it hits is looked up in the server's own ROUTE_SCOPES, and the result is a table.
// `node scripts/scopes.mjs` prints it; `node scripts/scopes.mjs --write` rewrites SCOPES.md; the test fails when SCOPES.md is stale or a tool hits a route that needs a scope the table does not show.
import { writeFileSync } from "node:fs";
import { Docustay } from "@docustay2026/sdk";
import { buildTools } from "../src/tools.js";
import { ROUTE_SCOPES, NARROW_ROUTE_SCOPES } from "../../../src/developer/scopes.mjs";

const UUID = "00000000-0000-4000-8000-000000000001";
const sample = (t, name) => {
  const d = t._def, k = d.typeName;
  if (k === "ZodOptional" || k === "ZodDefault") return undefined;
  if (k === "ZodNullable") return sample(d.innerType, name);
  if (k === "ZodString") { const c = (d.checks ?? []).map((x) => x.kind); return c.includes("uuid") ? UUID : c.includes("email") ? "a@example.test" : name === "path" ? "/tmp/x.pdf" : "x"; }
  if (k === "ZodNumber") return 1;
  if (k === "ZodBoolean") return true;
  if (k === "ZodEnum") return d.values[0];
  if (k === "ZodArray") return [sample(d.type, name)];
  if (k === "ZodRecord") return {};
  if (k === "ZodAny") return {};
  if (k === "ZodObject") return Object.fromEntries(Object.entries(d.shape()).map(([n, s]) => [n, sample(s, n)]).filter(([, v]) => v !== undefined));
  return "x";
};
const EXTRA = { draft_document_with_ai: { prompt: "x" } };   // tools whose arguments are all optional but need one of them
const args = (tool) => { const a = Object.fromEntries(Object.entries(tool.input).map(([n, s]) => [n, sample(s, n)]).filter(([, v]) => v !== undefined)); if ("confirm" in tool.input) a.confirm = true; return { ...a, ...(EXTRA[tool.name] ?? {}) }; };
const pattern = (key) => { const [m, ...p] = key.split(" "); return { m, re: new RegExp("^" + p.join(" ").replace(/:\w+/g, "[^/]+") + "$") }; };
const rules = Object.entries({ ...ROUTE_SCOPES, ...NARROW_ROUTE_SCOPES }).map(([k, v]) => ({ ...pattern(k), key: k, scope: v }));

export async function derive() {
  writeFileSync("/tmp/x.pdf", "%PDF-1.4\n");        // the one file the file-reading tool (detect_fields) is pointed at while its route is recorded

  const rows = [];
  for (const tool of buildTools(new Docustay("dsk_test_x" + "x".repeat(24), { baseUrl: "http://127.0.0.1:1" }), {})) {
    const hits = [];
    const client = new Docustay("dsk_test_x" + "x".repeat(24), { baseUrl: "http://127.0.0.1:1" });
    client._request = async (method, path) => { hits.push(`${method} ${path.split("?")[0]}`); return { id: UUID, jobId: UUID, title: "x", state: "done", message: "x", source: {}, patches: [], people: [], templates: [], plays: [] }; };
    client.testSignRaw = undefined;
    const t2 = buildTools(client, {}).find((x) => x.name === tool.name);
    let error = null; try { await t2.run(args(t2)); } catch (e) { error = e.message; }
    const scopes = new Set(), routes = [...new Set(hits)];
    for (const h of routes) { const [m, p] = h.split(" "); for (const r of rules) if (r.m === m && r.re.test(p)) scopes.add(r.scope); }
    rows.push({ name: tool.name, write: tool.write, routes, scopes: [...scopes].sort(), error });
  }
  return rows;
}
export const table = (rows) => "# Which key scopes each MCP tool needs\n\nDerived by running every tool against a recording client and looking each route up in the server's own scope table (`scripts/scopes.mjs`). A key without the scope gets the same plain 401 as any bad key, so a tool a key cannot use fails with that answer rather than a special message. `DOCUSTAY_READ_ONLY=1` removes every tool marked **writes**.\n\n| Tool | Writes | Calls | Scopes (any one of these on the key) |\n|---|---|---|---|\n" + rows.map((r) => `| \`${r.name}\` | ${r.write ? "**writes**" : "reads"} | ${r.routes.map((x) => `\`${x}\``).join("<br>") || "—"} | ${r.scopes.map((s) => `\`${s}\``).join(", ") || "—"} |`).join("\n") + "\n";
if (import.meta.url === `file://${process.argv[1]}`) { const rows = await derive(); const md = table(rows); if (process.argv.includes("--write")) { writeFileSync(new URL("../SCOPES.md", import.meta.url), md); console.log("wrote SCOPES.md,", rows.length, "tools"); } else console.log(md); }
