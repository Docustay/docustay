// Not part of Docustay: src/booking/reschedule.mjs belongs to the other product built on this engine. The names stay so imports resolve; none of it runs.
const gone = (n) => () => { throw Object.assign(new Error(n + " is not available in Docustay"), { code: "not_in_docustay" }); };
export const cancelBookingByRequest = gone("cancelBookingByRequest");
export const rescheduleBooking = gone("rescheduleBooking");
