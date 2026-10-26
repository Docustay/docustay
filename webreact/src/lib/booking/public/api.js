// PLATFORM'S OWN PUBLIC BOOKING PAGES — the browser door (spec BOOKING-EVERYWHERE §5.1). No session on this door; the practice
// is the one the Host header names. Plain fetch on purpose: nothing here imports the staff app's api.js.
// ★ Every refusal is the same generic 404 ("This page isn't available."); a write carries its own idempotencyKey in the body.

export class BookError extends Error {
  constructor(status, error) {
    super(error?.message || "We couldn't do that. Try again.");
    this.status = status; this.kind = error?.kind ?? null; this.detail = error?.detail ?? null;
    this.fields = error?.detail?.fields ?? error?.fields ?? null; this.code = error?.detail?.code ?? null;
  }
}
const q = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");

async function call(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method, cache: "no-store", credentials: "same-origin",
    headers: { accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  if (text) { try { parsed = JSON.parse(text); } catch { parsed = { error: { message: text.slice(0, 300) } }; } }
  if (!res.ok) throw new BookError(res.status, parsed?.error);
  return parsed;
}

export const bookApi = {
  practice: () => call("/api/public/book/practice"),
  address: (path) => call(`/api/public/book/address?${q({ path })}`),
  service: (service, page) => call(`/api/public/book/service?${q({ service, page })}`),
  slots: ({ service, from, to, host, page }) => call(`/api/public/book/slots?${q({ service, from, to, host, page })}`),
  team: (body) => call("/api/public/book/team", { method: "POST", body }),
  manage: (token) => call(`/api/public/book/manage?${q({ token })}`),
  manageSlots: ({ token, from, to }) => call(`/api/public/book/manage/slots?${q({ token, from, to })}`),
  manageMove: (body) => call("/api/public/book/manage/move", { method: "POST", body }),
  manageCancel: (body) => call("/api/public/book/manage/cancel", { method: "POST", body }),
};
export const newKey = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

// ── THE BOT CHECK (Cloudflare Turnstile, invisible) ───────────────────────────────────────────────
// The site key comes from /api/auth/config like sign-up's. No key on this deployment, or the widget cannot load or answers
// too slowly: resolve null — the server's own policy decides (it fails open on an outage and refuses only a clear rejection).
let siteKeyOnce;
const siteKey = () => (siteKeyOnce ??= fetch("/api/auth/config", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => j?.data?.turnstile?.siteKey ?? null).catch(() => null));
let scriptOnce;
const loadTurnstile = () => (scriptOnce ??= new Promise((resolve, reject) => {
  if (window.turnstile) { resolve(); return; }
  const s = document.createElement("script");
  s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"; s.async = true;
  s.onload = () => resolve(); s.onerror = () => { scriptOnce = undefined; reject(new Error("turnstile")); };
  document.head.appendChild(s);
}));
export async function botToken() {
  const key = await siteKey();
  if (!key) return null;
  try {
    await loadTurnstile();
    return await new Promise((resolve) => {
      const el = document.createElement("div");
      el.style.cssText = "position:fixed;bottom:12px;right:12px;z-index:60";
      document.body.appendChild(el);
      let id; let timer;
      const done = (t) => { clearTimeout(timer); try { if (id !== undefined) window.turnstile.remove(id); } catch { /* gone */ } el.remove(); resolve(t); };
      timer = setTimeout(() => done(null), 12_000);
      id = window.turnstile.render(el, { sitekey: key, appearance: "interaction-only", callback: (t) => done(t), "error-callback": () => done(null), "timeout-callback": () => done(null) });
    });
  } catch { return null; }
}
