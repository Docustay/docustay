#!/usr/bin/env node
// The weekly site digest (V2 section 8.4): what a person should read once a week. Everything here is read-only and prints no secret.
//   - the sitemap (how many canonical pages), the redirect map size, the crawler check against a host, and the status of the local gates (read from their last CSV when present)
//   - Search Console queries and pages for docustay.app, ONLY when GSC_ACCESS_TOKEN is set in the environment (otherwise the section says so)
//   - Umami page and event totals, ONLY when UMAMI_URL, UMAMI_WEBSITE_ID and UMAMI_TOKEN are set
// Usage: node scripts/weekly-site-report.mjs [--base https://docustay.app] [--out DIR]     Output: <out>/<date>.md  (default specs/proofs/stage-t/launch-site/research/weekly)
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "https://docustay.app"), OUT = arg("--out", path.resolve(ROOT, "../../specs/proofs/stage-t/launch-site/research/weekly"));
const date = new Date().toISOString().slice(0, 10); const lines = [`# Weekly site report, ${date}`, ""];
const section = (t, body) => { lines.push(`## ${t}`, ...(Array.isArray(body) ? body : [body]), ""); };
const sm = fs.readFileSync(path.join(ROOT, "static/sitemap.xml"), "utf8"); const urls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
section("Sitemap", [`${urls.length} canonical pages in static/sitemap.xml.`, `Newest lastmod: ${[...sm.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]).sort().at(-1) ?? "none recorded"}.`]);
try { const out = execFileSync("node", [path.join(ROOT, "scripts/ai-crawler-check.mjs"), "--base", BASE], { encoding: "utf8", timeout: 240000 }); section("Crawler access", ["```", ...out.trim().split("\n").slice(-4), "```"]); } catch (e) { section("Crawler access", "The crawler check failed: " + String(e.stdout ?? e.message).split("\n").slice(-3).join(" | ")); }
const gate = (name, f) => { try { const rows = fs.readFileSync(f, "utf8").trim().split("\n").slice(1); const bad = rows.filter((r) => /,"[^"]+"\s*$/.test(r)).length; return `${name}: ${rows.length - bad} of ${rows.length} pages pass (${f})`; } catch { return `${name}: no report file at ${f}; run the gate first`; } };
section("Gates (last run)", [gate("Visual gate", "/tmp/vall.csv"), gate("Depth gate", "/tmp/depth-all.csv")]);
if (process.env.GSC_ACCESS_TOKEN) {
  try { const end = new Date(), start = new Date(end - 28 * 864e5); const r = await fetch("https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Adocustay.app/searchAnalytics/query", { method: "POST", headers: { authorization: `Bearer ${process.env.GSC_ACCESS_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10), dimensions: ["query"], rowLimit: 15 }) }); const j = await r.json(); section("Search Console, top queries (28 days)", (j.rows ?? []).map((x) => `- ${x.keys[0]}: ${x.clicks} clicks, ${x.impressions} impressions, position ${x.position.toFixed(1)}`).concat(j.rows ? [] : [JSON.stringify(j).slice(0, 200)])); } catch (e) { section("Search Console", "Query failed: " + e.message); }
} else section("Search Console", "Not read: GSC_ACCESS_TOKEN is not set (refresh the Google OAuth token from Secret Manager first; never print it).");
if (process.env.UMAMI_URL && process.env.UMAMI_WEBSITE_ID && process.env.UMAMI_TOKEN) {
  try { const end = Date.now(), start = end - 7 * 864e5; const r = await fetch(`${process.env.UMAMI_URL}/api/websites/${process.env.UMAMI_WEBSITE_ID}/stats?startAt=${start}&endAt=${end}`, { headers: { authorization: `Bearer ${process.env.UMAMI_TOKEN}` } }); section("Umami, last 7 days", ["```json", JSON.stringify(await r.json()), "```"]); } catch (e) { section("Umami", "Query failed: " + e.message); }
} else section("Umami", "Not read: the production Umami service does not exist yet (TY-ONLY), so UMAMI_URL, UMAMI_WEBSITE_ID and UMAMI_TOKEN are not set.");
fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, `${date}.md`), lines.join("\n") + "\n"); console.log(`wrote ${path.join(OUT, date + ".md")}`);
