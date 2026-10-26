#!/usr/bin/env node
// docustay/selfhost/addon.mjs — fetch the Pro add-on with your Pro key. `node docustay/selfhost/addon.mjs pull` (also run by `docustay addon pull`).
// Sends your key and this install's id to docustay.app; a valid key for this install gets the bundle, which is checked against its digest and unpacked into <data>/addon. Restart the app afterwards.
// The add-on only counts while the install holds a live Pro note (the daily ping renews it); when the note ends the install is the Community build again and nothing is deleted.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, renameSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { installId } from "./usage-ping.mjs";

const env = process.env, DATA = env.KEYSTONE_DATA_DIR || "/data", HOME = (env.DOCUSTAY_HOME_URL || "https://docustay.app").replace(/\/+$/, "");
const DIR = env.DOCUSTAY_ADDON_DIR || path.join(DATA, "addon"), CORE = env.DOCUSTAY_CORE_SRC || path.resolve(import.meta.dirname, "../../src");

export async function pull({ version = null } = {}) {
  if (!env.DOCUSTAY_LICENSE_KEY) throw new Error("Set DOCUSTAY_LICENSE_KEY to your Pro key first.");
  const r = await fetch(`${HOME}/api/public/docustay/addon`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: env.DOCUSTAY_LICENSE_KEY, installId: installId(), version, role: env.DOCUSTAY_INSTANCE_ROLE === "test" ? "test" : "production" }), signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(r.status === 401 ? "That Pro key is not valid for this install." : `The add-on download failed (${r.status}).`);
  const bytes = Buffer.from(await r.arrayBuffer()), want = r.headers.get("x-addon-sha256");
  if (!want || createHash("sha256").update(bytes).digest("hex") !== want) throw new Error("The add-on download did not match its digest; nothing was installed.");
  const tmp = `${DIR}.new`; rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
  const tgz = path.join(tmp, "..", "addon.tgz"); writeFileSync(tgz, bytes);
  execFileSync("tar", ["-xzf", tgz, "-C", tmp]); rmSync(tgz, { force: true });
  symlinkSync(CORE, path.join(tmp, "core"));
  rmSync(DIR, { recursive: true, force: true }); renameSync(tmp, DIR);
  const v = JSON.parse(readFileSync(path.join(DIR, "package.json"), "utf8")).version;
  return { version: v, dir: DIR };
}
if (import.meta.url === `file://${process.argv[1]}` && process.argv[2] === "pull") {
  try { const r = await pull({ version: process.argv[3] ?? null }); console.log(`Pro add-on ${r.version} installed in ${r.dir}. Restart Docustay to use it.`); } catch (e) { console.error(e.message); process.exit(1); }
}
