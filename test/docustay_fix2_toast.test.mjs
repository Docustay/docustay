// D-076: the same words replace the toast on screen, and our own timer dismisses it whatever sonner's pause does.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../docustay/web/src/lib/ui/toast.js", import.meta.url), "utf8");
test("toast.js gives each message a stable id and a hard dismissal timer", () => {
  assert.match(src, /const id = `\$\{tone\}:\$\{text\}`/);
  assert.match(src, /sonner\.dismiss\(id\)/);
  assert.match(src, /clearTimeout\(timers\.get\(id\)\)/);
});
test("the Toaster caps the visible stack", () => {
  // R10-60: the toast stack is its own component, mounted by the app shell the first time a toast is asked for (or when the browser is idle)
  const host = readFileSync(new URL("../docustay/web/src/lib/ui/ToasterHost.svelte", import.meta.url), "utf8");
  assert.match(host, /visibleToasts=\{3\}/);
  const layout = readFileSync(new URL("../docustay/web/src/routes/(app)/+layout.svelte", import.meta.url), "utf8");
  assert.match(layout, /import\("\$lib\/ui\/ToasterHost\.svelte"\)/);   // positive control: the shell does mount it
});
