// Not part of Docustay: src/booking/slots.mjs belongs to the other product built on this engine. The names stay so imports resolve; none of it runs.
const gone = (n) => () => { throw Object.assign(new Error(n + " is not available in Docustay"), { code: "not_in_docustay" }); };
export const zonedLocalToUtc = gone("zonedLocalToUtc");
export const wallClockIn = gone("wallClockIn");
export const localTimeString = gone("localTimeString");
export const dayOfWeekIn = gone("dayOfWeekIn");
export const intersectWindows = gone("intersectWindows");
export const generateSlots = gone("generateSlots");
export const explainStart = gone("explainStart");
