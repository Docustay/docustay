#!/usr/bin/env node
// docustay/selfhost/usage-ping.mjs — the anonymous usage ping of a self-hosted install (Part 29 A6). Once a day it sends: a random install id, the version, and five whole numbers. Never a document, name, email or address.
// Off switch: DOCUSTAY_TELEMETRY=off. Offline installs: Settings → "Download usage report" gives the same JSON. Also: with DOCUSTAY_LICENSE_KEY set, it renews the Pro entitlement note (kept in the data volume, valid up to 30 days offline).
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { verifyEntitlement, CHECK_EVERY_DAYS } from "../../src/product/docustayLicense.mjs";
import { installVersion } from "../../src/product/installVersion.mjs";

const env = process.env, DATA = env.KEYSTONE_DATA_DIR || "/data", HOME = (env.DOCUSTAY_HOME_URL || "https://docustay.app").replace(/\/+$/, "");
const started = Date.now();
mkdirSync(DATA, { recursive: true });
const idFile = path.join(DATA, "install-id");
export const installId = () => { if (!existsSync(idFile)) writeFileSync(idFile, randomUUID()); return readFileSync(idFile, "utf8").trim(); };

async function counts() {
  const c = new pg.Client({ connectionString: env.KEYSTONE_DB_SUPERUSER_URL, ssl: env.KEYSTONE_DB_SSL === "off" ? false : { rejectUnauthorized: false } });
  await c.connect();
  try {
    const n = async (sql) => Number((await c.query(sql)).rows[0].n);
    return { documentsSentThisMonth: await n(`SELECT count(*)::int n FROM keystone.document_instance WHERE sent_at >= date_trunc('month', now())`), documentsSigned: await n(`SELECT count(*)::int n FROM keystone.document_instance WHERE state='executed'`),
      workspaces: await n(`SELECT count(*)::int n FROM keystone.tenant`), users: await n(`SELECT count(*)::int n FROM keystone.app_user WHERE role='staff' AND archived_at IS NULL`), uptimeDays: Math.floor((Date.now() - started) / 86_400_000) };
  } finally { await c.end(); }
}
const post = (p, body) => fetch(`${HOME}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });

export async function once() {
  const id = installId();
  if (env.DOCUSTAY_TELEMETRY !== "off") { try { await post("/api/public/docustay/ping", { installId: id, version: installVersion(env), counts: await counts() }); } catch (e) { console.log("docustay: usage ping skipped:", e.message); } }
  if (env.DOCUSTAY_LICENSE_KEY) {
    // 21 Oct 2026 (the maintainer): the key is checked at install and then about once a month (CHECK_EVERY_DAYS); the held note lasts 60 days, so 30 days of grace remain if docustay.app cannot be reached.
    // Only the key, this install's anonymous id, the version and its role (DOCUSTAY_INSTANCE_ROLE=test for a test or staging copy) are sent. This never switches anything off by itself.
    const f = path.join(DATA, "entitlement.json");
    let due = true; try { const held = JSON.parse(readFileSync(f, "utf8")); const n = JSON.parse(Buffer.from(held.entitlement, "base64url").toString("utf8")); due = n.installId !== id || !(Date.now() - Date.parse(n.issuedAt) < CHECK_EVERY_DAYS * 86_400_000); } catch { /* no note yet: check now */ }
    if (due) try { const r = await post("/api/public/docustay/license", { key: env.DOCUSTAY_LICENSE_KEY, installId: id, version: installVersion(env), role: env.DOCUSTAY_INSTANCE_ROLE === "test" ? "test" : "production" }); if (r.ok) writeFileSync(f, JSON.stringify(await r.json())); else console.log("docustay: licence not accepted (" + r.status + ")"); } catch (e) { console.log("docustay: licence check skipped (" + (e?.message ?? e) + ")"); }
  }
}
if (import.meta.url === `file://${process.argv[1]}`) { await once(); setInterval(() => once().catch(() => {}), 86_400_000); }
export { verifyEntitlement };
