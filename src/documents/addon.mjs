// THE PRO ADD-ON SEAM (Operation Live 5.1.4). The open core never imports the closed Pro add-on; this file loads it when it is present and
// otherwise answers every Pro entry point with the same plain upgrade message.
//   hosted        — the monorepo's pro/ folder is loaded (the hosted service runs both).
//   self-hosted   — KEYSTONE_SELF_HOST=1: the add-on is the folder the key-checked download unpacked (DOCUSTAY_ADDON_DIR, default <data>/addon), and it
//                   counts ONLY while the install holds a Pro entitlement note that verifies (our signature, this install, not run out). When the note ends
//                   the install falls back to Community with nothing deleted; the note renews daily while the subscription does (up to 30 days offline).
//   DOCUSTAY_PRO_ADDON = a path or package name forces that add-on; "off" forces the Community build (tests use both).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createPublicKey, verify as edVerify } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AppError, ErrorKind } from "../http/errors.mjs";

const env = process.env;
const selfHost = env.KEYSTONE_SELF_HOST === "1";
const DATA = env.KEYSTONE_DATA_DIR || "/data";
const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const addonDir = () => env.DOCUSTAY_ADDON_DIR || path.join(DATA, "addon");

/** The install's Pro note: our signature, this install's id, not run out. Same format as product/docustayLicense.mjs (kept here so the island imports nothing outside). */
export function selfHostProNote(now = Date.now()) {
  try {
    const pem = env.DOCUSTAY_LICENSE_PUBLIC_KEY || [env.DOCUSTAY_LICENSE_PUBLIC_KEY_FILE, here("../../docustay/license-public.pem"), "/app/docustay/license-public.pem"].filter(Boolean).filter(existsSync).map((f) => readFileSync(f, "utf8"))[0];
    if (!pem) return { ok: false, reason: "no_public_key" };
    const { entitlement, signature } = JSON.parse(readFileSync(path.join(DATA, "entitlement.json"), "utf8"));
    if (!edVerify(null, Buffer.from(entitlement), createPublicKey(pem), Buffer.from(signature, "base64url"))) return { ok: false, reason: "bad_signature" };
    const note = JSON.parse(Buffer.from(entitlement, "base64url").toString("utf8"));
    const id = readFileSync(path.join(DATA, "install-id"), "utf8").trim();
    if (note.installId !== id) return { ok: false, reason: "other_install" };
    if (Date.parse(note.expiresAt) <= now) return { ok: false, reason: "expired" };
    return { ok: true, note };
  } catch { return { ok: false, reason: "no_note" }; }
}

let addon = null;
const forced = env.DOCUSTAY_PRO_ADDON;
const target = forced === "off" ? null
  : forced ? forced
  : selfHost ? (existsSync(path.join(addonDir(), "index.mjs")) ? path.join(addonDir(), "index.mjs") : null)
  : (existsSync(here("../../pro/index.mjs")) ? here("../../pro/index.mjs") : null);
const gated = selfHost && !forced;   // a self-hosted add-on counts only with a live note
// Not awaited at the top level: the add-on imports core modules that import this one, so waiting here would deadlock. Doors wait on `addonReady`.
export const addonReady = target
  ? import(target.startsWith("/") ? pathToFileURL(target).href : target).then((m) => { addon = m; }, (e) => { console.error("pro add-on failed to load:", e.message); })
  : Promise.resolve();
let seen = { at: 0, ok: false };
const live = () => { if (!gated) return true; const n = Date.now(); if (n - seen.at > 60_000) seen = { at: n, ok: selfHostProNote(n).ok }; return seen.ok; };
export const addonInstalled = () => addon !== null && live();
export const addonVersion = () => (addonInstalled() ? addon.ADDON_VERSION ?? null : null);
/** The add-on's module `ns`, or null on a Community build (or a self-hosted install whose Pro note has ended). */
export const proPart = (ns) => (addonInstalled() ? addon[ns] ?? null : null);
/** The one refusal a Community build gives for a Pro entry point. */
export const needsAddon = (item) => new AppError(ErrorKind.FORBIDDEN, "This is part of Docustay Pro. Install the Pro add-on with a valid Pro key to use it.", { detail: { code: "pro_addon_missing", item } });
