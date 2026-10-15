// THE MANIFEST OF SETTINGS THE CODE REQUIRES (names only; no values ever appear here). Derived from the code's own throw sites ("X is not set"):
//   src/mail/product.mjs (both senders), src/email/resend.mjs (RESEND_API_KEY), src/auth/* (TOKEN_PEPPER, FIREBASE_PROJECT_ID), src/crypto (MASTER_KEY), src/health/index.mjs (DATABASE_URL).
// A "critical" entry that is missing FAILS /readyz on a deployed environment (so a deploy that lacks it never takes traffic); a "warn" entry is listed but does not fail.
// 9 Oct 2026: KEYSTONE_DOCUSTAY_MAIL_SENDER was missing from production and every Docustay email (sign-up code, signing request, reminder, signed copy) failed with a 500 until a customer hit it.
// anyOf = alternative names (the old name still works); skipWhen = a condition under which the setting is not needed.
// A self-hosted install (KEYSTONE_SELF_HOST=1, set by docustay/entrypoint.mjs) may send through its own mail server, domain or mailbox, chosen in Settings → Email after sign-in, so neither the provider key nor the default sender is required of it; the product itself says "Email isn't set up" until one is chosen (src/product/docustay.mjs).
export const REQUIRED_SETTINGS = Object.freeze([
  { anyOf: ["KEYSTONE_MAIL_SENDER", "KEYSTONE_EMAIL_FROM"], level: "critical", services: ["app", "worker"], skipWhen: (e) => e.KEYSTONE_SELF_HOST === "1", why: "the product's default sending address (Workbench mail, alerts)" },
  { anyOf: ["KEYSTONE_DOCUSTAY_MAIL_SENDER"], level: "critical", services: ["app", "worker"], skipWhen: (e) => e.KEYSTONE_PRODUCT === "docustay", why: "Docustay's sending address (sign-up code, signing request, reminder, signed copy); never defaulted to Workbench's" },
  { anyOf: ["RESEND_API_KEY"], level: "critical", services: ["app", "worker"], skipWhen: (e) => Boolean(e.KEYSTONE_MAIL_CAPTURE_SMTP) || e.KEYSTONE_SELF_HOST === "1", why: "the email provider key" },
  { anyOf: ["KEYSTONE_TOKEN_PEPPER"], level: "critical", services: ["app", "worker"], why: "links and codes are hashed with it" },
  { anyOf: ["KEYSTONE_MASTER_KEY"], level: "critical", services: ["app", "worker"], why: "seals stored secrets" },
  { anyOf: ["KEYSTONE_DATABASE_URL"], level: "critical", services: ["app"], why: "the database" },
  { anyOf: ["KEYSTONE_FIREBASE_PROJECT_ID"], level: "critical", services: ["app"], skipWhen: (e) => Boolean(e.KEYSTONE_LOCAL_AUTH), why: "sign-in identity" },
  { anyOf: ["KEYSTONE_MAIL_ALERT_TO", "KEYSTONE_ALERT_EMAIL"], level: "warn", services: ["app", "worker"], why: "where platform alerts go" },
  { anyOf: ["KEYSTONE_SIGNUP_URL"], level: "warn", services: ["app"], skipWhen: (e) => Boolean(e.KEYSTONE_LOCAL_AUTH), why: "the sign-up database role" },
  { anyOf: ["KEYSTONE_DOCUSTAY_SIGN_URL"], level: "warn", services: ["app", "worker"], why: "the host signing links point at" },
]);
const present = (e, name) => typeof e[name] === "string" && e[name].trim() !== "";
export function settingsReport(env = process.env, service = "app") {
  const missing = [], missingWarn = [], checked = [];
  for (const s of REQUIRED_SETTINGS) {
    if (!s.services.includes(service) || s.skipWhen?.(env)) continue;
    const ok = s.anyOf.some((n) => present(env, n));
    checked.push({ name: s.anyOf[0], ok });
    if (!ok) (s.level === "critical" ? missing : missingWarn).push(s.anyOf[0]);
  }
  return { missing, missingWarn, checked };
}
/** Only a deployed environment is held to the manifest; local runs and tests are not. */
export const holdsToManifest = (env = process.env) => ["production", "staging"].includes(env.KEYSTONE_ENVIRONMENT);
