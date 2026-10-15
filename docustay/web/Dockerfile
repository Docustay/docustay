# Docustay's web app (SvelteKit, adapter-node). BUILD CONTEXT = the repository root:  docker build -f docustay/web/Dockerfile .
# (the build drafts the legal pages from src/legal, the starter templates from src/documents/starters and their parser, and the Markdown docs from docustay/docs; all live at the root)
FROM node:22-alpine AS build
WORKDIR /repo
COPY src/legal ./src/legal
COPY src/documents ./src/documents
COPY src/http ./src/http
COPY docustay/docs ./docustay/docs
COPY docustay/web ./docustay/web
WORKDIR /repo/docustay/web
# the build scripts import island modules from /repo/src (the starters parser needs json-logic-js): let node find this folder's packages from there
RUN npm ci && ln -s /repo/docustay/web/node_modules /repo/node_modules && npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
# adapter-node refuses a request body over 512 KB by default; an upload part is up to 768 KiB, so every file over about half a megabyte failed with "Part 1 of the upload failed (502)" (measured 6 Oct 2026, sandbox: a 1 MB PDF).
# 25 MB covers the biggest single body the app takes (the app enforces each plan's own limit).
ENV BODY_SIZE_LIMIT=26214400
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
