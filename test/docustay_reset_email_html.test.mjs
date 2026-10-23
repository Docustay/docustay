// Run 10 EK-002: a Docustay password-reset email is a real HTML email in Docustay's frame (it went out as a bare plain-text link), with the link as the button and still in the plain-text twin; in French too; the platform's stays plain text.
import test from "node:test";
import assert from "node:assert/strict";
import { sendAuthEmail } from "../src/email/authEmail.mjs";

const env = { RESEND_API_KEY: "re_test_xxx", KEYSTONE_ENVIRONMENT: "local", KEYSTONE_EMAIL_FROM: "Docustay <hello@docustay.app>", KEYSTONE_DOCUSTAY_MAIL_SENDER: "Docustay <hello@docustay.app>", KEYSTONE_EMAIL_ALLOWLIST: "a@example.com" };
const LINK = "https://app.example.test/reset?oobCode=abc123";
const run = async (product, lang) => {
  const sent = [];
  const fetchImpl = async (u, o) => { sent.push(JSON.parse(o.body)); return { ok: true, status: 200, json: async () => ({ id: "x" }), text: async () => "{}" }; };
  const r = await sendAuthEmail({ to: "a@example.com", templateKey: "auth.password_reset", product, lang, vars: { link: LINK } }, { fetchImpl, env });
  return { r, m: sent[0] };
};
test("Docustay: HTML with the link as a button, the link still in the plain twin; English only (V1); Workbench's stays plain text", async () => {
  const d = await run("docustay", "en");
  assert.equal(d.r.status, "sent", d.r.error); assert.ok(d.m.html, "has an HTML part"); assert.match(d.m.html, new RegExp(`href="${LINK.replace(/[.?]/g, "\\$&")}"`)); assert.match(d.m.html, /Docustay/); assert.match(d.m.text, /oobCode=abc123/);
  const f = await run("docustay", "fr");
  assert.ok(f.m.html && !/Réinitialisez/.test(f.m.subject), "V1: Docustay is English only, so a French request still gets the English HTML email");
  const m = await run("workbench", "en");
  assert.equal(m.r.status, "sent", m.r.error); assert.ok(!m.m.html, "Workbench's reset is unchanged: plain text");
});
