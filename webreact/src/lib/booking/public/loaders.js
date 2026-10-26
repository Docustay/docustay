// PLATFORM'S OWN PUBLIC BOOKING PAGES — the loader behind /book/<anything>. ★ The address lookup comes FIRST (spec §2.4): a
// service, a person, a custom page (/book/p/<slug>, and the old /book/l/<slug>), a redirect (the page replaces the URL) or a
// gone page. Only when the lookup finds nothing does a single-segment path fall back to the old coach lookup, so a link that
// still points at the old person page keeps working. Never throws into the page: `{ problem: true }` says what went wrong.
import { bookApi, BookError } from "./api.js";

const get = (url) => fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
const maybePractice = () => bookApi.practice().catch(() => null);

/** /book/manage?t=<token>  (frame 8 in the platform's look). */
export async function loadManage({ query }) {
  const token = query.get("t") ?? query.get("token") ?? "";
  const practice = await maybePractice();
  if (!token) return { view: "manage", practice, closed: true, token: "" };
  try { return { view: "manage", practice, token, manage: await bookApi.manage(token) }; }
  catch { return { view: "manage", practice, token, closed: true }; }  // bad, expired or another practice's link: all the same sentence
}

async function legacyCoach(coachSlug, query) {
  const serviceId = query.get("serviceId");
  const r = await get(`/api/public/book/coach?coachSlug=${encodeURIComponent(coachSlug)}${serviceId ? `&serviceId=${encodeURIComponent(serviceId)}` : ""}`);
  if (!r.ok) return { problem: true, coachSlug, practice: await maybePractice() };  // the practice's name stays in the header
  const result = await r.json();
  // ★ The server says this link moved: follow it, replacing history.
  if (result?.redirect) return { redirect: result.redirect.subjectType === "coach" && result.redirect.coachSlug ? `/book/${encodeURIComponent(result.redirect.coachSlug)}` : "/book" };
  return { coach: result, coachSlug, confirmed: query.get("confirmed"), srcTag: query.get("src") };
}

/** `path` is everything after /book/ with no leading or trailing slash: "first-light-call", "grant", "p/intro-week". */
export async function loadBookPath({ path, query }) {
  if (path === "manage") return loadManage({ query });
  let hit;
  try { hit = await bookApi.address(path); }
  catch (err) {
    // the practice switched online booking off: its own closed answer, not "this page isn't available" (F36)
    if (err instanceof BookError && err.code === "booking_closed") return { view: "closed", practice: err.detail?.practice ?? null };
    if (err instanceof BookError && err.status === 404 && !path.includes("/")) { try { return await legacyCoach(path, query); } catch { /* fall through */ } }
    return { problem: true, coachSlug: path, practice: await maybePractice() };  // the practice's name stays in the header
  }
  if (hit?.redirect) return { redirect: typeof hit.redirect === "string" && hit.redirect.startsWith("/book") ? hit.redirect : "/book" };
  const practice = await maybePractice();
  if (hit?.gone) return { view: "gone", practice, message: hit.message || "This page isn't available." };
  if (hit?.kind === "service") return { view: "service", practice, path, address: hit };
  if (hit?.kind === "person") return { view: "person", practice, path, address: hit };
  if (hit?.kind === "page") return { view: "page", practice, path, address: hit };
  return { problem: true, coachSlug: path };
}
