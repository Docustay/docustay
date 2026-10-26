// Not part of Docustay: src/booking/calendarConnect.mjs belongs to the other product built on this engine. The names stay so imports resolve; none of it runs.
const gone = (n) => () => { throw Object.assign(new Error(n + " is not available in Docustay"), { code: "not_in_docustay" }); };
export const signCalendarOAuthState = gone("signCalendarOAuthState");
export const verifyCalendarOAuthState = gone("verifyCalendarOAuthState");
export const googleClientCredentials = gone("googleClientCredentials");
export const microsoftClientCredentials = gone("microsoftClientCredentials");
export const buildGoogleAuthorizeUrl = gone("buildGoogleAuthorizeUrl");
export const buildMicrosoftAuthorizeUrl = gone("buildMicrosoftAuthorizeUrl");
export const exchangeGoogleCode = gone("exchangeGoogleCode");
export const exchangeMicrosoftCode = gone("exchangeMicrosoftCode");
export const connectGoogleConnection = gone("connectGoogleConnection");
export const connectMicrosoftConnection = gone("connectMicrosoftConnection");
export const listConnections = gone("listConnections");
export const disconnectConnection = gone("disconnectConnection");
export const setWatchedCalendars = gone("setWatchedCalendars");
export const setPushTarget = gone("setPushTarget");
export const setEventTitleMode = gone("setEventTitleMode");
