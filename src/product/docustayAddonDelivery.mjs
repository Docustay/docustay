// Delivery of the closed Pro add-on (Operation Live 5.1.4). A self-hosted install presents its Pro key and its own install id; only a key that passes the SAME check as the licence
// route (known, not revoked, not expired, bound to this install) gets the add-on bundle, read from the private bucket. Every bad key gets the licence route's one plain refusal.
import { checkLicense } from "./docustayLicense.mjs";
import { getObject } from "../storage/s3.mjs";
import { dependency, notFound } from "../http/errors.mjs";

const SAFE_VERSION = /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/;
export const addonObjectKey = (version) => (version ? `_platform_addon/docustay-pro-${version}.tgz` : "_platform_addon/docustay-pro-latest.tgz");

/** @returns {{ body: Buffer, sha256: string, entitlement: object }} */
/** The add-on lives in its OWN private bucket when KEYSTONE_ADDON_S3_{ENDPOINT,BUCKET,ACCESS_KEY_ID,SECRET_ACCESS_KEY[,REGION]} are set (a Railway Bucket, so no customer file and no add-on share a store); otherwise in the app's own store. */
export function addonStoreEnv(env = process.env) {
  if (!env.KEYSTONE_ADDON_S3_ENDPOINT) return env;
  const o = { ...env };
  for (const k of ["ENDPOINT", "BUCKET", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY", "REGION"]) if (env[`KEYSTONE_ADDON_S3_${k}`] !== undefined) o[`KEYSTONE_S3_${k}`] = env[`KEYSTONE_ADDON_S3_${k}`];
  return o;
}

export async function deliverAddon(tx, { tenantId, key, installId, version = null, role = "production" }, { get = (a) => getObject(a, { env: addonStoreEnv() }) } = {}) {
  const entitlement = await checkLicense(tx, { tenantId, key, installId, role, version });   // throws the one plain refusal for a bad key
  if (version !== null && !SAFE_VERSION.test(String(version))) throw notFound("that add-on version does not exist");
  const r = await get({ key: addonObjectKey(version) });
  if (!r.ok) { if (r.status === 404) throw notFound("that add-on version does not exist"); throw dependency("the add-on store did not answer", new Error(String(r.error ?? r.status))); }
  return { body: r.body, sha256: r.sha256, entitlement };
}
