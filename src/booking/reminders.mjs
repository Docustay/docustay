// Not part of Docustay: src/booking/reminders.mjs belongs to the other product built on this engine. The names stay so imports resolve; none of it runs.
const gone = (n) => () => { throw Object.assign(new Error(n + " is not available in Docustay"), { code: "not_in_docustay" }); };
export const normalizeReminderOffsets = gone("normalizeReminderOffsets");
export const stillRemindable = gone("stillRemindable");
export const stillRemindableAtAll = gone("stillRemindableAtAll");
export const alreadyHappened = gone("alreadyHappened");
export const reminderRunAt = gone("reminderRunAt");
export const reminderRunAtFor = gone("reminderRunAtFor");
export const reminderFacts = gone("reminderFacts");
export const reminderRecipients = gone("reminderRecipients");
export const DEFAULT_REMINDER_MINUTES = 1440;
export const REMINDER_SETTING_KEY = "booking.reminder_minutes";
export const REMINDER_OFFSET_SETTING_KEY = "booking.reminder_offsets";
export const DEFAULT_REMINDER_OFFSETS = [];
export const reminderOffsetJobKey = gone("reminderOffsetJobKey");
export const reminderJobKey = gone("reminderJobKey");
