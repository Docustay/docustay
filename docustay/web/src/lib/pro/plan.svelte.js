// THE PLAN, ONE COPY FOR EVERY SCREEN (Run 8): what this workspace's plan includes, read once from GET /api/product/docustay/status and refreshed when billing changes. Every Pro lock asks
// `entitled(item)` here, so the screen and the server read the same answer (the server's `entitlements` map). A workspace on no Docustay plan (self-hosted) has no map: nothing is locked.
// While the answer has not arrived nothing is shown as locked (no flash of locks), and the server still refuses whatever is not included.
import { api } from "$lib/api.js";
import { live } from "$lib/live.js";

/** Where Explore Pro goes (the maintainer): the website's Pro section and its pricing. The same address as the server's (src/documents/chat/pro.mjs EXPLORE_PRO_URL). */
export const EXPLORE_PRO_URL = "https://docustay.app/pricing#pro";

export const plan = $state({ data: null, loaded: false });
let inflight = null, watching = false;
let loadedAt = 0;
// `force` re-reads, but not when the plan was read less than 1.5 s ago (one screen mounting three panels asked three times); `hard` (a live change event) always re-reads
export function loadPlan({ force = false, hard = false } = {}) {
  if (inflight) return inflight;
  if (plan.loaded && !force) return Promise.resolve(plan.data);
  if (plan.loaded && force && !hard && Date.now() - loadedAt < 1500) return Promise.resolve(plan.data);
  inflight = (async () => { const r = await api("/api/product/docustay/status"); if (r.ok) plan.data = r.json?.data ?? r.json; plan.loaded = true; loadedAt = Date.now(); return plan.data; })().finally(() => { inflight = null; });
  if (!watching && typeof window !== "undefined") { watching = true; live(["billing", "settings", "templates"], () => loadPlan({ force: true, hard: true })); }
  return inflight;
}
/** true / false once known; null while it is not known yet. A workspace with no plan map (self-hosted, an organisation on no Docustay plan) is entitled to everything. */
export function entitled(item) {
  if (!plan.loaded) return null;
  const e = plan.data?.entitlements;
  if (!e) return true;
  if (item === "unlimited_templates") { const u = plan.data?.usage; return u?.templatesLimit == null || (u.templatesThisMonth ?? 0) < u.templatesLimit; }   // locked only once this month's new templates are used
  return e[item] !== false;
}
/** On the Free plan (a hosted workspace that can upgrade). */
export const onFree = () => Boolean(plan.data?.plan && plan.data.plan.key === "docustay_free");
