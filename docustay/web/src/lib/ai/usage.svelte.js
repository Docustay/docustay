// The AI usage numbers, one copy for the settings card, and the Scribe footer: GET /api/documents/ai/usage (the allowance, what is used, when it resets, by kind of work).
import { api } from "$lib/api.js";
export const aiUsage = $state({ data: null, loaded: false });
let inflight = null;
export async function loadAiUsage() {
  if (inflight) return inflight;
  inflight = (async () => { const r = await api("/api/documents/ai/usage"); if (r.ok) aiUsage.data = r.json?.data ?? r.json; aiUsage.loaded = true; })().finally(() => { inflight = null; });
  return inflight;
}
