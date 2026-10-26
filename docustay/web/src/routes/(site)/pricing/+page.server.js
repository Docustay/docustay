// Real prices when the billing system answers quickly, the defaults in plans.js when it does not: this page never says "loading" and never shows an empty plan.
import { viewPlans } from "$lib/site/plans.js";
const API = (process.env.DOCUSTAY_API_URL || "http://localhost:8080").replace(/\/+$/, "");
export async function load({ fetch }) {
  try { const r = await fetch(`${API}/api/public/docustay/plans`, { signal: AbortSignal.timeout(1500) }); if (r.ok) return { plans: viewPlans(await r.json()) }; } catch { /* defaults below */ }
  return { plans: viewPlans(null) };
}
