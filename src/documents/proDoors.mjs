// The core's doors to the Pro add-on's modules (bulk send). With the add-on present each is the real function; without it a
// reader returns "nothing" and every writer refuses with the upgrade message. Callers never import the add-on.
import { proPart, needsAddon, addonReady } from "./addon.mjs";

const refuse = (item) => () => { throw needsAddon(item); };
const door = (ns, name, item, fallback) => async (...a) => { await addonReady; const p = proPart(ns); return p ? p[name](...a) : fallback ? fallback(...a) : refuse(item)(); };

// ── bulk send (Pro `bulk_send`)
export const BULK_MAX_ROWS = 50;
export const bulkSend = door("bulk", "bulkSend", "bulk_send");
