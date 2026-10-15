// src/developer/keyGuard.mjs — WHAT HAPPENS WHEN A KEY IS USED (FP-F2/F3/F4, 7 Oct 2026): the address check, the "last used" note, and the expiry warning emails.
// ★ The three run INSIDE the tenant transaction of the call, after the key has resolved and before the route runs.
// ★ An address outside a key's allowlist is refused with the SAME 401 as any other bad credential, and the refusal is still logged (with the address) in the API-call log.
import { BlockList, isIP } from "node:net";
import { deliverAsOrganisation } from "../email/deliver.mjs";

const MAX_RANGES = 20;

/** One range, as typed: "203.0.113.7", "203.0.113.0/24", "2001:db8::/32". Returns { text, family, base, bits } or null. */
export function parseRange(raw) {
  const text = String(raw ?? "").trim();
  const [addr, len, extra] = text.split("/");
  if (extra !== undefined || !addr) return null;
  const family = isIP(addr);
  if (!family) return null;
  const max = family === 4 ? 32 : 128;
  const bits = len === undefined ? max : /^\d{1,3}$/.test(len) ? Number(len) : NaN;
  if (!Number.isInteger(bits) || bits < 0 || bits > max) return null;
  return { text: len === undefined ? addr : `${addr}/${bits}`, family, base: addr, bits };
}

/** A list typed by a person → the stored list. Throws a sentence naming the first bad entry. */
export function cleanAllowlist(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw new TypeError("the allowed addresses must be a list");
  if (list.length > MAX_RANGES) throw new TypeError(`at most ${MAX_RANGES} address ranges`);
  const out = [];
  for (const item of list) {
    if (String(item ?? "").trim() === "") continue;
    const r = parseRange(item);
    if (!r) throw new TypeError(`“${String(item).slice(0, 60)}” is not an address or a range like 203.0.113.0/24`);
    out.push(r.text);
  }
  return [...new Set(out)];
}

/** Is `ip` inside any range? An empty list means anywhere. An address that cannot be read is never allowed by a non-empty list. */
export function ipAllowed(ip, list) {
  if (!Array.isArray(list) || list.length === 0) return true;
  let addr = String(ip ?? "").trim();
  if (/^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(addr)) addr = addr.slice(7);
  const family = isIP(addr);
  if (!family) return false;
  const blocks = new BlockList();
  for (const text of list) { const r = parseRange(text); if (r) blocks.addSubnet(r.base, r.bits, r.family === 4 ? "ipv4" : "ipv6"); }
  return blocks.check(addr, family === 4 ? "ipv4" : "ipv6");
}

/** Which warning is due: 3 when 3 days or fewer remain, 14 when 14 or fewer, otherwise none; each only once. */
export function warningDue({ expiresAt, warned14, warned3, now = Date.now() }) {
  if (!expiresAt) return null;
  const days = (new Date(expiresAt).getTime() - now) / 86400000;
  if (days <= 0) return null;
  if (days <= 3 && !warned3) return 3;
  if (days <= 14 && days > 3 && !warned14 && !warned3) return 14;
  return null;
}

/**
 * Run for every authenticated call. Throws `refuse()` (the caller supplies the uniform 401) when the address is not allowed.
 * Notes the use, and sends the expiry warning to the person who made the key when one is due.
 */
export async function guardKeyUse(db, { tenantId, tokenId, ip, agent }, refuse) {
  if (!tokenId) return;
  const { rows: [k] } = await db.query(`SELECT * FROM keystone.api_token_gate($1)`, [tokenId]);
  if (!k) return;
  if (!ipAllowed(ip, k.ip_allowlist)) throw refuse();
  await db.query(`SELECT keystone.record_api_token_use($1, $2, $3)`, [tokenId, ip && isIP(String(ip)) ? String(ip) : null, agent ? String(agent) : null]);
  const stage = warningDue({ expiresAt: k.expires_at, warned14: k.warned_14_at, warned3: k.warned_3_at });
  if (!stage || !k.created_by) return;
  try {
    const { rows: [who] } = await db.query(`SELECT email FROM keystone.app_user WHERE id = $1`, [k.created_by]);
    if (!who?.email) return;
    const when = new Date(k.expires_at).toUTCString().slice(0, 16);
    await deliverAsOrganisation(db, { tenantId, to: who.email, subject: `Your API key “${k.name}” expires in ${stage === 3 ? "3 days" : "about 2 weeks"}`,
      text: `The API key “${k.name}” stops working on ${when}.\n\nTo keep your integration running, make a new key in Settings → Developers → API keys, switch your software to it, then revoke this one. Both keys work at the same time, so nothing has to stop while you change over.\n` });
    await db.query(`SELECT keystone.mark_api_token_warned($1, $2)`, [k.id, stage]);
  } catch { /* a warning that cannot be sent must never stop an API call; it is tried again on the next use */ }
}
