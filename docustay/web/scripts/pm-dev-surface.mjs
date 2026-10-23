// PLAN PROMPTS · PART 3 · THE DEVELOPER SURFACE (BETA ONLY; run through /tmp/db-run.sh). The same question asked five ways must give the same answer as the app's own screen: the REST endpoint with an API key, the JavaScript SDK,
// the Python SDK, the CLI and the MCP tool, against the web session's preflight. Also: the OpenAPI document and the docs name the operation. Throwaway keys are made for two throwaway workspaces and revoked at the end.
import { setState, connect } from "../../../test/tools/prompt-state.mjs";
import { chromium, contextFor, call, preflight, WS, BETA_WEB, outDir } from "./pm-lib.mjs";
import { Docustay } from "../../../sdk/js/src/index.js";
import { buildTools } from "../../../sdk/mcp/src/tools.js";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const OUT = outDir(process.env.PM_OUT ?? `${process.env.HOME}/keystone/specs/v1/design-review/beta-proof`);
const results = []; let fails = 0;
const rec = (scn, what, ok, detail = "") => { results.push({ scn, what, ok, detail }); if (!ok) { fails += 1; console.log(`  FAIL ${scn} · ${what} ${detail}`); } };
const db = await connect(); const browser = await chromium.launch(); const ctx = {};
for (const k of ["free", "payg"]) ctx[k] = await contextFor(browser, WS[k]);
const revokeMine = async (plan) => { const list = await call(ctx[plan], "GET", "/api/developer/api-keys"); const rows = list.data?.keys ?? list.data?.rows ?? list.data ?? []; let n = 0; for (const k of Array.isArray(rows) ? rows : []) if (/^pm-dev-/.test(k.name ?? "") && !k.revoked_at && !k.revokedAt) { const r = await call(ctx[plan], "POST", `/api/developer/api-keys/${k.id}/revoke`, {}); if (r.ok) n += 1; } return n; };
for (const k of ["free", "payg"]) await revokeMine(k);   // keys an earlier run left behind
const REPO = new URL("../../../", import.meta.url).pathname;
const ASKS = [["send_document", {}], ["invite_person", {}], ["ai_draft", {}], ["create_template", {}], ["upload", { bytes: 26 * 1048576 }], ["bulk_send", { documents: 20 }], ["use_feature", { item: "custom_plays" }], ["connect_payments", {}]];
const same = (a, b) => { try { assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b))); return true; } catch { return false; } };
const keys = {};
for (const [plan, spec] of [["free", { docs: 15, ever: true, ai: 7, templates: 5 }], ["payg", { docs: 30, ever: true, budgetMinor: 1000, ai: 10 }]]) {
  await setState(db, WS[plan], { plan, ...spec });
  const made = await call(ctx[plan], "POST", "/api/developer/api-keys", { name: `pm-dev-${plan}`, scopes: ["documents:read", "account:read"], environment: "live" });
  const secret = made.json?.key ?? made.json?.secret ?? made.json?.token ?? made.data?.key; rec(`${plan} · key`, "a throwaway read-only key was made", !!secret, `${made.status} ${made.message ?? ""}`); if (!secret) continue;
  keys[plan] = { secret, id: made.data?.id ?? made.json?.id };
  const sdk = new Docustay(secret, { baseUrl: BETA_WEB }), tools = buildTools(sdk, { readOnly: true }), mcp = tools.find((t) => t.name === "preflight");
  rec(`${plan} · mcp`, "the MCP tool exists, is read-only and survives READ_ONLY mode", !!mcp && mcp.write === false);
  for (const [action, extra] of ASKS) {
    const scn = `${plan} · ${action}`, web = await preflight(ctx[plan], action, extra);
    const rest = await call({ request: { fetch: (u, o) => fetch(u, { method: o.method, headers: { ...o.headers, authorization: `Bearer ${secret}` }, body: o.data }).then((r) => ({ status: () => r.status, ok: () => r.ok, json: () => r.json() })) } }, "POST", "/api/v1/preflight", { action, ...extra });
    rec(scn, "REST (API key) equals the screen's answer", rest.ok && same(rest.data, web), `${rest.status} ${rest.message ?? ""}`);
    let viaJs = null; try { viaJs = await sdk.preflight({ action, ...extra }); } catch (e) { viaJs = { error: String(e.message) }; }
    rec(scn, "JavaScript SDK equals it", same(viaJs, web), JSON.stringify(viaJs).slice(0, 100));
    const py = spawnSync("python3", ["-c", `import json,sys; sys.path.insert(0, "${REPO}sdk/python"); from docustay import Docustay; d=Docustay("${secret}", base_url="${BETA_WEB}"); print(json.dumps(d.preflight("${action}", **json.loads('${JSON.stringify(Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, v])))}'))))`], { encoding: "utf8" });
    let viaPy = null; try { viaPy = JSON.parse(py.stdout); } catch { viaPy = { error: py.stderr.slice(-160) }; }
    rec(scn, "Python SDK equals it", same(viaPy, web), JSON.stringify(viaPy).slice(0, 120));
    const flags = Object.entries(extra).flatMap(([k, v]) => [`--${k}`, String(v)]);
    const cli = spawnSync("node", [`${REPO}sdk/cli/bin/docustay.mjs`, "preflight", action, ...flags, "--json"], { encoding: "utf8", env: { ...process.env, DOCUSTAY_API_KEY: secret, DOCUSTAY_URL: BETA_WEB, HOME: process.env.HOME } });
    let viaCli = null; try { viaCli = JSON.parse(cli.stdout); } catch { viaCli = { error: (cli.stderr || cli.stdout).slice(-160) }; }
    rec(scn, "CLI equals it", same(viaCli, web), JSON.stringify(viaCli).slice(0, 120));
    const out = await mcp.run({ action, ...extra }); rec(scn, "MCP tool equals it", mcp && typeof out === "object" && same(out, web), JSON.stringify(out).slice(0, 100));
  }
  // a read-only key may preflight; a key without account:read or documents:read may not
  const nokey = await call({ request: { fetch: (u, o) => fetch(u, { method: o.method, headers: { ...o.headers, authorization: "Bearer dsk_live_wrong" }, body: o.data }).then((r) => ({ status: () => r.status, ok: () => r.ok, json: () => r.json() })) } }, "POST", "/api/v1/preflight", { action: "send_document" });
  rec(`${plan} · auth`, "a wrong key is refused (401)", nokey.status === 401, String(nokey.status));
}
// the OpenAPI document and the docs name the operation
const oa = await fetch(`${BETA_WEB}/api/v1/openapi.json`).then((r) => r.json()).catch(() => null);
const op = oa?.paths?.["/api/v1/preflight"]?.post; rec("openapi", "the document lists POST /api/v1/preflight with operationId preflight and a bearer key", op?.operationId === "preflight" && JSON.stringify(op.security).includes("bearerAuth"), JSON.stringify(op?.operationId));
const whole = JSON.stringify(oa ?? {}); rec("openapi", "the action enum names all 11 actions", ["send_document", "bulk_send", "invite_person", "remove_person", "ai_draft", "ai_edit", "ai_read_file", "create_template", "upload", "use_feature", "connect_payments"].every((a) => whole.includes(`"${a}"`)), "");
rec("openapi", "the answer names severity, options and cost", ["severity", "options", "cost", "afterThis"].every((k) => JSON.stringify(op?.responses ?? {}).includes(k) || whole.includes(`"${k}"`)), "");
rec("openapi", "three code samples (JavaScript, Python, curl)", Array.isArray(op?.["x-codeSamples"]) && op["x-codeSamples"].length >= 3, String(op?.["x-codeSamples"]?.length));
const usage = await call(ctx.payg, "GET", "/api/product/docustay/status"); void usage;
for (const plan of ["free", "payg"]) { const n = await revokeMine(plan); rec(`${plan} · cleanup`, "the throwaway key was revoked", n >= 1, String(n)); }
writeFileSync(`${OUT}/dev-surface.json`, JSON.stringify({ at: new Date().toISOString(), fails, total: results.length, results }, null, 1));
console.log(`\nDeveloper surface: ${results.length - fails} of ${results.length} checks agree, ${fails} do not`);
await db.end(); await browser.close(); process.exitCode = fails ? 1 : 0;
