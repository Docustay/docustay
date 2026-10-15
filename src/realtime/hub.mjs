// src/realtime/hub.mjs — live screens. ONE long-lived Postgres connection LISTENs on `ks_change` (migration 0686: { t: tenant, k: kind }, no row data) and fans each message out to the open
// screens of that tenant only. Each app instance listens on its own, so it works with several instances behind Railway. Nothing here reads a table: a message only says "something of this kind changed".
import pg from "pg";
import { dbSsl } from "../db/ssl.mjs";

const subs = new Map();           // tenantId -> Set<(kind) => void>
let client = null, starting = null, stopped = false, retry = 1000;

async function connect() {
  const url = process.env.KEYSTONE_DATABASE_URL;
  if (!url) return;
  const c = new pg.Client({ connectionString: url, ssl: dbSsl(), application_name: "keystone-realtime" });
  c.on("notification", (m) => {
    if (m.channel !== "ks_change") return;
    let p; try { p = JSON.parse(m.payload); } catch { return; }
    const set = subs.get(p.t); if (!set) return;
    for (const fn of set) { try { fn(String(p.k)); } catch { /* one screen's failure never stops the others */ } }
  });
  const lost = () => { if (client === c) client = null; try { c.end().catch(() => {}); } catch { /* gone */ } if (!stopped && subs.size) setTimeout(ensure, Math.min(retry *= 2, 15000)); };
  c.on("error", lost); c.on("end", lost);
  await c.connect(); await c.query("LISTEN ks_change"); retry = 1000; client = c;
}
function ensure() { if (client || starting) return starting; starting = connect().catch(() => { if (!stopped && subs.size) setTimeout(ensure, Math.min(retry *= 2, 15000)); }).finally(() => { starting = null; }); return starting; }

/** Subscribe one screen of one tenant. Returns the unsubscribe function. */
function subscribe(tenantId, fn) {
  let set = subs.get(tenantId); if (!set) subs.set(tenantId, (set = new Set()));
  set.add(fn); ensure();
  return () => { set.delete(fn); if (!set.size) subs.delete(tenantId); };
}
const listenerCount = () => [...subs.values()].reduce((n, s) => n + s.size, 0);
async function stopRealtime() { stopped = true; subs.clear(); const c = client; client = null; if (c) await c.end().catch(() => {}); }

/** The streaming answer for one screen: `event: change` with { kind }, a comment every 20 s so proxies keep it open, a `ready` first so the screen knows it is connected. */
export function changeStream(tenantId, signal) {
  const enc = new TextEncoder(); let off = null, beat = null;
  const body = new ReadableStream({
    start(ctl) {
      const send = (s) => { try { ctl.enqueue(enc.encode(s)); } catch { /* closed */ } };
      const pending = new Set(); let timer = null;
      off = subscribe(tenantId, (k) => { pending.add(k); timer ??= setTimeout(() => { timer = null; for (const kind of pending) send(`event: change\ndata: ${JSON.stringify({ kind })}\n\n`); pending.clear(); }, 120); });
      beat = setInterval(() => send(": keep-alive\n\n"), 20000);
      send("retry: 3000\n\nevent: ready\ndata: {}\n\n");
      signal?.addEventListener("abort", () => { off?.(); clearInterval(beat); try { ctl.close(); } catch { /* closed */ } });
    },
    cancel() { off?.(); clearInterval(beat); },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } });
}
