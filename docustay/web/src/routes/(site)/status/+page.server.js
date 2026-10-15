// The live component status, fetched on the server so the page is correct in the first paint. If the API cannot be reached, that IS the news: say so, never "all good".
import { INCIDENTS } from "$lib/site/incidents.js";
const API = (process.env.DOCUSTAY_API_URL || "http://localhost:8080").replace(/\/+$/, "");
export const prerender = false;
export async function load({ fetch, setHeaders }) {
  setHeaders({ "cache-control": "public, max-age=15" });
  try {
    const r = await fetch(`${API}/api/public/status`, { signal: AbortSignal.timeout(3000) });
    if (r.ok) return { live: await r.json(), incidents: INCIDENTS };
  } catch { /* below */ }
  return { live: { status: "unreachable", checkedAt: new Date().toISOString(), components: [{ key: "api", name: "App and API", status: "unreachable" }] }, incidents: INCIDENTS };
}
