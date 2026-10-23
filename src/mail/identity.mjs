// src/mail/identity.mjs — WHO AN ORGANISATION'S EMAIL COMES FROM. One identity per organisation, resolved the same way for every email family.
//   platform  "<Org> via <Product>" from the product's default sender; replies go to the organisation's reply-to          (default; always works)
//   domain    from the organisation's OWN domain once Resend shows it VERIFIED; until then falls back to platform and says so
//   smtp      sent by the module itself through the organisation's own mail server (the password is a sealed envelope)
//   (purposes) default · auth (fixed product address, shown "<Org> via <Product>") · platform (fixed product sender, no organisation name: platform alerts)
//   mailbox   the organisation connected its own Google or Microsoft mailbox (src/mail/mailbox.mjs): sent through the Gmail API or Microsoft Graph as that address; if the connection stops working it falls back to platform, says why, and the fallback is COUNTED (noteFallback)
// State (what the screen shows): not_configured · ok · pending_dns · failed · limit_reached. Fixed-sender mail (sign-in, password, platform alerts) never uses an organisation's identity.
import { ports } from "./ports.mjs";
import { mailboxRow, PROVIDERS } from "./mailbox.mjs";
import { staticHostProblem } from "./destination.mjs";

const SMTP_SECRET = "smtp_password";
const DEFAULTS = Object.freeze({ mode: "platform", from_name: "", from_address: "", reply_to: "", smtp_host: "", smtp_port: 587, smtp_user: "", smtp_security: "starttls", daily_limit: null });

// ★ Run 8 (F960): each read names the workspace as well as relying on row-level security, so a caller that is not under it (a superuser, a privileged job) still gets THIS workspace's identity, never the first row of anyone's
export async function identityRow(tx) {
  const { rows } = await tx.query(`SELECT * FROM keystone.mail_identity WHERE tenant_id = keystone.current_tenant_id() LIMIT 1`);
  return rows[0] ?? { ...DEFAULTS };
}
export async function domainRow(tx) {
  const { rows } = await tx.query(`SELECT * FROM keystone.mail_domain WHERE tenant_id = keystone.current_tenant_id() LIMIT 1`);
  return rows[0] ?? null;
}
export async function secretRow(tx, name = SMTP_SECRET) {
  const { rows } = await tx.query(`SELECT secret_envelope, kek_version, secret_fingerprint, updated_at FROM keystone.mail_secret WHERE tenant_id = keystone.current_tenant_id() AND name = $1`, [name]);
  return rows[0] ?? null;
}

/** The identity the next email is sent with — never contains a secret. `mode` is what will really happen, `requested` what was asked for (they differ until a domain is verified). */
export async function resolveIdentity(tx, { tenantId, purpose = "default", product: forProduct = null }) {
  const P = await ports();
  const row = await identityRow(tx);
  const brand = await P.brand.get(tx, { tenantId });
  const orgName = brand.orgName || "";
  const product = await P.product(tx, { tenantId, product: forProduct });
  const base = { requested: row.mode, orgName, fromName: row.from_name || orgName, fromAddress: row.from_address || null, replyTo: row.reply_to || null, product: product.name, platform: product.sender };
  // sign-in and password mail: the product's own address (never an organisation's domain or server, so a broken sender can never lock anyone out), shown "<Org> via <Product>" so the person knows who it is for
  if (purpose === "auth") return { ...base, mode: "platform", fixed: true, smtp: null, fallbackReason: null, fromName: orgName ? `${orgName} via ${product.name}` : product.name, fromAddress: product.sender.address, replyTo: null };
  if (purpose === "platform") return { ...base, mode: "platform", fixed: true, smtp: null, fallbackReason: null, fromName: product.sender.name, fromAddress: product.sender.address, replyTo: null };
  // Docustay v1 item 9: the HOSTED service sends from Docustay's own address ("<Org> via Docustay", replies to the workspace's reply-to). A sending domain, SMTP server or mailbox saved earlier is kept in the tables but not used.
  // A self-hosted Docustay install keeps all three.
  if (product.name === "Docustay" && process.env.KEYSTONE_SELF_HOST !== "1") return { ...base, requested: "platform", mode: "platform", smtp: null, fallbackReason: null };
  if (row.mode === "domain") {
    const d = await domainRow(tx);
    if (d?.status === "verified" && base.fromAddress && base.fromAddress.toLowerCase().endsWith(`@${d.domain}`)) return { ...base, mode: "domain", smtp: null, fallbackReason: null };
    return { ...base, mode: "platform", smtp: null, fallbackReason: !d ? "No sending domain has been added yet — sending from the platform address." : d.status !== "verified" ? "Your domain is not verified yet — sending from the platform address until it is." : "The From address is not on your verified domain — sending from the platform address." };
  }
  if (row.mode === "smtp") {
    // D-054: a login is only needed when a user name is set — an internal relay with no login works without a password
    const ok = row.smtp_host && base.fromAddress && (!row.smtp_user || await secretRow(tx));
    if (ok) return { ...base, mode: "smtp", smtp: { host: row.smtp_host, port: row.smtp_port, user: row.smtp_user || null, security: row.smtp_security }, fallbackReason: null };
    return { ...base, mode: "platform", smtp: null, fallbackReason: "Your SMTP server is not fully set up (server and From address, and a password when you set a user name) — sending from the platform address." };
  }
  if (row.mode === "mailbox") {
    const mb = await mailboxRow(tx);
    if (mb && mb.status === "connected") return { ...base, mode: "mailbox", smtp: null, mailbox: { provider: mb.provider, email: mb.email, displayName: mb.display_name }, fromAddress: mb.email, fromName: row.from_name || mb.display_name || orgName, fallbackReason: null };
    return { ...base, mode: "platform", smtp: null, mailbox: mb?.email ?? null, fallbackReason: mb ? `Your ${PROVIDERS[mb.provider].label} mailbox (${mb.email}) needs to be connected again — sending from the platform address until it is.` : "No mailbox is connected — sending from the platform address." };
  }
  return { ...base, mode: "platform", smtp: null, fallbackReason: null };
}

/** The From line and Reply-To for an identity, as a provider wants them. */
export function fromLine(identity) {
  const q = (n) => String(n).replace(/["\\<>\r\n]/g, "").trim();   // a trailing backslash would escape the closing quote of the display name, and < > would open a second address (T-16)
  if (identity.fixed) return { from: `"${q(identity.fromName)}" <${identity.fromAddress}>`, replyTo: null };
  if ((identity.mode === "domain" || identity.mode === "smtp" || identity.mode === "mailbox") && identity.fromAddress) return { from: `"${q(identity.fromName || identity.orgName)}" <${identity.fromAddress}>`, replyTo: identity.replyTo };
  return { from: `"${q(identity.fromName || identity.orgName || identity.product)} via ${q(identity.product)}" <${identity.platform.address}>`, replyTo: identity.replyTo };
}

const KEYS = { "email.provider": "mode", "email.from_name": "from_name", "email.from_address": "from_address", "email.reply_to": "reply_to", "email.smtp_host": "smtp_host", "email.smtp_port": "smtp_port", "email.smtp_user": "smtp_user", "email.smtp_security": "smtp_security" };
/** The organisation chose its own sender and this mail went out from the platform address instead: remember when, why and how often, so the settings screen can say so. Never silent. */
export async function noteFallback(tx, { tenantId, reason }) {
  if (!reason) return;
  await tx.query(`INSERT INTO keystone.mail_identity (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`, [tenantId]);
  await tx.query(`UPDATE keystone.mail_identity SET fallback_at = now(), fallback_reason = $2, fallback_count = fallback_count + 1 WHERE tenant_id = $1`, [tenantId, String(reason).slice(0, 400)]);
}

export const isIdentitySettingKey = (k) => Object.hasOwn(KEYS, k);
/** The identity's fields under the setting names the Documents screen already uses. */
export async function identitySettings(tx) {
  const r = await identityRow(tx);
  return Object.fromEntries(Object.entries(KEYS).map(([k, c]) => [k, r[c]]));
}
export async function setIdentitySetting(tx, { tenantId, key, value, updatedBy = null }) {
  const col = KEYS[key];
  if (!col) throw new Error(`not a mail identity setting: ${key}`);
  const prev = (await identitySettings(tx))[key];
  await tx.query(`INSERT INTO keystone.mail_identity (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`, [tenantId]);
  await tx.query(`UPDATE keystone.mail_identity SET ${col} = $2, updated_by = $3, updated_at = now() WHERE tenant_id = $1`, [tenantId, value, updatedBy]);
  return { key, value, changed: prev !== value };
}
export async function setDailyLimit(tx, { tenantId, limit, updatedBy = null }) {
  if (limit !== null && (!Number.isInteger(limit) || limit < 0)) throw new Error("the daily limit must be a whole number, or null for the default");
  await tx.query(`INSERT INTO keystone.mail_identity (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`, [tenantId]);
  await tx.query(`UPDATE keystone.mail_identity SET daily_limit = $2, updated_by = $3, updated_at = now() WHERE tenant_id = $1`, [tenantId, limit, updatedBy]);
}
export { SMTP_SECRET };

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
/** Change several identity fields at once. Every field is checked by name; nothing is saved unless all are valid. `dailyLimit: null` returns to the product default. */
export async function saveIdentity(tx, { tenantId, fields, updatedBy = null, invalid }) {
  const bad = (field, msg) => { throw invalid(msg, { field }); };
  const out = {};
  const f = fields ?? {};
  if (f.mode !== undefined) { if (!["platform", "domain", "smtp", "mailbox"].includes(f.mode)) bad("mode", "Choose platform, your own domain, your mail server, or your connected mailbox"); out.mode = f.mode; }
  for (const [k, col, max] of [["fromName", "from_name", 120], ["smtpHost", "smtp_host", 253], ["smtpUser", "smtp_user", 254]]) if (f[k] !== undefined) { if (typeof f[k] !== "string" || f[k].length > max) bad(k, `${k} must be text of at most ${max} characters`); out[col] = f[k].trim(); }
  for (const [k, col] of [["fromAddress", "from_address"], ["replyTo", "reply_to"]]) if (f[k] !== undefined) { if (typeof f[k] !== "string" || (f[k].trim() !== "" && !EMAIL.test(f[k].trim()))) bad(k, "Enter an email address like name@yourdomain.com"); out[col] = f[k].trim(); }
  // ★ S-4 (security audit run 5, 10 Oct 2026): the server connects to this host on the organisation's behalf, so a private or internal one cannot be saved.
  //   (An empty host means "not set". The name is resolved and judged again, and the connection pinned to the judged address, in src/mail/send.mjs.)
  if (f.smtpHost !== undefined && out.smtp_host) { const problem = staticHostProblem(out.smtp_host); if (problem) bad("smtpHost", `That mail server address is not allowed: ${problem}`); }
  if (f.smtpPort !== undefined) { if (!Number.isInteger(f.smtpPort) || f.smtpPort < 1 || f.smtpPort > 65535) bad("smtpPort", "The port is a number from 1 to 65535"); out.smtp_port = f.smtpPort; }
  if (f.smtpSecurity !== undefined) { if (!["starttls", "tls", "none"].includes(f.smtpSecurity)) bad("smtpSecurity", "Choose starttls, tls or none"); out.smtp_security = f.smtpSecurity; }
  if (f.dailyLimit !== undefined) { if (f.dailyLimit !== null && (!Number.isInteger(f.dailyLimit) || f.dailyLimit < 0)) bad("dailyLimit", "The daily limit is a whole number, or empty for the default"); out.daily_limit = f.dailyLimit; }
  const cols = Object.keys(out);
  if (!cols.length) return { changed: false };
  await tx.query(`INSERT INTO keystone.mail_identity (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`, [tenantId]);
  await tx.query(`UPDATE keystone.mail_identity SET ${cols.map((c, i) => `${c} = $${i + 3}`).join(", ")}, updated_by = $2, updated_at = now() WHERE tenant_id = $1`, [tenantId, updatedBy, ...cols.map((c) => out[c])]);
  return { changed: true, fields: cols };
}
