// The two QA sign-in accounts (migration 0550/0553; QUEUE F865). They are how the sandbox AND production are tested in a browser, so NOTHING may take them out of service:
// not offboarding, not a bulk stage change, not archive. F865 was exactly that — the QA admin was moved to `former`; QA sign-in still answered 200 (it filtered only on
// archived_at) and every request after it was refused ("no longer with this practice"). One constant, no migration; the three paths below consult it.
const QA_LOGIN_UIDS = Object.freeze(["qa-login-admin-foundry", "qa-login-client-foundry"]);
export const isQaLoginUid = (uid) => typeof uid === "string" && QA_LOGIN_UIDS.includes(uid);
export const QA_LOGIN_REFUSAL = "This is a QA sign-in account — it can't be removed from the team, paused, or archived.";
