// src/product/docustayLicenseShare.mjs — ONE PRODUCTION INSTANCE PER SELF-HOST LICENCE KEY, THE LIGHT VERSION (the maintainer, 21 Oct 2026, answer 8).
// Every instance that checks a key is remembered by its anonymous instance id (a random id the install made itself), its role (production or test) and its version. When a SECOND production instance
// has used the same key within the last 60 days, the answer to its licence check carries a plain warning (the admin screen shows it) and the licence owner is emailed once for that instance.
// It can NEVER block an instance and it never receives customer data: only the key (hashed), the instance id, the role and the version.
import { docustayFrame } from "../email/docustayBilling.mjs";
import * as mail from "../mail/index.mjs";

export const SHARE_WINDOW_DAYS = 60;
export const SHARE_NOTICE = "This licence key has been used by more than one production instance in the last 60 days. One licence covers one production instance. If this is a test or staging copy, set DOCUSTAY_INSTANCE_ROLE=test on it. Nothing has been switched off.";
const ROLES = new Set(["production", "test"]);
const ownerEmailOf = (note) => (/(?:^|\s)email=(\S+@\S+)/.exec(String(note ?? "")) ?? [])[1] ?? null;

/** Remember this instance for this key and say whether the key now looks shared. → { production: number, shared: boolean, notified: boolean }. Never throws: a failure here must not stop a licence check. */
export async function noteInstance(tx, { tenantId, keyHash, installId, role = "production", version = null, note = null, now = Date.now(), send = mail.sendMail, log = console }) {
  try {
    const r = ROLES.has(role) ? role : "production";
    const ver = typeof version === "string" && /^[0-9A-Za-z.+-]{1,32}$/.test(version) ? version : null;
    await tx.query(
      `INSERT INTO keystone.docustay_license_instance (tenant_id, key_hash, install_id, role, version, last_seen_at) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (tenant_id, key_hash, install_id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at, role = EXCLUDED.role, version = COALESCE(EXCLUDED.version, keystone.docustay_license_instance.version)`,
      [tenantId, keyHash, installId, r, ver, new Date(now)]);
    const { rows } = await tx.query(
      `SELECT install_id, notified_at, first_seen_at FROM keystone.docustay_license_instance
        WHERE tenant_id = $1 AND key_hash = $2 AND role = 'production' AND last_seen_at >= $3 ORDER BY first_seen_at, install_id`,
      [tenantId, keyHash, new Date(now - SHARE_WINDOW_DAYS * 86_400_000)]);
    const shared = rows.length > 1;
    let notified = false;
    const mine = rows.find((x) => x.install_id === installId);
    if (shared && mine && r === "production" && mine.install_id !== rows[0].install_id && !mine.notified_at) {   // the first instance seen is never the "extra" one
      const to = ownerEmailOf(note);
      if (to) {
        const { text, html } = docustayFrame({
          preheader: "A second server is using your Docustay licence key.", heading: "A second server is using your licence key",
          intro: ["Your Docustay self-hosting licence covers one production instance. A second production instance has just checked in with the same key (instance " + String(installId).slice(0, 8) + ").",
                  "Nothing has been switched off and no data about your documents, people or customers was sent: we only see the key, an anonymous instance id and the version."],
          after: ["If this is a test or staging copy, set DOCUSTAY_INSTANCE_ROLE=test on it and it will not count. If you need a second production instance, reply to this email and we will sort out a licence for it."],
          button: { label: "Read the licence terms", url: `${(process.env.KEYSTONE_DOCUSTAY_APP_URL || "https://docustay.app").replace(/\/+$/, "")}/legal/licensing` },
        });
        await send(tx, { tenantId, to, purpose: "platform", product: "docustay", subject: "A second server is using your Docustay licence key", text, html });
        notified = true;
      }
      await tx.query(`UPDATE keystone.docustay_license_instance SET notified_at = $4 WHERE tenant_id = $1 AND key_hash = $2 AND install_id = $3`, [tenantId, keyHash, installId, new Date(now)]);
    }
    return { production: rows.length, shared, notified };
  } catch (e) { log.error(`docustay licence instance note: ${e?.message ?? e}`); return { production: 1, shared: false, notified: false }; }
}
