// Not part of Docustay: src/email/bookingEmailFacts.mjs belongs to the other product built on this engine. The names stay so imports resolve; none of it runs.
const gone = (n) => () => { throw Object.assign(new Error(n + " is not available in Docustay"), { code: "not_in_docustay" }); };
export const reminderChannelsFor = gone("reminderChannelsFor");
export const deliverableChannels = gone("deliverableChannels");
export const noticeText = gone("noticeText");
export const manageLinkAllowed = gone("manageLinkAllowed");
export const resolveBookingEmailFacts = gone("resolveBookingEmailFacts");
export const BOOKING_EMAIL_TOPICS = gone("BOOKING_EMAIL_TOPICS");
export const HOST_TEMPLATE_FOR = {};
export const DEFAULT_REMINDER_CHANNELS = [];
