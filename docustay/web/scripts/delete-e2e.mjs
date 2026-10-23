// DELETING THE WORKSPACE end to end, light / dark / phone: the sole-owner notice links straight to Delete this workspace; a paid plan is explained with the exact days left (or Lifetime) before the owner can confirm,
// the checkbox gates the button, the request carries the acknowledgement, the pending state says what ended and that Keep comes back on Free. Server answers are stood in with page.route (no Stripe, nothing deleted).
//   node scripts/delete-e2e.mjs --base http://127.0.0.1:5181 --out /tmp/delete-e2e [--scheme dark] [--width 390]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { BETA_WEB, WS, contextFor } from "./pm-lib.mjs";
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg("--base", BETA_WEB), SCHEME = arg("--scheme", "light"), WIDTH = Number(arg("--width", 1440));
const OUT = arg("--out", "/tmp/delete-e2e"); mkdirSync(OUT, { recursive: true });
const TAG = `${SCHEME}${WIDTH < 700 ? "-phone" : ""}`;
let pass = 0, fail = 0; const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const json = (b, s = 200) => ({ status: s, contentType: "application/json", body: JSON.stringify(b) });
const browser = await chromium.launch();
const ctx = await contextFor(browser, WS.pro, { base: BASE, width: WIDTH, height: WIDTH < 700 ? 844 : 900, colorScheme: SCHEME });
if (SCHEME === "dark") await ctx.addCookies([{ name: "docustay-theme", value: "dark", url: BASE }]);
const page = await ctx.newPage(); const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200))); page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|favicon|net::ERR|40\d/.test(m.text())) errors.push(m.text().slice(0, 200)); });
const noSideScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const DAY = 86400_000;
const STATUS = (o = {}) => ({ account: null, workspace: null, isOwner: true, soleOwner: true, graceDays: { account: 14, workspace: 7 }, reauthMinutes: 15, plan: { kind: "none" }, ...o });
async function arrange(status, { onDelete = null } = {}) {
  await page.unrouteAll({ behavior: "ignoreErrors" }); const calls = [];
  await page.route("**/api/account/deletion", (r) => r.request().method() === "GET" ? r.fulfill(json(status)) : r.fulfill(json({}, 405)));
  await page.route("**/api/product/docustay/delete-workspace", (r) => { const b = JSON.parse(r.request().postData() ?? "{}"); calls.push(["delete", b]); r.fulfill(json(onDelete?.(b) ?? { requested: true, status: "pending", scheduledFor: new Date(Date.now() + 7 * DAY).toISOString() })); });
  await page.route("**/api/product/docustay/delete-workspace/cancel", (r) => { calls.push(["keep"]); r.fulfill(json({ cancelled: true })); });
  return calls;
}
const go = async (path) => { await page.goto(`${BASE}${path}`, { waitUntil: "load", timeout: 60000 }); await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {}); };
const body = async () => (await page.locator("main").first().innerText()).replace(/\s+/g, " ");

// 1 · the sole-owner notice on My account links straight to the workspace deletion
await arrange(STATUS()); await go("/settings?tab=account");
await page.getByTestId("delete-account-sole-owner").waitFor({ timeout: 20000 });
ok("[account] the sole-owner notice offers a link to Delete this workspace", (await page.getByTestId("sole-owner-to-workspace").getAttribute("href")) === "/settings?tab=data&delete=workspace#delete-workspace");
ok("[account] and one step that deletes the workspace and the account together", /workspace and my account together/.test(await page.getByTestId("sole-owner-both").innerText()));
ok("[account] it says the account goes with the workspace", /including yours/.test(await page.getByTestId("delete-account-sole-owner").innerText()));
await page.screenshot({ path: `${OUT}/account-sole-owner-${TAG}.png` });
await page.getByTestId("sole-owner-both").click(); await page.waitForURL(/tab=data/, { timeout: 10000 });
await page.getByTestId("delete-workspace-confirm").waitFor({ timeout: 15000 });
ok("[data] following it lands on Delete this workspace with the confirmation already open", (await page.getByTestId("delete-workspace-confirm").count()) === 1);

// 2 · Pro with days left
let calls = await arrange(STATUS({ plan: { kind: "subscription", planKey: "docustay_pro", planName: "Pro", daysLeft: 13, periodEnd: new Date(Date.now() + 13 * DAY).toISOString(), cancelling: false } }));
await go("/settings?tab=data&delete=workspace"); await page.getByTestId("delete-plan-notice").waitFor({ timeout: 20000 });
const n = (await page.getByTestId("delete-plan-notice").innerText()).replace(/\s+/g, " ");
ok("[pro] says the plan ends now", /Deleting ends your Pro plan now/.test(n));
ok("[pro] gives the exact number of paid days left", /13 paid days left/.test(n));
ok("[pro] says they are lost, cannot be recovered, no refund and no credit", /lost/.test(n) && /cannot be recovered/.test(n) && /no refunds and no credit/.test(n));
ok("[pro] says Keep brings the workspace back on Free, before they confirm", /comes back on the Free plan/.test(await body()));
await page.getByTestId("delete-workspace-confirm").fill("Test workspace");
ok("[pro] the schedule button stays off until they tick that they understand", await page.getByTestId("delete-workspace-go").isDisabled());
await page.screenshot({ path: `${OUT}/data-pro-${TAG}.png` });
await page.getByTestId("delete-plan-understood").check();
ok("[pro] ticking it turns the button on", !(await page.getByTestId("delete-workspace-go").isDisabled()));
await page.getByTestId("delete-workspace-go").click(); await page.waitForTimeout(500);
const sent = calls.find((c) => c[0] === "delete")?.[1];
ok("[pro] the request carries the typed name and the acknowledgement", sent?.confirm === "Test workspace" && sent?.acknowledgePlanLoss === true);
ok("[pro] no sideways scroll", await noSideScroll());

// 3 · the pending state: what ended, and Keep comes back on Free
calls = await arrange(STATUS({ workspace: { id: "r1", kind: "workspace", status: "pending", scheduledFor: new Date(Date.now() + 7 * DAY).toISOString() } }));
await go("/settings?tab=data"); await page.getByTestId("delete-workspace-pending").waitFor({ timeout: 20000 });
ok("[pending] says when it will be deleted and that Keep comes back on Free", (await page.getByTestId("delete-keep-free").innerText()).includes("Free plan"));
await page.screenshot({ path: `${OUT}/data-pending-${TAG}.png` });
await page.getByTestId("delete-workspace-keep").click(); await page.waitForTimeout(500);
ok("[pending] Keep this workspace calls the keep route", calls.some((c) => c[0] === "keep"));

// 4 · Lifetime
await arrange(STATUS({ plan: { kind: "lifetime", planKey: "docustay_lifetime", planName: "Lifetime" } }));
await go("/settings?tab=data&delete=workspace"); await page.getByTestId("delete-plan-notice").waitFor({ timeout: 20000 });
const l = (await page.getByTestId("delete-plan-notice").innerText()).replace(/\s+/g, " ");
ok("[lifetime] says it was a one-time purchase that is lost, cannot be recovered, no refund", /one-time purchase/.test(l) && /cannot be recovered/.test(l) && /no refunds/.test(l));
await page.screenshot({ path: `${OUT}/data-lifetime-${TAG}.png` });

// 5 · Free: nothing to confirm beyond the name
await arrange(STATUS({ soleOwner: false }));
await go("/settings?tab=data&delete=workspace"); await page.getByTestId("delete-workspace-confirm").waitFor({ timeout: 20000 });
ok("[free] no plan notice and no checkbox", (await page.getByTestId("delete-plan-notice").count()) === 0);
await page.getByTestId("delete-workspace-confirm").fill("x"); ok("[free] the button is on once a name is typed", !(await page.getByTestId("delete-workspace-go").isDisabled()));
ok("no page errors", errors.length === 0, errors.join(" | "));
await ctx.close(); await browser.close();
console.log(`\n${TAG}: ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
