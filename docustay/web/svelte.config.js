import adapter from "@sveltejs/adapter-node";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
// the CSP hash of the one inline script in app.html (Appearance and the js class before first paint), computed from the file so it can never go stale when that script is edited
const APP_HTML_SCRIPT_HASH = "sha256-" + createHash("sha256").update(/<script>([\s\S]*?)<\/script>/.exec(readFileSync(new URL("./src/app.html", import.meta.url), "utf8"))[1]).digest("base64");
// Part 30 item 0 — a Content-Security-Policy for the pages Docustay owns. SvelteKit adds the nonces/hashes for its own inline scripts (mode "auto").
// Nothing third-party loads except what is named here: blob: for the PDF.js worker and signature images, Google Tag Manager only after a visitor accepts (public site), and Cloudflare's bot check on the sign-up page only (a deployment with no site key never loads it).
export default {
  kit: {
    adapter: adapter({ precompress: true }),
    inlineStyleThreshold: 30000,   // the page CSS rides inside the HTML: seven stylesheet requests on first paint became none
    // the public site is prerendered; links into the API (the OpenAPI file, the interactive reference) are served by the backend at run time, so the crawl must not fail on them
    prerender: { handleHttpError: ({ path, message }) => { if (path.startsWith("/api/")) return; throw new Error(message); } },
    csrf: { checkOrigin: false },   // same-origin proxy: the API does its own origin/idempotency checks
    csp: {
      mode: "auto",
      directives: {
        "default-src": ["self"],
        "script-src": ["self", "wasm-unsafe-eval", APP_HTML_SCRIPT_HASH, "https://www.googletagmanager.com", "https://challenges.cloudflare.com"],   // Tag Manager: loaded by lib/site/Consent.svelte ONLY after a visitor accepts (public site only);   // the one inline script in app.html (theme and js class before first paint); an external file blocked first paint for ~4 s in the throttled lab
        "style-src": ["self", "unsafe-inline"],
        "img-src": ["self", "data:", "blob:", "https://www.googletagmanager.com", "https://www.google-analytics.com"],
        "media-src": ["self", "blob:"],
        "font-src": ["self", "data:"],
        "connect-src": ["self", "https://challenges.cloudflare.com", "https://identitytoolkit.googleapis.com", "https://securetoken.googleapis.com", "https://www.googletagmanager.com", "https://www.google-analytics.com", "https://region1.google-analytics.com", "https://analytics.google.com"],   // + the Google hosts for analytics after consent, public site only;   // Firebase sign-in is called from the browser (lib/auth.js); nothing else leaves the origin
        "worker-src": ["self", "blob:"],
        "frame-src": ["self", "https://challenges.cloudflare.com"],
        "frame-ancestors": ["none"],
        "object-src": ["none"],
        "base-uri": ["self"],
        "form-action": ["self"]
      }
    }
  }
};
