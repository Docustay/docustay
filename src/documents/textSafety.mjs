// src/documents/textSafety.mjs — PURE TEXT-SAFETY HELPERS (Round 3, W1-4 / W1-5 / W1-6). Imports nothing.
//   · csvCell      — a spreadsheet must never run a cell as a formula (T-15, S-7)
//   · cleanName    — a typed name or title: no control, bidi or zero-width characters, one space between words, bounded
//   · safeEntryName / uniquePath — a zip entry can never climb out of its folder or overwrite another (T-9, T-10)
//   · cleanEmailAddress — one plain, deliverable address: IDN domains become punycode, lengths bounded (RFC 5321), nothing else accepted
//   · headerFilename / contentDisposition — a download name with any script in it never throws in a header (T-13, T-14, S-14)

/** A cell that starts with = + - @ TAB or CR is read by Excel/Sheets as a formula; a single quote in front makes it plain text. Everything else is unchanged. */
export function csvCell(value) {
  if (typeof value !== "string") return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

// bidi controls, zero-width characters, the word joiner and the BOM — invisible, and they reorder or hide text
const INVISIBLE = new RegExp("[" + [[0x200B,0x200F],[0x202A,0x202E],[0x2060,0x2060],[0x2066,0x2069],[0xFEFF,0xFEFF]].map(([a,b]) => String.fromCharCode(a) + (b > a ? "-" + String.fromCharCode(b) : "")).join("") + "]", "g");
// NUL and every other C0 / C1 control character (whitespace controls are turned into spaces BEFORE this runs)
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g;

/** A name or title as it should be stored and shown: NFC, whitespace runs become one space, controls and invisible characters removed, trimmed, at most `max` code points. */
export function cleanName(value, { max = 200 } = {}) {
  let s = String(value ?? "");
  try { s = s.normalize("NFC"); } catch { /* keep as is */ }
  s = s.replace(/\s+/g, " ").replace(CONTROL, "").replace(INVISIBLE, "");
  s = s.replace(/\s+/g, " ").trim();
  const points = Array.from(s);
  if (points.length > max) s = points.slice(0, max).join("").trim();
  return s;
}

/**
 * One plain email address, as it should be stored and sent to: `{ ok: true, email }` (domain in punycode, lower case) or `{ ok: false, reason }` with a sentence a person can act on.
 * RFC 5321 limits: 254 characters in all, 64 before the @, 63 per domain label. No display names, spaces, commas, brackets or a second @. Letters outside ASCII before the @ need SMTPUTF8, which most mail systems do not accept, so they are refused with that explanation;
 * an international DOMAIN (exämple.de, 例え.jp) is fine and is converted to its ASCII form (xn--…), which is what the mail system needs.
 */
export function cleanEmailAddress(value) {
  const raw = String(value ?? "");
  let s = raw;
  try { s = s.normalize("NFC"); } catch { /* keep as is */ }
  s = s.trim();
  const no = (reason) => ({ ok: false, reason });
  if (!s) return no("is empty");
  if (/[\s,;<>()\[\]\\":]/.test(s)) return no("must be one plain address like name@example.com — no spaces, commas, brackets or display name");
  const at = s.split("@");
  if (at.length !== 2) return no("must have exactly one @");
  const [local, domainRaw] = at;
  if (!local || !domainRaw) return no("is missing the part before or after the @");
  if (Array.from(local).length > 64) return no("has more than 64 characters before the @, which no mail system accepts");
  if (/[^\x21-\x7E]/.test(local)) return no("has letters outside A–Z before the @; most mail systems cannot deliver to that. Use the plain-letter address");
  if (/^\.|\.$|\.\./.test(local) || !/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(local)) return no("has characters before the @ that are not allowed");
  let domain = domainRaw.toLowerCase().replace(/\.$/, "");
  if (/[^\x00-\x7F]/.test(domain)) { try { domain = new URL(`http://${domain}`).hostname; } catch { return no("has a website part that is not valid"); } }
  if (!domain.includes(".") || domain.length > 253) return no("needs a website part like example.com");
  const labels = domain.split(".");
  if (labels.some((l) => l.length < 1 || l.length > 63 || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(l))) return no("has a website part that is not valid");
  if (/^\d+$/.test(labels[labels.length - 1]) || labels[labels.length - 1].length < 2) return no("has an ending (after the last dot) that is not valid");
  const email = `${local.toLowerCase()}@${domain}`;
  if (email.length > 254) return no("is longer than 254 characters");
  return { ok: true, email };
}

/** One zip entry name PART (no folders): letters and digits of any script, space . _ - ( ) only; no `..`, no leading dots or slashes; at most 120 characters (the extension survives the cut); never empty. */
export function safeEntryName(value, fallback = "file") {
  let s = cleanName(value, { max: 1000 });
  s = s.replace(/[^\p{L}\p{N} ._()-]/gu, "_");
  s = s.replace(/\.{2,}/g, "").replace(/^[.\s_]+/, "").replace(/_{2,}/g, "_").replace(/ {2,}/g, " ").replace(/[. ]+$/, "");
  const points = Array.from(s);
  if (points.length > 120) {
    const m = /\.[\p{L}\p{N}]{1,10}$/u.exec(s);
    const ext = m ? m[0] : "";
    s = Array.from(s.slice(0, s.length - ext.length)).slice(0, 120 - Array.from(ext).length).join("").replace(/[. ]+$/, "") + ext;
  }
  return s || cleanFallback(fallback);
}
const cleanFallback = (f) => String(f ?? "").replace(/[^\p{L}\p{N} ._()-]/gu, "_").replace(/^[.\s]+/, "") || "file";

/**
 * Make `path` unique among `taken` (a Set of lower-cased paths; the path is added). The second one becomes `name (2).ext`, the third `name (3).ext`.
 * Case-insensitive, because the machines that open the zip often are.
 */
export function uniquePath(taken, path) {
  const slash = path.lastIndexOf("/");
  const dir = slash >= 0 ? path.slice(0, slash + 1) : "";
  const leaf = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = leaf.lastIndexOf(".");
  const stem = dot > 0 ? leaf.slice(0, dot) : leaf;
  const ext = dot > 0 ? leaf.slice(dot) : "";
  let candidate = path;
  for (let n = 2; taken.has(candidate.toLowerCase()); n += 1) candidate = `${dir}${stem} (${n})${ext}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** The two halves of a Content-Disposition filename: `ascii` for old clients (non-ASCII becomes `_`, quotes, backslashes and controls removed) and `star` for `filename*=UTF-8''<star>` (RFC 6266 / 5987). */
export function headerFilename(name) {
  const raw = String(name ?? "").replace(LONE_SURROGATE, String.fromCharCode(0xFFFD));
  const ascii = raw.replace(/["\\\u0000-\u001F\u007F-\u009F]/g, "").replace(/[^\x20-\x7E]/g, "_").trim() || "file";
  const star = encodeURIComponent(raw).replace(/['()*!]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  return { ascii, star };
}

/** The whole header value: `attachment; filename="<ascii>"; filename*=UTF-8''<star>` (or `inline`). */
export function contentDisposition(type, name) {
  const { ascii, star } = headerFilename(name);
  return `${type === "inline" ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${star}`;
}
