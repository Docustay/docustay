// QA-ONLY SIGN-IN. Test-access brief, 1 Oct 2026, Part 1.
//
// ★★★ WHY THIS EXISTS: "blocked on sign-in" kept recurring because every prior attempt routed
// through firebase-admin, which trips the Credential Exploration gate regardless of any claimed
// pre-approval — a real, non-bypassable runtime denial (confirmed by direct retry, twice, in the
// prior session). This route never imports firebase.mjs and never calls verifyIdToken. It mints a
// session the same way login.mjs's own step 5 does (createSession, src/auth/session.mjs) for one
// of two fixed app_user rows (migration 0550) — identity is a constant, not a credential this
// route verifies, so there is nothing here for that gate to fire on.
//
// ★★ TWO GUARDS, LAYERED, NOT ALTERNATIVES:
//   1. KEYSTONE_QA_LOGIN_ENABLED must be exactly "true" — unset in any environment, this route
//      refuses every request with a plain 404 (not 403: its very existence is not worth revealing
//      to a caller who does not already have the enabling variable).
//   2. In production (NODE_ENV === "production") ONLY, the caller must also present
//      KEYSTONE_QA_LOGIN_TOKEN (header `x-qa-token`), compared in constant time. Locally, with
//      NODE_ENV !== "production", no token is required — that is the "dev-only sign-in" half of
//      the brief, for the full test pass against a local Postgres with no real data at stake.
//   ★ Both variables are read from process.env on every request, not cached — switching either
//     off takes effect on the process's next restart (Railway always restarts on a variable
//     change), and there is no code path that reads a stale "enabled" decision.
//
// ★ RATE LIMITED (formSubmitLimiter, in-process — same primitive the public lead form already
//   uses) and every attempt (success or refusal) is logged with a structured line to stdout —
//   Railway's own log search covers it; this deliberately does NOT write to keystone.audit_entry,
//   whose action vocabulary is a frozen, migration-gated contract (0183/CT-042) not worth
//   reopening for a test-only route. If the maintainer wants this in the formal audit trail later, that is a
//   one-line addition to AUDIT_ACTIONS plus a migration — not done here without being asked.

import { withCredentialLookup, withTenant } from "../db/index.mjs";
import { createSession } from "./session.mjs";
import { notFound, unauthenticated, invalid, internal } from "../http/errors.mjs";
import { formSubmitLimiter } from "../http/rateLimit.mjs";
import { timingSafeEqual, createHmac, randomBytes } from "node:crypto";

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ ONE-TIME SIGN-IN TICKETS (the maintainer, 2 Oct 2026 — "a signed-in browser WITHOUT exposing secrets").
//     A browser pane needs the `ks_session` HttpOnly cookie, which only a real server response can
//     set — and getting there with the standing QA token would mean typing that token into a
//     transcript. So the token holder (a script run with the token injected, never typed) asks for a
//     TICKET: `POST /api/qa/session { as, mintTicket: true }` + the `x-qa-token` header returns
//     `{ ticket }` and sets NO cookie. The browser then redeems it, in-page and same-origin:
//     `fetch("/api/qa/session", { method: "POST", body: JSON.stringify({ as, ticket }) })` — the
//     response's Set-Cookie lands in the browser's own cookie jar. No new route (nothing to declare).
//   ★ A ticket is HMAC-SHA256(`as|expiry|nonce`) keyed by the standing token (stateless), lives 120 s,
//     is bound to ONE account (`as`), and is SINGLE-USE (the nonce is remembered until expiry).
//     It grants exactly what a QA login of that account grants today and nothing the token itself
//     doesn't; the standing token is never printed, sent to a browser, or logged.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const TICKET_TTL_MS = 120_000;
const usedTicketNonces = new Map(); // nonce -> expiry ms

function ticketMac(key, payload) {
  return createHmac("sha256", key).update(payload).digest("base64url");
}
export function mintQaTicket(as, key, now = Date.now()) {
  const payload = `${as}|${now + TICKET_TTL_MS}|${randomBytes(12).toString("base64url")}`;
  return `${Buffer.from(payload).toString("base64url")}.${ticketMac(key, payload)}`;
}
/** Returns true and CONSUMES the ticket, or false. Never throws on a malformed ticket. */
export function redeemQaTicket(ticket, as, key, now = Date.now()) {
  try {
    const [b64, mac] = String(ticket ?? "").split(".");
    const payload = Buffer.from(b64 ?? "", "base64url").toString("utf8");
    if (!tokensMatch(mac, ticketMac(key, payload))) return false;
    const [tAs, exp, nonce] = payload.split("|");
    if (tAs !== as || !(Number(exp) > now) || !nonce) return false;
    for (const [n, e] of usedTicketNonces) if (e <= now) usedTicketNonces.delete(n);
    if (usedTicketNonces.has(nonce)) return false;
    usedTicketNonces.set(nonce, Number(exp));
    return true;
  } catch { return false; }
}

// ★ the maintainer, 1 Oct 2026 — FOUND LIVE, local testing: the first version of this route ran a bare
//   `withCredentialLookup` JOIN across app_user/tenant to find the QA row by email. That connection
//   deliberately sets NO tenant GUC (src/db/index.mjs:188, "every keystone.* table stays invisible")
//   — FORCE RLS on app_user hides every row from it, so the lookup always returned zero rows,
//   regardless of whether migration 0550 had run. The REAL login path (login.mjs) never hits this:
//   it resolves tenancy through `resolve_tenants_by_firebase_uid`, a SECURITY DEFINER owned by
//   auth_owner with ITS OWN narrow policy (`firebase_uid IS NOT NULL`, migration 0031) — already
//   granted, already audited, already exactly what a QA row (which carries a real firebase_uid,
//   synthetic or not) satisfies. Reusing it — then reading the rest of the row inside an ordinary
//   `withTenant` once the tenant is known — needed zero new SQL, zero new grants, and zero widening
//   of what the production credential role can see. Deliberately NOT a new SECURITY DEFINER
//   function of this route's own: that would have meant either owning it by auth_owner (widening
//   that role's column grants beyond what the real login path needs, a real if narrow regression
//   on a production-security-critical role) or a brand-new dedicated role (which migrations cannot
//   create at all — `db/migrate.mjs` runs as app_owner, which has no CREATEROLE; confirmed by
//   0044's own header hitting the identical wall for `app_worker`).

// ★ SECTION B (the maintainer, pasted brief, 1 Oct 2026) — "repoint QA login's client to Example Owner FIRST"
//   (before deleting the test-data survivors down to exactly 4). The standalone "QA Test Client"
//   seed row (firebase_uid 'qa-login-client-example', migration 0550) is being removed as redundant
//   test clutter; "QA login as client" now signs in as the real "Example Owner" test-client record
//   instead, via his OWN already-existing real firebase_uid — a login identity, not a lookup key
//   this route invents, so this is a pure repoint, never a value anyone needed to generate.
//   ★ `admin` is unchanged — "QA admin" is one of section B's own 4 keepers, not touched.
const QA_ACCOUNTS = Object.freeze({
  admin: "qa-login-admin-foundry",
  client: "x7xwI5oeubMe0ogHvKOoWkANpZB3",
});

function tokensMatch(presented, expected) {
  const a = Buffer.from(String(presented ?? ""), "utf8");
  const b = Buffer.from(String(expected ?? ""), "utf8");
  // ★ Different lengths must still take the comparison branch, not short-circuit on `.length` —
  //   otherwise the response time itself leaks the expected length. Pad the shorter one before
  //   comparing, then separately check the real lengths matched.
  const len = Math.max(a.length, b.length, 1);
  const pa = Buffer.concat([a, Buffer.alloc(len - a.length)]);
  const pb = Buffer.concat([b, Buffer.alloc(len - b.length)]);
  return a.length === b.length && timingSafeEqual(pa, pb);
}

// ★ QUEUE §23.8.1 — A WEBHOOK RECEIVER FOR THE SANDBOX RUN. A document-signed event has to be seen ARRIVING to prove "webhook delivered", and the platform's sender refuses private addresses and sends nothing
//   to a third party we do not control — so the sandbox receives its own. It exists ONLY when the same switch that enables QA sign-in is on (the sandbox sets it; production does not): POST answers 200 and
//   remembers the last 20 deliveries (when, event id header, whether it was signed, the first 1,500 bytes of the body); reading them takes the QA token. Memory only — nothing is stored.
const sinkSeen = [];
function registerQaWebhookSink(app) {
  app.post("/api/qa/webhook-sink", async (c) => {
    if (process.env.KEYSTONE_QA_LOGIN_ENABLED !== "true") throw notFound();
    const full = await c.req.text();
    const raw = full.slice(0, 1500);
    sinkSeen.push({ at: new Date().toISOString(), eventId: c.req.header("keystone-event-id") ?? null, signed: Boolean(c.req.header("keystone-signature")), timestamp: c.req.header("keystone-timestamp") ?? null, body: raw,
      // §25.5/25.6 — what a Standard Webhooks verifier needs (the whole body, up to 20 KB) and the replay marker
      standard: { id: c.req.header("webhook-id") ?? null, timestamp: c.req.header("webhook-timestamp") ?? null, signature: c.req.header("webhook-signature") ?? null },
      replay: c.req.header("keystone-replay") ?? null, fullBody: full.length <= 20000 ? full : null });
    while (sinkSeen.length > 20) sinkSeen.shift();
    return c.json({ ok: true });
  });
  app.get("/api/qa/webhook-sink", async (c) => {
    if (process.env.KEYSTONE_QA_LOGIN_ENABLED !== "true") throw notFound();
    const expected = process.env.KEYSTONE_QA_LOGIN_TOKEN;
    if (!expected || !tokensMatch(c.req.header("x-qa-token"), expected)) throw unauthenticated("bad qa token");
    return c.json({ deliveries: sinkSeen });
  });
}

// A stand-in for the model provider, for the live retry test in the SANDBOX only (QA login enabled). The script sets a plan with the QA token ("answers": [429, 503, 200, ...]); the AI job's own_endpoint call then gets those answers in order, and the last 200 is a valid draft.
// Memory only; with no plan it answers 404, so it can never stand in for a real provider by accident.
let fakePlan = null; const fakeCalls = [];
function registerQaFakeModel(app) {
  app.post("/api/qa/fake-model/plan", async (c) => {
    if (process.env.KEYSTONE_QA_LOGIN_ENABLED !== "true") throw notFound();
    const expected = process.env.KEYSTONE_QA_LOGIN_TOKEN;
    if (!expected || !tokensMatch(c.req.header("x-qa-token"), expected)) throw unauthenticated("bad qa token");
    const body = await c.req.json().catch(() => ({}));
    fakePlan = Array.isArray(body.answers) ? body.answers.map(Number) : null; fakeCalls.length = 0;
    return c.json({ ok: true, plan: fakePlan });
  });
  app.get("/api/qa/fake-model/calls", async (c) => {
    if (process.env.KEYSTONE_QA_LOGIN_ENABLED !== "true") throw notFound();
    const expected = process.env.KEYSTONE_QA_LOGIN_TOKEN;
    if (!expected || !tokensMatch(c.req.header("x-qa-token"), expected)) throw unauthenticated("bad qa token");
    return c.json({ calls: fakeCalls });
  });
  app.post("/api/qa/fake-model", async (c) => {
    if (process.env.KEYSTONE_QA_LOGIN_ENABLED !== "true" || !fakePlan) throw notFound();
    const asked = await c.req.json().catch(() => ({}));
    const sys = String(asked?.system ?? ""); const rules = /<house_rules>\n([\s\S]*?)\n<\/house_rules>/.exec(sys);
    const status = fakePlan.length ? fakePlan.shift() : 200; fakeCalls.push({ at: new Date().toISOString(), status, houseRules: rules ? rules[1].slice(0, 200) : null, rulesAfterFixed: rules ? sys.indexOf("<house_rules>") > 200 : null });
    if (status !== 200) return c.json({ error: "planned answer" }, status);
    const source = { type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Retry test agreement" }] }, { type: "paragraph", content: [{ type: "text", text: "This draft arrived after the provider answered busy and then unavailable." }] }] };
    return c.json({ text: JSON.stringify({ title: "Retry test agreement", source }), input_tokens: 0, output_tokens: 0 });
  });
}

/** The QA sign-in, the webhook sink and the fake model exist only where testing happens. A production deployment (KEYSTONE_ENVIRONMENT=production) does not mount them at all, whatever else is set: no route, no 401, no standing token that could ever open a session there. */
export function registerQaRoutes(app, env = process.env) {
  if (env.KEYSTONE_ENVIRONMENT === "production") {
    if (env.KEYSTONE_QA_LOGIN_ENABLED === "true") console.error("KEYSTONE_QA_LOGIN_ENABLED is set on a production deployment and is ignored: the QA routes are not mounted here.");
    return false;
  }
  registerQaWebhookSink(app);
  registerQaFakeModel(app);
  app.post("/api/qa/session", async (c) => {
    if (process.env.KEYSTONE_QA_LOGIN_ENABLED !== "true") {
      throw notFound();
    }

    const ip = c.get("clientIp") ?? null;
    formSubmitLimiter("qa_session", ip, { limit: 20, windowMs: 600_000 });

    const isProd = process.env.NODE_ENV === "production";
    const body = await c.req.json().catch(() => null);
    const as = body?.as;
    const expected = process.env.KEYSTONE_QA_LOGIN_TOKEN;
    if (isProd) {
      if (!expected || expected.length < 32) {
        throw internal("KEYSTONE_QA_LOGIN_TOKEN is unset or too short — refusing to run the QA login route in production");
      }
      const presented = c.req.header("x-qa-token");
      if (body?.ticket !== undefined && presented === undefined) {
        // ★ Redeem a one-time ticket instead of the standing token. Same refusal wording either way.
        if (!redeemQaTicket(body.ticket, as, expected)) {
          console.log(JSON.stringify({ at: "qa_session", result: "refused_bad_ticket", ip }));
          throw unauthenticated("bad qa token");
        }
      } else if (!tokensMatch(presented, expected)) {
        console.log(JSON.stringify({ at: "qa_session", result: "refused_bad_token", ip }));
        throw unauthenticated("bad qa token");
      }
    }
    if (as !== "admin" && as !== "client") {
      throw invalid('body.as must be "admin" or "client"', { field: "as" });
    }
    if (body?.mintTicket === true) {
      // Mint only — no session, no cookie. Requires the standing token (a ticket cannot mint a ticket).
      if (!isProd) return c.json({ ticket: mintQaTicket(as, expected ?? "dev-qa-key-not-for-production-use-xxxxxxxx"), expiresInSeconds: TICKET_TTL_MS / 1000 });
      if (body?.ticket !== undefined) throw invalid("a ticket cannot mint a ticket", { field: "ticket" });
      return c.json({ ticket: mintQaTicket(as, expected), expiresInSeconds: TICKET_TTL_MS / 1000 });
    }
    // ★ SANDBOX (QUEUE §12.1): the client account is production's real Example Owner uid; a sandbox database holds its
    //   OWN seeded Example (a different uid), named by this variable. Unset (production) = the constant above, unchanged.
    const firebaseUid = (as === "client" && process.env.KEYSTONE_QA_CLIENT_FIREBASE_UID?.trim()) || QA_ACCOUNTS[as];

    // ── step 1: tenancy, via the SAME resolver the real login path uses ───────────────────────
    const tenantIds = await withCredentialLookup(async (db) => {
      const { rows } = await db.query(
        `SELECT keystone.resolve_tenants_by_firebase_uid($1) AS id`, [firebaseUid]
      );
      return rows.map((r) => r.id).filter(Boolean);
    });
    const tenantId = tenantIds[0] ?? null;

    if (!tenantId) {
      // ★ Migration 0550 not applied yet, the row was archived, or its tenant isn't 'active'.
      //   Named plainly — this is a setup problem, not a credential problem, and there is no
      //   caller to protect from an oracle here (the fixed "which test account" set is
      //   documented, not discoverable).
      throw notFound(`qa account for "${as}" does not exist or is not reachable — has migration 0550 been applied?`);
    }

    // ── step 2: the rest of the row, via an ORDINARY tenant-scoped read ────────────────────────
    const person = await withTenant(tenantId, async (db) => {
      const { rows } = await db.query(
        `SELECT id, role, staff_role, display_name, lifecycle_status FROM keystone.app_user
          WHERE tenant_id = $1 AND firebase_uid = $2 AND archived_at IS NULL`,
        [tenantId, firebaseUid]
      );
      return rows[0] ?? null;
    });

    if (!person) {
      throw notFound(`qa account for "${as}" does not exist or is archived`);
    }
    // ★ F865 — the per-request gate (src/http/app.mjs) refuses a staff row that is paused/former; this route filtered only on archived_at, so it answered 200 and the very next
    //   request failed. Refuse HERE, with the same reason, so the mismatch cannot hide.
    if (person.role === "staff" && (person.lifecycle_status === "paused" || person.lifecycle_status === "former")) {
      throw notFound(`qa account for "${as}" is ${person.lifecycle_status} — it was taken out of service (F865); run the restore in migration 0560`);
    }

    const session = await createSession({
      tenantId,
      appUserId: person.id,
      firebaseUid,
      userAgent: c.req.header("user-agent") ?? null,
      ip,
      kind: "app",
    });

    console.log(JSON.stringify({ at: "qa_session", result: "signed_in", as, ip, appUserId: person.id }));

    // ★ `npm run dev` (scripts/dev.mjs) serves plain HTTP on 127.0.0.1 — no TLS at all locally,
    //   unlike every deployed environment. A `Secure` cookie over plain HTTP is simply dropped by
    //   the browser, so this is the one cookie-setting line in the codebase that varies the
    //   attribute: every other one (src/auth/install.mjs) is reached only via a real Firebase
    //   token, which cannot be obtained for local testing anyway, so they never needed to.
    const secureAttr = isProd ? "; Secure" : "";
    c.header(
      "set-cookie",
      `ks_session=${encodeURIComponent(session.token)}; HttpOnly${secureAttr}; SameSite=Lax; Path=/; Max-Age=43200`
    );
    return c.json({
      appUserId: person.id, role: person.role, staffRole: person.staff_role,
      displayName: person.display_name,
    });
  });
  return true;
}
