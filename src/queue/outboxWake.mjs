// src/queue/outboxWake.mjs — run a practice's outbox dispatch the moment an event is emitted (B-1, Run 6).
// emit() (src/events/outbox.mjs) NOTIFYs `keystone_outbox` with the practice id inside its own transaction, so the notice only
// arrives after COMMIT. This listener (worker process only) turns each notice into one `dispatch_outbox` job for that practice,
// due now, under the same job key the once-a-minute sweep uses — so the two can never stack. The sweep stays as the backstop for a
// notice nobody heard (worker restarting, connection dropped).
import pg from "pg";
import { openEnqueuer, workerConnectionString } from "./runner.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function startOutboxWake({ connectionString, debounceMs = 150, log = console } = {}) {
  const cs = connectionString ?? workerConnectionString();
  const queue = await openEnqueuer({ connectionString: cs });
  const pending = new Map();   // tenantId -> timer
  let client = null, stopped = false, retry = null;

  const fire = async (tenantId) => {
    pending.delete(tenantId);
    try {
      await queue.add("dispatch_outbox", { tenantId },
        { jobKey: `dispatch_outbox:${tenantId}`, jobKeyMode: "replace", runAt: new Date(), priority: -12 });
    } catch (e) { log.error?.(`outbox wake: could not queue a dispatch for ${tenantId}: ${e.message} (the minute sweep will)`); }
  };
  const onNote = (msg) => {
    const id = String(msg.payload ?? "");
    if (!UUID.test(id) || pending.has(id)) return;   // a burst of events for one practice is one dispatch
    pending.set(id, setTimeout(() => fire(id), debounceMs));
  };
  const connect = async () => {
    if (stopped) return;
    const c = new pg.Client({ connectionString: cs });
    c.on("notification", onNote);
    const lost = () => { if (client === c) client = null; c.removeAllListeners(); c.end().catch(() => {}); if (!stopped) retry = setTimeout(connect, 2000); };
    c.on("error", lost); c.on("end", () => { if (client === c) lost(); });
    try { await c.connect(); await c.query("LISTEN keystone_outbox"); client = c; }
    catch (e) { log.error?.(`outbox wake: cannot listen (${e.message}); retrying`); lost(); }
  };
  await connect();
  return {
    async stop() {
      stopped = true; clearTimeout(retry);
      for (const t of pending.values()) clearTimeout(t);
      pending.clear();
      if (client) { const c = client; client = null; c.removeAllListeners(); await c.end().catch(() => {}); }
      await queue.release().catch(() => {});
    },
  };
}
