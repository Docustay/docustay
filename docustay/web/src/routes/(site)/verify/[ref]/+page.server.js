// R13-D285: the address printed on every certificate (and in its QR code) is /verify/<organisation>.<document>.<code>. The facts come from the app on the server, so the page is right in the first
// paint; the code is the credential, and a wrong one reads exactly like "no such document". Never cached: a document that is voided or archived must stop answering at once.
const API = (process.env.DOCUSTAY_API_URL || "http://localhost:8080").replace(/\/+$/, "");
export const prerender = false;
export async function load({ fetch, params, setHeaders }) {
  setHeaders({ "cache-control": "no-store" });
  try {
    const r = await fetch(`${API}/api/public/documents/verify-facts?ref=${encodeURIComponent(params.ref)}`, { signal: AbortSignal.timeout(5000) });
    if (r.ok) return { facts: await r.json(), problem: null };
    return { facts: null, problem: r.status === 404 ? "notfound" : "trouble" };
  } catch { return { facts: null, problem: "trouble" }; }
}
