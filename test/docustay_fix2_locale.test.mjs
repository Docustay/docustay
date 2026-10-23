// D-042: dates and the device label are written in the chosen language, not the browser's/server's English.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const r = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
test("whenText formats in English (Docustay v1 is English only), never the browser's or server's own locale", () => {
  assert.match(r("docustay/web/src/lib/i18n/index.svelte.js"), /toLocaleString\("en", opts\)/);
});
test("the screens that showed browser-locale dates use it", () => {
  for (const f of ["SecurityPanel.svelte", "AuditPanel.svelte", "ai/AiLogPanel.svelte"]) assert.match(r(`docustay/web/src/lib/${f}`), /whenText\(/, f);
  assert.doesNotMatch(r("docustay/web/src/lib/SecurityPanel.svelte"), /toLocaleString\(\)/);
});
test("the sessions route sends the device as parts and the screen builds the sentence with t()", () => {
  assert.match(r("src/auth/install.mjs"), /device: userAgentParts\(r\.userAgent\)/);
  assert.match(r("docustay/web/src/lib/i18n/deviceText.js"), /t\("\{browser\} on \{os\}"/);
});
