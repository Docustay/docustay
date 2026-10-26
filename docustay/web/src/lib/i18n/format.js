// A small ICU MessageFormat formatter: {name}, {n, plural, one {# item} other {# items}}, {x, select, a {..} other {..}}. Pure and side-effect free: the locale is an argument, never a global,
// so the same function serves the browser, the server's emails and PDF drawing. Plural categories come from the platform's CLDR data (Intl.PluralRules), so Arabic's six and Russian's four work without any table of ours.
// Rules for catalogue strings: whole sentences, never concatenated; names and numbers are arguments; word order is the translator's.
const cache = new Map();
function parse(src) {   // -> array of string | { name, kind, options } ; throws on unbalanced braces
  let i = 0;
  const readBody = (stop) => {
    const out = []; let text = "";
    while (i < src.length) {
      const c = src[i];
      if (c === "'" && src[i + 1] === "{") { text += "{"; i += 2; continue; }   // '{ escapes a brace
      if (c === "'" && src[i + 1] === "'") { text += "'"; i += 2; continue; }
      if (c === "}" && stop) { if (text) out.push(text); return out; }
      if (c === "{") { if (text) out.push(text); text = ""; i += 1; out.push(readArg()); continue; }
      text += c; i += 1;
    }
    if (stop) throw new Error("unbalanced braces in: " + src);
    if (text) out.push(text); return out;
  };
  const readArg = () => {
    let name = ""; while (i < src.length && !",}".includes(src[i])) { name += src[i]; i += 1; } name = name.trim();
    if (i >= src.length) throw new Error("unbalanced braces in: " + src);
    if (src[i] === "}") { i += 1; return { name, kind: "arg" }; }
    i += 1; let kind = ""; while (i < src.length && !",}".includes(src[i])) { kind += src[i]; i += 1; } kind = kind.trim();
    if (src[i] === "}") { i += 1; return { name, kind, options: null }; }
    i += 1; const options = {};
    while (i < src.length && src[i] !== "}") {
      while (/\s/.test(src[i] ?? "")) i += 1; if (src[i] === "}") break;
      let key = ""; while (i < src.length && !/[\s{]/.test(src[i])) { key += src[i]; i += 1; }
      while (/\s/.test(src[i] ?? "")) i += 1; if (src[i] !== "{") throw new Error("expected { after " + key + " in: " + src);
      i += 1; options[key] = readBody(true); i += 1;
    }
    i += 1; return { name, kind, options };
  };
  return readBody(false);
}
const ast = (src) => { let a = cache.get(src); if (!a) { a = parse(src); cache.set(src, a); } return a; };
/** Format one message. `locale` is a BCP 47 tag ("de", "ar"). A malformed message returns itself rather than throwing, so a bad string never blanks a screen (the build checks catch it first). */
export function format(src, vars, locale = "en") {
  if (!src.includes("{")) return src;
  try {
    return runWithPound(ast(src), vars ?? {}, locale);
  } catch { return src; }
}
function runWithPound(nodes, vars, locale, pound) {
  let out = "";
  for (const n of nodes) {
    if (typeof n === "string") { out += pound !== undefined ? n.replace(/#/g, pound) : n; continue; }
    const v = vars[n.name];
    if (n.kind === "arg") { out += v ?? ""; continue; }
    if (n.kind === "plural" || n.kind === "selectordinal") {
      const num = Number(v), cat = new Intl.PluralRules(locale, { type: n.kind === "plural" ? "cardinal" : "ordinal" }).select(num);
      out += runWithPound(n.options["=" + num] ?? n.options[cat] ?? n.options.other ?? [], vars, locale, new Intl.NumberFormat(locale).format(num)); continue;
    }
    if (n.kind === "select") { out += runWithPound(n.options[String(v)] ?? n.options.other ?? [], vars, locale, pound); continue; }
    out += v ?? "";
  }
  return out;
}
/** For the checks: the placeholder names a message uses, and the plural/select option keys per argument. Throws on a syntax error. */
export function inspect(src) {
  const names = new Set(), options = {};
  const walk = (nodes) => { for (const n of nodes) if (typeof n !== "string") { names.add(n.name); if (n.options) { options[n.name] = { kind: n.kind, keys: Object.keys(n.options) }; for (const o of Object.values(n.options)) walk(o); } } };
  walk(parse(src)); return { names: [...names].sort(), options };
}
