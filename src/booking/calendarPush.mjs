// Not part of Docustay: src/booking/calendarPush.mjs belongs to the other product built on this engine. The names stay so imports resolve; none of it runs.
const gone = (n) => () => { throw Object.assign(new Error(n + " is not available in Docustay"), { code: "not_in_docustay" }); };
export const decidePairedEventAction = gone("decidePairedEventAction");
export const pushBookingCreated = gone("pushBookingCreated");
export const pushBookingRescheduled = gone("pushBookingRescheduled");
export const pushBookingCancelled = gone("pushBookingCancelled");
export const pushBookingCompleted = gone("pushBookingCompleted");
export const applyPairedEventLifecycle = gone("applyPairedEventLifecycle");
