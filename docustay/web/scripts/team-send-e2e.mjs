// SENDING TO TEAMMATES on the screens, light / dark / phone (server answers stood in with page.route): People > Team filter (read only, Team tag), Documents > Waiting on you tab (and it opens first when something waits).
// The picker, Add myself and a real send to a teammate are on the release queue's beta list.
//   node scripts/team-send-e2e.mjs --base http://127.0.0.1:5181 --out /tmp/team-send-e2e [--scheme dark] [--width 390]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { BETA_WEB, WS, contextFor } from "./pm-lib.mjs";
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg("--base", BETA_WEB), SCHEME = arg("--scheme", "light"), WIDTH = Number(arg("--width", 1440));
const OUT = arg("--out", "/tmp/team-send-e2e"); mkdirSync(OUT, { recursive: true });
const TAG = `${SCHEME}${WIDTH < 700 ? "-phone" : ""}`;
let pass = 0, fail = 0; const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const json = (b, s = 200) => ({ status: s, contentType: "application/json", body: JSON.stringify(b) });
const browser = await chromium.launch();
const ctx = await contextFor(browser, WS.pro, { base: BASE, width: WIDTH, height: WIDTH < 700 ? 844 : 900, colorScheme: SCHEME });
if (SCHEME === "dark") await ctx.addCookies([{ name: "docustay-theme", value: "dark", url: BASE }]);
const page = await ctx.newPage(); const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200))); page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|favicon|net::ERR|40\d/.test(m.text())) errors.push(m.text().slice(0, 200)); });
const MATES = [{ id: "11111111-1111-4111-8111-111111111111", name: "Pat Owner", email: "pat@x.test", role: "owner", you: true, team: true }, { id: "22222222-2222-4222-8222-222222222222", name: "Sam Member", email: "sam@x.test", role: "member", you: false, team: true }, { id: "33333333-3333-4333-8333-333333333333", name: "Ada Admin", email: "ada@x.test", role: "admin", you: false, team: true }];
const DOC = (n) => ({ id: `d${n}`, title: `Contract ${n}`, state: "sent", sent_at: new Date().toISOString() });
const go = async (path) => { await page.goto(`${BASE}${path}`, { waitUntil: "load", timeout: 60000 }); await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {}); };
const noSideScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
let teamCalls = 0;
await page.route("**/api/documents/teammates**", (r) => { teamCalls++; r.fulfill(json({ teammates: MATES })); });
await page.route("**/api/documents/people?**", (r) => r.fulfill(json({ contacts: [], total: 0 })));

// People: the Team filter
await go("/contacts"); await page.getByTestId("people-source").waitFor({ timeout: 20000 });
await page.getByTestId("people-source").selectOption("team"); await page.getByTestId("team-list").waitFor({ timeout: 8000 });
ok("[people] Team filter lists the teammates", (await page.getByTestId("team-list").locator("li").count()) === 3);
ok("[people] each carries a Team tag and a role word", (await page.getByTestId("team-tag").count()) === 3 && /Owner/.test(await page.getByTestId("team-row-pat@x.test").innerText()) && /Member/.test(await page.getByTestId("team-row-sam@x.test").innerText()));
ok("[people] you are marked, and nothing can be edited or removed here", /you/.test(await page.getByTestId("team-row-pat@x.test").innerText()) && (await page.getByTestId("team-list").locator("button").count()) === 0);
ok("[people] it says they are managed in Settings > Team and links there", /managed in Settings/i.test(await page.getByTestId("team-note").innerText()) && (await page.getByTestId("team-note").locator("a").getAttribute("href")) === "/settings?tab=team");
ok("[people] Add a person is still there, unchanged", await page.getByTestId("people-add").isVisible());
ok("[people] no sideways scroll", await noSideScroll());
await page.screenshot({ path: `${OUT}/people-team-${TAG}.png` });

// Documents: Waiting on you
await page.unroute("**/api/documents/teammates**");
await page.route("**/api/documents/waiting-on-me", (r) => r.fulfill(json({ documents: [{ ...DOC(1), action: "sign", from: "Ada Admin" }, { ...DOC(2), action: "approve", from: null }] })));
await page.route("**/api/list/documents", (r) => r.fulfill(json({ rows: [] })));
await go("/documents"); await page.getByTestId("doc-waiting-you").waitFor({ timeout: 20000 });
ok("[documents] with something waiting, the Waiting on you tab opens first and says how many", /Waiting on you/.test(await page.getByTestId("doc-tabs").innerText()) && (await page.getByTestId("doc-waiting-row").count()) === 2);
const acts = await page.getByTestId("doc-waiting-action").allInnerTexts();
ok("[documents] each row says sign or approve, and who from", acts.join("|") === "Needs your signature|Needs your approval" && /From Ada Admin/.test(await page.getByTestId("doc-waiting-you").innerText()) && /From your workspace/.test(await page.getByTestId("doc-waiting-you").innerText()));
ok("[documents] a row opens the document", (await page.getByTestId("doc-waiting-row").first().getAttribute("href")) === "/documents/d1");
ok("[documents] says to sign with the emailed link", /use the link in the email/.test(await page.getByTestId("doc-waiting-you").locator("xpath=following-sibling::p").innerText()));
ok("[documents] no sideways scroll", await noSideScroll());
await page.screenshot({ path: `${OUT}/documents-waiting-${TAG}.png` });
await page.unroute("**/api/documents/waiting-on-me");
await page.route("**/api/documents/waiting-on-me", (r) => r.fulfill(json({ documents: [] })));
await go("/documents");
ok("[documents] nothing waiting: the page opens as before (no waiting list)", (await page.getByTestId("doc-waiting-you").count()) === 0);
ok("no page errors", errors.length === 0, errors.join(" | "));
await ctx.close(); await browser.close();
console.log(`\n${TAG}: ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
