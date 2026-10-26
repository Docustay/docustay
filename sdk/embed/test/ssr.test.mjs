// Importing the package where there is no DOM (a server render) must not throw (it did: "HTMLElement is not defined" broke every Next.js / Nuxt / Angular Universal build that imported the React, Vue or Angular wrapper)
import { test } from "node:test"; import assert from "node:assert/strict"; import { execFileSync } from "node:child_process";
test("imports without a DOM", () => {
  const out = execFileSync("node", ["--input-type=module", "-e", `import * as m from ${JSON.stringify(new URL("../src/index.js", import.meta.url).href)}; console.log(typeof globalThis.HTMLElement, Object.keys(m).sort().join(","))`], { encoding: "utf8" });
  assert.match(out, /^undefined /); assert.match(out, /DocustaySign/); assert.match(out, /defineDocustayBuilder/);
});
