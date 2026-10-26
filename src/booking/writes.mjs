// Not part of Docustay: src/booking/writes.mjs belongs to the other product built on this engine. The names stay so imports resolve; none of it runs.
const gone = (n) => () => { throw Object.assign(new Error(n + " is not available in Docustay"), { code: "not_in_docustay" }); };
export const createAvailabilityRule = gone("createAvailabilityRule");
export const endAvailabilityRule = gone("endAvailabilityRule");
export const upsertDateOverride = gone("upsertDateOverride");
export const assertMayEditHost = gone("assertMayEditHost");
export const removeDateOverride = gone("removeDateOverride");
export const setHostDailyCap = gone("setHostDailyCap");
export const setBookingPolicy = gone("setBookingPolicy");
export const addBookingParticipant = gone("addBookingParticipant");
export const setAttendance = gone("setAttendance");
export const setBookingFlag = gone("setBookingFlag");
export const policyFor = gone("policyFor");
export const PARTICIPANT_PARTIES = gone("PARTICIPANT_PARTIES");
export const DAY_NAMES = gone("DAY_NAMES");
