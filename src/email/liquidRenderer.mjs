// src/email/liquidRenderer.mjs — PART 2, worker-failures brief, 1 Oct 2026.
//
// ★★★ THE ONE RENDERER. Liquid → text. Used by the real send (resolveTemplate.mjs), Run →
//     Templates' preview/test-send, and (Part 3) the invoice editor's Email tab — one function,
//     so "what you see is exactly what's sent" is true by construction, not by discipline.
//
// ★★ A MISSING REQUIRED VARIABLE THROWS, THE SAME GUARANTEE templates.mjs's old REQUIRED_VARS
//    check made ("rendering anyway would send 'undefined' to a person") — enforced here by the
//    registry's own Zod schema (`entry.schema.parse(vars)`), so there is one place that decides
//    what a template needs, not a schema AND a separate hand-maintained REQUIRED_VARS list that
//    can drift from it.
//
// ★ TERMINOLOGY TOKENS (`{{ userType.member | default: "Team member" }}`) are resolved by calling
//   the CALLER'S OWN `t(key, fallback)` — the exact function `renderTemplate()` already builds via
//   `makeRecordingResolver` (templates.mjs) — so the recording/freezing of "what terminology
//   actually resolved to" (written onto the delivery row) keeps working unchanged; this module
//   does not maintain a second copy of that bookkeeping. The resolved values are merged into the
//   render context under their namespace (`userType: { member: "..." }`), so Liquid's ordinary
//   dot-path lookup finds them.
//
// ★ SYNCHRONOUS. `resolveTemplate.mjs` must keep returning `{subject, text, html}` as plain
//   functions callable as `tpl.subject(vars, t)` (renderTemplate's existing, unchanged calling
//   convention) — LiquidJS's `parseAndRenderSync` makes that possible with no filters/tags that
//   need async, which this project's templates never use.

import { Liquid } from "liquidjs";
import { TEMPLATE_REGISTRY_BY_KEY } from "./registry.mjs";
import { makeRecordingResolver } from "./templates.mjs";

const engine = new Liquid({ strictVariables: false, strictFilters: true });

const TERM_TOKEN_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_.]*)\s*\|\s*default:\s*"((?:[^"\\]|\\.)*)"\s*\}\}/g;

/** ★ Every `{{ ns.leaf | default: "..." }}` in the Liquid source, resolved via the caller's own
 *   `t(key, fallback)`, grouped by namespace so Liquid's own dot-path lookup finds them. */
function termNamespaceVars(liquidSource, t) {
  const nsVars = {};
  const re = new RegExp(TERM_TOKEN_RE);
  let m;
  while ((m = re.exec(liquidSource))) {
    const key = m[1];
    const fallback = JSON.parse(`"${m[2]}"`);
    const value = t(key, fallback);
    const dot = key.indexOf(".");
    (nsVars[key.slice(0, dot)] ??= {})[key.slice(dot + 1)] = value;
  }
  return nsVars;
}

/**
 * Render a template's subject OR body — called once per side by resolveTemplate.mjs's own
 * `subject(vars, t)` / `text(vars, t)` functions (so each call re-validates and re-scans; cheap,
 * and keeps this module from needing to know which side the caller wants ahead of time).
 *
 * @param {string} key — registry key (always required — the Zod schema + terminology scan live
 *   here even when `override` substitutes a tenant's own Liquid source for the shipped default)
 * @param {"subject"|"body"} side
 * @param {object} vars
 * @param {(key: string, fallback: string) => string} t
 * @param {{subjectSrc?: string, bodySrc?: string}} [override]
 * @returns {string}
 */
/** ★ Every plain `{{ name }}` / `{{ name | filter }}` in a Liquid source — NOT a dotted
 *   terminology token (that scan is `termNamespaceVars`, below), so a tenant's own override is
 *   checked against what IT actually references, never the shipped default's unrelated schema. */
const PLAIN_VAR_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:\|[^}]*)?\}\}/g;
function plainVarsFromSource(src) {
  const names = new Set();
  const re = new RegExp(PLAIN_VAR_RE);
  let m;
  while ((m = re.exec(src))) names.add(m[1]);
  return names;
}

export function renderLiquidSide(key, side, vars, t, override = {}) {
  const entry = TEMPLATE_REGISTRY_BY_KEY[key];
  if (!entry) {
    throw new Error(`"${key}" is not a template key. Known keys are in src/email/registry.mjs.`);
  }
  const isOverride = override.subjectSrc !== undefined || override.bodySrc !== undefined;
  const subjectSrc = override.subjectSrc ?? entry.liquid.subject;
  const bodySrc = override.bodySrc ?? entry.liquid.body;
  const src = side === "subject" ? subjectSrc : bodySrc;

  // ★ THE REQUIRED-VARIABLE GUARANTEE. For the shipped default: the registry's own Zod schema
  //   (typed, one source of truth for what THAT content needs). For a tenant override (or an
  //   unsaved draft being previewed): the override's OWN content may use a smaller or different
  //   set of variables than the shipped default — checking it against the shipped default's
  //   schema would refuse a perfectly valid, simpler rewrite for needing fields it never
  //   mentions. FOUND LIVE verifying this exact path: a test override using only
  //   practiceName/recipientName was refused for "missing" the shipped default's reasonLine/
  //   timeZone/whenLocal, which its own text never references.
  let renderVars;
  if (isOverride) {
    const required = plainVarsFromSource(`${subjectSrc}\n${bodySrc}`);
    const missing = [...required].filter(
      (name) => vars[name] === undefined || vars[name] === null || String(vars[name]).trim() === "");
    if (missing.length) {
      throw new Error(
        `template "${key}" (tenant override) is missing ${missing.join(", ")}. Rendering anyway ` +
        `would send "undefined" to a person, which they cannot act on and nobody can un-send.`);
    }
    renderVars = vars;
  } else {
    const parsed = entry.schema.safeParse(vars);
    if (!parsed.success) {
      const problems = parsed.error.issues.map((i) => i.path.join(".") || "(root)").join(", ");
      throw new Error(
        `template "${key}" is missing or has an invalid ${problems}. Rendering anyway would send ` +
        `"undefined" to a person, which they cannot act on and nobody can un-send.`);
    }
    renderVars = parsed.data;
  }

  const nsVars = termNamespaceVars(src, t);
  const rendered = engine.parseAndRenderSync(src, { ...renderVars, ...nsVars });

  if (!rendered.trim()) {
    throw new Error(`template "${key}" rendered an empty ${side}`);
  }
  return rendered;
}

/**
 * Convenience one-shot render for callers that are not already inside `renderTemplate()`'s own
 * recording-resolver flow (Run → Templates preview/test-send, Part 3's invoice editor Email tab).
 * Builds its own recording resolver, so `terms` in the result is exactly what
 * `makeRecordingResolver` would have frozen.
 */
export function renderLiquidTemplate(key, vars = {}, terms = {}, override = {}) {
  const { t, used } = makeRecordingResolver(terms);
  const subject = renderLiquidSide(key, "subject", vars, t, override);
  const text = renderLiquidSide(key, "body", vars, t, override);
  return { subject, text, terms: used(), template: key, template_version: 1 };
}

/** ★ For Run → Templates / the invoice editor's Email tab: render arbitrary (possibly unsaved)
 *    Liquid source against a key's own schema and terminology scan, without touching any stored
 *    override row. Same function underneath — "what you see is exactly what's sent" by construction. */
export function previewLiquidTemplate(key, subjectSrc, bodySrc, vars, terms = {}) {
  return renderLiquidTemplate(key, vars, terms, { subjectSrc, bodySrc });
}
