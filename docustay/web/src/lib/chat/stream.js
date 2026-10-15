// The browser end of the chat's server-sent events: POST, then read `event:`/`data:` frames as they arrive. Calls onEvent(ev) per frame; resolves when the stream ends.
export async function postStream(url, body, { onEvent, signal }) {
  let r;
  try { r = await fetch(url, { method: "POST", credentials: "same-origin", signal, headers: { "content-type": "application/json", accept: "text/event-stream", "idempotency-key": crypto.randomUUID?.() ?? String(Date.now()) }, body: JSON.stringify(body) }); }
  catch (e) { if (e?.name === "AbortError") return { aborted: true }; return { error: "network" }; }
  if (!r.ok || !r.body) { const j = await r.json().catch(() => null); return { error: j?.error?.message ?? "failed", status: r.status, code: j?.error?.detail?.code ?? null }; }
  const reader = r.body.getReader(), dec = new TextDecoder(); let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf("\n\n")) >= 0) { const frame = buf.slice(0, i); buf = buf.slice(i + 2); const d = frame.split("\n").find((l) => l.startsWith("data:")); if (d) { try { onEvent(JSON.parse(d.slice(5).trim())); } catch { /* a bad frame is skipped */ } } }
    }
  } catch (e) { if (e?.name === "AbortError") return { aborted: true }; return { error: "dropped" }; }
  return { ok: true };
}
