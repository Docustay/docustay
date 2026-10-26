// src/mail/ports.mjs — THE MAIL MODULE'S PORTS. The mail module (one sending identity per organisation, used by every email family) imports nothing from the platform or from Documents:
// where it needs something from outside it asks a port, defined here as plain function shapes. The host plugs its implementations in once at startup (src/ports/mail.mjs).
// Docustay, lifted out, plugs in its own (or sets a Resend key / SMTP, which is all a self-hoster needs).
//
//   transport.send({to, from, subject, text, html, replyTo?, attachments?, rawBody?, idempotencyKey?, tenantId?}) → {ok, providerMessageId, error, ...}   one email through the provider (Resend)
//   transport.configured() → bool                                  is a provider key present at all ("email isn't set up")
//   outside(name, url, init, {timeoutMs}) → {ok, status, body, timedOut}   an HTTP call to the provider's domain API
//   providerKey() → string                                         the provider's sending API key (throws when not set)
//   adminKey() → string                                            the key that may MANAGE sending domains (a sending key is usually restricted to sending); optional — falls back to providerKey()
//   environment.route({to, subject}) → {to, subject}               the environment backstop: where may mail to `to` really go HERE (throws when it may not)
//   product() → {name, sender:{name,address}, alertTo}             the product's own default sender, and the one platform-alert address
//   brand.get(tx, {tenantId}) → {orgName}                          the organisation's display name
//   secrets.seal({tenantId, purpose, plaintext}) / secrets.open({envelope, tenantId, purpose, kekVersion})
//   limits.dailyDefault(tx, {tenantId}) → number | null            the host's per-organisation daily sending limit (a hosted plan's), used when the organisation has set none (optional)
//   oauthClient(provider: 'google'|'microsoft') → {clientId, clientSecret} | null    the OAuth client this server uses to connect organisations' mailboxes (optional; null = connecting is not set up)
//   callbackBase({tenantId}) → string | null   the address the provider sends the person back to after consent (the server's own public address, which must be registered with the OAuth app)
//   capture.target() → string|null · capture.send({to, from, subject, text, html, replyTo?, attachments?}) → {ok, providerMessageId, error}   sandbox capture: when a target is set, every mode ends at the capture server instead of a real provider (optional)
//   mailbox.resolve(...)  retired: the module owns the mailbox connection itself (src/mail/mailbox.mjs)
const REQUIRED = Object.freeze(["transport", "outside", "providerKey", "environment", "product", "brand", "secrets"]);
let installed = null;
export function installMailPorts(impl) {
  for (const k of REQUIRED) if (!impl?.[k]) throw new Error(`installMailPorts: the "${k}" port is missing`);
  installed = Object.freeze({ mailbox: { resolve: async () => null }, adminKey: () => impl.providerKey(), ...impl });
}
export const mailPortsInstalled = () => installed !== null;
export async function ports() {
  if (installed) return installed;
  const host = await import("../ports/mail.mjs");
  host.installHostMailPorts();
  if (!installed) throw new Error("the mail module has no ports installed and the host did not install them");
  return installed;
}
