// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE PUBLIC ROUTES — pages anyone can open with no session, served by the server as app.html like every other path
// (only /login and /signup have their own HTML). Checked by the entry BEFORE <App>, which would ask for a session.
// Each loader is transcribed from its SvelteKit +page.js (webui/src/routes/*/+page.js); the page gets `{ data }`.
// ★ A loader never throws into the page: it answers { problem: true } and the page says what went wrong.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { loadBookPath } from "@/lib/booking/public/loaders.js";

const json = (r) => r.json();
const get = (url) => fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });

export const PUBLIC_ROUTES = [
  {
    id: "invite", match: (p) => (p === "/invite" ? {} : null), file: "routes/invite.jsx",
    load: async ({ query }) => {
      const token = query.get("token");
      if (!token) return { problem: true };
      try { const r = await get(`/api/auth/invite/${encodeURIComponent(token)}`); return r.ok ? { invite: await json(r) } : { problem: true }; }
      catch { return { problem: true }; }
    },
  },
  {
    id: "book", match: (p) => (p === "/book" ? {} : null), file: "routes/book.jsx",
    load: async () => {
      try {
        const r = await get("/api/public/book/practice");
        if (r.ok) return { practice: await json(r) };
        // online booking switched off: the server's 404 carries the practice's name and phone under detail.code "booking_closed" (F36)
        const body = await r.json().catch(() => null);
        return body?.error?.detail?.code === "booking_closed" ? { closed: body.error.detail.practice ?? {} } : { problem: true };
      }
      catch { return { problem: true }; }
    },
  },
  {
    // ★ Booking everywhere (22 Oct 2026): EVERYTHING under /book/ — a service, a person, a custom page (/book/p/<slug>, and the
    //   old /book/l/<slug>), /book/manage — resolves through the address lookup first (lib/booking/public/loaders.js). The route id
    //   stays `book-coach` because the entry maps that id to routes/book/coachSlug.jsx, which now dispatches by `data.view`.
    id: `book-coach`,
    match: (p) => {
      const m = /^\/book\/(.+?)\/*$/.exec(p);
      if (!m) return null;
      const path = m[1].split("/").map((s) => { try { return decodeURIComponent(s); } catch { return s; } }).join("/").toLowerCase();
      return { path, coachSlug: path };
    },
    file: "routes/book/coachSlug.jsx",
    load: ({ params, query }) => loadBookPath({ path: params.path, query }),
  },
  { id: "verify", match: (p) => (p === "/verify" ? {} : null), file: "routes/verify.jsx", load: null },
  {
    id: "verify-doc", match: (p) => { const m = /^\/verify\/([0-9a-f-]{36}\.[0-9a-f-]{36}\.[0-9a-f]{16})$/i.exec(p); return m ? { ref: m[1] } : null; }, file: "routes/verifyDoc.jsx",
    load: async ({ params }) => {
      try { const r = await get(`/api/public/documents/verify-facts?ref=${encodeURIComponent(params.ref)}`); return r.ok ? { facts: await json(r) } : { facts: null }; } catch { return { facts: null }; }
    },
  },
  {
    id: "self-serve", match: (p) => { const m = /^\/s\/([a-z0-9][a-z0-9-]{1,62})$/i.exec(p); return m ? { slug: m[1].toLowerCase() } : null; }, file: "routes/selfServe.jsx",
    load: async ({ params }) => {
      try { const r = await get(`/api/public/documents/self-serve?slug=${encodeURIComponent(params.slug)}`); return r.ok ? { page: await json(r), slug: params.slug } : { page: null, slug: params.slug }; } catch { return { page: null, slug: params.slug }; }
    },
  },
  { id: "tool-sign-pdf", match: (p) => (p === "/tools/sign-pdf" ? {} : null), file: "routes/toolSignPdf.jsx", load: null },
  { id: "tool-signature-maker", match: (p) => (p === "/tools/signature-maker" ? {} : null), file: "routes/toolSignatureMaker.jsx", load: null },
  { id: "sign-pdf", match: (p) => (p === "/sign/pdf" ? {} : null), file: "routes/signPdf.jsx", load: null },
  { id: "download", match: (p) => (p === "/download" ? {} : null), file: "routes/download.jsx", load: null },
  { id: "sign", match: (p) => (p === "/sign" ? {} : null), file: "routes/sign.jsx", load: null },
  {
    id: "unsubscribe", match: (p) => { const m = /^\/u\/([^/]+)$/.exec(p); return m ? { token: decodeURIComponent(m[1]) } : null; }, file: "routes/u/token.jsx",
    load: async ({ params }) => {
      try {
        const r = await fetch("/go/unsubscribe", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ token: params.token }), cache: "no-store" });
        if (!r.ok) return { fetchError: true };
        const { status, practiceName, ownerFirstName } = await json(r);
        return { status, practiceName, ownerFirstName };
      } catch { return { fetchError: true }; }
    },
  },
  {
    id: "waitlist-claim", match: (p) => (p === "/waitlist/claim" ? {} : null), file: "routes/waitlist/claim.jsx",
    load: async ({ query }) => {
      const t = query.get("t") ?? "";
      if (!t) return { problem: true, t: "" };
      try { const r = await get(`/api/public/waitlist/claim?t=${encodeURIComponent(t)}`); return r.ok ? { peek: await json(r), t } : { problem: true, t }; }
      catch { return { problem: true, t }; }
    },
  },
];

export function resolvePublic(path) {
  for (const route of PUBLIC_ROUTES) { const params = route.match(path); if (params) return { route, params }; }
  return null;
}
