// `docustay listen`: your laptop cannot be reached from the internet, so Docustay keeps the signed deliveries of a "relay" webhook and this command fetches them and POSTs each to your local server
// with the SAME headers, so the signature your code checks is the real one. Nothing is opened on your computer; it only makes outbound calls.
export async function forwardOne(event, target, { fetchImpl = fetch } = {}) {
  const t0 = Date.now();
  try {
    const res = await fetchImpl(target, { method: "POST", headers: event.headers, body: event.body, redirect: "manual", signal: AbortSignal.timeout(15000) });
    return { ok: res.ok, status: res.status, ms: Date.now() - t0 };
  } catch (e) { return { ok: false, status: null, ms: Date.now() - t0, error: e?.cause?.code || e?.name || "error" }; }
}
/** Poll until `signal` aborts. `onEvent(event, result)` is called for each. Returns when stopped. */
export async function listen({ docustay, webhookId, target, onEvent, onError, signal, fetchImpl, waitSeconds = 20, backoffMs = 3000 }) {
  let after;
  while (!signal?.aborted) {
    try {
      const page = await docustay.fetchRelayEvents(webhookId, { ...(after ? { after } : {}), wait: waitSeconds });
      for (const ev of page.events) {
        const result = target ? await forwardOne(ev, target, { fetchImpl }) : null;
        onEvent(ev, result); after = ev.id;
      }
      if (!page.events.length && page.cursor) after = page.cursor;
    } catch (e) {
      if (signal?.aborted) return;
      onError?.(e); await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
}
