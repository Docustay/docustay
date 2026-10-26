// D-108 (found 9 Oct 2026 by a contrast scan of the Documents list): white initials on hsl(h 55% 48%) were 2.1–2.4:1 for yellow and green hues. White on hsl(h 50% 28%) is at least 4.5:1 for every hue.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lumOf = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
function hsl(h, s, l) { s /= 100; l /= 100; const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); return [f(0) * 255, f(8) * 255, f(4) * 255]; }
const ratio = (c) => 1.05 / (lumOf(c) + 0.05);
test("every hue of the avatar colour gives white text at least 4.5:1", () => {
  let worst = 99; for (let h = 0; h < 360; h += 1) worst = Math.min(worst, ratio(hsl(h, 50, 28)));
  assert.ok(worst >= 4.5, `worst ${worst.toFixed(2)}`);
});
test("positive control: the old colour did fail for some hue", () => {
  let worst = 99; for (let h = 0; h < 360; h += 1) worst = Math.min(worst, ratio(hsl(h, 55, 48)));
  assert.ok(worst < 3);
});
test("an avatar uses the accessible colour pair, and the contrast gate holds that pair", () => {
  // the redesigned Documents list has no avatars (page thumbnails and a ribbon); People and the document page draw the one Avatar: initials in the accent ink on the accent tint, one colour for everyone
  const av = fs.readFileSync(new URL("../docustay/web/src/lib/ui/Avatar.svelte", import.meta.url), "utf8");
  assert.match(av, /bg-accent-soft/); assert.match(av, /text-accent-ink/); assert.doesNotMatch(av, /hsl\(/);
  const gate = fs.readFileSync(new URL("../docustay/web/scripts/contrast-gate.mjs", import.meta.url), "utf8");
  assert.match(gate, /accent-ink/);
});
