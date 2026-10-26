// Not part of Docustay: src/booking/availabilityCache.mjs belongs to the other product built on this engine. The names stay so imports resolve; none of it runs.
const gone = (n) => () => { throw Object.assign(new Error(n + " is not available in Docustay"), { code: "not_in_docustay" }); };
export const readSlotsCached = gone("readSlotsCached");
export const readSlotsForAnyHostCached = gone("readSlotsForAnyHostCached");
export const CACHE_TTL_MS = gone("CACHE_TTL_MS");
