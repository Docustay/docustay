// Not part of Docustay: src/booking/teamBooking.mjs belongs to the other product built on this engine. The names stay so imports resolve; none of it runs.
const gone = (n) => () => { throw Object.assign(new Error(n + " is not available in Docustay"), { code: "not_in_docustay" }); };
export const loadTeamService = gone("loadTeamService");
export const teamPool = gone("teamPool");
export const staffChoiceAllowed = gone("staffChoiceAllowed");
export const readTeamSlots = gone("readTeamSlots");
export const createTeamBooking = gone("createTeamBooking");
export const RULES = [];
export const firstNameOf = gone("firstNameOf");
export const referenceOf = gone("referenceOf");
