# P12.3 / P12.4 — keystone-app AND keystone-worker. ONE IMAGE, TWO COMMANDS.
#
# ★★ A DOCKERFILE, NOT NIXPACKS (§D4). Nixpacks infers a build from the repository's shape, so
# the thing that gets deployed is decided by a heuristic that can change under you between
# deploys — and "why did this build differently today" is unanswerable from the repo. A
# Dockerfile is the build, in the repo, reviewable.
#
# ★★★ NODE 22, PINNED, AND THE REASON IS P13.2 — WHICH HAS NOT HAPPENED YET.
# firebase-admin 14.4.0 requires node >= 22.18 while package.json declares ">=20". Local npm will
# install either, so the conflict does NOT surface on this Mac — it surfaces at image build time,
# in CI, later, looking like an unrelated infrastructure failure. P12.3 says to pin it HERE so
# that cannot happen. ★ If P13.2 instead pins firebase-admin ^13.10.0, this line may relax; it
# must not be relaxed for any other reason.
FROM node:22.23.4-bookworm-slim AS deps

WORKDIR /app

# ★ Copy ONLY the manifests first. Layer caching keys on file content, so a source edit that does
#   not touch package-lock.json reuses the install layer entirely.
COPY package.json package-lock.json ./

# ★★ `npm ci`, never `npm install`. `ci` installs exactly the lockfile and FAILS if the lockfile
#    and package.json disagree. `install` would silently resolve a newer version, which is how a
#    deployed image stops matching the one every gate was run against.
# ★ --omit=dev: the runtime dependency list is `pg`, `zod`, `hono`, `@hono/node-server`. tailwind,
#   postcss and stylelint are build/lint tools and have no business in a server image.
# ★★★ FOUND LIVE, 28 Sep 2026 (this deploy's own preflight): `npm ci` here refused with ERESOLVE —
#     `@signpdf/placeholder-pdfkit010@3.3.0` declares `peerDependencies: { pdfkit: "~0.10.0" }`, but
#     this project pins `pdfkit@0.20.2` (needed elsewhere; not renegotiable tonight). The package
#     itself only touches pdfkit's low-level `PDFReference`/buffer internals, which are unchanged
#     across that range — MEASURED against the installed 0.20.2 locally, `node -e
#     "require('@signpdf/placeholder-pdfkit010')"` loads and signs cleanly. `--legacy-peer-deps`
#     accepted this exact resolution in local dev already. NOT a permanent fix — the real one is
#     either bumping @signpdf/placeholder-pdfkit010 to a release that declares 0.20.x, or an npm
#     `overrides` entry scoped to just that package's peer range — recorded as open work, not
#     guessed at under deploy pressure tonight.
RUN npm ci --omit=dev --legacy-peer-deps

# ─────────────────────────────────────────────────────────────────────────────
# ★★★ the maintainer, 28 Sep 2026 — SVELTE (`webui/`) IS DELETED, ENTIRELY, NOT HELD AS A FALLBACK. "There must
#     be one front end, so nothing can pick between two versions of a screen" — the maintainer's own words,
#     overriding an EARLIER ruling the same night that kept webui/ as the undo path. The undo, if
#     ever needed, is Railway's own deploy history (it holds this deploy and the one before it),
#     not a second bundle carried in every image forever.
#
# P17.2 — THE FRONT-END BUILD STAGE. React (`webreact/`), the only front end now.
#
# ★★★ THE IMAGE PREVIOUSLY COPIED `src` AND `db` AND NOTHING ELSE. So even once static serving
# existed there would have been no bundle in the image to serve, and `/` would have answered the
# 503 that src/http/app.mjs deliberately makes loud. A deploy would have looked healthy —
# /healthz is liveness and checks nothing external — while the product was unreachable.
#
# ★★ A SEPARATE STAGE, BECAUSE THE BUILD NEEDS THE DEV DEPENDENCIES AND THE RUNTIME MUST NOT HAVE
#    THEM. vite and the shadcn/eslint tooling are build tooling; shipping them in a server image is
#    audited surface for no benefit. `deps` above is already --omit=dev, so this stage does its own
#    full install and nothing crosses over except `web/reactdist`.
#
# ★ ITS OWN package.json AND ITS OWN node_modules, exactly as the retired Svelte stage had. The
#   server image never sees webreact's build tooling, and adding to it cannot disturb the root
#   package-lock.json a backend-only session works against.
FROM node:22.23.4-bookworm-slim AS web

WORKDIR /app

# ★★★ FOUND LIVE, 28 Sep 2026 (this deploy's own attempt) — `webreact/vite.config.js` resolves
#     `@keystone` to `../src` and `@design` to `../design` (the SAME two backend-alias roots the
#     retired Svelte stage copied in, for the same reason: `PersonActionsPopover1Popover.jsx`,
#     `App.jsx`, `ClientTeenHome.jsx`, `DocPreviewModal1Modal.jsx` and others import real backend
#     modules through it — LIFECYCLE_STATUSES, SURFACES, CRISIS_LINE, VARIABLES, sectionRedirects).
#     `COPY webreact ./webreact` alone left this stage with no `src/` or `design/` to resolve those
#     aliases against — it built fine on a local checkout (where they exist as real sibling
#     directories outside the image) and failed only in the actual isolated Docker build context,
#     14 `[UNLOADABLE_DEPENDENCY]` errors, "No such file or directory". Copied in, same as the
#     retired stage always did.
COPY src ./src
COPY design ./design
COPY webreact ./webreact
RUN set -e; \
    cd webreact && npm ci --legacy-peer-deps && npm run build; \
    test -f ../web/reactdist/app.html || { echo "FATAL: webreact produced no web/reactdist/app.html"; exit 1; }; \
    test -d ../web/reactdist/webapp   || { echo "FATAL: webreact produced no web/reactdist/webapp asset directory"; exit 1; }; \
    test -f ../web/reactdist/login.html  || { echo "FATAL: webreact produced no web/reactdist/login.html";  exit 1; }; \
    test -f ../web/reactdist/signup.html || { echo "FATAL: webreact produced no web/reactdist/signup.html"; exit 1; }

# ─────────────────────────────────────────────────────────────────────────────
FROM node:22.23.4-bookworm-slim AS runtime

# ★★ Run as a NON-ROOT user. The node image ships an unprivileged `node` user (uid 1000); a
#    container process running as root shares that uid with the host namespace in several common
#    configurations, and nothing here needs it.
ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node src ./src
# ★ R13-D045 (16 Oct 2026, found by a Run 13 tester on the beta): the hosted service loads the Pro add-on from ../../pro/index.mjs (src/documents/addon.mjs). The Pro split (14 Oct) moved
#   automations, playbooks, bulk send and the own signing domain there; without this line the image shipped no add-on and every Pro door answered "install the Pro add-on".
# [p]ro matches only a folder named exactly pro (not the probe_*.mjs files at the root). The PUBLIC release builds this same file from a tree that has no pro/ (the add-on is closed source): there
#   the line copies only the root package.json into ./pro, which addon.mjs ignores (no index.mjs). package.json comes first so the add-on's own package.json wins when pro/ is present.
COPY --chown=node:node package.json [p]ro ./pro/
# ★ db/ is copied because the readiness probe reads db/migrations to answer "are migrations
#   current" by CHECKSUM (src/health/probes.mjs). Without it /readyz cannot distinguish a current
#   schema from a drifted one, and would have to guess — which is the F2 failure shape again.
COPY --chown=node:node db ./db
# Docustay self-host: the first-run entrypoint and the two scripts it runs on a brand-new database (nothing of ours in them — see docustay/README.md)
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node docustay ./docustay

# ★★★ the maintainer, 28 Sep 2026 — THE REACT BUNDLE, AND ONLY THE REACT BUNDLE. `KEYSTONE_STATIC_ROOT` and
#     the whole "which bundle" question are gone: `src/server.mjs`/`src/http/app.mjs` now hard-code
#     `./web/reactdist`, so this COPY is what `staticRoot` points at, full stop — no switch, no
#     Svelte bundle carried alongside it "just in case". ONLY `reactdist` is copied — `webreact/src`
#     and its two HTML entries are build inputs and have no business in a server image.
COPY --from=web --chown=node:node /app/web/reactdist ./web/reactdist

# Security (a release gate scans the image): bring the operating system's packages up to date, and take npm, corepack and yarn out of the RUNTIME image. The server starts with `node`; it never runs npm, and the copy of npm that ships in the base image carries its own bundled dependencies, which is where most scanner findings were.
RUN apt-get update && apt-get -y --no-install-recommends upgrade && rm -rf /var/lib/apt/lists/* \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-*
# the self-host package keeps its sealing certificate and install id in /data; a named volume takes this folder's owner on first use
RUN mkdir -p /data && chown node:node /data
USER node

# ★ Documentation only — Railway injects PORT and the server reads it.
EXPOSE 8080

# ★★★ HEALTHCHECK USES /healthz, NOT /readyz, AND THE DIFFERENCE MATTERS.
#   · /healthz is LIVENESS: is this process alive? It deliberately checks nothing external.
#   · /readyz is READINESS: should it receive traffic? It checks the database, migrations, the
#     signing certificate and every tenant's timezone.
#   Pointing a container HEALTHCHECK at /readyz means a brief database blip RESTARTS the process
#   — which cannot fix a database blip and turns a degraded system into a crash loop. Readiness
#   belongs to the load balancer; liveness belongs here.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# ── keystone-app is the default. keystone-worker overrides the command. ───────
# ★ §D4 permits "two images or one image two commands". One image is chosen because app and
#   worker share every dependency and every module; two images would be two things to keep in
#   step, and a worker running different code from the app is a class of bug that is very hard to
#   see. The Railway service for the worker sets:  node src/worker.mjs
CMD ["node", "src/server.mjs"]

# plumb:labels begin
LABEL org.opencontainers.image.title="Docustay app" \
      org.opencontainers.image.description="The open-source e-signature API. One flat price for every user, payments built in, self-hostable." \
      org.opencontainers.image.source="https://github.com/Docustay/docustay" \
      org.opencontainers.image.url="https://docustay.app" \
      org.opencontainers.image.version="0.2.2" \
      org.opencontainers.image.licenses="AGPL-3.0" \
      org.opencontainers.image.vendor="Docustay"
# plumb:labels end
