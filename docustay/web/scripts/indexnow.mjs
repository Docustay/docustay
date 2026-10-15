#!/usr/bin/env node
// Tell Bing, Yandex and the other IndexNow search engines which pages exist or changed (run after a deploy that is live on the real host).
//   node scripts/indexnow.mjs [--dry]      reads static/sitemap.xml, posts the URLs once to api.indexnow.org
// The key is not a secret: it is the file name of a public text file that proves we own the site.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "static");
const keyFile = fs.readdirSync(root).find((f) => /^[0-9a-f]{32}\.txt$/.test(f));
if (!keyFile) { console.error("no IndexNow key file in static/"); process.exit(1); }
const key = keyFile.replace(/\.txt$/, ""); const host = "docustay.app";
if (fs.readFileSync(path.join(root, keyFile), "utf8").trim() !== key) { console.error("the key file does not contain its own name"); process.exit(1); }
const urls = [...fs.readFileSync(path.join(root, "sitemap.xml"), "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).filter((u) => new URL(u).host === host);
console.log(`${urls.length} urls, key file ${keyFile}`);
if (process.argv.includes("--dry")) process.exit(0);
const r = await fetch("https://api.indexnow.org/indexnow", { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ host, key, keyLocation: `https://${host}/${keyFile}`, urlList: urls.slice(0, 10000) }) });
console.log("IndexNow answered", r.status, r.status === 200 || r.status === 202 ? "(accepted)" : await r.text());
process.exit(r.status === 200 || r.status === 202 ? 0 : 1);
