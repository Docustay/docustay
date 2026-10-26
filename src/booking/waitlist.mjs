// Not part of Docustay: src/booking/waitlist.mjs belongs to the other product built on this engine. The names stay so imports resolve; none of it runs.
const gone = (n) => () => { throw Object.assign(new Error(n + " is not available in Docustay"), { code: "not_in_docustay" }); };
export const preferenceMatches = gone("preferenceMatches");
export const addToWaitlist = gone("addToWaitlist");
export const recordDemand = gone("recordDemand");
export const removeFromWaitlist = gone("removeFromWaitlist");
export const offerFreedSlot = gone("offerFreedSlot");
export const offerTime = gone("offerTime");
export const peekOffer = gone("peekOffer");
export const claimOffer = gone("claimOffer");
export const declineOffer = gone("declineOffer");
export const PREFERENCES = [];
