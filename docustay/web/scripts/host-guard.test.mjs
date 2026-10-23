// node docustay/web/scripts/host-guard.test.mjs — a customer's own hostname serves the signing page and nothing else; our own hosts serve everything.
import assert from "node:assert/strict";
import { hostMayServe, isPlatformHost, redirectFor, pathAllowed, isAppHost, isSiteHost } from "../src/lib/hostGuard.js";
assert.ok(hostMayServe("sign.acme.com", "/sign/pdf"), "own host: signing page");
assert.ok(hostMayServe("sign.acme.com", "/api/public/pdf/view"), "own host: public API");
assert.ok(hostMayServe("sign.acme.com", "/_app/immutable/x.js"), "own host: the app's assets");
for (const bad of ["/", "/login", "/documents", "/settings", "/billing", "/api/auth/login", "/api/documents/pdf/x", "/api/product/docustay/status", "/templates", "/signup"]) assert.ok(!hostMayServe("sign.acme.com", bad), `own host must NOT serve ${bad}`);
for (const h of ["docustay.app", "app.docustay.app", "sign.docustay.app", "localhost:5180", "127.0.0.1", "host.example.com"]) assert.ok(isPlatformHost(h) && hostMayServe(h, "/documents"), `our host ${h} serves the workspace`);
assert.ok(!isPlatformHost("docustay.app.evil.com"), "a look-alike is not ours");
assert.equal(redirectFor("docustay.app", "/login"), "https://app.docustay.app/login", "sign-in belongs on the app address");
assert.equal(redirectFor("www.docustay.app", "/documents"), "https://app.docustay.app/documents");
assert.equal(redirectFor("docustay.app", "/pricing"), null, "the site keeps its own pages");
assert.equal(redirectFor("www.docustay.app", "/pricing"), "https://docustay.app/pricing", "R8-71: www sends a visitor to the one site address");
assert.equal(redirectFor("www.docustay.app", "/"), "https://docustay.app/", "R8-71: and the home page too");
// R8-71 (Stryker, Run 8 /verify: 3 survivors on that line) — what the www rule must NOT do, beside the positives above
assert.equal(redirectFor("www.theircompany.com", "/pricing"), null, "R8-71: a www name that is not one of OUR site names is never sent to us");
assert.equal(redirectFor("docs.example.org", "/pricing", { siteHosts: ["example.org", "docs.example.org"] }), null, "R8-71: only a www name is folded into the main site address, not every other site name");
assert.equal(redirectFor("www.example.org", "/pricing", { siteHosts: ["www.example.org", "example.org"] }), null, "R8-71: when www IS the main site address it is not sent to itself (no loop)");
assert.equal(redirectFor("www.example.org", "/pricing", { siteHosts: ["example.org", "www.example.org"] }), "https://example.org/pricing", "R8-71: control — the same names the other way round do fold");
assert.equal(redirectFor("docustay.app", "/templates/nda-template"), null, "a public template page stays on the site address");
assert.equal(redirectFor("docustay.app", "/templates"), null, "on the site address /templates is an old address of the template hub (301 to /free-templates), not the workspace list");
assert.equal(isAppHost("app.docustay.app"), true); assert.equal(isAppHost("docustay.app"), false); assert.equal(isSiteHost("docustay.app"), true); assert.equal(isSiteHost("app.docustay.app"), false); assert.equal(isSiteHost("host.example.com"), false);
assert.equal(redirectFor("docustay.app", "/templates/rich"), "https://app.docustay.app/templates/rich", "the editor route still belongs to the app address");
assert.equal(redirectFor("app.docustay.app", "/"), "/documents");
assert.equal(redirectFor("app.docustay.app", "/documents"), null);
assert.equal(redirectFor("sign.docustay.app", "/sign/pdf"), null, "signing stays on the signing address");
assert.equal(redirectFor("sign.docustay.app", "/login"), "https://docustay.app/login", "nothing else is served from the signing address");
assert.equal(redirectFor("localhost:5180", "/login"), null, "local and sandbox hosts are not redirected");

// Run 8 /verify (Stryker: the PUBLIC list survived 23 of 24 mutants, because no assertion pinned its anchors). A customer's own signing hostname serves EXACTLY these paths:
for (const p of ["/sign", "/sign/pdf", "/download", "/download?t=kl_x".split("?")[0], "/verify", "/verify/abc", "/s/abc123", "/f/acme", "/f/acme/volunteers", "/api/public/pdf/view", "/_app/immutable/x.js", "/media/a.png", "/favicon.ico", "/favicon.svg", "/robots.txt", "/healthz"])
  assert.ok(pathAllowed(p), `a customer host serves ${p}`);
for (const p of ["/downloads", "/x/download", "/signup", "/signing", "/documents/sign", "/x/verify", "/verify-me", "/s/abc/def", "/s/", "/f/", "/f/acme/volunteers/edit", "/api/publicx", "/api/v1/documents", "/x/_app/y", "/_apps/x", "/x/media/a", "/mediax", "/x/favicon.ico", "/robots.txt.bak", "/x/robots.txt", "/healthz/x", "/x/healthz", "/x/s/abc", "/x/f/acme", "/x/api/public/pdf/view", "/settings", "/"])
  assert.ok(!pathAllowed(p), `a customer host refuses ${p}`);
assert.ok(!hostMayServe("sign.theircompany.com", "/settings") && hostMayServe("sign.theircompany.com", "/sign/pdf"), "the guard itself: refuses the workspace, serves signing");
console.log("ok — host guard and hostname routing");
