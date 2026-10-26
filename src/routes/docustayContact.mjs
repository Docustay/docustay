// Part 30 website — the public Contact form. The ONE place the marketing site collects personal data: a name, an email address and a message. It is not stored anywhere; it is emailed once to the platform
// operator's own address (KEYSTONE_MAIL_ALERT_TO) with the visitor's address as Reply-To, and the answer to the visitor says only whether it was sent. Outside production the mail backstop redirects it like every other mail.
import { invalid, AppError, ErrorKind } from "../http/errors.mjs";
import { sendViaResend } from "../email/resend.mjs";
import { sendingAddress } from "../email/send.mjs";
import { platformAlertTo } from "../mail/index.mjs";
import { cleanName } from "../documents/frontDoor.mjs";

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const WINDOW_MS = 60 * 60 * 1000, PER_ADDRESS = 3, PER_IP = 5, GLOBAL = 60;
const hits = new Map();           // key -> [timestamps]; a single-process counter is enough for a form this small
function limited(key, max, now) { const l = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS); if (l.length >= max) { hits.set(key, l); return true; } l.push(now); hits.set(key, l); return false; }
const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);

export function registerDocustayContactRoutes(app, { now = () => Date.now(), send = sendViaResend } = {}) {
  app.post("/api/public/docustay/contact", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") throw invalid("send a JSON body");
    if (clean(body.website, 200) !== "") return c.json({ sent: true });                 // honeypot: a person never fills the hidden field; a bot is told it worked
    const name = cleanName(clean(body.name, 120), { max: 120 }), email = clean(body.email, 200).toLowerCase(), message = clean(body.message, 5000);
    if (!name) throw invalid("Please tell us your name.", { field: "name" });
    if (!EMAIL.test(email)) throw invalid("That email address does not look right.", { field: "email" });
    if (message.length < 10) throw invalid("Please write a few words about what you need.", { field: "message" });
    const t = now(), ip = c.get("clientIp") ?? "unknown";
    if (limited("g", GLOBAL, t) || limited(`ip:${ip}`, PER_IP, t) || limited(`e:${email}`, PER_ADDRESS, t)) throw new AppError(ErrorKind.RATE_LIMITED, "Too many messages just now. Please try again later.");
    // Run 6: the sandbox and staging copies of the site take the form and answer "sent" like the real one, but do not email the operator (test messages were landing in the real inbox). KEYSTONE_CONTACT_ALERTS=on turns it back on for a delivery test.
    if (["sandbox", "staging"].includes(process.env.KEYSTONE_ENVIRONMENT ?? "") && process.env.KEYSTONE_CONTACT_ALERTS !== "on") { console.log(`docustayContact: not emailed (${process.env.KEYSTONE_ENVIRONMENT}; set KEYSTONE_CONTACT_ALERTS=on to deliver)`); return c.json({ sent: true }); }
    const to = platformAlertTo();
    if (!to) throw new AppError(ErrorKind.DEPENDENCY, "Contact is not available right now. Please try again later.");
    const r = await send({ to, from: sendingAddress(), replyTo: email, subject: `Docustay contact form: ${name}`, text: `From: ${name} <${email}>\n\n${message}\n\n(Sent from the Docustay website contact form.)` });
    if (!r?.ok) { console.error(`docustayContact: the mail provider refused the message (${r?.status ?? "no status"}): ${String(r?.error ?? r?.providerMessage ?? "no reason").slice(0, 300)}`); }
    if (!r?.ok) throw new AppError(ErrorKind.DEPENDENCY, "That could not be sent. Please try again later.");
    return c.json({ sent: true });
  });
}
export const _resetContactLimits = () => hits.clear();
