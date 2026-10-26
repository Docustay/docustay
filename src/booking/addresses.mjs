// Not part of Docustay: src/booking/addresses.mjs belongs to the other product built on this engine. The names stay so imports resolve; none of it runs.
const gone = (n) => () => { throw Object.assign(new Error(n + " is not available in Docustay"), { code: "not_in_docustay" }); };
export const toAddress = gone("toAddress");
export const checkShape = gone("checkShape");
export const uniqueAddress = gone("uniqueAddress");
export const liveAddress = gone("liveAddress");
export const claimAddress = gone("claimAddress");
export const ensurePersonAddress = gone("ensurePersonAddress");
export const ensureServiceAddress = gone("ensureServiceAddress");
export const retireServiceAddress = gone("retireServiceAddress");
export const retirePersonAddress = gone("retirePersonAddress");
export const retirePageAddress = gone("retirePageAddress");
export const resolveAddress = gone("resolveAddress");
export const assertKind = gone("assertKind");
export const RESERVED = gone("RESERVED");
