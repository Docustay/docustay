// FP-F1/F2/F4/F6 — narrow scopes, the address allowlist, expiry warnings, and the dsk_ key format with its checksum.
import test from "node:test";
import assert from "node:assert/strict";
import { cleanAllowlist, ipAllowed, warningDue, parseRange } from "../src/developer/keyGuard.mjs";
import { generateToken, parseToken } from "../src/auth/apiToken.mjs";
import { GRANTABLE_SCOPES, ROUTE_SCOPES, NARROW_ROUTE_SCOPES } from "../src/developer/scopes.mjs";

const ENV = { KEYSTONE_TOKEN_PEPPER: "x".repeat(40) };

test("an allowlist accepts single addresses and ranges, refuses nonsense, and an empty list means anywhere", () => {
  assert.deepEqual(cleanAllowlist(["203.0.113.7", "10.0.0.0/8", "2001:db8::/32", "203.0.113.7"]), ["203.0.113.7", "10.0.0.0/8", "2001:db8::/32"]);
  assert.throws(() => cleanAllowlist(["not-an-ip"]), /not an address/);
  assert.throws(() => cleanAllowlist(["10.0.0.0/33"]), /not an address/);
  assert.throws(() => cleanAllowlist(Array.from({ length: 21 }, (_, i) => `10.0.0.${i}`)), /at most 20/);
  assert.equal(parseRange("1.2.3.4/"), null);                     // a trailing slash is not a range
  assert.equal(parseRange("1.2.3.4/24/8"), null);
  assert.equal(ipAllowed("198.51.100.9", []), true);
  assert.equal(ipAllowed("198.51.100.9", null), true);
});

test("a range lets its own addresses in and keeps every other address out (a positive and a negative control)", () => {
  const list = ["203.0.113.0/24", "2001:db8::/32"];
  assert.equal(ipAllowed("203.0.113.200", list), true);
  assert.equal(ipAllowed("203.0.114.1", list), false);
  assert.equal(ipAllowed("::ffff:203.0.113.5", list), true);      // an IPv4 address that arrives in IPv6 clothing
  assert.equal(ipAllowed("2001:db8::1", list), true);
  assert.equal(ipAllowed("2001:db9::1", list), false);
  assert.equal(ipAllowed(null, list), false);                      // an unreadable address is never let in by a non-empty list
  assert.equal(ipAllowed("garbage", list), false);
});

test("an expiry warning is due once at 14 days and once at 3, never after expiry, never without an expiry", () => {
  const now = Date.parse("2026-10-07T00:00:00Z"), day = 86400000;
  const at = (d) => new Date(now + d * day).toISOString();
  assert.equal(warningDue({ expiresAt: null, now }), null);
  assert.equal(warningDue({ expiresAt: at(30), now }), null);
  assert.equal(warningDue({ expiresAt: at(13), now }), 14);
  assert.equal(warningDue({ expiresAt: at(13), warned14: true, now }), null);
  assert.equal(warningDue({ expiresAt: at(2), warned14: true, now }), 3);
  assert.equal(warningDue({ expiresAt: at(2), warned14: true, warned3: true, now }), null);
  assert.equal(warningDue({ expiresAt: at(-1), now }), null);
});

test("a dsk_ key carries a checksum: it parses, a changed character does not, and the old gl_ shape still parses", () => {
  const dsk = generateToken({ environment: "test", brand: "dsk" }, ENV);
  assert.match(dsk.presented, /^dsk_test_[0-9A-HJKMNP-TV-Z]{26}_[A-Za-z0-9_-]{43}[0-9A-Za-z]{6}$/);
  const p = parseToken(dsk.presented);
  assert.equal(p.tokenId, dsk.tokenId); assert.equal(p.secret, dsk.secret); assert.equal(p.environment, "test");
  const flip = dsk.presented.slice(0, -1) + (dsk.presented.endsWith("A") ? "B" : "A");
  assert.throws(() => parseToken(flip), /not valid/);                   // checksum no longer matches
  const gl = generateToken({ environment: "live" }, ENV);
  assert.match(gl.presented, /^gl_live_/);
  assert.equal(parseToken(gl.presented).secret, gl.secret);
  assert.throws(() => generateToken({ brand: "xx" }, ENV), /brand/);
  assert.equal(dsk.secretHash.equals(generateToken({ environment: "test", brand: "dsk" }, ENV).secretHash), false);
});

test("every narrow scope is a real scope on a real route, and none widens past what the route already meant", () => {
  for (const [route, narrow] of Object.entries(NARROW_ROUTE_SCOPES)) {
    assert.ok(Object.hasOwn(ROUTE_SCOPES, route), `${route} is not a route`);
    assert.ok(GRANTABLE_SCOPES.includes(narrow), `${narrow} is not grantable`);
    const kind = (s) => s.split(":")[1];
    assert.equal(kind(narrow), kind(ROUTE_SCOPES[route]), `${route}: ${narrow} changes read/write against ${ROUTE_SCOPES[route]}`);
  }
});
