// src/mail/product.mjs — THE PRODUCT'S OWN DEFAULT SENDER AND THE ONE PLATFORM-ALERT ADDRESS. Pure (reads the environment it is given, nothing else), so health code and tests can inject `env`.
//   KEYSTONE_MAIL_SENDER      the product's default sending address (the platform: hello@example.com · Docustay: an address on docustay.app). KEYSTONE_EMAIL_FROM is read only as the OLD name of the same thing.
//   KEYSTONE_MAIL_ALERT_TO    where platform alerts go (health, worker watch, the daily summary, a failed lead form). KEYSTONE_ALERT_EMAIL is the old name.
//   KEYSTONE_PRODUCT          "docustay" for a Docustay deployment; anything else is the platform.
export class MailConfigError extends Error { constructor(m) { super(m); this.name = "MailConfigError"; } }
export const productName = (env = process.env) => (env.KEYSTONE_PRODUCT === "docustay" ? "Docustay" : "Workbench");
const bare = (from) => { const m = /<([^>]+)>/.exec(from ?? ""); return (m ? m[1] : from ?? "").trim(); };
/** Never defaulted: an unverified From is refused by the provider and reads as a delivery failure rather than as the configuration mistake it is. */
export function productSender(env = process.env) {
  const addr = bare(env.KEYSTONE_MAIL_SENDER || env.KEYSTONE_EMAIL_FROM);
  if (!addr.includes("@")) throw new MailConfigError("KEYSTONE_MAIL_SENDER is not set to an address, so there is nothing to send from (the old name KEYSTONE_EMAIL_FROM also works). It is NOT defaulted: an unverified from-address is rejected by the provider and presents as a delivery failure.");
  return { name: productName(env), address: addr };
}
export const platformAlertTo = (env = process.env) => env.KEYSTONE_MAIL_ALERT_TO || env.KEYSTONE_ALERT_EMAIL || null;

// ★ Part 29 (decision D1): the product is a property of the ORGANISATION (keystone.tenant.product), not only of the deployment. One backend serves the platform organisations and Docustay workspaces; each is mailed,
//   named and signed as its own product. `KEYSTONE_PRODUCT=docustay` (a self-hosted install) still makes every organisation there a Docustay one.
export const productKeyOf = (value, env = process.env) => (value === "docustay" || env.KEYSTONE_PRODUCT === "docustay" ? "docustay" : "workbench");
export const productNameFor = (key) => (key === "docustay" ? "Docustay" : "Workbench");
/** Docustay's own default sender: KEYSTONE_DOCUSTAY_MAIL_SENDER (hello@docustay.app). Never defaulted, never the platform's. A self-hosted install's one sender is KEYSTONE_MAIL_SENDER. */
export function productSenderFor(key, env = process.env) {
  if (key !== "docustay") return productSender(env);
  const addr = bare(env.KEYSTONE_DOCUSTAY_MAIL_SENDER || (env.KEYSTONE_PRODUCT === "docustay" ? (env.KEYSTONE_MAIL_SENDER || env.KEYSTONE_EMAIL_FROM) : ""));
  if (!addr.includes("@")) throw new MailConfigError("KEYSTONE_DOCUSTAY_MAIL_SENDER is not set to an address, so Docustay has nothing to send from. It is NOT defaulted to Workbench's address.");
  return { name: "Docustay", address: addr };
}
