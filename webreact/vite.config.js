// webreact/vite.config.js — the React front end (specs/react-rebuild/REACT-PLAN.md R-4, R1.1).
//
// ★★★ THE OUTPUT CONTRACT IS THE SERVER'S, NOT OURS. src/http/app.mjs serves, from
//     KEYSTONE_STATIC_ROOT: /webapp/* (assets), /fonts/*, /photos/*, /login → login.html,
//     /signup → signup.html, every other non-API GET → app.html. So the build writes exactly that
//     shape into web/reactdist and the cutover is an environment flip (R-23). No server change.
// ★★ OUTPUT OUTSIDE webui's web/webdist, and emptyOutDir only empties OUR directory — the recorded
//    failure where one build emptied another's output (webui/svelte.config.js header) cannot recur.
import { defineConfig } from "vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// Dev only: route like the Hono server does, so a deep link works under `vite`.
function serverLikeFallback() {
  return {
    name: "workbench-server-like-fallback",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url ?? "/";
        const p = url.split("?")[0];
        if (req.method !== "GET" || p.startsWith("/api/") || p.startsWith("/@") || p.startsWith("/src/") ||
            p.startsWith("/node_modules/") || p.startsWith("/fonts/") || p.startsWith("/photos/") || /\.[a-z0-9]+$/i.test(p)) return next();
        req.url = p === "/login" ? "/login.html" : p === "/signup" || p === "/setup" ? "/signup.html" : "/app.html";
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss(), serverLikeFallback()],
  resolve: {
    alias: {
      "@keystone": path.resolve(here, "../src"),
      "@design": path.resolve(here, "../design"),
      "@": path.resolve(here, "src"),
      "node:crypto": path.resolve(here, "src/lib/shims/node-crypto.js"), // server modules the UI imports (can.js)
      // Launch: the island's rules module (src/documents/rules.mjs, outside webreact/) imports json-logic-js; the image installs only webreact's own node_modules for this build, so the bare name must resolve here.
      "json-logic-js": path.resolve(here, "node_modules/json-logic-js"),
      // ★★★ Part 3 invoice rebuild — FOUND LIVE, first real render of the new PDF preview: the
      //     root project ALSO has its own `react`/`@react-pdf/renderer`/`@react-pdf/primitives`
      //     installs (invoicePdfServer.mjs needs them for the server-side attachment). Without
      //     this, a file under `@keystone` (physically outside webreact/) resolves THOSE bare
      //     specifiers from the ROOT's own node_modules instead of webreact's — a SEPARATE module
      //     instance, with its OWN `Font` registry singleton and its OWN React internals. MEASURED:
      //     `Font.register("Inter", ...)` called from invoicePdf.mjs registered into the root
      //     copy's registry; `usePDF` (imported directly in webreact) read from webreact's own
      //     copy, found nothing, and threw "Font family not registered: Inter" — and the two
      //     React copies disagreeing about element types is what produced the OTHER crash
      //     alongside it (React error #31, an invalid-child/invalid-element-type class of bug).
      //     Forcing every resolution of these four specifiers to webreact's OWN copy, regardless
      //     of which directory the importing file lives in, is what makes "one component, both
      //     sides" (this file's own design goal) actually hold at the module level, not just in
      //     source text.
      "react": path.resolve(here, "node_modules/react"),
      "react-dom": path.resolve(here, "node_modules/react-dom"),
      "@react-pdf/renderer": path.resolve(here, "node_modules/@react-pdf/renderer"),
      "@react-pdf/primitives": path.resolve(here, "node_modules/@react-pdf/primitives"),
      // ★ specs/INVOICE-SEND-FIX.md — the SAME class of bug the four aliases above exist for, hit
      //   by a NEW `@keystone` file: InvoiceEditor.jsx now imports src/money/invoiceView.mjs
      //   directly so the editor's preview is the exact function the server uses, and that file
      //   imports `zod`. Node's own module resolution walks up from the IMPORTING FILE's own
      //   directory (src/money/), never into a sibling webreact/node_modules — in the real Docker
      //   build (Dockerfile's `web` stage) there is no root-level node_modules at all for it to
      //   find on the way up, so this is not optional the way it looked in local dev (where the
      //   root project's OWN `npm install` happens to sit on that walk-up path and masks the bug).
      "zod": path.resolve(here, "node_modules/zod"),
      // ★ §23.5.14 — the SAME class of bug a third time: the free "sign a PDF" page runs src/documents/pdfFlatten.mjs in the browser, and that file imports `@cantoo/pdf-lib`. FOUND by the first sandbox build
      //   ("Rolldown failed to resolve import @cantoo/pdf-lib from /app/src/documents/pdfFlatten.mjs") — the Docker `web` stage has no root node_modules on the walk-up path, local dev does, so the local build passed.
      "@cantoo/pdf-lib": path.resolve(here, "node_modules/@cantoo/pdf-lib"),
    },
  },
  appType: "mpa",
  build: {
    outDir: path.resolve(here, "../web/reactdist"),
    emptyOutDir: true,
    assetsDir: "webapp",
    rollupOptions: {
      input: {
        app: path.resolve(here, "app.html"),
        login: path.resolve(here, "login.html"),
        signup: path.resolve(here, "signup.html"),
      },
    },
  },
  server: {
    fs: { allow: [".."] },
    // The local Keystone server (npm run dev at the repo root). Same origin from the browser's view,
    // so the host-only ks_session cookie works exactly as in production.
    proxy: { "/api": { target: "http://127.0.0.1:8799", changeOrigin: false } },
  },
});
