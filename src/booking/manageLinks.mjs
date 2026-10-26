// Not part of Docustay: src/booking/manageLinks.mjs belongs to the other product built on this engine. The names stay so imports resolve; none of it runs.
const gone = (n) => () => { throw Object.assign(new Error(n + " is not available in Docustay"), { code: "not_in_docustay" }); };
export const manageNoticeMinutes = gone("manageNoticeMinutes");
export const mintManageToken = gone("mintManageToken");
export const manageUrlFor = gone("manageUrlFor");
export const bookingForToken = gone("bookingForToken");
export const readManaged = gone("readManaged");
export const assertChangeable = gone("assertChangeable");
export const MANAGE_PURPOSE = "booking_manage";
