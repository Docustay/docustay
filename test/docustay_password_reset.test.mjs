// Part 29 B3 — Docustay's password-reset mail: our link, Docustay product, same answer for unknown addresses. Run: node test/docustay_password_reset.test.mjs
import assert from "node:assert/strict";
import { requestPasswordReset } from "../src/auth/passwordReset.mjs";
const sent = [];
const send = async (m) => { sent.push(m); return { status: "sent" }; };
const budgets = []; const budget = async (s, k) => { budgets.push(s); };
const env = { KEYSTONE_DOCUSTAY_APP_URL: "https://app.docustay.test" };
const known = { generatePasswordResetLink: async () => "https://x.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=ABC123&apiKey=k" };
const unknown = { generatePasswordResetLink: async () => { throw Object.assign(new Error("nf"), { code: "auth/user-not-found" }); } };
let r = await requestPasswordReset({ email: "Jo@Example.com", ip: "1.1.1.1", product: "docustay" }, { auth: known, send, env, budget });
assert.deepEqual(r, { sent: true }); assert.equal(sent.length, 1);
assert.equal(sent[0].vars.link, "https://app.docustay.test/reset?oobCode=ABC123"); assert.equal(sent[0].product, "docustay"); assert.equal(sent[0].to, "jo@example.com");
assert.ok(!/firebase|workbench/i.test(sent[0].vars.link), "link names neither Firebase nor Workbench");
r = await requestPasswordReset({ email: "nobody@example.com", ip: "1.1.1.2", product: "docustay" }, { auth: unknown, send, env, budget });
assert.deepEqual(r, { sent: true }); assert.equal(sent.length, 1, "unknown address: same answer, nothing sent");
// found live 9 Oct 2026: with email enumeration protection on, an address with no account makes the admin library throw "Unable to create the email action link"; it must get the same answer as any unknown address (positive control: the known address above still sends)
const guarded = { generatePasswordResetLink: async () => { throw new Error("INTERNAL ASSERT FAILED: Unable to create the email action link"); } };
r = await requestPasswordReset({ email: "nobody2@example.com", ip: "1.1.1.3", product: "docustay" }, { auth: guarded, send, env, budget });
assert.deepEqual(r, { sent: true }); assert.equal(sent.length, 1, "enumeration-protected unknown address: same answer, nothing sent");
await assert.rejects(() => requestPasswordReset({ email: "x@example.com", product: "docustay" }, { auth: { generatePasswordResetLink: async () => { throw new Error("quota exceeded"); } }, send, env, budget }), /quota/, "a different failure is still an error");
r = await requestPasswordReset({ email: "not-an-email" }, { auth: known, send, env, budget }); assert.deepEqual(r, { sent: true }); assert.equal(sent.length, 1);
assert.ok(budgets.includes("email") && budgets.includes("ip"), "both budgets spent");
// D-006: a deployment with no Firebase project resets through its own identity store, never touching Firebase
{
  const sent2 = []; const send2 = async (m) => { sent2.push(m); return { status: "sent" }; };
  const localEnv = { ...env, KEYSTONE_LOCAL_AUTH: "1", KEYSTONE_LOCAL_AUTH_SECRET: "s".repeat(40) };
  const issued = []; const issueLocal = async ({ email }) => { issued.push(email); return email === "jo@example.com" ? "TOKEN-abcdefghijklmnopqrstuvwx" : null; };
  let r2 = await requestPasswordReset({ email: "Jo@Example.com", product: "docustay" }, { send: send2, env: localEnv, budget, issueLocal });
  assert.deepEqual(r2, { sent: true }); assert.equal(sent2.length, 1, "known local address: one email");
  assert.equal(sent2[0].vars.link, "https://app.docustay.test/reset?oobCode=TOKEN-abcdefghijklmnopqrstuvwx", "the link is our /reset page carrying the one-time token");
  r2 = await requestPasswordReset({ email: "nobody@example.com", product: "docustay" }, { send: send2, env: localEnv, budget, issueLocal });
  assert.deepEqual(r2, { sent: true }); assert.equal(sent2.length, 1, "unknown local address: same answer, nothing sent (positive control above: a known one sends)");
  assert.deepEqual(issued, ["jo@example.com", "nobody@example.com"], "the identity store was asked, lower-cased");
  // without local auth switched on and without Firebase configured the old refusal still stands (it must not silently pretend)
  await assert.rejects(() => requestPasswordReset({ email: "jo@example.com" }, { send: send2, env: { ...env, KEYSTONE_PUBLIC_URL: "https://x.test" }, budget, issueLocal }), /FIREBASE|Firebase/i);
}
// D-007: the link in the email is absolute or the mail is not sent — never a relative path nobody can open, and never built from a request header
{
  const sent3 = []; const send3 = async (m) => { sent3.push(m); return { status: "sent" }; };
  const noBase = { KEYSTONE_LOCAL_AUTH: "1", KEYSTONE_LOCAL_AUTH_SECRET: "s".repeat(40) };
  await assert.rejects(() => requestPasswordReset({ email: "jo@example.com", product: "docustay" }, { send: send3, env: noBase, budget, issueLocal: async () => "TOKEN-abcdefghijklmnopqrstuvwx" }), /address|KEYSTONE_DOCUSTAY_APP_URL/i, "no configured address: refuses");
  assert.equal(sent3.length, 0, "nothing was sent with a dead link");
  await assert.rejects(() => requestPasswordReset({ email: "nobody@example.com", product: "docustay" }, { send: send3, env: noBase, budget, issueLocal: async () => null }), /address|KEYSTONE_DOCUSTAY_APP_URL/i, "the refusal does not depend on whether the address has an account");
  await requestPasswordReset({ email: "jo@example.com", product: "docustay" }, { send: send3, env: { ...noBase, KEYSTONE_PUBLIC_URL: "https://sign.example.test/" }, budget, issueLocal: async () => "TOKEN-abcdefghijklmnopqrstuvwx" });
  assert.equal(sent3[0].vars.link, "https://sign.example.test/reset?oobCode=TOKEN-abcdefghijklmnopqrstuvwx", "a self-host's KEYSTONE_PUBLIC_URL carries the link (positive control)");
}
console.log("ok — 9 cases");
