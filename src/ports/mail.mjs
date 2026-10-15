// src/ports/mail.mjs — PLATFORM'S side of the mail module's ports (see src/mail/ports.mjs): the Resend transport and its environment backstop, the product's default sender, brand, secrets, the connected mailbox.
// Installed once at startup (server.mjs, worker.mjs). Docustay plugs in its own: the same module, a different product sender.
import { planEmailLimit, emailUsageAlerts } from "../product/docustay.mjs";
import { installMailPorts, productName, productSender, platformAlertTo, productKeyOf, productNameFor, productSenderFor } from "../mail/index.mjs";
import { sendViaResend, emailIsConfigured, resendApiKey } from "../email/resend.mjs";
import { redirectForEnvironment } from "../email/redirect.mjs";
import { captureTarget, captureSend } from "../email/capture.mjs";
import { callOutside } from "../http/outside.mjs";
import { getSetting } from "../settings/writes.mjs";
import { sealSecret, openSecret, CURRENT_KEK_VERSION } from "../secrets/envelope.mjs";
import { holdMail } from "../product/demoHold.mjs";
import { trackOnce } from "../product/analytics.mjs";
import { googleClientCredentials, microsoftClientCredentials } from "../booking/calendarConnect.mjs";

const hostMailPorts = Object.freeze({
  transport: { send: (m, opts) => sendViaResend(m, opts), configured: () => emailIsConfigured() },
  outside: (name, url, init, opts) => callOutside(name, url, init, opts),
  capture: { target: () => captureTarget(process.env), send: (m) => captureSend(m) },
  providerKey: () => resendApiKey(),
  // domain management needs a key that is allowed to manage domains (the sending key is restricted to sending): RESEND_ADMIN_API_KEY
  adminKey: () => (process.env.RESEND_ADMIN_API_KEY || "").trim() || resendApiKey(),
  environment: { route: ({ to, subject }) => redirectForEnvironment({ to, subject }, process.env) },
  // Launch step 8: a demo workspace's mail is held and recorded, never sent (null for every real workspace)
  hold: async (tx, message) => { const r = await holdMail(tx, message); if (r) await trackOnce(tx, null, "demo_step", { step: "sent_document" }, { key: "demo_step:sent_document" }).catch(() => {}); return r; },
  // the product for THIS organisation (or the one a pre-sign-in request is for): Docustay workspaces are mailed as Docustay, everyone else as the platform (decision D1)
  product: async (tx, { tenantId = null, product = null } = {}) => {
    let own = product;
    if (!own && tx && tenantId) own = (await tx.query(`SELECT product FROM keystone.tenant WHERE id = $1`, [tenantId]).catch(() => ({ rows: [] }))).rows[0]?.product ?? null;
    const key = productKeyOf(own);
    return { key, name: productNameFor(key), sender: (() => { try { return productSenderFor(key); } catch { return { name: productNameFor(key), address: null }; } })(), alertTo: platformAlertTo(), defaultDailyLimit: Number(process.env.KEYSTONE_MAIL_DAILY_LIMIT) || 500 };
  },
  brand: {
    async get(tx, { tenantId }) {
      const { rows } = await tx.query(`SELECT name FROM keystone.tenant WHERE id = $1`, [tenantId]);
      return { orgName: (await getSetting(tx, "practice.name", null)) || rows[0]?.name || "" };
    },
  },
  secrets: {
    seal: ({ tenantId, purpose, plaintext }) => { const e = sealSecret({ plaintext, tenantId, purpose }); return { envelope: e, fingerprint: e.fingerprint, kekVersion: CURRENT_KEK_VERSION }; },
    open: ({ envelope, tenantId, purpose, kekVersion }) => openSecret(envelope, { tenantId, purpose, kekVersion }),
  },
  limits: { dailyDefault: (tx, { tenantId }) => planEmailLimit(tx, { tenantId }), afterCount: (tx, a) => emailUsageAlerts(tx, a) },
  // the OAuth clients for connecting an organisation's own mailbox: the same Google and Microsoft apps the calendar connect already uses (env names GOOGLE_OAUTH_CLIENT_*, MICROSOFT_GRAPH_OAUTH_CLIENT_*)
  callbackBase: () => (process.env.KEYSTONE_MAILBOX_CALLBACK_BASE || process.env.KEYSTONE_PUBLIC_URL || "").replace(/\/+$/, "") || null,
  oauthClient: (provider) => { try { return provider === "google" ? googleClientCredentials() : provider === "microsoft" ? microsoftClientCredentials() : null; } catch { return null; } },
});
export function installHostMailPorts() { installMailPorts(hostMailPorts); }
