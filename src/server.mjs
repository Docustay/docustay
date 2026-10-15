#!/usr/bin/env node
// P12.5 — THE SERVER ENTRYPOINT.
//
// ★★★ assertStartupInvariants() RUNS BEFORE THE LISTENER BINDS, AND THAT ORDERING IS THE WHOLE
// POINT (M4.7). The two invariants it checks both have the same shape: they are wrong in a way
// that LOOKS like working software.
//   · a wrong tenant timezone produces plausible WRONG SLOTS — every booking that tenant makes
//     is silently shifted, and nothing errors;
//   · a missing signing certificate lets the app start normally and every signing fails later.
// A process that binds and THEN discovers this has already told the orchestrator it is healthy,
// has already been added to a load balancer, and has already served requests.
// ★ If it binds and then fails, it is not M4.7. The check is worthless in that order.

import "./logging/install.mjs";   // Run 7 part 6: every log line leaves without credentials or email addresses
import { serve } from "@hono/node-server";
import { assertStartupInvariants, StartupAssertionError } from "./health/index.mjs";
import { healthDeps, closeProbePool } from "./health/probes.mjs";
import { createApp, startIpWindowSweeper } from "./http/app.mjs";
import { installAuth, resolvePrincipal } from "./auth/install.mjs";
import { closePool, closeLimiterPool, closeStripeMirrorPool } from "./db/index.mjs";
import { startWorkerWatch } from "./health/workerWatch.mjs";
import { trustedProxyWarning } from "./http/trustedIp.mjs";
import { installHostDocumentsPorts } from "./ports/documents.mjs";
// ★ the Documents island asks its host for mail / brand / people / facts / price / usage — plugged in ONCE, here, at startup (src/documents/ports.mjs)
installHostDocumentsPorts();
import { installHostMailPorts } from "./ports/mail.mjs";
// ★ the mail module (one sending identity per organisation) asks its host for the provider, sender, brand and secrets — plugged in ONCE, here
installHostMailPorts();

const PORT = Number(process.env.PORT ?? 8080);

async function main() {
  const deps = healthDeps();

  // ── 1 · THE INVARIANTS. BEFORE ANYTHING BINDS. ─────────────────────────────
  try {
    const r = await assertStartupInvariants({
      env: process.env,
      readCertificate: deps.readCertificate,
      queryTenantTimezones: deps.queryTenantTimezones,
    });
    console.log(`startup invariants ok: ${r.checked.join(", ")}`);
  } catch (err) {
    if (err instanceof StartupAssertionError || Array.isArray(err.failures)) {
      console.error("\n★ STARTUP INVARIANTS FAILED — refusing to bind a listener:\n");
      for (const f of err.failures ?? [err.message]) console.error(`  ✗ ${f}`);
      console.error("");
    } else {
      console.error(`\n★ STARTUP INVARIANT CHECK THREW — refusing to bind a listener:\n  ${err.message}\n`);
    }
    // ★★ EXIT, DO NOT CATCH-AND-CONTINUE. health/index.mjs:78-79 says in its own words that the
    //    entrypoint "must NOT catch-and-continue". A process that logs this and serves anyway is
    //    strictly worse than one that never started, because it looks available.
    await shutdown(1);
    return;
  }

  // ── 2 · ONLY NOW: the app, and the listener. ───────────────────────────────
  // ★ P13 — install the DATABASE-backed session store before the first request. Until this
  //   runs, paths/index.mjs falls back to the in-memory Map the Y1 gates use, and a production
  //   process on that fallback would authenticate nobody (the Map is empty) — which fails closed,
  //   but for the wrong reason and with a confusing message.
  installAuth();
  // ★ P17.2 — the SERVER serves the front end; an in-process gate does not (see createApp's
  //   `serveFrontEnd` default).
  const app = createApp({
    deps,
    resolvePrincipal,
    serveFrontEnd: true,
    // ═══════════════════════════════════════════════════════════════════════════════════════
    // ★★★ `./web/webdist` — THE **SVELTE** BUNDLE. AND THIS LINE IS WHY CHANGING THE DEFAULT IN
    //     `createApp` WAS NOT ENOUGH.
    //
    //   [EXECUTED 2026-09-16] the default in `createApp({ staticRoot = "./web/webdist" })` was
    //   changed, the image built, the Dockerfile copied `web/webdist` in, Railway reported
    //   **"Deploy complete"** and `list-deployments` reported **SUCCESS** — and the served shell was
    //   still the REACT one, because THIS CALLER passes `staticRoot` explicitly and a default is
    //   only a default when nobody supplies the argument.
    //
    // ★★★ NOTHING ABOUT THAT FAILURE WAS VISIBLE FROM THE DEPLOY. It was found by fetching `/` and
    //     grepping the markup for `/webapp/` — CLAUDE.md §2.8b's rule, literally: *"NEVER trust the
    //     deploy's exit code."* A hash comparison would not have found it either: both bundles were
    //     freshly built and both were present in the image. **Only the CONTENT of what was served
    //     answers the question.**
    // ═══════════════════════════════════════════════════════════════════════════════════════
    // ★★★ the maintainer, 28 Sep 2026 — THE SWITCH IS GONE. Svelte (`webui/`) is deleted, not kept as a
    //     fallback — one front end, so nothing can pick between two versions of a screen. The
    //     comment above this line records the real incident `KEYSTONE_STATIC_ROOT` existed to
    //     avoid repeating; it still applies to "what does this deploy actually serve" as a
    //     question, even with only one bundle left to answer it from.
    staticRoot: "./web/reactdist",
  });
  const stopSweeper = startIpWindowSweeper();   // P12.9 / F24
  { const w = trustedProxyWarning(); if (w) console.error(`[config] ${w}`); }
  // ★ Stage 4 Task 3 / F504 layer 2 — assigned from the listen callback below, so the watcher starts
  //   only AFTER the listener actually binds (never before, same ordering argument as M4.7 at the top
  //   of this file), and `close()` can still stop it even though it starts later.
  let stopWorkerWatch = () => {};

  const server = serve(
    {
      fetch: app.fetch,
      port: PORT,
      // ★★★ NOT OPTIONAL. @hono/node-server replaces the GLOBAL Request/Response for speed.
      //     Stripe and Resend SDK calls must not run against a swapped global — a class-identity
      //     mismatch there presents as an inexplicable SDK failure far from here. ★ Documenso was a
      //     third example here and is retired (S2 Task 3, 01 default 9).
      overrideGlobalObjects: false,
    },
    (info) => {
      console.log(`keystone-app listening on :${info.port}`);
      stopWorkerWatch = startWorkerWatch({ env: process.env });
    }
  );

  const close = async (code) => {
    stopSweeper();
    stopWorkerWatch();
    // Round 3 (10 Oct 2026, MEASURED): `server.close` waits for every open request, so one hung request kept an old process alive for 20+ minutes after SIGTERM (still holding its database connections and locks).
    // Requests get KEYSTONE_DRAIN_MS to finish; then the connections are cut and the process exits.
    const drain = Number(process.env.KEYSTONE_DRAIN_MS ?? 25_000);
    await new Promise((r) => { const t = setTimeout(() => { try { server.closeAllConnections?.(); } catch { /* already closed */ } r(); }, drain); t.unref?.(); server.close(() => { clearTimeout(t); r(); }); });
    await shutdown(code);
  };
  process.on("SIGTERM", () => close(0));
  process.on("SIGINT", () => close(0));
}

async function shutdown(code) {
  await closeProbePool().catch(() => {});
  await closePool().catch(() => {});
  // ★ task 6.18 / F563 — the limiter's own connection pool (src/db/index.mjs withLimiterConnection),
  //   closed the same way as the request pool beside it.
  await closeLimiterPool().catch(() => {});
  // ★ specs/STRIPE-MIRROR.md §3.4 — the stripe-mirror's own connection pool (src/db/index.mjs
  //   withStripeMirrorConnection), closed the same way as the request pool beside it.
  await closeStripeMirrorPool().catch(() => {});
  process.exit(code);
}

main().catch(async (err) => {
  console.error(`FATAL: ${err.stack ?? err.message}`);
  await shutdown(1);
});
