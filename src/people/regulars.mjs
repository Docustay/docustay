// src/people/regulars.mjs — Stage 11 task 11.3: what "a regular" means (S11-OQ-3(a), RULED) and the
// two parameterised SQL fragments other prompt kinds share so the definition is written once.
// Imports nothing — these are string builders, not queries; nothing here touches a database.

// ★ RULED (S11-OQ-3(a)): a regular is someone who attended at least REGULAR_MIN_ATTENDED sessions
//   in the last REGULAR_WINDOW_DAYS days. DRIFT_DAYS is F01 §2.1's own "six weeks" — not invented
//   here, just named as a constant so no caller hand-writes 42.
export const REGULAR_MIN_ATTENDED = 3;
export const REGULAR_WINDOW_DAYS = 90;
export const DRIFT_DAYS = 42;

/** A parameterised SQL boolean: has `${userAlias}` attended `serviceParam` at least `minParam`
 *  times in the last `windowParam` days? `attended IS TRUE`, never `<> false` — the column is
 *  nullable with no default, so NULL is "nobody has said" and is not attendance
 *  (src/records/lists.mjs:227-236, M). */
export function regularOfServiceSql(userAlias, serviceParam, windowParam, minParam) {
  return `(SELECT count(*) FROM keystone.booking b JOIN keystone.booking_participant bp ON bp.booking_id = b.id WHERE bp.app_user_id = ${userAlias}.id AND b.service_id = ${serviceParam}::uuid AND bp.attended IS TRUE AND b.starts_at > now() - make_interval(days => ${windowParam}::int) AND b.starts_at <= now()) >= ${minParam}::int`;
}

/** The same boolean without the service predicate — for kinds like `clients_drifting` that ask
 *  "is this person a regular at all", not "a regular of this service". */
export function regularAnySql(userAlias, windowParam, minParam) {
  return `(SELECT count(*) FROM keystone.booking b JOIN keystone.booking_participant bp ON bp.booking_id = b.id WHERE bp.app_user_id = ${userAlias}.id AND bp.attended IS TRUE AND b.starts_at > now() - make_interval(days => ${windowParam}::int) AND b.starts_at <= now()) >= ${minParam}::int`;
}
