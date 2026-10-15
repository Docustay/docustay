// THE CONTRAST GATE (report §13.2: "Step 1 of the build order proves this with a real contrast check"). Reads the token layer in src/app.css and computes WCAG contrast for every text pair on every surface.
//   node scripts/contrast-gate.mjs        → exit 1 if any text pair is under 4.5:1 (3:1 for the focus ring and large accents)
// Blends the alpha tokens over the surface they sit on, the way the browser does. A control (a deliberately bad pair) must be caught, or the gate itself is broken.
import fs from "node:fs";
const css = fs.readFileSync(new URL("../src/app.css", import.meta.url), "utf8");

function block(selector) {
  const i = css.indexOf(selector); if (i < 0) throw new Error(`no block ${selector}`);
  const open = css.indexOf("{", i), close = css.indexOf("}", open); const vars = {};
  for (const m of css.slice(open + 1, close).matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}
const SETS = {
  light: block(":root {\n  color-scheme: light;\n  --paper"),
  dark: block(':root[data-theme="dark"], :root[data-surface="site"] {'),
  signing: block(':root[data-surface="signing"] {'),
};
SETS.site = SETS.dark;

function parse(v) {
  v = v.trim();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (m) { let h = m[1]; if (h.length === 3) h = [...h].map((c) => c + c).join(""); return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 }; }
  m = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+))?\s*\)$/.exec(v);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  throw new Error(`cannot parse colour "${v}"`);
}
const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

// [text token, background token, minimum, note]
const PAIRS = [
  ["ink", "paper", 4.5], ["ink", "card", 4.5], ["ink", "tint", 4.5], ["ink", "sidebar", 4.5],
  ["text-2", "paper", 4.5], ["text-2", "card", 4.5],
  ["mute", "paper", 4.5], ["mute", "card", 4.5], ["mute", "tint", 4.5], ["mute", "sidebar", 4.5],
  ["faint", "paper", 4.5], ["faint", "card", 4.5],
  ["brand", "paper", 4.5], ["brand", "card", 4.5], ["brand-ink", "brand", 4.5], ["brand-ink", "brand-hover", 4.5],
  ["ok", "paper", 4.5], ["warn", "paper", 4.5], ["bad", "paper", 4.5], ["info", "paper", 4.5],
  ["ok", "ok-bg", 4.5], ["warn", "warn-bg", 4.5], ["bad", "bad-bg", 4.5], ["info", "info-bg", 4.5],
  ["accent", "paper", 3, "focus ring and large accents"],
];
let bad = 0, total = 0;
function check(set, name, vars) {
  const bg0 = parse(vars.paper);
  const solid = (tok) => over(parse(vars[tok]), tok === "paper" ? { r: 255, g: 255, b: 255, a: 1 } : bg0);
  for (const [fg, bg, min] of PAIRS) {
    if (vars[fg] === undefined || vars[bg] === undefined) { console.log(`FAIL  ${name}: token missing (${fg} or ${bg})`); bad++; continue; }
    const B = solid(bg), F = over(parse(vars[fg]), B), r = ratio(F, B); total++;
    if (r < min) { console.log(`FAIL  ${name}: ${fg} on ${bg} = ${r.toFixed(2)}:1 (needs ${min})`); bad++; }
  }
}
for (const [name, vars] of Object.entries(SETS)) check(null, name, vars);
// control: a deliberately weak pair must be caught
const weak = ratio(parse("#9a9a9a"), parse("#ffffff")); if (weak >= 4.5) { console.log("FAIL  control: #9a9a9a on white should be under 4.5"); bad++; } else console.log(`PASS  control: a weak pair is caught (${weak.toFixed(2)}:1)`);
console.log(bad ? `CONTRAST GATE FAIL: ${bad} of ${total} pairs` : `CONTRAST GATE PASS: ${total} text pairs across light, dark, site and signing`);
process.exit(bad ? 1 : 0);
