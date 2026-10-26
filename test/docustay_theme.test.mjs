// Stage 1 (7 Oct 2026): the pure parts of the new look: which surface a route wears, how a saved Appearance resolves, relative times, the contrast gate, and the CSP hash of app.html's inline script.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { surfaceOf, preferenceFrom, serverTheme, resolveTheme } from "../docustay/web/src/lib/theme/surface.js";
import { relativeTime } from "../docustay/web/src/lib/ui/relativeTime.js";

test("surfaceOf: the portal and docs follow the account, the site is dark, signing is light", () => {
  assert.equal(surfaceOf("/(app)/documents/[id]"), "");
  assert.equal(surfaceOf("/(auth)/login"), "");
  assert.equal(surfaceOf("/(site)/docs/[...slug]"), "");
  assert.equal(surfaceOf("/(site)/pricing"), "site");
  assert.equal(surfaceOf("/(site)"), "site");
  assert.equal(surfaceOf("/sign"), "signing");
  assert.equal(surfaceOf("/download"), "signing");
  // controls: the look is decided by the route, never by a lookalike name
  assert.equal(surfaceOf("/(site)/design"), "site");
  assert.equal(surfaceOf("/(site)/docs-and-more"), "site");
  assert.equal(surfaceOf(null, "/sign/abc"), "signing");
  assert.equal(surfaceOf(null, "/nope"), "site");
});

test("the saved Appearance: cookie parsing, server value and System resolution", () => {
  assert.equal(preferenceFrom("a=1; docustay-theme=dark; b=2"), "dark");
  assert.equal(preferenceFrom("docustay-theme=system"), "system");
  assert.equal(preferenceFrom("docustay-theme=purple"), null);
  assert.equal(preferenceFrom(""), null);
  assert.equal(serverTheme("dark"), "dark");
  assert.equal(serverTheme("system"), "light");   // the server cannot know the OS; the pre-paint script resolves it
  assert.equal(serverTheme(null), "light");        // light is the default
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
});

test("relativeTime", () => {
  const now = Date.UTC(2026, 9, 7, 12, 0, 0);
  assert.equal(relativeTime(now - 3 * 60000, { now }), "3 minutes ago");
  assert.equal(relativeTime(now + 2 * 86400000, { now }), "in 2 days");
  assert.equal(relativeTime(now - 26 * 3600000, { now }), "yesterday");
  assert.equal(relativeTime("not a date", { now }), "");
  // Run 9: the reader's language, including the "just now" case (a German page had said "now")
  assert.equal(relativeTime(now - 5000, { now }), "now");
  assert.equal(relativeTime(now - 5000, { now, locale: "de" }), "jetzt");
  assert.equal(relativeTime(now - 3 * 60000, { now, locale: "de" }), "vor 3 Minuten");
});

test("the contrast gate passes, and its control catches a weak pair", () => {
  const out = execFileSync("node", ["docustay/web/scripts/contrast-gate.mjs"], { encoding: "utf8" });
  assert.match(out, /CONTRAST GATE PASS/);
  assert.match(out, /control: a weak pair is caught/);
});

test("the CSP hash is computed from app.html, so editing the inline script cannot leave a stale hash", async () => {
  const cfg = (await import("../docustay/web/svelte.config.js")).default;
  const hash = cfg.kit.csp.directives["script-src"].find((x) => x.startsWith("sha256-"));
  const { createHash } = await import("node:crypto");
  const fs = await import("node:fs");
  const script = /<script>([\s\S]*?)<\/script>/.exec(fs.readFileSync("docustay/web/src/app.html", "utf8"))[1];
  assert.equal(hash, "sha256-" + createHash("sha256").update(script).digest("base64"));
});

test("a signing, download or form link that does not resolve still wears the signing look (never the dark site) — and /sign-pdf stays the site", async () => {
  const { surfaceOf } = await import("../docustay/web/src/lib/theme/surface.js");
  for (const path of ["/sign/not-a-real-link", "/download/x", "/f/missing"]) assert.equal(surfaceOf("/(site)/[...rest]", path), "signing", path);
  assert.equal(surfaceOf("/(site)/sign-pdf", "/sign-pdf"), "site");   // positive control
});
