// P1.16 — /healthz + /readyz   ·   P1.17 (M4.7) — STARTUP ASSERTIONS
//
// ★★ /healthz AND /readyz ARE DIFFERENT QUESTIONS. Conflating them is a real outage mode:
//   /healthz — "is this process alive?"   Failing it makes the orchestrator KILL and restart.
//   /readyz  — "should traffic reach me?" Failing it makes the orchestrator STOP SENDING traffic.
// If the database is down and /healthz reports it, every replica is killed and restarted in a
// loop, turning a recoverable dependency outage into a crash loop that also loses warm caches.
// A dependency failure belongs in /readyz ONLY.
//
// ★★★ P1.17 / M4.7 — THE STARTUP ASSERTIONS FAIL LOUD AND REFUSE TO BOOT.
// A missing signing certificate discovered at startup is an incident. A missing signing
// certificate discovered when the first client tries to sign an agreement is an incident WITH A
// CLIENT WATCHING. Same for timezone: a booking system with an unset zone silently books the
// wrong hour and nobody notices until somebody misses an appointment.
//
// ★ NEVER `process.env.X || 'default'`. A hardcoded fallback turns a missing secret into a
// working-looking system pointed at the wrong thing.

import { readFile } from "node:fs/promises";
import { settingsReport, holdsToManifest } from "./requiredSettings.mjs";

export class StartupAssertionError extends Error {
  constructor(failures) {
    super(`startup assertions failed:\n  - ${failures.join("\n  - ")}`);
    this.name = "StartupAssertionError";
    this.failures = failures;
  }
}

// ★★★ MEASURED 2026-09-12, node v25.5.0 — AND IT CHANGED THIS FUNCTION'S DESIGN.
//
// The obvious check — "does `new Intl.DateTimeFormat({timeZone: tz})` throw?" — IS TOO WEAK, and
// weak in the precise way that produces the bug P1.17 exists to prevent:
//
//     "PST"  → accepted, resolves to America/Los_Angeles
//     "EST"  → accepted, resolves to ★ America/PANAMA
//
// America/Panama DOES NOT OBSERVE DAYLIGHT SAVING. A practice that sets its timezone to "EST"
// meaning "US Eastern" is therefore correct in winter and ONE HOUR WRONG ALL SUMMER — every
// booking, every reminder, silently. No error, no log line. That is exactly "a booking system
// with an unset timezone silently books the wrong hour", arriving through a value that LOOKS set.
//
// So the rule is: the stored zone must be a CANONICAL IANA identifier, not merely something ICU
// is willing to parse. Ambiguous abbreviations are rejected at the boundary and the operator has
// to say which zone they actually mean.
//
// ★ `UTC` is allowed explicitly: it is not in `Intl.supportedValuesOf('timeZone')` (the canonical
// list carries `Etc/UTC`), but it is unambiguous, universally understood, and has no DST to get
// wrong. Allowing it is a decision, not an oversight.
const CANONICAL_ZONES = new Set(
  typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : []
);
const EXPLICITLY_ALLOWED = new Set(["UTC"]);

/**
 * True only for a canonical IANA zone (or UTC). Deliberately stricter than "ICU parses it".
 */
export function isValidTimezone(tz) {
  if (typeof tz !== "string" || tz.length === 0) return false;
  if (EXPLICITLY_ALLOWED.has(tz)) return true;
  if (CANONICAL_ZONES.size > 0) return CANONICAL_ZONES.has(tz);
  // Fallback for a runtime without supportedValuesOf: parse-check, and still refuse bare
  // abbreviations, which are the dangerous class.
  if (/^[A-Z]{2,5}\d?[A-Z]{0,4}$/.test(tz)) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; }
  catch { return false; }
}

/**
 * What a non-canonical value would silently have become — used to make the error message
 * actionable rather than just "invalid".
 */
export function resolveTimezoneHint(tz) {
  try { return new Intl.DateTimeFormat("en-US", { timeZone: tz }).resolvedOptions().timeZone; }
  catch { return null; }
}

/**
 * P1.17 — run BEFORE the server listens. Throws StartupAssertionError, which the entrypoint
 * must NOT catch-and-continue.
 *
 * `deps` is injected so this is testable without a live process:
 *   { env, readCertificate, queryTenantTimezones }
 */
export async function assertStartupInvariants(deps = {}) {
  const env = deps.env ?? process.env;
  const failures = [];

  // ── 1. Database URL present ───────────────────────────────────────────────
  if (!env.KEYSTONE_DATABASE_URL) {
    failures.push("KEYSTONE_DATABASE_URL is not set (no default is permitted)");
  }

  // ── 2. ★ Signing certificate PRESENT AND PARSEABLE ────────────────────────
  // ★ "Present" is not enough. An empty file, a truncated copy, or a path that resolves to a
  // directory all satisfy "the variable is set" and all fail at signing time.
  // ★★★ P17.2 — TWO SOURCES, AND THE INLINE ONE IS PREFERRED IN A CONTAINER.
  // [MEAS 2026-09-13] the certificate lived only at `KEYSTONE_SIGNING_CERT_PATH`, pointing at
  // `~/keystone/.local/signing.crt` — a path OUTSIDE the image (the Dockerfile copies src, db and
  // web/dist). So the deployed process would have failed this invariant and refused to bind, which
  // is the correct behaviour and would have read as a broken deploy.
  // ★★ THE FIX IS NOT TO COPY `.local/` INTO THE IMAGE. `signing.key` sits beside the certificate
  //    with mode 600, and key material in an image layer is readable by anyone who can pull the
  //    image, forever, including after the key is rotated. A container receives its secrets at
  //    RUNTIME. So `KEYSTONE_SIGNING_CERT_PEM` carries the PEM directly.
  // ★★★ AND IT STILL FAILS CLOSED: if NEITHER source is present the invariant fails, exactly as
  //     before. This adds a source; it does not add an escape. The parse checks are unchanged and
  //     apply to whichever source supplied the bytes — an empty or non-PEM value from the env var
  //     is refused on the same terms as an empty file.
  const certPem = env.KEYSTONE_SIGNING_CERT_PEM;
  const certPath = env.KEYSTONE_SIGNING_CERT_PATH;
  if (!certPem && !certPath) {
    failures.push(
      "no signing certificate: set KEYSTONE_SIGNING_CERT_PEM (the PEM itself, preferred in a " +
      "container) or KEYSTONE_SIGNING_CERT_PATH (a file)"
    );
  } else if (certPem) {
    // ★ `where` names the SOURCE, not a path, so the failure message cannot imply a file that
    //   does not exist — the misleading-message hazard §D2.2 records for verifyIdToken.
    const where = "KEYSTONE_SIGNING_CERT_PEM";
    if (certPem.trim().length === 0) {
      failures.push(`signing certificate in ${where} is empty`);
    } else if (!/-----BEGIN [A-Z ]*CERTIFICATE-----/.test(certPem)) {
      failures.push(`signing certificate in ${where} is not PEM (no BEGIN CERTIFICATE block)`);
    }
  } else {
    try {
      const read = deps.readCertificate ?? ((p) => readFile(p, "utf8"));
      const pem = await read(certPath);
      if (typeof pem !== "string" || pem.trim().length === 0) {
        failures.push(`signing certificate at ${certPath} is empty`);
      } else if (!/-----BEGIN [A-Z ]*CERTIFICATE-----/.test(pem)) {
        failures.push(`signing certificate at ${certPath} is not PEM (no BEGIN CERTIFICATE block)`);
      }
    } catch (err) {
      failures.push(`signing certificate at ${certPath} is unreadable: ${err.message}`);
    }
  }

  // ── 3. ★ EVERY tenant has a REAL timezone ─────────────────────────────────
  // ★ Not "the column is NOT NULL" — the schema already guarantees that. This asserts the VALUE
  // is a zone this runtime can resolve. 'America/Los_Angeles' and 'US/Pacific' both parse;
  // 'PST', 'Pacific Time' and '' do not, and any of them would silently shift every booking.
  if (deps.queryTenantTimezones) {
    try {
      const rows = await deps.queryTenantTimezones();
      for (const r of rows) {
        if (!isValidTimezone(r.timezone)) {
          const hint = resolveTimezoneHint(r.timezone);
          // ★ Name what it WOULD have silently become. "EST is invalid" sends someone hunting;
          // "EST would resolve to America/Panama, which has no DST" ends the conversation.
          const because = hint
            ? ` — it would silently resolve to ${hint}; use that canonical name if it is what you mean`
            : "";
          failures.push(
            `tenant ${r.slug ?? r.id}: timezone ${JSON.stringify(r.timezone)} is not a canonical IANA zone${because}`
          );
        }
      }
    } catch (err) {
      failures.push(`could not read tenant timezones: ${err.message}`);
    }
  }

  // ── 4. ★★★ WHICH ENVIRONMENT IS THIS, AND DOES ITS CONFIGURATION AGREE? (08 §6, §7) ───────────────
  //    Staging must be physically unable to reach production or charge a live card; production must not
  //    sign people in against the staging Firebase project. A process that boots with a crossed wire looks
  //    healthy and does real damage, so this refuses to bind — same reasoning as checks 1–3.
  const ENVIRONMENTS = ["local", "staging", "production"];
  const environment = env.KEYSTONE_ENVIRONMENT;
  // ★★★ `local` MEANS A DEVELOPER'S MACHINE, AND A DEPLOYMENT CANNOT CLAIM IT (Stage 2 final review C1).
  //     `local` skips every check below, and probeStorage exempts `local` from contacting the store, so a
  //     Railway service mis-set to `local` used to pass its deploy healthcheck having measured nothing. Railway
  //     injects RAILWAY_* identifiers into every deployment it runs; a developer's shell has none of them.
  const RAILWAY_MARKERS = ["RAILWAY_PROJECT_ID", "RAILWAY_ENVIRONMENT_ID", "RAILWAY_SERVICE_ID", "RAILWAY_DEPLOYMENT_ID"];
  const onRailway = RAILWAY_MARKERS.filter((k) => typeof env[k] === "string" && env[k] !== "");
  if (!ENVIRONMENTS.includes(environment)) {
    failures.push(`KEYSTONE_ENVIRONMENT must be one of ${ENVIRONMENTS.join(" | ")} (got ${JSON.stringify(environment ?? null)}); there is no default`);
  } else if (environment === "local" && onRailway.length) {
    failures.push(`KEYSTONE_ENVIRONMENT=local on a Railway deployment (${onRailway.join(", ")} present) — local is for a developer's machine and skips every environment check; set staging or production`);
  } else if (environment !== "local") {
    if (environment === "production" && env.KEYSTONE_MAIL_CAPTURE_SMTP) failures.push("KEYSTONE_MAIL_CAPTURE_SMTP is set in production: mail capture would swallow real email");
    const fp = deps.productionFingerprint === undefined
      ? JSON.parse(env.KEYSTONE_PRODUCTION_FINGERPRINT ?? "null")
      : deps.productionFingerprint;
    if (!fp) failures.push("KEYSTONE_PRODUCTION_FINGERPRINT is not set (hostnames + Firebase project id of production; not a secret)");
    const hostOf = (u) => { try { return new URL(u).hostname; } catch { return null; } };
    // ★★★ RULING R23 — THIS LOOP DELIBERATELY NAMES BOTH `KEYSTONE_STRIPE_SECRET_KEY` AND
    //     `KEYSTONE_STRIPE_API_KEY`, EVEN THOUGH F478 MADE THE SECOND NAME A DEFECT EVERYWHERE
    //     ELSE. `db/gates/s2_one_name_per_credential.mjs` enforces "one name per credential" across
    //     `src/` and excludes THIS FILE, BY NAME, from that scan — because what this check is doing
    //     is different in kind from reading a configured secret: it is asking "could a live Stripe
    //     key be sitting on staging under ANY name we might plausibly have used", and a WIDER net is
    //     correct for that question, not a defect in it. NEVER "tidy" this down to one name — a
    //     future rename that adds a third alias for the platform key would need a third name here
    //     too, and this comment is what tells that session not to delete the second one instead.
    if (fp && environment === "staging") {
      for (const name of ["KEYSTONE_STRIPE_SECRET_KEY", "KEYSTONE_STRIPE_API_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_LIVE_WEBHOOK_SECRET"]) {
        const v = env[name];
        if (typeof v === "string" && /^(sk|rk)_live_/.test(v)) failures.push(`staging holds a LIVE Stripe key in ${name}`);
        if (name === "STRIPE_LIVE_WEBHOOK_SECRET" && v) failures.push("staging must not hold STRIPE_LIVE_WEBHOOK_SECRET");
      }
      const checks = [
        ["KEYSTONE_DATABASE_URL", fp.dbHosts, "production database"],
        ["KEYSTONE_WORKER_DATABASE_URL", fp.dbHosts, "production database"],
        ["KEYSTONE_S3_ENDPOINT", fp.s3Hosts, "production storage"],
        ["KEYSTONE_N8N_URL", fp.n8nHosts, "production n8n"],
      ];
      for (const [name, hosts, what] of checks) {
        const h = env[name] ? hostOf(env[name]) : null;
        if (h && hosts.includes(h)) failures.push(`staging ${name} points at the ${what} (${h})`);
      }
      if (env.KEYSTONE_FIREBASE_PROJECT_ID === fp.firebaseProjectId) failures.push("staging uses the production Firebase project");
    }
    if (fp && environment === "production" && env.KEYSTONE_FIREBASE_PROJECT_ID !== fp.firebaseProjectId) {
      failures.push(`production must use Firebase project ${fp.firebaseProjectId}, got ${JSON.stringify(env.KEYSTONE_FIREBASE_PROJECT_ID ?? null)}`);
    }
  }

  // ── 5. ★★★ CT-077 — THE MASTER KEY MUST BE PROVISIONED, ON PRODUCTION AND STAGING. ─────────────
  //    src/secrets/envelope.mjs refuses to boot from a missing/malformed KEYSTONE_MASTER_KEY the
  //    moment something first tries to seal or open a secret — but "the first webhook connect after
  //    deploy" is a client-watching moment, exactly the class of incident this file exists to catch
  //    BEFORE traffic arrives (see the docstring at the top of this file). `local` skips this check,
  //    same as every other one here — a developer's machine is not required to hold a production key.
  //    ★ The error NAMES the variable and NEVER prints it — same discipline `loadMasterKey` already
  //    keeps in `src/secrets/envelope.mjs`.
  if (environment === "production" || environment === "staging") {
    const raw = env.KEYSTONE_MASTER_KEY;
    if (!raw) {
      failures.push("KEYSTONE_MASTER_KEY is not set (required on staging and production; not printed)");
    } else {
      const key = Buffer.from(raw, "base64");
      if (key.length !== 32) {
        failures.push(`KEYSTONE_MASTER_KEY must be 32 bytes base64-encoded (got ${key.length}; value not printed)`);
      }
    }
  }

  if (failures.length) throw new StartupAssertionError(failures);
  return { ok: true, checked: ["database_url", "signing_certificate", "tenant_timezones", "environment", "master_key"] };
}

// ─────────────────────────────────────────────────────────────────────────────
// P1.16 — the two endpoints
// ─────────────────────────────────────────────────────────────────────────────

/** Liveness. Deliberately checks NOTHING external. See the note at the top. */
export function healthz() {
  return { status: 200, body: { status: "ok", uptimeSeconds: Math.round(process.uptime()) } };
}

/**
 * Readiness — all four conditions P1.16 names:
 *   db reachable · migrations current · signing cert present · timezone set
 * ★ A readiness probe that only pings the DB reports healthy while the signing certificate is
 * missing, which is exactly the failure P1.17 exists to prevent reaching a client.
 */
export async function readyz(deps = {}) {
  const checks = {};
  const fail = (k, msg) => { checks[k] = { ok: false, detail: msg }; };
  const pass = (k, detail) => { checks[k] = { ok: true, ...(detail ? { detail } : {}) }; };

  // db
  // ★★★ P12.6 / F2 — THIS CHECK USED TO FAIL OPEN, AND SO DID TWO OF THE OTHER THREE.
  // It read `const r = await deps.pingDatabase?.(); r === false ? fail(...) : pass(...)`.
  // Mounted "unchanged", `deps` is `{}`, so `deps.pingDatabase?.()` is `undefined`,
  // `undefined === false` is FALSE, and the check took the PASS branch:
  // ★★ /readyz RETURNED 200 READY, REPORTING THE DATABASE HEALTHY WITHOUT EVER CONTACTING IT.
  // The docstring four lines above warns about a WEAKER version of this same bug. The module
  // shipped the stronger version of the defect it was written to prevent.
  //
  // ★ The `migrations` check was the only one of the four that was already right —
  // `if (!m) fail("migrations", "no migration check supplied")` — so the correct shape was
  // present in this very function and the other three did not follow it. They do now.
  //
  // ★★ AN ABSENT PROBE IS A FAILED PROBE. "Nobody told me how to check" is not evidence of
  // health; it is the absence of evidence, and a readiness endpoint that cannot tell those
  // apart will route live traffic at a process that cannot serve it.
  if (!deps.pingDatabase) {
    fail("database", "no database ping supplied — an absent probe is a FAILED probe, never a pass");
  } else {
    try {
      const r = await deps.pingDatabase();
      r === false ? fail("database", "ping returned false") : pass("database");
    } catch (err) { fail("database", err.message); }
  }

  // ★ migrations CURRENT — not merely "the table exists". A replica running old code against a
  // newer schema, or new code against an older one, is a silent correctness problem.
  try {
    const m = await deps.checkMigrations?.();
    if (!m) fail("migrations", "no migration check supplied");
    else if (m.pending > 0) fail("migrations", `${m.pending} migration(s) pending`);
    else if (m.drift) fail("migrations", "applied migration checksums do not match the files");
    else pass("migrations", `${m.applied} applied`);
  } catch (err) { fail("migrations", err.message); }

  // signing certificate
  // ★★ F2, SECOND FAIL-OPEN: `err.failures?.filter(...)` yields `[]` for any throw that is not a
  // StartupAssertionError — a programming error, a bad `deps.env`, anything — and an empty list
  // took the PASS branch. So a check that THREW reported the certificate healthy.
  try {
    await assertStartupInvariants({
      env: deps.env ?? process.env,
      readCertificate: deps.readCertificate,
    });
    pass("signing_certificate");
  } catch (err) {
    if (!Array.isArray(err.failures)) {
      // ★ An unrecognised throw is a FAILURE, not a pass. It is reported verbatim rather than
      //   classified, because guessing at an unknown error's meaning is how the original bug read.
      fail("signing_certificate", `startup invariant check threw: ${err.message}`);
    } else {
      const certIssues = err.failures.filter((f) => /certificate/i.test(f));
      // ★ Non-certificate failures still matter here — they mean the process is misconfigured.
      //   Previously they were silently discarded and the check passed.
      const other = err.failures.filter((f) => !/certificate/i.test(f));
      if (certIssues.length) fail("signing_certificate", certIssues.join("; "));
      else if (other.length) fail("signing_certificate", `other startup invariant failed: ${other.join("; ")}`);
      else pass("signing_certificate");
    }
  }

  // required settings (names only): a deploy that lacks one never takes traffic
  try {
    const env = deps.env ?? process.env;
    if (holdsToManifest(env)) {
      const r = settingsReport(env, "app");
      if (r.missing.length) fail("settings", `missing required setting(s): ${r.missing.join(", ")}`);
      else pass("settings", r.missingWarn.length ? `all required set; recommended but unset: ${r.missingWarn.join(", ")}` : `${r.checked.length} checked`);
    }
  } catch (err) { fail("settings", `settings check threw: ${err.message}`); }

  // timezone
  // ★★ F2, THIRD FAIL-OPEN: `(await deps.queryTenantTimezones?.()) ?? []` became `[]` when no
  // probe was supplied, zero rows means zero bad rows, and the check passed with
  // `"0 tenant(s)"` — a number that looks like a measurement and is the absence of one.
  if (!deps.queryTenantTimezones) {
    fail("timezone", "no tenant-timezone probe supplied — an absent probe is a FAILED probe");
  } else {
    try {
      const rows = (await deps.queryTenantTimezones()) ?? [];
      const bad = rows.filter((r) => !isValidTimezone(r.timezone));
      bad.length
        ? fail("timezone", `${bad.length} tenant(s) with an invalid timezone: ` +
            bad.map((r) => `${r.slug ?? r.id}=${JSON.stringify(r.timezone)}`).join(", "))
        : pass("timezone", `${rows.length} tenant(s)`);
    } catch (err) { fail("timezone", err.message); }
  }

  // ★★★ STORAGE — 01 default 7 names four conditions for readiness: database, migrations applied,
  // signing certificate AND STORAGE. Storage was the one that had never been wired. For three days the
  // file store was unreachable from every other service (its listeners were bound IPv4-only on Railway's
  // IPv6-only private network) and nothing in the product noticed. (The OFF-SITE BACKUP's failure in F487
  // turned out to have a different cause — its rclone address — so this check is not F487's fix; it is
  // how the product notices the store is gone, whatever the reason.)
  //
  // ★★ IT FAILS CLOSED, THE SAME WAY THE OTHER FOUR DO. An absent probe is a FAILED probe (P12.6/F2):
  // "nobody wired the storage check" must never read as "storage is healthy".
  //
  // ★ AND A FAILING STORAGE CHECK CANNOT TAKE THE LIVE SITE DOWN. [MEASURED, docs.railway.com —
  //   "Railway calls the endpoint at deploy time, not continuously after the deployment is live"]
  //   the healthcheck gates a DEPLOYMENT, so the worst case here is that a new version waits while
  //   the file store is unreachable. The running app keeps serving, and shows 06 §5's "Files are
  //   unavailable — try again" on the surfaces that need a file. Both specs are satisfied.
  if (!deps.probeStorage) {
    fail("storage", "no storage probe supplied — an absent probe is a FAILED probe, never a pass");
  } else {
    try {
      const r = await deps.probeStorage();
      // ★ `false` is a failure and so is a probe that reports `{ ok: false }`. Only an explicit
      //   affirmative passes — `undefined` is not an answer, it is the absence of one.
      if (r === false || (r && typeof r === "object" && r.ok === false)) {
        fail("storage", (r && r.detail) || "storage probe reported not reachable");
      } else if (r === true || (r && typeof r === "object" && r.ok === true)) {
        pass("storage", (r && r.detail) || undefined);
      } else {
        fail("storage", `storage probe returned ${JSON.stringify(r)} — not an answer`);
      }
    } catch (err) { fail("storage", err.message); }
  }

  const ok = Object.values(checks).every((c) => c.ok);
  return { status: ok ? 200 : 503, body: { status: ok ? "ready" : "not_ready", checks } };
}
