// ROLES on the screens, light / dark / phone: a Member sees Plays and Playbooks read-only (with the sentence why) and can reach their OWN Security (password, two-step, passkeys) from Settings > Account;
// an Admin or Owner sees the controls, and Security has left the Workspace group. The role comes from /api/nav (rank), stood in for here; the plays list answers `canManage` from the server (stood in too).
//   node scripts/roles-e2e.mjs --base http://127.0.0.1:5181 --out /tmp/roles-e2e [--scheme dark] [--width 390]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { BETA_WEB, WS, contextFor } from "./pm-lib.mjs";
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg("--base", BETA_WEB), SCHEME = arg("--scheme", "light"), WIDTH = Number(arg("--width", 1440));
const OUT = arg("--out", "/tmp/roles-e2e"); mkdirSync(OUT, { recursive: true });
const TAG = `${SCHEME}${WIDTH < 700 ? "-phone" : ""}`;
let pass = 0, fail = 0; const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const json = (b, s = 200) => ({ status: s, contentType: "application/json", body: JSON.stringify(b) });
const browser = await chromium.launch();
const ctx = await contextFor(browser, WS.pro, { base: BASE, width: WIDTH, height: WIDTH < 700 ? 844 : 900, colorScheme: SCHEME });
if (SCHEME === "dark") await ctx.addCookies([{ name: "docustay-theme", value: "dark", url: BASE }]);
const page = await ctx.newPage(); const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200))); page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|favicon|net::ERR|40\d/.test(m.text())) errors.push(m.text().slice(0, 200)); });
const PLAYS = (canManage) => ({ data: { canManage, custom: true,
  plays: [{ name: "plain-english", title: "Plain English", description: "Tone", kind: "house_style", builtin: true, on: true }, { name: "late-fee", title: "Late fee", description: "A clause", kind: "addon", builtin: true, on: false }, { name: "house-rule", title: "House rule", description: "Ours", kind: "skill", builtin: false, published: true, on: true }],
  playbooks: [{ name: "starter-pack", title: "Starter pack", description: "For one job", builtin: true, enabled: true, plays: [], templates: [] }, { name: "own-pack", title: "Own pack", description: "Ours", builtin: false, enabled: false, plays: [], templates: [] }] } });
async function arrange(rank, canManage) {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.route("**/api/nav", async (r) => { const res = await r.fetch(); const j = await res.json(); const d = j.data ?? j; d.rank = rank; await r.fulfill({ response: res, json: j }); });
  await page.route("**/api/documents/plays", (r) => r.request().method() === "GET" ? r.fulfill(json(PLAYS(canManage))) : r.continue());
  if (rank === "member") await page.route("**/api/settings/security", (r) => r.request().method() === "GET" ? r.fulfill(json({ mode: "off", canChange: false, canReset: false, idleMinutes: 0, youMustUseTwoStep: false, youWillNeedTwoStep: false })) : r.continue());
}
const go = async (path) => { await page.goto(`${BASE}${path}`, { waitUntil: "load", timeout: 60000 }); await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {}); };
const has = async (id) => (await page.getByTestId(id).count()) > 0;
const visible = async (sel) => { const l = page.locator(sel); const n = await l.count(); for (let i = 0; i < n; i++) if (await l.nth(i).isVisible()) return true; return false; };

// ── a Member: plays read-only ──
await arrange("member", false); await go("/plays");
await page.getByTestId("plays-list").waitFor({ timeout: 20000 });
ok("[member] sees the sentence about who may manage plays", /Only Admins and Owners/.test(await page.getByTestId("plays-members-note").innerText()));
ok("[member] sees which plays are on (read only), with no switches", (await page.getByTestId("play-state").count()) === 3 && (await page.getByTestId("play-on").count()) === 0);
ok("[member] cannot import or start a new skill", !(await visible("text=Import a skill")) && !(await visible("text=New skill")));
ok("[member] cannot copy, change or archive a play", !(await visible("[data-testid=play-duplicate]")) && !(await visible("[data-testid=play-edit]")) && !(await visible("text=Archive")));
ok("[member] can still read a play", await page.getByTestId("play-read").first().isVisible());
await page.screenshot({ path: `${OUT}/member-plays-${TAG}.png` });
await go("/plays?tab=packs"); await page.getByTestId("book-list").waitFor({ timeout: 20000 });
ok("[member] playbooks: the sentence, state words, no switches, no new or archive", (await has("books-members-note")) && (await page.getByTestId("book-state").count()) === 2 && (await page.getByTestId("book-on").count()) === 0 && !(await visible("text=Archive")) && !(await visible("text=New playbook")));
await page.screenshot({ path: `${OUT}/member-playbooks-${TAG}.png` });
// ── a Member: Settings is their account, and Security is in it ──
await go("/settings");
ok("[member] Settings shows the Account group with Security in it", (await has("settings-account")) && (await has("settings-security")) && (await has("settings-notifications")));
ok("[member] and no Workspace, Documents or Developers group", !(await has("settings-team")) && !(await has("settings-keys")) && !(await has("settings-documents")));
await page.getByTestId("settings-security").click();
await page.getByTestId("password-section").waitFor({ timeout: 20000 });
ok("[member] Security shows their own password and two-step", (await has("password-section")) && (await has("two-step-section")));
ok("[member] and none of the workspace rules", (await page.getByTestId("require-section").count()) === 0 && (await page.getByTestId("access-log").count()) === 0);
await page.screenshot({ path: `${OUT}/member-security-${TAG}.png` });

// ── an Admin / Owner: the controls, and Security out of the Workspace group ──
await arrange("admin", true); await go("/plays");
await page.getByTestId("plays-list").waitFor({ timeout: 20000 });
ok("[admin] no read-only sentence; switches are there", (await page.getByTestId("plays-members-note").count()) === 0 && (await page.getByTestId("play-on").count()) === 3);
ok("[admin] can start a new skill and import", (await visible("text=Import a skill")) && (await visible("[data-testid=play-edit]")));
await page.screenshot({ path: `${OUT}/admin-plays-${TAG}.png` });
await go("/settings");
ok("[admin] Workspace group has Team but Security sits under Account", (await has("settings-team")) && (await has("settings-security")) && (await page.locator("[data-testid=settings-areas]").innerText()).indexOf("Security") < (await page.locator("[data-testid=settings-areas]").innerText()).indexOf("Team"));
ok("no page errors", errors.length === 0, errors.join(" | "));
await ctx.close(); await browser.close();
console.log(`\n${TAG}: ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
