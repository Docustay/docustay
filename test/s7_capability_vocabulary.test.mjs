// test/s7_capability_vocabulary.test.mjs — Stage 7 task 7.21.
//
// ★★★ WHAT THIS PROVES: `src/developer/scopes.mjs` carries the WHOLE of CT-100 (`STAGE-5-PLAN.md §9`) —
//     `GRANTABLE_SCOPES` 7 → 23, `ROUTE_SCOPES` 2 → 82, and the new frozen `NEVER_DELEGABLE` (40) and
//     `SCOPED_BUT_CLOSED` (7) — and that the module itself refuses to load a broken shape rather than
//     silently opening (or silently closing) a route. Nothing here reimplements the map: every
//     assertion reads the SHIPPED module's own exports and the module's own exported checkers.
//
// ★★ EVERY NEGATIVE ASSERTION HAS ITS POSITIVE CONTROL IN THE SAME TEST (the s5_link_token.test.mjs /
//    s7_audit_entry.test.mjs / e6_0b_api_client_request_key.test.mjs rule, kept here on purpose).
//
// No database needed:  node test/s7_capability_vocabulary.test.mjs

import {
  GRANTABLE_SCOPES, ROUTE_SCOPES, NEVER_DELEGABLE, SCOPED_BUT_CLOSED,
  assertRouteScopes, assertNeverDelegableDisjoint, assertScopedButClosedSubset, assertVocabularyCounts,
} from "../src/developer/scopes.mjs";

let pass = 0, fail = 0;
const t = (n, fn) => {
  try { fn(); console.log("  ✓", n); pass++; }
  catch (e) { console.log("  ✗", n, "—", e.message); fail++; }
};
const must = (c, m) => { if (!c) throw new Error(m); };
const same = (a, b, m) => { if (a !== b) throw new Error(`${m} — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); };
/** Run `fn`, return the error it threw (or null). Never swallows: the caller asserts on it. */
const thrown = (fn) => { try { fn(); return null; } catch (e) { return e; } };
const sortedDiff = (actual, expected) => {
  const a = [...actual].sort(), e = [...expected].sort();
  const missing = e.filter((x) => !a.includes(x));
  const extra = a.filter((x) => !e.includes(x));
  return { equal: missing.length === 0 && extra.length === 0, missing, extra };
};

console.log("\n=== S7 / 7.21 — the capability vocabulary: 121 delegable routes, 67 that never are, 25 scopes (Stage 20 task 20.51 added growth routes) ===");

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// (a) all four exports are FROZEN — and the freeze is real, not decorative.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
t("(a1) GRANTABLE_SCOPES is frozen; a locally constructed unfrozen array of the same shape ACCEPTS a mutation, so 'frozen' is not vacuously true", () => {
  must(Object.isFrozen(GRANTABLE_SCOPES), "GRANTABLE_SCOPES must be Object.isFrozen");
  const err = thrown(() => { GRANTABLE_SCOPES.push("x:read"); });
  must(err !== null, "pushing onto GRANTABLE_SCOPES must throw");

  const unfrozenControl = [...GRANTABLE_SCOPES];
  const controlErr = thrown(() => { unfrozenControl.push("x:read"); });
  must(controlErr === null && unfrozenControl.length === GRANTABLE_SCOPES.length + 1,
    "positive control: an UNFROZEN copy must accept the same push without throwing");
});

t("(a2) ROUTE_SCOPES is frozen; a locally constructed unfrozen object of the same shape ACCEPTS a mutation", () => {
  must(Object.isFrozen(ROUTE_SCOPES), "ROUTE_SCOPES must be Object.isFrozen");
  const err = thrown(() => { ROUTE_SCOPES["POST /api/__nope__"] = "people:read"; });
  must(err !== null, "assigning a new key onto ROUTE_SCOPES must throw");

  const unfrozenControl = { ...ROUTE_SCOPES };
  const controlErr = thrown(() => { unfrozenControl["POST /api/__nope__"] = "people:read"; });
  must(controlErr === null && "POST /api/__nope__" in unfrozenControl,
    "positive control: an UNFROZEN copy must accept the same assignment without throwing");
});

t("(a3) NEVER_DELEGABLE is frozen AND its mutators throw or are absent — Object.freeze(new Set(...)) alone does NOT stop .add/.delete", () => {
  must(Object.isFrozen(NEVER_DELEGABLE), "NEVER_DELEGABLE must be Object.isFrozen");
  const before = NEVER_DELEGABLE.size;
  const addErr = thrown(() => NEVER_DELEGABLE.add("POST /api/__nope__"));
  must(addErr !== null, "NEVER_DELEGABLE.add must throw");
  const delErr = thrown(() => NEVER_DELEGABLE.delete([...NEVER_DELEGABLE][0]));
  must(delErr !== null, "NEVER_DELEGABLE.delete must throw");
  same(NEVER_DELEGABLE.size, before, "size must be unchanged after both refused mutations");

  // positive control: a PLAIN Object.freeze(new Set(...)) — the naive approach — DOES accept .add,
  // proving this test can actually tell "really immutable" from "decorated with isFrozen".
  const naiveFrozenSet = Object.freeze(new Set(["a"]));
  const controlErr = thrown(() => naiveFrozenSet.add("b"));
  must(controlErr === null && naiveFrozenSet.size === 2,
    "positive control: a naively Object.freeze()'d Set must still accept .add (that's the bug this module avoids)");
});

t("(a4) SCOPED_BUT_CLOSED is frozen AND its mutators throw or are absent, same proof as (a3)", () => {
  must(Object.isFrozen(SCOPED_BUT_CLOSED), "SCOPED_BUT_CLOSED must be Object.isFrozen");
  const before = SCOPED_BUT_CLOSED.size;
  const addErr = thrown(() => SCOPED_BUT_CLOSED.add("POST /api/__nope__"));
  must(addErr !== null, "SCOPED_BUT_CLOSED.add must throw");
  same(SCOPED_BUT_CLOSED.size, before, "size must be unchanged after the refused mutation");

  const naiveFrozenSet = Object.freeze(new Set(["a"]));
  const controlErr = thrown(() => naiveFrozenSet.add("b"));
  must(controlErr === null, "positive control: naive Object.freeze() on a Set still accepts .add");
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// (b) the four counts are 25 / 121 / 67 / 7, and each collection's members are DISTINCT.
// ★ 25 Sep 2026 (Stage 20, task 20.51): added growth:read and growth:write scopes, 23 new routes.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
t("(b) counts are 25 / 146 / 66 / 7 and every collection's members are distinct", () => {
  // ★ [FINAL PUSH Stage 4, 7 Oct 2026] 25 -> 28: plays:read, plays:write, drafts:write (the plays, playbooks and drafts API).
  // [FINAL PUSH Stage 6, 7 Oct 2026] 28 -> 35: templates:read/write, webhooks:read/write, reports:read, account:read, embedded:write (FP-F1).
  same(GRANTABLE_SCOPES.length, 34, "GRANTABLE_SCOPES.length");
  same(new Set(GRANTABLE_SCOPES).size, 34, "GRANTABLE_SCOPES must have 34 DISTINCT members");
  // ★ [3 Oct 2026, QUEUE §23.5.8] 128 -> 134: the six Documents REST API routes. (The line said 124 and had been failing since the accountant removal took the map to 128 — a stale fixture, now brought to the real, deliberate count.)
  // [Part 30 item 7] 134 -> 136: POST /api/v1/templates/html and /file, both documents:write.
  // [Part 30 item 2] 136 -> 141: five more customer-facing document operations for keys.
  // [Part 30 item 4] 141 -> 142: embed-session.
  // [Shared engine, 6 Oct 2026] 142 -> 145: templates/source, documents/ai/draft, documents/ai/jobs/:id; 145 -> 146: usage.
  // [FINAL PUSH Stage 4, 7 Oct 2026] 157 -> 168: eleven plays, playbooks and drafts routes.
  // [FINAL PUSH Stage 6, 7 Oct 2026] 168 -> 174: test-sign, email templates, emails.
  // [FINAL PUSH Stage 6, 7 Oct 2026] 174 -> 182: the webhook routes; 182 -> 183: the embedded builder session; 183 -> 184: the embedded Scribe session; 184 -> 185: GET /api/v1/ai/usage; 185 -> 186: POST /api/v1/documents/detect-fields.
  // [Run 7–9] 186 -> 205 as the forms, search, contracts, payments, library and automation routes were added (the pin here had not followed); [Run 9 Part 4.3] 205 -> 204: POST /api/money/subscriptions/cancel was a route that no longer exists.
  same(Object.keys(ROUTE_SCOPES).length, 189, "Object.keys(ROUTE_SCOPES).length");   // Part 2: + POST /api/v1/preflight
  // ★ [TY, 2 Oct 2026] 67 -> 66: "POST /api/reports/accountant/send" removed along with the whole
  //   accountant pack feature.
  same(NEVER_DELEGABLE.size, 66, "NEVER_DELEGABLE.size");   // [FINAL PUSH Stage 6] 66 -> 67: api-keys/:id/allowlist; [Run 9 Part 4.3] 67 -> 66: POST /api/app/booking/waitlist was a route that no longer exists
  same(SCOPED_BUT_CLOSED.size, 7, "SCOPED_BUT_CLOSED.size");
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// (c) set equality, printed as a diff — a count alone passes when somebody swaps a member.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const EXPECTED_GRANTABLE = [
  "accounts:read", "accounts:write", "booking:read", "booking:write", "documents:read",
  "documents:write", "growth:read", "growth:write", "items:read", "items:write", "lead:write", "money:read", "money:write",
  "network:read", "network:write", "notifications:read", "notifications:write", "people:read",
  "people:write", "platform:read", "platform:write", "records:read", "records:write",
  "settings:read", "settings:write",
  "plays:read", "plays:write", "drafts:write",
  "templates:read", "templates:write", "webhooks:read", "webhooks:write", "account:read", "embedded:write",
];

const EXPECTED_NEVER_DELEGABLE = [
  // credential (11) — Task 20.17 adds POST /api/automations/callback
  "POST /api/auth/login", "POST /api/auth/logout", "POST /api/webhooks/:provider",
  "POST /api/automations/callback",
  "POST /api/developer/webhook-endpoints", "GET /api/developer/api-keys", "GET /api/developer/audit-log",
  "GET /api/developer/webhook-endpoints", "GET /api/settings/developer/sandbox",
  "GET /api/auth/branding/logo", "GET /api/auth/config",
  // privilege escalation (7)
  "POST /api/developer/api-keys", "POST /api/developer/api-keys/:id/revoke", "POST /api/developer/api-keys/:id/allowlist", "POST /api/people/invite",
  "POST /api/people/staff-role", "POST /api/settings/roles/permission", "POST /api/signup",
  "POST /api/settings/practice/slug",
  // consent and personal acts (15) + Stage 18 client-app routes (3) = 18
  "POST /api/app/booking", "POST /api/app/documents/disclosure", "POST /api/app/documents/sign",
  "POST /api/app/notifications/preference", "POST /api/app/notifications/read",
  "GET /api/app/activity", "GET /api/app/booking", "GET /api/app/documents", "GET /api/app/documents/:id",
  "GET /api/app/notifications", "GET /api/app/payments", "GET /api/app/profile", "GET /api/app/sessions",
  "GET /api/app/surfaces", "GET /api/app/working-on",
  // Stage 18 (F13/F14/F15) client-app exclusive routes
  "GET /api/app/home", "POST /api/app/payments/pay",
  // UI shell and pre-authentication (8)
  "GET /api/capabilities", "GET /api/help", "GET /api/home", "GET /api/nav", "GET /api/section/*",
  "GET /api/auth/branding", "GET /api/auth/practices", "GET /api/signup/slug-available",
  // ★ Stage 18 additions (23), reconciled 25 Sep 2026 against scopes.mjs — operator chain (platform
  //   routes are the OPERATOR's, never a tenant API key's), support-access consent acts, per-device
  //   registration, and personal/system acts no key may perform for a person.
  "GET /api/me/push-config", "POST /api/me/devices", "POST /api/me/devices/forget",
  "GET /api/platform/jobs", "POST /api/platform/jobs/run-now",
  "GET /api/platform/overview", "GET /api/platform/practices", "GET /api/platform/practices/:tenantId",
  "GET /api/platform/practices/:tenantId/look",
  "POST /api/platform/practices/:tenantId/access-requests", "POST /api/platform/practices/:tenantId/access/end",
  "GET /api/platform/prompts", "POST /api/platform/prompts/dismiss",
  "GET /api/platform/provisioning/:runId/steps", "GET /api/platform/usage", "POST /api/platform/usage/tell",
  "GET /api/settings/support-access", "POST /api/settings/support-access/:grantId/end",
  "POST /api/settings/support-access/:requestId/answer",
  "GET /api/whats-new", "POST /api/developer/api-keys/:id/scopes",
  "POST /api/tasks/automations/:key",
];

const EXPECTED_SCOPED_BUT_CLOSED = [
  "POST /api/platform/provisioning/advance", "POST /api/jobs/retry", "POST /api/jobs/give-up",
  "GET /api/platform/health", "GET /api/platform/provisioning", "GET /api/platform/tenants",
  "GET /api/list/*",
];

t("(c1) GRANTABLE_SCOPES sorted equals the 25 names field 4(a) names, exactly — printed as a diff", () => {
  same(EXPECTED_GRANTABLE.length, 34, "the test's own control list must itself have 34 names");
  const d = sortedDiff(GRANTABLE_SCOPES, EXPECTED_GRANTABLE);
  must(d.equal, `mismatch — missing: [${d.missing.join(", ")}]  extra: [${d.extra.join(", ")}]`);
});

t("(c2) NEVER_DELEGABLE sorted equals the 66 keys, exactly — printed as a diff", () => {
  same(EXPECTED_NEVER_DELEGABLE.length, 66, "the test's own control list must itself have 66 names");
  const d = sortedDiff([...NEVER_DELEGABLE], EXPECTED_NEVER_DELEGABLE);
  must(d.equal, `mismatch — missing: [${d.missing.join(", ")}]  extra: [${d.extra.join(", ")}]`);
});

t("(c3) SCOPED_BUT_CLOSED sorted equals the 7 keys field 4(d) names, exactly — printed as a diff", () => {
  same(EXPECTED_SCOPED_BUT_CLOSED.length, 7, "the test's own control list must itself have 7 names");
  const d = sortedDiff([...SCOPED_BUT_CLOSED], EXPECTED_SCOPED_BUT_CLOSED);
  must(d.equal, `mismatch — missing: [${d.missing.join(", ")}]  extra: [${d.extra.join(", ")}]`);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// (d) every ROUTE_SCOPES value is null, PER_VIEW, or in GRANTABLE_SCOPES — positive control: a
//     fabricated map with one unknown value fails the same validator, in the same test.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
t("(d) every real ROUTE_SCOPES value is valid; a fabricated map with one unknown value fails the SAME validator", () => {
  const err = thrown(() => assertRouteScopes(ROUTE_SCOPES, GRANTABLE_SCOPES));
  must(err === null, `the real ROUTE_SCOPES must pass assertRouteScopes — got: ${err && err.message}`);

  const broken = { ...ROUTE_SCOPES, "GET /api/__bad__": "not:a:real:scope" };
  const controlErr = thrown(() => assertRouteScopes(broken, GRANTABLE_SCOPES));
  must(controlErr !== null && /GET \/api\/__bad__/.test(controlErr.message),
    "positive control: a fabricated map with one unknown value must fail the same validator and name the bad key");
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// (e) ROUTE_SCOPES keys ∩ NEVER_DELEGABLE is empty — positive control: a fabricated pair that DOES
//     intersect fails the same check, so "empty" is not passing because the checker compares nothing.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
t("(e) ROUTE_SCOPES ∩ NEVER_DELEGABLE is empty; a fabricated overlapping pair fails the SAME check", () => {
  const err = thrown(() => assertNeverDelegableDisjoint(ROUTE_SCOPES, NEVER_DELEGABLE));
  must(err === null, `the real pair must be disjoint — got: ${err && err.message}`);

  const overlappingKey = Object.keys(ROUTE_SCOPES)[0];
  const fabricatedNever = new Set([...NEVER_DELEGABLE, overlappingKey]);
  const controlErr = thrown(() => assertNeverDelegableDisjoint(ROUTE_SCOPES, fabricatedNever));
  must(controlErr !== null && controlErr.message.includes(overlappingKey),
    "positive control: a fabricated pair that DOES intersect must fail the same check and name the overlap");
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// (f) the 7 scopes Stage 5 shipped are a SUBSET of the 23, never the reverse, and none was renamed —
//     positive control: all 7 resolve, listed by name.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const STAGE_5_SEVEN = [
  "people:read", "people:write", "accounts:read", "documents:read",
  "money:read", "booking:read", "lead:write",
];

t("(f) the 7 scopes Stage 5 shipped are all present, unrenamed, in the 23 — a subset, never the reverse", () => {
  for (const s of STAGE_5_SEVEN) {
    must(GRANTABLE_SCOPES.includes(s), `Stage 5's scope "${s}" must still resolve by name in the widened GRANTABLE_SCOPES`);
  }
  must(GRANTABLE_SCOPES.length > STAGE_5_SEVEN.length,
    "the 23 must be a PROPER superset of the 7 (widened, not merely re-shuffled) — otherwise this passes vacuously");
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// (g) SCOPED_BUT_CLOSED ⊂ Object.keys(ROUTE_SCOPES) — positive control: a fabricated member outside
//     the map fails.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
t("(g) SCOPED_BUT_CLOSED ⊂ ROUTE_SCOPES keys; a fabricated member outside the map fails the SAME check", () => {
  const err = thrown(() => assertScopedButClosedSubset(ROUTE_SCOPES, SCOPED_BUT_CLOSED));
  must(err === null, `the real SCOPED_BUT_CLOSED must be a subset of ROUTE_SCOPES keys — got: ${err && err.message}`);

  const fabricated = new Set([...SCOPED_BUT_CLOSED, "GET /api/__not_in_the_map__"]);
  const controlErr = thrown(() => assertScopedButClosedSubset(ROUTE_SCOPES, fabricated));
  must(controlErr !== null && controlErr.message.includes("GET /api/__not_in_the_map__"),
    "positive control: a fabricated member outside the map must fail the same check and name it");
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// bonus: the module's own load-time aggregate (assertVocabularyCounts) — same red-first shape.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
t("assertVocabularyCounts passes on the real vocabulary; a fabricated 39-member NEVER_DELEGABLE fails it", () => {
  const err = thrown(() => assertVocabularyCounts());
  must(err === null, `the real vocabulary must pass assertVocabularyCounts — got: ${err && err.message}`);

  const shrunk = new Set([...NEVER_DELEGABLE]);
  shrunk.delete([...shrunk][0]);
  const controlErr = thrown(() => assertVocabularyCounts({ neverDelegable: shrunk }));
  must(controlErr !== null && /NEVER_DELEGABLE/.test(controlErr.message),
    "positive control: a fabricated 39-member NEVER_DELEGABLE must fail the count check");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
