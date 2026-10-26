// src/http/idnBody.mjs — let the public API accept an address on an international domain (B-2, Run 6).
// `POST /api/v1/...` bodies are checked by zod's `.email()`, which refuses `anna@exämple.de` although it is deliverable as `anna@xn--exmple-cua.de`. Changing the schema would drift the checked-in OpenAPI document and the generated SDKs, so the address is converted BEFORE the schema sees it: only the domain half of a string under a key named email / replyTo / reply_to, only when that domain has a non-ASCII letter. Everything else passes through untouched.
import { domainToASCII } from "node:url";

const KEYS = new Set(["email", "replyTo", "reply_to"]);
const NON_ASCII = /[^\x00-\x7F]/;

function toAsciiAddress(v) {
  const at = v.lastIndexOf("@");
  if (at < 1) return v;
  const domain = v.slice(at + 1);
  if (!NON_ASCII.test(domain)) return v;
  const ascii = domainToASCII(domain.trim());
  return ascii ? `${v.slice(0, at)}@${ascii}` : v;       // an empty answer means the domain is not valid: leave it, and the schema refuses it as before
}

/** A copy of `value` with every international email domain in an email-named string converted to punycode. Returns the same object when nothing changed. */
export function punycodeEmails(value, depth = 0) {
  if (depth > 8 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    let out = null;
    value.forEach((x, i) => { const y = punycodeEmails(x, depth + 1); if (y !== x) { out ??= value.slice(); out[i] = y; } });
    return out ?? value;
  }
  let out = null;
  for (const [k, x] of Object.entries(value)) {
    const y = typeof x === "string" ? (KEYS.has(k) ? toAsciiAddress(x) : x) : punycodeEmails(x, depth + 1);
    if (y !== x) { out ??= { ...value }; out[k] = y; }
  }
  return out ?? value;
}

/** Hono middleware: rewrite a JSON request body in place when it holds an international address. A body that is not JSON, is empty or has nothing to convert is left exactly as it came. */
export async function idnBodyMiddleware(c, next) {
  const m = c.req.method;
  if ((m === "POST" || m === "PUT" || m === "PATCH") && /json/i.test(c.req.header("content-type") ?? "")) {
    const raw = c.req.raw;
    const text = await raw.clone().text().catch(() => "");
    if (NON_ASCII.test(text)) {
      let parsed; try { parsed = JSON.parse(text); } catch { parsed = undefined; }
      const fixed = parsed === undefined ? parsed : punycodeEmails(parsed);
      if (fixed !== parsed) {
        const headers = new Headers(raw.headers); headers.delete("content-length");
        c.req.raw = new Request(raw.url, { method: raw.method, headers, body: JSON.stringify(fixed) });
      }
    }
  }
  await next();
}
