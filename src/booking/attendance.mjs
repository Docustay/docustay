// Not part of Docustay: src/booking/attendance.mjs belongs to the other product built on this engine. The names stay so imports resolve; none of it runs.
const gone = (n) => () => { throw Object.assign(new Error(n + " is not available in Docustay"), { code: "not_in_docustay" }); };
export const noShowChargePercent = gone("noShowChargePercent");
export const resolveNoShowCharge = gone("resolveNoShowCharge");
export const recordAttendance = gone("recordAttendance");
export const ATTENDANCE_OUTCOMES = [];
export const NO_SHOW_SETTING_KEY = "booking.no_show_charge_percent";
export const RULED_NO_SHOW_CHARGE_PERCENT = 50;
