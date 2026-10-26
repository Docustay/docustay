import test from "node:test";
import assert from "node:assert/strict";
process.env.KEYSTONE_LOCAL_AUTH = "1"; process.env.KEYSTONE_LOCAL_AUTH_SECRET = "x".repeat(40);
const o = await import("../src/auth/oidc.mjs");
test("off unless issuer, client id and secret are all set", () => {
  for (const k of ["DOCUSTAY_OIDC_ISSUER", "DOCUSTAY_OIDC_CLIENT_ID", "DOCUSTAY_OIDC_CLIENT_SECRET"]) delete process.env[k];
  assert.equal(o.oidcEnabled(), false);
  process.env.DOCUSTAY_OIDC_ISSUER = "https://idp.example.test"; process.env.DOCUSTAY_OIDC_CLIENT_ID = "a";
  assert.equal(o.oidcEnabled(), false);
  process.env.DOCUSTAY_OIDC_CLIENT_SECRET = "b";
  assert.equal(o.oidcEnabled(), true);
});
test("the state cookie round-trips and refuses tampering and expiry", () => {
  const v = o.sealState({ verifier: "v", state: "s", nonce: "n" });
  assert.equal(o.openState(v).state, "s");
  assert.equal(o.openState(v.slice(0, -2) + "xx"), null);
  assert.equal(o.openState(v.replace(/^[^.]+/, Buffer.from(JSON.stringify({ state: "evil", exp: 9e12 })).toString("base64url"))), null);
  assert.equal(o.openState(""), null);
  assert.equal(o.readStateCookie(`a=b; docustay_oidc=${v}`).nonce, "n");
});
test("not available without the built-in identity (hosted production uses Firebase)", async () => {
  delete process.env.KEYSTONE_LOCAL_AUTH;
  assert.equal(o.oidcEnabled(), false);
});
