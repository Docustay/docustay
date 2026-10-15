// FP-E3 — the pure parts of passkeys: the feature flag is OFF by default, and only listed origins may register or sign in.
import test from "node:test";
import assert from "node:assert/strict";
import { passkeysEnabled, allowedOrigins, relyingParty } from "../src/auth/passkeys.mjs";

test("passkeys are off unless KEYSTONE_PASSKEYS=1", () => {
  const was = process.env.KEYSTONE_PASSKEYS;
  delete process.env.KEYSTONE_PASSKEYS; assert.equal(passkeysEnabled(), false);
  process.env.KEYSTONE_PASSKEYS = "0"; assert.equal(passkeysEnabled(), false);
  process.env.KEYSTONE_PASSKEYS = "1"; assert.equal(passkeysEnabled(), true);
  if (was === undefined) delete process.env.KEYSTONE_PASSKEYS; else process.env.KEYSTONE_PASSKEYS = was;
});

test("the allowed origins are the app URL plus the listed ones, as origins", () => {
  const env = { KEYSTONE_DOCUSTAY_APP_URL: "https://app.docustay.app/path", KEYSTONE_PASSKEY_ORIGINS: "https://docustay.app, http://localhost:5173 , not a url" };
  assert.deepEqual([...allowedOrigins(env)].sort(), ["http://localhost:5173", "https://app.docustay.app", "https://docustay.app"]);
});

test("the relying party is the origin's host, and any other origin is refused (positive control beside each refusal)", () => {
  const env = { KEYSTONE_DOCUSTAY_APP_URL: "https://app.docustay.app" };
  assert.deepEqual(relyingParty("https://app.docustay.app", env), { origin: "https://app.docustay.app", rpID: "app.docustay.app" });
  assert.throws(() => relyingParty("https://evil.example", env), /not available from https:\/\/evil.example/);
  assert.throws(() => relyingParty("https://app.docustay.app.evil.example", env), /not available/);
  assert.throws(() => relyingParty(undefined, env), /cannot use passkeys/);
  assert.throws(() => relyingParty("http://app.docustay.app", env), /not available/);   // same host, wrong scheme
});

test("the web address comes from Origin when present, else from the proxy's forwarded host and scheme (and a bare request has none)", async () => {
  const { requestOrigin } = await import("../src/auth/passkeys.mjs");
  const req = (h) => ({ req: { header: (k) => h[k.toLowerCase()] } });
  assert.equal(requestOrigin(req({ origin: "https://app.docustay.app" })), "https://app.docustay.app");
  assert.equal(requestOrigin(req({ "x-docustay-origin": "https://sign.example.com", "x-forwarded-host": "edge.internal", "x-forwarded-proto": "https" })), "https://sign.example.com");   // an edge that rewrote the forwarded host does not matter
  assert.equal(requestOrigin(req({ "x-forwarded-host": "app.docustay.app", "x-forwarded-proto": "https" })), "https://app.docustay.app");
  assert.equal(requestOrigin(req({ "x-forwarded-host": "a.example, b.example", "x-forwarded-proto": "http, https" })), "http://a.example");
  assert.equal(requestOrigin(req({})), undefined);
});
