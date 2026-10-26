// src/branding/publicLogo.mjs — the ONE place a stored logo setting becomes a URL a browser or an email client can load.
// `branding.logo_url` holds either an https address or a storage pointer `ks-object:t/<tenant>/brand_logo/<file>` (what POST /api/settings/branding/logo writes).
// A pointer is never shown raw: the bytes are served, public and cacheable, by GET /api/public/brand/logo on the practice's own host (src/routes/publicBookingS2S.mjs).
// Found 7 Oct 2026: the hosted booking page and every confirmation email were handed the raw setting (a pointer, or the retired example.com address) or nothing.
const POINTER = /^ks-object:t\/[0-9a-f-]{36}\/brand_logo\/[A-Za-z0-9._-]{1,128}$/i;
export const PUBLIC_LOGO_PATH = "/api/public/brand/logo";

/** `origin` null → a same-host relative path (for pages served from the practice's own host); an origin → an absolute URL (for email). Returns null when there is no usable logo. */
export function publicLogoUrl(stored, origin = null) {
  if (typeof stored !== "string" || !stored) return null;
  if (POINTER.test(stored)) return origin ? `${origin}${PUBLIC_LOGO_PATH}` : PUBLIC_LOGO_PATH;
  if (/^https:\/\//.test(stored)) return stored;
  return null;
}

/** The practice's public origin for email links: https://<slug>.<KEYSTONE_APP_DOMAIN>. null when either is unknown. */
export function practiceOrigin(slug, env = process.env) {
  const domain = String(env.KEYSTONE_APP_DOMAIN ?? "").toLowerCase().replace(/\.$/, "");
  return slug && domain ? `https://${slug}.${domain}` : null;
}

/** R13-D492: a document email (signing invitation, reminder, preview) is sent from a host shared by every workspace, so the host cannot say whose logo to serve. A stored pointer becomes `<origin of the signing link>/api/public/brand/logo/<tenant id>`; an https address is kept; anything else is no logo (the workspace name shows instead). Used to be the raw `ks-object:` pointer, which no mail program can load. */
export function emailLogoUrl(stored, link, tenantId) {
  if (typeof stored !== "string" || !stored) return null;
  if (/^https:\/\//.test(stored)) return stored;
  if (!POINTER.test(stored) || !/^[0-9a-f-]{36}$/i.test(String(tenantId ?? ""))) return null;
  try { return `${new URL(link).origin}${PUBLIC_LOGO_PATH}/${tenantId}`; } catch { return null; }
}
