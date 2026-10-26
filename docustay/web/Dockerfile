# Docustay's web app (SvelteKit, adapter-node). BUILD CONTEXT = the repository root:  docker build -f docustay/web/Dockerfile .
# (the build drafts the legal pages from src/legal, the starter templates from src/documents/starters and their parser, and the Markdown docs from docustay/docs; all live at the root)
FROM node:22.23.4-alpine AS build
WORKDIR /repo
COPY src/legal ./src/legal
COPY src/documents ./src/documents
COPY src/http ./src/http
COPY src/product/docustay.facts.json ./src/product/docustay.facts.json
COPY src/product/docustayPrices.mjs ./src/product/docustayPrices.mjs
COPY src/product/docustayWords.mjs ./src/product/docustayWords.mjs
COPY docustay/docs ./docustay/docs
COPY docustay/web ./docustay/web
WORKDIR /repo/docustay/web
# the build scripts import island modules from /repo/src (the starters parser needs json-logic-js): let node find this folder's packages from there
# the Content-Security-Policy is written at build time and names the analytics server only when these are set; the prerendered pages also bake the website id in at build time (Railway hands a service variable to the build only if the Dockerfile declares it)
ARG DOCUSTAY_UMAMI_URL
ARG DOCUSTAY_UMAMI_ID
# PH1: PostHog's PUBLIC project token (the kind meant for web pages) and host; with either missing, no PostHog code runs and the CSP does not name it
ARG DOCUSTAY_POSTHOG_TOKEN
ARG DOCUSTAY_POSTHOG_HOST
ENV DOCUSTAY_UMAMI_URL=$DOCUSTAY_UMAMI_URL DOCUSTAY_UMAMI_ID=$DOCUSTAY_UMAMI_ID DOCUSTAY_POSTHOG_TOKEN=$DOCUSTAY_POSTHOG_TOKEN DOCUSTAY_POSTHOG_HOST=$DOCUSTAY_POSTHOG_HOST
# inside the image the generated files are made fresh from the sources it was given; on a developer machine the same script only checks them (plumb sync writes them)
ENV GEN_FLAG=""
RUN npm ci && ln -s /repo/docustay/web/node_modules /repo/node_modules && npm run build

FROM node:22.23.4-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
# adapter-node refuses a request body over 512 KB by default; an upload part is up to 768 KiB, so every file over about half a megabyte failed with "Part 1 of the upload failed (502)" (measured 6 Oct 2026, sandbox: a 1 MB PDF).
# The biggest single body the app takes is a 100 MB PDF as base64 JSON (templates/file, detect-fields: 4/3 of 100 MB + 256 KB, src/http/app.mjs).
# R13-D401: at 25 MB here a 20 MB PDF (27 MB as base64) was cut off and the edge answered 502. Other routes are refused early by src/hooks.server.js.
ENV BODY_SIZE_LIMIT=140072278
COPY --from=build /repo/docustay/web/build ./build
COPY --from=build /repo/docustay/web/frame-guard.mjs ./frame-guard.mjs
COPY --from=build /repo/docustay/web/package.json /repo/docustay/web/package-lock.json ./
# the server build imports some packages at run time (qrcode, papaparse, pdfjs-dist, signature_pad, tiptap, auto-animate): without them any page that uses one answered 500 when loaded directly (found 6 Oct 2026; scripts/runtime-deps-gate.mjs keeps it from coming back)
RUN npm ci --omit=dev --ignore-scripts
# Security (a release gate scans the image): current operating-system packages, and no npm, corepack or yarn in the runtime image (the server starts with `node`; the base image's npm carries its own bundled dependencies)
RUN apk upgrade --no-cache && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-*
# DOCUSTAY_API_URL = the the platform backend's internal address (never shown to a browser)
EXPOSE 3000
CMD ["node", "--import", "./frame-guard.mjs", "build"]

# plumb:labels begin
LABEL org.opencontainers.image.title="Docustay web" \
      org.opencontainers.image.description="The open-source e-signature API. One flat price for every user, payments built in, self-hostable." \
      org.opencontainers.image.source="https://github.com/Docustay/docustay" \
      org.opencontainers.image.url="https://docustay.app" \
      org.opencontainers.image.version="0.2.2" \
      org.opencontainers.image.licenses="AGPL-3.0" \
      org.opencontainers.image.vendor="Docustay"
# plumb:labels end
