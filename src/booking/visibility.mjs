// Not part of Docustay: src/booking/visibility.mjs belongs to the other product built on this engine. The names stay so imports resolve; none of it runs.
const gone = (n) => () => { throw Object.assign(new Error(n + " is not available in Docustay"), { code: "not_in_docustay" }); };
export const bookingSubject = gone("bookingSubject");
export const servicesForClient = gone("servicesForClient");
export const assertClientMayBook = gone("assertClientMayBook");
export const assertSubjectMayBook = gone("assertSubjectMayBook");
export const NOT_AVAILABLE = gone("NOT_AVAILABLE");
export const TEEN_WAITS = "Booking opens once consent is recorded. Until then, your parent books your sessions.";
