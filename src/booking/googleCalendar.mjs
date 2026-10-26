// Not part of Docustay: src/booking/googleCalendar.mjs belongs to the other product built on this engine. The names stay so imports resolve; none of it runs.
const gone = (n) => () => { throw Object.assign(new Error(n + " is not available in Docustay"), { code: "not_in_docustay" }); };
export const googleConnectionsFor = gone("googleConnectionsFor");
export const syncCalendarList = gone("syncCalendarList");
export const syncCalendarListsForHost = gone("syncCalendarListsForHost");
export const sweepCalendarLists = gone("sweepCalendarLists");
export const busyForHost = gone("busyForHost");
export const overlapsBusy = gone("overlapsBusy");
export const insertEvent = gone("insertEvent");
export const patchEvent = gone("patchEvent");
export const deleteEvent = gone("deleteEvent");
export const __caches = {};
export const LIST_REFRESH_MS = gone("LIST_REFRESH_MS");
