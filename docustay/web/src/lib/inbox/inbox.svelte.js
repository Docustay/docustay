// The inbox's shared state: ONE unread count for every bell on the page (the phone bar, the rail and the wide sidebar each show one), refreshed by ONE poller — every 60 s while the
// tab is visible, and at once when the live channel says a document or the plan changed. Started by the first bell that mounts and stopped when the last one goes.
import { api } from "$lib/api.js";
import { live } from "$lib/live.js";
export const inbox = $state({ unread: 0 });
let users = 0, timer = null, stopLive = null;
let flying = null, lastAt = 0;   // one request at a time, and not twice inside 1.5 s (a page load and the live channel's first events used to ask three times)
export function refreshCount(hard = false) { if (typeof document !== "undefined" && document.hidden) return Promise.resolve(); if (flying) return flying; if (!hard && Date.now() - lastAt < 1500) return Promise.resolve();
  flying = (async () => { const r = await api("/api/product/docustay/inbox?limit=1"); lastAt = Date.now(); if (r.ok) inbox.unread = (r.json?.data ?? r.json).unread ?? 0; })().finally(() => { flying = null; }); return flying; }
export function useCount() {
  users += 1;
  if (users === 1) { refreshCount(); timer = setInterval(() => refreshCount(true), 60000); stopLive = live(["documents", "billing"], () => refreshCount(true)); }
  return () => { users -= 1; if (users === 0) { clearInterval(timer); stopLive?.(); timer = null; stopLive = null; } };
}
