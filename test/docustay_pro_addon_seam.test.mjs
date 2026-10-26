// The Pro add-on seam: with the add-on the doors are real; as a Community build they read as empty and every writer refuses with the upgrade message.
// R13-D439: sending to a list is NOT behind the seam (it is in the Community edition); adding an own signing domain still is.
import { test } from "node:test"; import assert from "node:assert/strict"; import { spawnSync } from "node:child_process";
const run = (env, code) => spawnSync(process.execPath, ["--input-type=module", "-e", code], { env: { ...process.env, ...env }, encoding: "utf8", cwd: new URL("..", import.meta.url).pathname });
const probe = `const a = await import(${JSON.stringify(new URL("../src/documents/addon.mjs", import.meta.url).href)}); const d = await import(${JSON.stringify(new URL("../src/domains/proDomains.mjs", import.meta.url).href)}); const b = await import(${JSON.stringify(new URL("../src/documents/proDoors.mjs", import.meta.url).href)}); await a.addonReady;
 let refused = null; try { await d.addDomain({}, {}); } catch (e) { refused = e.detail?.code ?? e.message; }
 let bulk = null; try { await b.bulkSend({ query: async () => ({ rows: [] }) }, { rows: [] }); } catch (e) { bulk = e.detail?.code ?? e.message; }
 console.log(JSON.stringify({ installed: a.addonInstalled(), refused, bulk }));`;
test("Community build: add-on absent, writers refuse with pro_addon_missing", () => {
  const r = run({ DOCUSTAY_PRO_ADDON: "off" }, probe); assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout.split("\n").filter((l) => l.startsWith("{")).pop()); assert.equal(o.installed, false); assert.equal(o.refused, "pro_addon_missing");
  assert.equal(o.bulk, "There are no rows to send.", "sending to a list runs its own checks on Community instead of asking for the add-on (R13-D439)");
});
import { existsSync } from "node:fs";
test("Pro build (positive control): add-on installed, the same writer is the real one and does NOT refuse with the upgrade message", { skip: !existsSync(new URL("../pro/index.mjs", import.meta.url)) && "the public export carries no add-on" }, () => {
  const r = run({}, probe); assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout.split("\n").filter((l) => l.startsWith("{")).pop()); assert.equal(o.installed, true); assert.notEqual(o.refused, "pro_addon_missing");
});
