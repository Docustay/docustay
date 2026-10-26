// Not part of Docustay: src/booking/calendarSync.mjs belongs to the other product built on this engine. The names stay so imports resolve; none of it runs.
const gone = (n) => () => { throw Object.assign(new Error(n + " is not available in Docustay"), { code: "not_in_docustay" }); };
export const findConnectionsNeedingRenewal = gone("findConnectionsNeedingRenewal");
export const findSilentlyBrokenConnections = gone("findSilentlyBrokenConnections");
export const renewChannel = gone("renewChannel");
export const applyRemoteEvent = gone("applyRemoteEvent");
export const handleSyncTokenGone = gone("handleSyncTokenGone");
export const recordSweep = gone("recordSweep");
export const calendarHealth = gone("calendarHealth");
export const platformCalendarHealth = gone("platformCalendarHealth");
export const listRemoteChanges = gone("listRemoteChanges");
export const acceptRemoteChange = gone("acceptRemoteChange");
export const rejectRemoteChange = gone("rejectRemoteChange");
export const CalendarSyncDegraded = gone("CalendarSyncDegraded");
export const GOOGLE_MAX_CHANNEL_SECONDS = gone("GOOGLE_MAX_CHANNEL_SECONDS");
export const RENEWAL_HEADROOM_MS = gone("RENEWAL_HEADROOM_MS");
