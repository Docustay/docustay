import { readFileSync } from "node:fs";

/** The release this install runs (R13-D301): KEYSTONE_VERSION when the operator sets one, else the version the public release stamped
 *  into package.json (scripts/publish-public.mjs). An unreleased build (0.0.0) has none. */
export function installVersion(env = process.env, pkgUrl = new URL("../../package.json", import.meta.url)) {
  if (env.KEYSTONE_VERSION) return env.KEYSTONE_VERSION;
  try { const v = JSON.parse(readFileSync(pkgUrl, "utf8")).version; return v && v !== "0.0.0" ? v : null; } catch { return null; }
}
