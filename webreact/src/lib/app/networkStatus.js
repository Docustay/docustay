// ═══════════════════════════════════════════════════════════════════════════════════════════════
// GLOBAL NETWORK STATUS — the "degraded, not broken" banner's state. Ported from
// webui/src/lib/app/networkStatus.svelte.js: same shape, `{ degraded: false }`, set by api.js when a
// fetch throws before a response and cleared on the next success. Now a framework-free store.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { createStore } from "./store.js";

export const networkStatus = createStore({ degraded: false });
