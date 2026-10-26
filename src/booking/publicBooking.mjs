// Not part of Docustay: src/booking/publicBooking.mjs belongs to the other product built on this engine. The names stay so imports resolve; none of it runs.
const gone = (n) => () => { throw Object.assign(new Error(n + " is not available in Docustay"), { code: "not_in_docustay" }); };
export const resolvePublicTenantId = gone("resolvePublicTenantId");
export const readPublicPractice = gone("readPublicPractice");
export const readPublicCoach = gone("readPublicCoach");
export const createPublicBooking = gone("createPublicBooking");
export const PUBLIC_BOOKING_REFUSED = gone("PUBLIC_BOOKING_REFUSED");
