// Browser helpers for the Docustay API (same origin through the proxy in hooks.server.js).
import { t, i18n } from "$lib/i18n/index.svelte.js";
import { twoStepGate } from "$lib/twoStepGate.svelte.js";
import { serverText } from "$lib/serverText.js";   // R8-52: the limit and Pro refusals in the reader's language
const GENERIC_HTTP = /^(internal server error|internal error|bad gateway|service unavailable|gateway time-?out|server error|error)\.?$/i;   // R13-D445: words that only repeat the status
// a refusal for rank is a code on the wire ("section refused: requires_admin", "refused: requires edit on setting"); a person reads a sentence
const RANK_REFUSAL = /^(section )?refused: requires/;
// P10-A-11: a 429 is a wait, said in plain words (Retry-After in seconds when the server sends it)
export const tooManyText = (retryAfter) => { const n = Math.ceil(Number(retryAfter) / 60); return Number.isFinite(n) && n > 0 ? `${t("Too many tries from this connection.")} ${t("{n, plural, one {Try again in # minute.} other {Try again in # minutes.}}", { n })}` : t("Too many tries from this connection. Wait a few minutes and try again."); };
export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
// Run 8 (R8-14): the same GET asked for again while it is still in flight shares that one request (the shell, a page and a panel each asked for the same settings, 3 requests per screen);
// every caller still gets its OWN copy of the answer, so one screen changing what it got never changes another's. Writes are never shared.
const inflight = new Map();
let sessionEndedChecked = false;
export function api(path, opts = {}) {
  if ((opts.method ?? "GET") !== "GET" || opts.body !== undefined) return call(path, opts);
  let p = inflight.get(path); if (!p) { p = call(path, opts).finally(() => inflight.delete(path)); inflight.set(path, p); }
  return p.then((out) => ({ ...out, json: out.json == null ? out.json : structuredClone(out.json) }));
}
async function call(path, { method = "GET", body, key } = {}) {
  let r;
  // Run 8 (S2 states, offline mid-save): no network made fetch THROW — an uncaught page error, the field stuck on "saving", nobody told. Every caller now gets a plain answer it already handles.
  // R10-60: the answer the page head already asked the server for (app.html), taken once; anything else, or an old one, is asked for now
  const early = method === "GET" && typeof window !== "undefined" && window.__pre?.[path]; if (early) delete window.__pre[path];
  if (early && Date.now() - early.at < 20000) r = await early.p;
  if (r) { /* the early answer */ } else
  try { r = await fetch(path, { method, credentials: "same-origin", headers: { accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(method !== "GET" ? { "idempotency-key": key ?? newKey() } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch { return { ok: false, status: 0, json: null, offline: true, error: t("Docustay could not be reached. Check your connection and try again.") }; }
  const json = await r.json().catch(() => null);
  // a workspace that requires two-step sign-in answers everything but the setup calls with this code: the app shows its one set-up page in place of the screen (TwoStepGate).
  // HOTFIX 11 Oct 2026: never a redirect — a redirect to the Security tab made every page jump back there, because each page's own calls were refused again.
  if (r.status === 403 && json?.error?.detail?.code === "two_step_required") { twoStepGate.needed = true; twoStepGate.message = json.error.message ?? ""; }
  // Run 7: a session idle past the workspace's limit has been ended on the server: go to sign-in and say why
  if (r.status === 401 && json?.error?.detail?.code === "idle_signed_out" && typeof location !== "undefined") location.assign("/login?signedout=idle");
  // 26 Oct 2026: a signed-in page that is suddenly refused asks once why; if its workspace was deleted the person lands on sign-in with that sentence
  if (r.status === 401 && !path.startsWith("/api/auth") && !path.startsWith("/api/public") && typeof location !== "undefined" && !sessionEndedChecked) {
    sessionEndedChecked = true;
    try { const e = await fetch("/api/auth/session-ended", { credentials: "same-origin", headers: { accept: "application/json" } }).then((x) => x.json()); if (e?.ended) location.assign("/login?signedout=deleted"); } catch { /* the usual "session ended" wording stands */ }
  }
  const raw = json?.error?.message ?? null;
  // R13-D445: a server fault with no words of its own (a proxy's page, or only an HTTP phrase such as "Internal Server Error") is said in plain words; a 5xx the server worded itself passes through
  if (r.status >= 500 && (!raw || GENERIC_HTTP.test(String(raw).trim()))) return { ok: false, status: r.status, json, error: t("Something went wrong on our side. Try again in a moment.") };
  return { ok: r.ok, status: r.status, json, error: r.status === 429 ? tooManyText(r.headers.get("retry-after")) : r.status === 401 && !path.startsWith("/api/auth") && !path.startsWith("/api/public") ? t("Your session has ended. Sign in again.") : r.status === 403 && raw && RANK_REFUSAL.test(raw) ? t("You do not have permission to do that. Ask an owner or an admin.") : serverText(json?.error, t, i18n.lang) };
}
export const money = (minor, cur = "usd") => new Intl.NumberFormat("en-US", { style: "currency", currency: cur.toUpperCase(), minimumFractionDigits: minor % 100 ? 2 : 0 }).format(minor / 100);
