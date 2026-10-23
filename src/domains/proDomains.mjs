// Door to the Pro add-on's own signing domain (Pro `own_signing_domain`). No add-on: no domains, and every writer refuses with the upgrade message.
import { proPart, needsAddon, addonReady } from "../documents/frontDoor.mjs";
const door = (name, fallback) => async (...a) => { await addonReady; const p = proPart("domains"); if (p) return p[name](...a); if (fallback) return fallback(...a); throw needsAddon("own_signing_domain"); };
export const listDomains = door("listDomains", async () => ({ domains: [], configured: false }));   // R13-D015: the route reads `.domains`; a bare [] (no Pro add-on loaded) made GET /api/domains throw a 500
export const liveHostname = door("liveHostname", async () => null);
export const addDomain = door("addDomain");
export const checkDomain = door("checkDomain");
export const removeDomain = door("removeDomain");
