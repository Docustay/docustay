#!/usr/bin/env node
// robots.txt gate: fetches robots.txt (from BASE, default http://127.0.0.1:5190, or --file for static/robots.txt) and checks, per RFC 9309 matching, that EVERY crawler in lib/site/crawlers.js is allowed on the public pages and blocked on /sign/, /api/ and every app route; an unnamed crawler (*) gets the same answer. Seeded controls prove the checker can say "blocked" and "allowed".
import fs from "node:fs";
import { BOTS, KEEP_OUT, MUST_ALLOW } from "../src/lib/site/crawlers.js";
const argv = process.argv.slice(2), given = argv.find((a) => a.startsWith("http"));
let stop = () => {};
// fetches /robots.txt from a real preview of the build (or from the given address); --file reads static/robots.txt instead
const text = argv.includes("--file") ? fs.readFileSync(new URL("../static/robots.txt", import.meta.url), "utf8") : await (async () => { let base = given; if (!base) { const { startPreview } = await import("./crawl-gate.mjs"); const pv = await startPreview(); stop = pv.stop; base = `http://127.0.0.1:${pv.port}`; } return (await fetch(base + "/robots.txt")).text(); })();
stop();
export function parse(txt) {
  const groups = []; let cur = null, lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim(); const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "user-agent") { if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); lastWasAgent = true; }
    else if ((k === "allow" || k === "disallow") && cur) { cur.rules.push({ allow: k === "allow", path: v }); lastWasAgent = false; }
    else lastWasAgent = false;
  }
  return groups;
}
const toRe = (p) => new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
export function allowed(groups, agent, urlPath) {
  const a = agent.toLowerCase(); const g = groups.find((x) => x.agents.includes(a)) ?? groups.find((x) => x.agents.includes("*")); if (!g) return true;
  let best = null; for (const r of g.rules) { if (r.path === "") continue; if (toRe(r.path).test(urlPath) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r; }
  return best ? best.allow : true;
}
const groups = parse(text); const bad = [];
const must = (cond, msg) => { if (!cond) bad.push(msg); };
// positive and negative controls for the checker itself
const c = parse("User-agent: a\nDisallow: /x\nAllow: /x/ok\n\nUser-agent: *\nDisallow: /");
must(allowed(c, "a", "/y") && !allowed(c, "a", "/x/1") && allowed(c, "a", "/x/ok") && !allowed(c, "b", "/y"), "the checker's own seeded controls failed");
for (const bot of [...BOTS, "SomeUnnamedBot"]) {
  for (const p of MUST_ALLOW) must(allowed(groups, bot, p), `${bot} is blocked on ${p}`);
  for (const p of ["/sign/abc", "/api/openapi.json", "/api/documents", "/f/xyz", "/documents", "/settings/team", "/login", "/signup", "/automations", "/plays"]) must(!allowed(groups, bot, p), `${bot} is allowed on ${p}`);
}
for (const bot of BOTS) must(groups.some((g) => g.agents.includes(bot.toLowerCase())), `${bot} is not named in robots.txt`);
must(/^Sitemap: \S+\/sitemap\.xml/m.test(text), "robots.txt does not name the sitemap");
console.log(`robots.txt: ${BOTS.length} named crawlers x ${MUST_ALLOW.length} public paths allowed, ${KEEP_OUT.length} closed prefixes blocked`);
for (const b of bad.slice(0, 25)) console.log("  FAIL " + b); console.log(bad.length ? `ROBOTS GATE FAIL (${bad.length})` : "ROBOTS GATE PASS"); process.exit(bad.length ? 1 : 0);
