// src/developer/builderFrame.mjs — the signed statement "this builder page may be framed by THIS website until THIS time". It rides in the builder link's query (nothing secret: the key itself stays in the #fragment, which no server ever sees),
// and the web server asks the API to check it before it names the allowed parent in the page's frame-ancestors. HMAC-SHA256 under the install's own pepper; stateless, so nothing to store and nothing to clean up.
import { createHmac, timingSafeEqual } from "node:crypto";

const secret = () => { const v = process.env.KEYSTONE_TOKEN_PEPPER; if (!v) throw new Error("KEYSTONE_TOKEN_PEPPER is not set"); return `builder-frame:${v}`; };
const mac = (o, e) => createHmac("sha256", secret()).update(`${o}\n${e}`).digest("base64url");

/** → { o, e, s } for a website that is already known to be allowed. */
export function signFrame(origin, ttlSeconds = 3600, now = Date.now()) { const e = Math.floor(now / 1000) + ttlSeconds; return { o: origin, e, s: mac(origin, e) }; }
/** → the origin, or null for anything forged, altered or expired. */
export function openFrame({ o, e, s } = {}, now = Date.now()) {
  if (typeof o !== "string" || typeof s !== "string" || !/^\d{9,12}$/.test(String(e))) return null;
  if (Number(e) < Math.floor(now / 1000)) return null;
  const a = Buffer.from(mac(o, e)), b = Buffer.from(s);
  return a.length === b.length && timingSafeEqual(a, b) ? o : null;
}
