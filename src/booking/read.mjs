// Not part of Docustay: src/booking/read.mjs belongs to the other product built on this engine. The names stay so imports resolve; none of it runs.
const gone = (n) => () => { throw Object.assign(new Error(n + " is not available in Docustay"), { code: "not_in_docustay" }); };
export const readSlots = gone("readSlots");
export const explainSlot = gone("explainSlot");
export const readSlotsForAnyHost = gone("readSlotsForAnyHost");
export const BUSY_STATES = gone("BUSY_STATES");
