// design/build-tokens.mjs
//
// The single generator that reads design/tokens.json (the one source of truth for every design
// value quoted from specs/MOCKUPS.md §1, §2, §5, §6 — see task 10a.1) and emits the three
// downstream artefacts other tasks consume:
//   - webui/src/styles/tokens.css  (10a.6)
//   - design/tailwind-preset.cjs   (10a.8)
//   - src/documents/pdfTheme.mjs   (10a.7)
//
// `buildTokens({ write = false })` NEVER writes by default — importers (gates, tests, other
// tasks' generators) get the generated strings back and can diff generated-vs-on-disk without
// touching the tree. Pass `{ write: true }` explicitly to write the three files.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ F583 — THE THREE PROPERTIES THIS FILE NOW HAS, AND WHY IT SHIPPED WITHOUT THEM.
//
//   The first version of this generator emitted **59 flat custom properties in one `:root` block**
//   with `"primitive": {}` — no primitive layer, no OKLCH conversion — while the file it is
//   supposed to generate, `webui/src/styles/tokens.css`, declares **127** properties across three
//   layers and is read by 54 files. Three downstream tasks (10a.2's gate, 10a.6, 10a.7) each
//   assumed it was complete against that set, and 10a.6 could not be built at all: "regenerate
//   from source" and "delete no property any file still references" were mutually exclusive.
//   Registered as F583 (and F582 for the pdfTheme half of it). The three properties that close it:
//
//   1 · ★★★ **A LEAF'S KEY IS THE CUSTOM-PROPERTY NAME THE APPLICATION READS, VERBATIM,
//        INCLUDING THE `--`.** No mapping, no prefixing, no pluralising. The first version keyed
//        leaves on invented names — `fs-body`, `drawer-w`, `control-h` — none of which any
//        stylesheet reads: the consumers read `--fs`, `--surface-w-drawer` and
//        `--density-control-h`. A generator whose output nothing reads is shipped failure #1 wearing
//        a source-of-truth's clothes. Grep a token name anywhere in the repo and it lands here.
//   2 · ★★★ **A COLOUR LITERAL MAY APPEAR IN `primitive` AND NOWHERE ELSE, AND THE VALIDATOR
//        REFUSES THE ALTERNATIVE.** That is `db/gates/design-tokens.mjs`'s rule 1 moved upstream of
//        the file it polices, so the generator is structurally incapable of emitting output that
//        fails the gate. (The first version emitted 29 hexes straight into `:root` — the gate would
//        have failed every one.)
//   3 · ★★★ **EVERY `var(--x)` MUST RESOLVE TO A DECLARED LEAF.** F368: a custom property that is
//        READ and not DECLARED makes the whole declaration invalid at computed-value time and it is
//        dropped SILENTLY — the defect that sized five of the most looked-at controls in the product
//        by accident. The validator walks the whole graph and refuses a dangling reference.
//
//   ★★ AND THE OKLCH CONVERSION IS ARITHMETIC IN HERE, NOT A NUMBER SOMEBODY TYPED. `hexToOklch`
//      is Ottosson's sRGB→Oklab matrix pair; `oklchToHex` is its inverse; and the validator asserts
//      **every colour round-trips at the emitted precision** (L 4dp · C 4dp · H 1dp), so a value can
//      never drift by a rounding step between the source and the sheet. Independent corroboration
//      that the arithmetic is right: it reproduces the two anchors the previous hand-authored file
//      derived by hand — #7F7BF5 → oklch(0.6453 0.1772 281.7) and #90A9CB → oklch(0.7277 0.0569
//      256.2) — to the digit.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// Every leaf in design/tokens.json must carry a "source": "quoted" | "derived". A "derived" leaf
// with no "from" is invalid. A "quoted" leaf's "from" must be a literal "MOCKUPS.md:<line>"
// reference. A leaf that fails either rule makes this refuse (non-zero exit), printing the
// leaf's dotted path.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const TOKENS_JSON = path.join(__dirname, "tokens.json");

const TOKENS_CSS_OUT      = path.join(ROOT, "webui/src/styles/tokens.css");
const TAILWIND_PRESET_OUT = path.join(ROOT, "design/tailwind-preset.cjs");
const PDF_THEME_OUT       = path.join(ROOT, "src/documents/pdfTheme.mjs");

const QUOTED_FROM_RE = /^MOCKUPS\.md:\d+/;
const LAYERS = ["primitive", "semantic", "component"];
const KEY_RE = /^--[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ── sRGB ⇄ OKLCH ────────────────────────────────────────────────────────────────────────────────
// ★ Björn Ottosson's Oklab. The two matrices and the cube root are the whole conversion; the only
//   judgement in here is the emitted precision, and the validator proves that precision is lossless
//   for every colour this product actually uses.
const L_PRECISION = 4;
const C_PRECISION = 4;
const H_PRECISION = 1;

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

const HEX_RE = /^#([0-9a-fA-F]{6})$/;

export function hexToOklch(hex) {
  const m = HEX_RE.exec(hex);
  if (!m) throw new Error(`not a #rrggbb hex: ${hex}`);
  const r = toLinear(parseInt(m[1].slice(0, 2), 16) / 255);
  const g = toLinear(parseInt(m[1].slice(2, 4), 16) / 255);
  const b = toLinear(parseInt(m[1].slice(4, 6), 16) / 255);
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;
  let H = (Math.atan2(B, A) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { L, C: Math.hypot(A, B), H };
}

export function oklchToHex(L, C, H) {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const rgb = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_,
  ].map((v) => Math.round(Math.min(1, Math.max(0, toGamma(v))) * 255));
  return "#" + rgb.map((v) => v.toString(16).padStart(2, "0").toUpperCase()).join("");
}

/** The emitted `oklch(L C H)` for a hex, at the precision the validator proves lossless. */
function oklchLiteral(hex) {
  const { L, C, H } = hexToOklch(hex);
  const Lr = L.toFixed(L_PRECISION);
  const Cr = +C.toFixed(C_PRECISION);
  // ★ A chroma of zero has no hue. Emitting the atan2 noise (89.9° for white) would be a number
  //   pretending to carry information — and it is what the hand-authored file wrote as `1.0000 0 0`.
  if (Cr === 0) return `oklch(${Lr} 0 0)`;
  return `oklch(${Lr} ${Cr.toFixed(C_PRECISION)} ${(+H.toFixed(H_PRECISION)).toFixed(H_PRECISION)})`;
}

/** The hex a literal `oklch(...)` value resolves to, or null when it carries alpha. */
function hexOfOklchLiteral(value) {
  const m = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value.trim());
  if (!m) return null;
  return oklchToHex(Number(m[1]), Number(m[2]), Number(m[3]));
}

// ── the token file ──────────────────────────────────────────────────────────────────────────────
function isLeaf(node) {
  return (
    node !== null &&
    typeof node === "object" &&
    !Array.isArray(node) &&
    Object.prototype.hasOwnProperty.call(node, "value") &&
    Object.prototype.hasOwnProperty.call(node, "source")
  );
}

/** The groups of one layer, in file order, with the `$`-prefixed metadata keys skipped. */
function groupsOf(layer) {
  return Object.entries(layer ?? {}).filter(([key]) => !key.startsWith("$"));
}

function collectLeaves(tokens) {
  const out = [];
  for (const layerName of LAYERS) {
    for (const [groupName, group] of groupsOf(tokens[layerName])) {
      for (const [key, node] of Object.entries(group)) {
        if (key.startsWith("$")) continue;
        out.push({ layer: layerName, group: groupName, key, leaf: node, path: `${layerName}.${groupName}.${key}` });
      }
    }
  }
  return out;
}

const COLOUR_FN_RE =
  /(?<![\w-])(?:oklab|oklch|hsla?|rgba?|hwb|lab|lch|color|color-mix)\(\s*[^)]*\)/g;
const ANY_HEX_RE = /#[0-9a-fA-F]{3,8}\b/;

/**
 * Validates every leaf. Throws with the leaf's dotted path in the message on the first violation —
 * the mechanism that stops an unsourced, unverifiable, mis-layered or dangling value from ever
 * reaching a generated artefact.
 */
function validateTokens(tokens) {
  const leaves = collectLeaves(tokens);
  const declared = new Map();

  for (const { path: leafPath, key, leaf, layer } of leaves) {
    if (!isLeaf(leaf)) throw new Error(`${leafPath}: not a leaf — every entry needs "value" and "source"`);
    // ★ Property 1 — the key IS the custom-property name. See the header.
    if (!KEY_RE.test(key)) {
      throw new Error(`${leafPath}: a leaf key must be the custom-property name it declares, e.g. "--primary"`);
    }
    if (declared.has(key)) {
      throw new Error(`${leafPath}: ${key} is already declared at ${declared.get(key)} — one name, one declaration`);
    }
    declared.set(key, leafPath);

    if (!leaf.source) throw new Error(`${leafPath}: missing "source"`);
    if (leaf.source !== "quoted" && leaf.source !== "derived") {
      throw new Error(`${leafPath}: "source" must be "quoted" or "derived"`);
    }
    if (leaf.source === "derived" && !leaf.from) {
      throw new Error(`${leafPath}: "derived" leaf has no "from"`);
    }
    if (leaf.source === "quoted" && (!leaf.from || !QUOTED_FROM_RE.test(leaf.from))) {
      throw new Error(`${leafPath}: "quoted" leaf's "from" is not a MOCKUPS.md:<line> reference`);
    }
    if (typeof leaf.value !== "string" || leaf.value.trim() === "") {
      throw new Error(`${leafPath}: "value" must be a non-empty string`);
    }

    // ★ Property 2 — a colour literal belongs to layer 1 and nowhere else. This is
    //   db/gates/design-tokens.mjs rule 1, moved upstream of the file it polices.
    if (layer !== "primitive") {
      if (ANY_HEX_RE.test(leaf.value)) {
        throw new Error(
          `${leafPath}: hex literal in layer "${layer}" — a colour literal may appear in "primitive" only; ` +
            `declare a primitive and point at it with var(…)`
        );
      }
      for (const m of leaf.value.matchAll(COLOUR_FN_RE)) {
        if (m[0].includes("var(")) continue;
        throw new Error(
          `${leafPath}: raw colour function ${m[0]} in layer "${layer}" — a functional colour is still a ` +
            `colour literal; declare a primitive and point at it with var(…)`
        );
      }
    }

    // ★ And the round-trip. A hex leaf must survive hex → oklch → hex at the emitted precision.
    if (HEX_RE.test(leaf.value.trim())) {
      const hex = leaf.value.trim().toUpperCase();
      const back = hexOfOklchLiteral(oklchLiteral(hex));
      if (back !== hex) {
        throw new Error(
          `${leafPath}: ${hex} does not survive the OKLCH round-trip at the emitted precision ` +
            `(got ${back}) — raise L_PRECISION/C_PRECISION/H_PRECISION rather than shipping a drifted colour`
        );
      }
    }
  }

  // ★ Property 3 — F368. Every var(--x) must resolve to a declared leaf, or the whole declaration
  //   that reads it is invalid at computed-value time and is dropped silently.
  for (const { path: leafPath, leaf } of leaves) {
    for (const m of leaf.value.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)/g)) {
      if (!declared.has(m[1])) {
        throw new Error(
          `${leafPath}: reads ${m[1]}, which no leaf declares — a property that is READ and not ` +
            `DECLARED is invalid at computed-value time and its whole declaration is dropped SILENTLY (F368)`
        );
      }
    }
  }

  return leaves;
}

/** The hex a token resolves to, following var() indirection down to a primitive literal. */
export function resolveHex(tokens, key, seen = new Set()) {
  if (seen.has(key)) throw new Error(`${key}: var() cycle — a custom property that reads itself is invalid`);
  seen.add(key);
  const hit = collectLeaves(tokens).find((l) => l.key === key);
  if (!hit) throw new Error(`${key}: no such token`);
  const value = hit.leaf.value.trim();
  if (HEX_RE.test(value)) return value.toUpperCase();
  const direct = hexOfOklchLiteral(value);
  if (direct) return direct;
  const ref = /^var\(\s*(--[a-zA-Z0-9_-]+)\s*\)$/.exec(value);
  if (ref) return resolveHex(tokens, ref[1], seen);
  throw new Error(`${key}: "${value}" is not a colour this generator can resolve to a hex`);
}

// ── webui/src/styles/tokens.css ─────────────────────────────────────────────────────────────────
const LAYER_HEADINGS = {
  primitive:
    "LAYER 1 — PRIMITIVES. The ONLY place a colour literal may appear, anywhere. In `@theme` so\n *   Tailwind 4 generates its utilities from these names.",
  semantic: "LAYER 2 — SEMANTIC. Meaning, pointing at layer 1. No literals.",
  component: "LAYER 3 — COMPONENT. Only where a component genuinely needs its own hook.",
};

function commentBlock(text, indent) {
  const lines = String(text).split("\n");
  if (lines.length === 1) return [`${indent}/* ${lines[0]} */`];
  const out = [`${indent}/* ${lines[0]}`];
  for (const line of lines.slice(1)) out.push(`${indent} * ${line}`);
  out.push(`${indent} */`);
  return out;
}

function emitLeaf(key, leaf, width) {
  const value = leaf.value.trim();
  const isHex = HEX_RE.test(value);
  const declared = isHex ? oklchLiteral(value.toUpperCase()) : value;
  const pad = " ".repeat(Math.max(1, width - key.length));
  let line = `  ${key}:${pad}${declared};`;
  const comments = [];
  if (isHex) comments.push(value.toUpperCase());
  else {
    const hex = hexOfOklchLiteral(value);
    if (hex) comments.push(hex);
  }
  if (leaf.note) comments.push(leaf.note);
  if (comments.length) line += `  /* ${comments.join(" — ")} */`;
  return line;
}

function emitGroups(tokens, layerName, lines) {
  const layer = tokens[layerName];
  lines.push("");
  lines.push(...commentBlock(`═══ ${LAYER_HEADINGS[layerName]}`, "  "));
  if (layer?.$note) lines.push(...commentBlock(layer.$note, "  "));
  for (const [groupName, group] of groupsOf(layer)) {
    lines.push("");
    lines.push(`  /* ── ${groupName} ─────────────────────────────────────────────── */`);
    if (group.$note) lines.push(...commentBlock(group.$note, "  "));
    const keys = Object.keys(group).filter((k) => !k.startsWith("$"));
    const width = Math.max(...keys.map((k) => k.length)) + 1;
    for (const key of keys) lines.push(emitLeaf(key, group[key], width));
  }
}

function buildTokensCss(tokens) {
  const lines = [];
  lines.push("/* GENERATED by design/build-tokens.mjs from design/tokens.json. DO NOT EDIT BY HAND. */");
  lines.push("/*");
  lines.push(" * ★★★ EVERY VALUE IN THIS FILE COMES FROM design/tokens.json, WHICH CARRIES A `source`");
  lines.push(" *     AND A `from` FOR EACH ONE. Change a value there and re-run `node design/build-tokens.mjs`.");
  lines.push(" *     A hand edit here is reverted by the next run and fails db/gates/design-tokens.mjs check 6.");
  lines.push(` * ★ ${tokens.meta?.rule ?? ""}`);
  lines.push(` * ★ Source: ${tokens.meta?.source ?? ""}`);
  lines.push(" */");
  lines.push("");
  lines.push("@theme {");
  emitGroups(tokens, "primitive", lines);
  lines.push("}");
  lines.push("");
  lines.push(":root {");
  emitGroups(tokens, "semantic", lines);
  emitGroups(tokens, "component", lines);
  lines.push("}");
  return lines.join("\n") + "\n";
}

// ── design/tailwind-preset.cjs ──────────────────────────────────────────────────────────────────
// ★ Recovery Compass is a DIFFERENT REPOSITORY on Tailwind 3, so this preset cannot ship `var(…)`
//   chains — the primitives it would point at do not exist over there. Every colour is therefore
//   RESOLVED to its hex here, through the same var() graph the stylesheet uses (task 10a.8 field 7:
//   `require('./design/tailwind-preset.cjs').theme.extend.colors.primary` is `"#5A56D6"`).
// ★★ The list is EXPLICIT rather than "every semantic colour", so the preset cannot silently
//    balloon as layer 2 grows — 10a.8 names exactly these families.
const PRESET_COLOURS = [
  "--primary", "--accent", "--surface", "--canvas", "--on-primary",
  "--ink", "--ink-muted", "--line", "--line-soft", "--nav-active",
  "--chip-neutral-bg", "--chip-neutral-ink",
  "--chip-ok-bg", "--chip-ok-ink", "--chip-ok-edge",
  "--chip-warn-bg", "--chip-warn-ink", "--chip-warn-edge",
  "--chip-bad-bg", "--chip-bad-ink", "--chip-bad-edge",
  "--chip-act-bg", "--chip-act-ink",
  "--signer-client-bg", "--signer-client-ink",
  "--signer-parent-bg", "--signer-parent-ink",
  "--signer-practice-bg", "--signer-practice-ink",
  "--button-secondary-border",
];

const PRESET_FONTS = { sans: "--ks-font-text", figure: "--ks-font-figure", mono: "--ks-font-mono" };
const PRESET_HEIGHTS = { control: "--density-control-h", "control-hero": "--control-h-hero", row: "--row-h" };

function leafValue(tokens, key) {
  const hit = collectLeaves(tokens).find((l) => l.key === key);
  if (!hit) throw new Error(`${key}: no such token`);
  return hit.leaf.value.trim();
}

function jsKey(key) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function fontStack(value) {
  return value
    .split(",")
    .map((part) => part.trim().replace(/^"(.*)"$/, "$1"))
    .filter(Boolean);
}

function buildTailwindPreset(tokens) {
  const colours = PRESET_COLOURS.map((key) => {
    const name = key.slice(2);
    return `      ${jsKey(name)}: ${JSON.stringify(resolveHex(tokens, key))},`;
  }).join("\n");
  const fonts = Object.entries(PRESET_FONTS)
    .map(([name, key]) => `      ${jsKey(name)}: ${JSON.stringify(fontStack(leafValue(tokens, key)))},`)
    .join("\n");
  const heights = Object.entries(PRESET_HEIGHTS)
    .map(([name, key]) => `      ${jsKey(name)}: ${JSON.stringify(leafValue(tokens, key))},`)
    .join("\n");

  return [
    "// GENERATED by design/build-tokens.mjs from design/tokens.json. DO NOT EDIT BY HAND.",
    "//",
    "// ★ The Tailwind 3 preset for Recovery Compass (a DIFFERENT repository — spec 09 §3). Its",
    "//   colours are the same tokens the staff app ships, RESOLVED to hex: a `var(--…)` chain would",
    "//   point at primitives that do not exist in that app.",
    "module.exports = {",
    "  theme: {",
    "    extend: {",
    "      colors: {",
    colours,
    "      },",
    "      borderRadius: {",
    `        pill: ${JSON.stringify(leafValue(tokens, "--radius-pill"))},`,
    "      },",
    "      fontFamily: {",
    fonts.replace(/^ {6}/gm, "        "),
    "      },",
    "      height: {",
    heights.replace(/^ {6}/gm, "        "),
    "      },",
    "    },",
    "  },",
    "};",
    "",
  ].join("\n");
}

// ── src/documents/pdfTheme.mjs ──────────────────────────────────────────────────────────────────
// ★★★ F582 — THE SIX ROLES, NOT "EVERY SEMANTIC COLOUR". The first version of this generator
//     emitted all 29 of `semantic.color`'s keys under their CSS spellings (`ink-muted`, `on-primary`)
//     and with no `faint` at all — so `buildTokens({ write: true })` would have silently overwritten
//     the hand-built module with a shape none of `pdf.mjs`'s ten `PDF_THEME.*` reads could match,
//     breaking PDF generation. The six roles below are the shape `src/documents/pdf.mjs` actually
//     consumes (task 10a.7), and the values come from the token graph rather than from this file.
const PDF_ROLES = [
  ["ink", "--ink", "MOCKUPS.md:49 — body text"],
  ["muted", "--ink-muted", "MOCKUPS.md:49 — captions, footnotes, signature meta"],
  ["faint", "--ink-muted", "MOCKUPS.md:49 — see note above; derived, not quoted"],
  ["line", "--line", "MOCKUPS.md:49"],
  ["primary", "--primary", "MOCKUPS.md:50"],
  ["onPrimary", "--on-primary", "MOCKUPS.md:50"],
];

function buildPdfTheme(tokens) {
  const hex = Object.fromEntries(PDF_ROLES.map(([role, key]) => [role, resolveHex(tokens, key)]));
  const width = Math.max(...PDF_ROLES.map(([role]) => role.length)) + 2;
  const row = (role, comment) =>
    `  ${role}:${" ".repeat(width - role.length)}${JSON.stringify(hex[role])}, // ${comment}`;

  return [
    "// P18.4 · CT-084 — THE COLOUR ROLES A GENERATED PDF READS, SO A PDF AND A SCREEN CANNOT DRIFT.",
    "//",
    "// GENERATED by design/build-tokens.mjs from design/tokens.json. DO NOT EDIT BY HAND.",
    "//",
    "// `src/documents/pdf.mjs` used to hard-code three distinct grey literals, ten times over. Each",
    "// site now reads one of the six named roles below instead. Every value here is resolved from",
    "// `design/tokens.json`'s token graph (task 10a.1's single source of truth for every colour quoted",
    "// from `specs/MOCKUPS.md`), with ONE exception recorded in the `faint` entry.",
    "",
    "export const PDF_THEME = Object.freeze({",
    row("ink", PDF_ROLES[0][2]),
    row("muted", PDF_ROLES[1][2]),
    "  // ★ MOCKUPS.md §1 gives ONE muted value, not two. The old third grey literal marked an",
    "  //   UNRESOLVED VARIABLE or an UNANSWERED QUESTION — a semantic distinction the mock does not",
    "  //   name. Rather than invent a third grey, `faint` is set equal to `muted`; the distinction is",
    "  //   still carried by the existing italic/`Helvetica-Oblique` treatment at the signature-slot",
    "  //   site. This is the one value in this file that is a derived decision, not a direct quotation",
    "  //   — see `design/tokens.json`.",
    row("faint", PDF_ROLES[2][2]),
    row("line", PDF_ROLES[3][2]),
    row("primary", PDF_ROLES[4][2]),
    row("onPrimary", PDF_ROLES[5][2]),
    "});",
    "",
  ].join("\n");
}

/**
 * @param {{ write?: boolean }} [options]
 * @returns {{ tokensCss: string, tailwindPreset: string, pdfTheme: string, artifacts: string[] }}
 */
export function buildTokens({ write = false } = {}) {
  const raw = readFileSync(TOKENS_JSON, "utf8");
  const tokens = JSON.parse(raw);

  const leaves = validateTokens(tokens);

  const tokensCss = buildTokensCss(tokens);
  const tailwindPreset = buildTailwindPreset(tokens);
  const pdfTheme = buildPdfTheme(tokens);

  const artifacts = [TOKENS_CSS_OUT, TAILWIND_PRESET_OUT, PDF_THEME_OUT];

  if (write) {
    writeFileSync(TOKENS_CSS_OUT, tokensCss);
    writeFileSync(TAILWIND_PRESET_OUT, tailwindPreset);
    writeFileSync(PDF_THEME_OUT, pdfTheme);
  }

  return { tokensCss, tailwindPreset, pdfTheme, artifacts, leafCount: leaves.length };
}

function isMainModule() {
  return import.meta.url === `file://${process.argv[1]}`;
}

if (isMainModule()) {
  try {
    const result = buildTokens({ write: process.argv.includes("--write") });
    for (const artifact of result.artifacts) {
      console.log(path.relative(ROOT, artifact));
    }
    console.log(`${result.leafCount} tokens`);
    console.log("ok");
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
