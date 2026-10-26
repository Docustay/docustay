#!/usr/bin/env node
// Part 31 gate: a CSS rule Svelte reports as "unused" is not just untidy, it is DELETED from the build. Found on 5 Oct 2026: the home page's seal-press animation (SealMoment.svelte) had four such rules (a `.js` ancestor and a `[data-shown]` attribute that script sets at run time are invisible to Svelte's markup check), so the seal never animated although the page looked finished. This runs svelte-check and FAILS on any "Unused CSS selector" warning; the fix is :global(.js) / :global([data-shown]) on the part Svelte cannot see.
import { spawnSync } from "node:child_process";
const r = spawnSync("npx", ["svelte-check", "--output", "machine"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const out = (r.stdout ?? "") + (r.stderr ?? "");
if (!/COMPLETED \d+ FILES/.test(out)) { console.error("FAIL  svelte-check did not finish, so nothing was measured\n" + out.slice(-600)); process.exit(1); }
const unused = out.split("\n").filter((l) => l.includes("Unused CSS selector"));
for (const l of unused) console.log("FAIL  " + l.replace(/^\d+ WARNING /, "").slice(0, 200));
console.log(unused.length ? `\nCSS GATE FAIL (${unused.length} unused rule(s) are being deleted from the build)` : "CSS GATE PASS: no unused CSS selectors (every written rule reaches the build)");
process.exit(unused.length ? 1 : 0);
