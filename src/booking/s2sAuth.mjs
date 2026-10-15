// @ts-check
// src/booking/s2sAuth.mjs — THE SIGNED SERVER-TO-SERVER CREDENTIAL for a practice's own website (6 Oct 2026).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ WHAT THIS PROVES, AND WHAT IT DELIBERATELY DOES NOT. A practice's website server cannot answer Cloudflare
//     Turnstile (there is no browser). This replaces that one check, for that one caller, with a signature the
//     practice's own the platform holds a key for. It proves "this request was made by someone holding practice P's key".
//     It does NOT choose the tenant: the tenant is the one the Host header resolved (src/routes/publicBookingS2S.mjs),
//     exactly as on every other public door, and the key is DERIVED FOR THAT TENANT — so a key issued for practice A,
//     sent to practice B's host, fails verification. There is no code path in which a signature selects, widens or
//     switches a tenant.
//
// ★★ WHY DERIVED, NOT STORED. key(tenant, epoch) = HMAC-SHA256(KEYSTONE_PUBLIC_API_MASTER, "public-api:v1:<tenant>:<epoch>").
//    Nothing secret is written to the database; an Owner/Admin reads or rotates it on a screen (rotate = bump the
//    practice setting `booking.api_key_epoch`); rotating the master revokes every practice at once. A leaked key opens
//    exactly one practice's public booking door, which is what a visitor can already do through that practice's browser page.
//
// ★ CANONICAL STRING (newline separated): "v1", unix seconds, METHOD, path+query as sent, sha256(body) hex, visitor ip or "".
//   Headers: X-the platform-Timestamp, X-the platform-Signature: "v1=<hex>". The visitor ip is part of what is signed, so no one can
//   choose their own rate-limit bucket by adding a header.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { createHmac, createHash, timingSafeEqual } from "node:crypto";

const MAX_SKEW_SECONDS = 300;
export const MASTER_VAR = "KEYSTONE_PUBLIC_API_MASTER";

/** @param {NodeJS.ProcessEnv} [env] */
function master(env = process.env) {
  const m = env[MASTER_VAR];
  if (!m || m.length < 32) return null; // unset or too short: the credential door is simply closed
  return m;
}

/** The practice's key. `null` when the master is not configured (the door stays shut). */
export function deriveTenantKey(tenantId, epoch = 1, env = process.env) {
  const m = master(env);
  if (!m || !tenantId) return null;
  const raw = createHmac("sha256", m).update(`public-api:v1:${tenantId}:${Number(epoch) || 1}`, "utf8").digest("base64url");
  return `msk_${raw}`;
}

const sha256hex = (/** @type {string|Uint8Array} */ s) => createHash("sha256").update(s).digest("hex");

function canonicalString({ timestamp, method, pathAndQuery, bodyHash, visitorIp }) {
  return ["v1", String(timestamp), String(method).toUpperCase(), pathAndQuery, bodyHash, visitorIp ?? ""].join("\n");
}

/** What a caller sends. Exported so the website's adapter and the tests sign the same way the server verifies. */
export function signRequest(key, { method, pathAndQuery, body = "", visitorIp = "", timestamp = Math.floor(Date.now() / 1000) }) {
  const sig = createHmac("sha256", key).update(canonicalString({ timestamp, method, pathAndQuery, bodyHash: sha256hex(body), visitorIp }), "utf8").digest("hex");
  return { "x-workbench-timestamp": String(timestamp), "x-workbench-signature": `v1=${sig}`, ...(visitorIp ? { "x-visitor-ip": visitorIp } : {}) };
}

/**
 * Verify. Returns `{ ok: true, visitorIp }` or `{ ok: false }` — NEVER a reason (every refusal is the same to the caller).
 * @param {{ tenantId: string, epoch: number, method: string, pathAndQuery: string, rawBody: string, timestampHeader?: string|null, signatureHeader?: string|null, visitorIpHeader?: string|null, now?: number, env?: NodeJS.ProcessEnv }} a
 */
export function verifyRequest({ tenantId, epoch, method, pathAndQuery, rawBody, timestampHeader, signatureHeader, visitorIpHeader, now = Date.now(), env = process.env }) {
  const key = deriveTenantKey(tenantId, epoch, env);
  if (!key) return { ok: false };
  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts) || !/^\d{9,12}$/.test(String(timestampHeader ?? ""))) return { ok: false };
  if (Math.abs(now / 1000 - ts) > MAX_SKEW_SECONDS) return { ok: false };
  const m = /^v1=([0-9a-f]{64})$/.exec(String(signatureHeader ?? ""));
  if (!m) return { ok: false };
  const visitorIp = (visitorIpHeader ?? "").trim();
  const expected = createHmac("sha256", key).update(canonicalString({ timestamp: ts, method, pathAndQuery, bodyHash: sha256hex(rawBody ?? ""), visitorIp }), "utf8").digest();
  const given = Buffer.from(m[1], "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false };
  return { ok: true, visitorIp: visitorIp || null };
}
