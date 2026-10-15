// the version the command prints is the version in package.json (0.1.0 printed "0.1.0" after a bump once: caught here)
import { test } from "node:test"; import assert from "node:assert/strict"; import fs from "node:fs";
test("the CLI prints the package.json version", () => {
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")); const src = fs.readFileSync(new URL("../bin/docustay.mjs", import.meta.url), "utf8");
  assert.equal(src.match(/const VERSION = "([^"]+)"/)[1], pkg.version);
});
