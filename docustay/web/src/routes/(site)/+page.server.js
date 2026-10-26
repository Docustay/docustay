// The home page shows the real prices when the billing system answers quickly, and sensible defaults when it does not (so the page is never empty).
import { viewPlans } from "$lib/site/plans.js";
const API = (process.env.DOCUSTAY_API_URL || "http://localhost:8080").replace(/\/+$/, "");
export async function load({ fetch }) {
  try { const r = await fetch(`${API}/api/public/docustay/plans`, { signal: AbortSignal.timeout(1500) }); if (r.ok) return { plans: viewPlans(await r.json()) }; } catch { /* defaults below */ }
  return { plans: viewPlans(null) };
}
