// Live screens. ONE stream per browser tab (GET /api/realtime, server-sent events); every screen says which kinds of change it cares about and how to reload, and hears about them within a
// fraction of a second — from this tab, another tab, another person on the team, the API or a webhook. Kinds: settings templates documents people plays team keys webhooks email apilog billing.
// A reload never lands on someone who is typing: it waits until they leave the field. After a dropped connection (or a laptop waking up) every screen reloads once to catch up.
const subs = new Set();           // { kinds:Set|null, run }
let es = null, up = false, closeTimer = null;

// "typing" = a text field the person has actually changed and not left yet. A field that merely has focus (a page that focuses its first input) never blocks a reload.
let edited = null;
if (typeof document !== "undefined") { document.addEventListener("input", (e) => { edited = e.target; }, true); document.addEventListener("focusout", (e) => { if (edited === e.target) edited = null; }, true); }
const typing = () => typeof document !== "undefined" && !!edited && document.activeElement === edited && edited.isConnected;

function fire(kind) {
  for (const s of subs) if (kind === "*" || !s.kinds || s.kinds.has(kind)) s.poke();
}
function open() {
  if (es || typeof EventSource === "undefined") return;
  clearTimeout(closeTimer);
  es = new EventSource("/api/realtime", { withCredentials: true });
  es.addEventListener("ready", () => { if (up === false && es.__seen) fire("*"); up = true; es.__seen = true; });
  es.addEventListener("change", (e) => { try { fire(JSON.parse(e.data).kind); } catch { /* ignore */ } });
  es.onerror = () => { up = false; };   // the browser reconnects on its own; "ready" then reloads everything once
}
function maybeClose() { if (!subs.size && es) closeTimer = setTimeout(() => { if (!subs.size) { es?.close(); es = null; up = false; } }, 2000); }

if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && subs.size) fire("*"); });

/** live(["settings"], load) → stop(). Call inside onMount (return the stop function) or an $effect. */
export function live(kinds, reload, { wait = 200 } = {}) {
  let timer = null, blocked = false;
  const go = () => {
    if (typing()) { if (!blocked) { blocked = true; addEventListener("focusout", () => { blocked = false; setTimeout(go, 150); }, { once: true, capture: true }); } return; }
    Promise.resolve().then(reload).catch(() => {});
  };
  const s = { kinds: kinds ? new Set(kinds) : null, poke: () => { clearTimeout(timer); timer = setTimeout(go, wait); } };
  subs.add(s); open();
  return () => { clearTimeout(timer); subs.delete(s); maybeClose(); };
}
