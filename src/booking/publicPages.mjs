// Not part of Docustay: src/booking/publicPages.mjs belongs to the other product built on this engine. The names stay so imports resolve; none of it runs.
const gone = (n) => () => { throw Object.assign(new Error(n + " is not available in Docustay"), { code: "not_in_docustay" }); };
export const eventDetails = gone("eventDetails");
export const pageScope = gone("pageScope");
export const publicServices = gone("publicServices");
export const practiceExtras = gone("practiceExtras");
export const serviceView = gone("serviceView");
export const addressView = gone("addressView");
export const GONE_SERVICE = "Not available online right now. Contact the practice.";
export const GONE_PAGE = "This page has moved.";
