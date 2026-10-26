// ONE PLACE that decides which Stripe account a product talks to (Part 1 of the Docustay launch plan, 13 Oct 2026).
//
// Docustay has its OWN Stripe account (its own keys, products, webhooks, Connect platform). the platform keeps the Docustay account. Before this file every Stripe call in the
// codebase read one variable, KEYSTONE_STRIPE_SECRET_KEY, so a Docustay purchase and a coaching payment went to the same account.
//
//   product "docustay"  -> KEYSTONE_DOCUSTAY_STRIPE_* when set; otherwise the shared KEYSTONE_STRIPE_* (so a server that has not been given Docustay's own keys — production
//                          until the switch, a self-hoster who brings their OWN Stripe keys — behaves exactly as before).
//   any other product   -> KEYSTONE_STRIPE_* exactly as before. the platform never reads a KEYSTONE_DOCUSTAY_STRIPE_* variable.
//
// Nothing here reads or returns a key unless asked, and nothing logs one.

/** the shared variable each Docustay one overrides (the code everywhere else already reads the shared name from an `env` object, so an overlay of it works for all of it) */
const DOCUSTAY_STRIPE_VARS = Object.freeze({
  KEYSTONE_STRIPE_SECRET_KEY: "KEYSTONE_DOCUSTAY_STRIPE_SECRET_KEY",
  KEYSTONE_STRIPE_PUBLISHABLE_KEY: "KEYSTONE_DOCUSTAY_STRIPE_PUBLISHABLE_KEY",
  STRIPE_WEBHOOK_SECRET: "KEYSTONE_DOCUSTAY_STRIPE_WEBHOOK_SECRET",
  STRIPE_LIVE_WEBHOOK_SECRET: "KEYSTONE_DOCUSTAY_STRIPE_WEBHOOK_SECRET",
  STRIPE_CONNECT_WEBHOOK_SECRET: "KEYSTONE_DOCUSTAY_STRIPE_CONNECT_WEBHOOK_SECRET",
  KEYSTONE_STRIPE_CONNECT_CLIENT_ID: "KEYSTONE_DOCUSTAY_STRIPE_CONNECT_CLIENT_ID",
});

/** vars that name the Docustay platform's own direct account: they never apply to a Docustay workspace once Docustay has its own account */
const FOUNDRY_ONLY = ["KEYSTONE_STRIPE_DIRECT_ACCOUNT_ID", "KEYSTONE_STRIPE_DIRECT_TENANT_SLUG"];

const present = (v) => typeof v === "string" && v.trim() !== "";

/** true when Docustay has been given its own Stripe account on this server */
export function hasDedicatedDocustayStripe(env = process.env) {
  return present(env.KEYSTONE_DOCUSTAY_STRIPE_SECRET_KEY);
}

/**
 * The environment a product's Stripe code should read. For Docustay with its own keys: a copy of `env` whose shared Stripe names carry Docustay's values (a Docustay name that
 * is unset leaves that value empty, never the Docustay one — the two accounts never mix). Everything else: `env` itself.
 */
export function stripeEnv(product, env = process.env) {
  if (product !== "docustay" || !hasDedicatedDocustayStripe(env)) return env;
  const out = { ...env };
  for (const [shared, own] of Object.entries(DOCUSTAY_STRIPE_VARS)) {
    if (present(env[own])) out[shared] = env[own]; else delete out[shared];
  }
  for (const g of FOUNDRY_ONLY) delete out[g];
  return out;
}

/** the secret key a product must use (undefined when none is set). Callers keep their own shape/live-key checks. */
export function stripeSecretFor(product, env = process.env) {
  const v = stripeEnv(product, env).KEYSTONE_STRIPE_SECRET_KEY;
  return present(v) ? v.trim() : undefined;
}

/** the publishable key a product's browser code must use */
export function stripePublishableFor(product, env = process.env) {
  const v = stripeEnv(product, env).KEYSTONE_STRIPE_PUBLISHABLE_KEY;
  return present(v) ? v.trim() : null;
}

/** which webhook signing secrets a product's endpoint accepts, most specific first (never a secret of the other product's account) */
export function webhookSecretsFor(product, env = process.env) {
  const e = stripeEnv(product, env);
  return [e.STRIPE_LIVE_WEBHOOK_SECRET, e.STRIPE_WEBHOOK_SECRET, e.STRIPE_CONNECT_WEBHOOK_SECRET].filter(present).map((s) => s.trim());
}

/** the product of a tenant (default workbench) */
export async function productOfTenant(tx, tenantId) {
  const { rows: [t] } = await tx.query(`SELECT product FROM keystone.tenant WHERE id = $1`, [tenantId]);
  return t?.product === "docustay" ? "docustay" : "mainstay";
}
