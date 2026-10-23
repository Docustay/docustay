#!/usr/bin/env node
// Release-day Search Console step for docustay.app (property sc-domain:docustay.app, already verified).
//   node scripts/search-console-release.mjs            dry run: prints what it would do, calls nothing that changes anything
//   node scripts/search-console-release.mjs --go       submits the sitemap, then checks the top 25 URLs with the URL Inspection API
// Credentials: read at run time with gcloud from Secret Manager (example-oauth-client-id, example-oauth-client-secret, example-oauth-refresh-token); held in memory only, never printed or written.
// Honest limit: Google offers NO public API for "Request indexing" (the Indexing API is for job-posting and livestream pages only). A submitted sitemap is how new URLs are found;
// the URL Inspection API reports each page's index state; the manual button in Search Console stays a hand step for the few pages you want crawled first (the list is printed).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
const GO = process.argv.includes("--go"), SITE = "sc-domain:docustay.app", MAP = "https://docustay.app/sitemap.xml";
const TOP = ["/", "/features", "/features/how-it-works", "/features/scribe", "/features/payments", "/features/proof", "/features/automations", "/features/embedded-signing", "/features/test-mode", "/features/agent-ready", "/features/white-label", "/pricing", "/developers", "/developers/api", "/developers/sdks", "/developers/webhooks", "/free-templates", "/templates/nda-template", "/self-host", "/sign-pdf", "/open-source", "/trust", "/verify", "/docs/quickstart", "/about"];
const secret = (n) => execFileSync("gcloud", ["secrets", "versions", "access", "latest", `--secret=${n}`, "--project=example-project"], { encoding: "utf8" }).trim();
const inSitemap = new Set([...fs.readFileSync(new URL("../static/sitemap.xml", import.meta.url), "utf8").matchAll(/<loc>https:\/\/docustay\.app([^<]*)<\/loc>/g)].map((m) => m[1] || "/"));
const missing = TOP.filter((p) => !inSitemap.has(p)); if (missing.length) { console.error("not in the sitemap:", missing.join(", ")); process.exit(1); }
console.log(`${TOP.length} priority URLs, all in the sitemap. Mode: ${GO ? "GO" : "dry run"}`);
if (!GO) { console.log("Would: refresh the Google token, PUT the sitemap", MAP, "to", SITE, "and inspect:\n  " + TOP.map((p) => "https://docustay.app" + p).join("\n  ")); process.exit(0); }
const tok = await (await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: secret("foundry-oauth-client-id"), client_secret: secret("foundry-oauth-client-secret"), refresh_token: secret("foundry-oauth-refresh-token"), grant_type: "refresh_token" }) })).json();
if (!tok.access_token) { console.error("token refresh failed:", tok.error ?? "unknown"); process.exit(1); }
const H = { authorization: `Bearer ${tok.access_token}`, "content-type": "application/json" };
const put = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/sitemaps/${encodeURIComponent(MAP)}`, { method: "PUT", headers: H });
console.log(put.ok ? "sitemap submitted" : `sitemap submit failed: HTTP ${put.status}`);
for (const p of TOP) {
  const r = await fetch("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", { method: "POST", headers: H, body: JSON.stringify({ inspectionUrl: "https://docustay.app" + p, siteUrl: SITE }) });
  const j = await r.json().catch(() => ({})); console.log(p.padEnd(34), r.ok ? j.inspectionResult?.indexStatusResult?.coverageState ?? "?" : `HTTP ${r.status}`);
}
console.log("Request indexing by hand in Search Console for: /, /features, /pricing, /developers, /free-templates (the API cannot).");
