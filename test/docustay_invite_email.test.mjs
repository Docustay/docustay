// Run 10 R10-41: a Docustay team invitation is a real HTML email in Docustay's frame (it was plain text only), with the link as a button and still in the plain-text twin; the platform's stays plain text.
import test from "node:test";
import assert from "node:assert/strict";
import { sendAuthEmail } from "../src/email/authEmail.mjs";

const env = { RESEND_API_KEY: "re_test_xxx", KEYSTONE_ENVIRONMENT: "local", KEYSTONE_EMAIL_FROM: "Docustay <hello@docustay.app>", KEYSTONE_DOCUSTAY_MAIL_SENDER: "Docustay <hello@docustay.app>", KEYSTONE_EMAIL_ALLOWLIST: "a@example.com" };
const run = async (product, productName) => {
  const sent = [];
  const fetchImpl = async (u, o) => { sent.push(JSON.parse(o.body)); return { ok: true, status: 200, json: async () => ({ id: "x" }), text: async () => "{}" }; };
  const r = await sendAuthEmail({ to: "a@example.com", templateKey: "auth.invite", product, vars: { practiceName: "Acme", productName, inviterName: "Riley Owner", acceptUrl: "https://app.example.test/invite?token=t1", expiresOn: "October 21, 2026", personalLine: "Welcome aboard." } }, { fetchImpl, env });
  return { r, m: sent[0] };
};
test("Docustay: HTML with a button, the sender's line and the expiry; the plain twin keeps the link (positive control: Workbench stays plain text)", async () => {
  const d = await run(null, "Docustay");   // the real invite call passes no `product`: the workspace is known by vars.productName
  assert.equal(d.r.status, "sent", d.r.error); assert.match(d.m.subject, /Riley Owner invited you to join Acme on Docustay/);
  assert.ok(d.m.html, "has an HTML part");
  assert.match(d.m.html, /href="https:\/\/app\.example\.test\/invite\?token=t1"/); assert.match(d.m.html, /Accept the invitation/); assert.match(d.m.html, /Welcome aboard\./); assert.match(d.m.html, /expires on October 21, 2026/);
  assert.match(d.m.text, /invite\?token=t1/);
  const m = await run("workbench", "Workbench");
  assert.equal(m.r.status, "sent", m.r.error); assert.ok(!m.m.html, "Workbench's invitation is unchanged: plain text");
});
