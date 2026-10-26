// Not part of Docustay: src/booking/blocks.mjs belongs to the other product built on this engine. The names stay so imports resolve; none of it runs.
const gone = (n) => () => { throw Object.assign(new Error(n + " is not available in Docustay"), { code: "not_in_docustay" }); };
export const addDaysISO = gone("addDaysISO");
export const expandBlock = gone("expandBlock");
export const createBlock = gone("createBlock");
export const stopBlock = gone("stopBlock");
export const skipBlockDay = gone("skipBlockDay");
