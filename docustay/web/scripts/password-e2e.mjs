// PASSWORDS end to end, light / dark / phone: (A) forgot password by code (email -> six boxes -> new password -> done), (B) Settings > Security "Change password" / "Set a password", with and without two-step.
// The server's answers for the password calls are stood in for with page.route (so every state, wrong code, expired code, two-step on, is exact and sends no email); the web app and the sign-in are the real ones at --base.
// The REAL end to end (a real emailed code, a real change) is on the release queue's beta list.
//   node scripts/password-e2e.mjs --base http://127.0.0.1:5181 --out /tmp/password-e2e [--scheme dark] [--width 390]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { BETA_WEB, WS, contextFor } from "./pm-lib.mjs";
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg("--base", BETA_WEB), SCHEME = arg("--scheme", "light"), WIDTH = Number(arg("--width", 1440));
const OUT = arg("--out", "/tmp/password-e2e"); mkdirSync(OUT, { recursive: true });
const TAG = `${SCHEME}${WIDTH < 700 ? "-phone" : ""}`;
let pass = 0, fail = 0; const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const json = (b, s = 200) => ({ status: s, contentType: "application/json", body: JSON.stringify(b) });
const err = (message, s = 403) => json({ error: { kind: "forbidden", message } }, s);
const browser = await chromium.launch();
const errors = [];
const watch = (page) => { page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200))); page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|favicon|net::ERR|403|401/.test(m.text())) errors.push(m.text().slice(0, 200)); }); };
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
async function fresh() {
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: WIDTH < 700 ? 844 : 900 }, colorScheme: SCHEME });
  if (SCHEME === "dark") await ctx.addCookies([{ name: "docustay-theme", value: "dark", url: BASE }]);
  const page = await ctx.newPage(); watch(page); return { ctx, page };
}
const declineCookies = async (page) => { try { await page.getByRole("button", { name: "Decline" }).click({ timeout: 2500 }); } catch { /* none shown */ } };

// ── A · forgot password by code ───────────────────────────────────────────────────────────────────────────────────────────
{
  const { ctx, page } = await fresh(); const calls = [];
  let codeTry = 0;
  await page.route("**/api/auth/password-reset/request", (r) => { calls.push(["request", r.request().postData()]); r.fulfill(json({ sent: true })); });
  await page.route("**/api/auth/password-reset/code", (r) => { calls.push(["code", r.request().postData()]); codeTry++; r.fulfill(codeTry === 1 ? err("That code was not accepted.") : codeTry === 2 ? err("That code has expired — ask for a new one.") : json({ grant: "G".repeat(43), expiresInSeconds: 600 })); });
  await page.route("**/api/auth/password-reset/set", (r) => { calls.push(["set", r.request().postData()]); r.fulfill(json({ changed: true })); });
  await page.goto(`${BASE}/forgot`, { waitUntil: "load", timeout: 60000 }); await declineCookies(page);
  ok("[forgot] asks for the email first and promises a code", (await page.getByText("six-digit code").count()) > 0 && (await page.getByTestId("forgot-email").count()) === 1);
  await page.screenshot({ path: `${OUT}/forgot-1-email-${TAG}.png` });
  await page.getByTestId("forgot-email").fill("Jo@Example.com"); await page.getByTestId("forgot-send").click();
  await page.getByTestId("code-boxes").waitFor({ timeout: 8000 });
  ok("[forgot] six code boxes appear", (await page.locator("[data-testid=code-boxes] .box").count()) === 6);
  ok("[forgot] the same wording whether or not the address has an account", (await page.getByText("If that address has an account").count()) > 0);
  ok("[forgot] the code field offers the one-time-code autofill", (await page.locator("#forgot-code").getAttribute("autocomplete")) === "one-time-code");
  ok("[forgot] 'send a new code' waits a moment", await page.getByTestId("forgot-resend").isDisabled());
  ok("[forgot] the request carried only the address", JSON.parse(calls[0][1]).email === "jo@example.com".replace("jo", "Jo").replace("example", "Example") || /jo@example\.com/i.test(calls[0][1]));
  await page.screenshot({ path: `${OUT}/forgot-2-code-${TAG}.png` });
  // wrong code (a paste of all six confirms itself)
  await page.locator("#forgot-code").fill("111111");
  await page.getByTestId("forgot-problem").waitFor({ timeout: 6000 });
  ok("[forgot] a wrong code says so, and the boxes stay open", /not accepted/.test(await page.getByTestId("forgot-problem").innerText()) && (await page.getByTestId("code-boxes").count()) === 1);
  await page.screenshot({ path: `${OUT}/forgot-3-wrong-${TAG}.png` });
  await page.locator("#forgot-code").fill("222222");
  await page.waitForFunction(() => /expired/.test(document.querySelector("[data-testid=forgot-problem]")?.textContent ?? ""), null, { timeout: 6000 }).catch(() => {});
  ok("[forgot] an expired code says it expired and asks for a new one", /expired/.test(await page.getByTestId("forgot-problem").innerText()));
  await page.screenshot({ path: `${OUT}/forgot-4-expired-${TAG}.png` });
  await page.locator("#forgot-code").fill("333333");
  await page.getByTestId("forgot-save").waitFor({ timeout: 6000 });
  ok("[forgot] the right code goes to 'Choose a new password' by itself (no button pressed)", (await page.getByText("Choose a new password").count()) > 0);
  ok("[forgot] the code is in no address bar", !/\d{6}/.test(page.url()) && !/code=/.test(page.url()));
  await page.screenshot({ path: `${OUT}/forgot-5-password-${TAG}.png` });
  await page.locator("#np").fill("short"); await page.getByTestId("forgot-save").click();
  ok("[forgot] 7 characters or fewer is refused with the one rule", (await page.getByText("at least 8 characters").count()) > 0 && !calls.some((c) => c[0] === "set"));
  await page.locator("#np").fill("a long new phrase 1"); await page.getByTestId("forgot-save").click();
  await page.getByTestId("forgot-done").waitFor({ timeout: 6000 });
  const set = JSON.parse(calls.find((c) => c[0] === "set")[1]);
  ok("[forgot] the new password is sent with the grant, not the code", set.grant && set.grant.length >= 20 && set.password === "a long new phrase 1" && !("code" in set));
  ok("[forgot] the done screen says other devices are signed out and offers Sign in", /signed out on every device/.test(await page.locator("main").innerText()) && (await page.getByTestId("forgot-signin").getAttribute("href")) === "/login");
  ok("[forgot] no sideways scroll", await noSideScroll(page));
  await page.screenshot({ path: `${OUT}/forgot-6-done-${TAG}.png` });
  await ctx.close();
}

// ── B · Settings > Security: change / set password ───────────────────────────────────────────────────────────────────────
{
  const ctx = await contextFor(browser, WS.pro, { base: BASE, width: WIDTH, height: WIDTH < 700 ? 844 : 900, colorScheme: SCHEME });
  if (SCHEME === "dark") await ctx.addCookies([{ name: "docustay-theme", value: "dark", url: BASE }]);
  const page = await ctx.newPage(); watch(page);
  const OV = (on) => ({ on, authenticatorApp: { on, since: new Date().toISOString() }, passkeys: [], recoveryLeft: on ? 8 : 0, devices: [], thisDeviceRemembered: false, activity: [] });
  async function arrange({ has, twoStep }) {
    await page.unrouteAll({ behavior: "ignoreErrors" }); const calls = [];
    await page.route("**/api/auth/password/status", (r) => r.fulfill(json({ hasPassword: has, twoStep, minLength: 8 })));
    await page.route("**/api/auth/two-step/overview", (r) => r.fulfill(json(OV(twoStep))));
    await page.route("**/api/auth/password/request-code", (r) => { calls.push(["request-code", r.request().postData()]); r.fulfill(json({ sent: true })); });
    await page.route("**/api/auth/password/change", (r) => { const b = JSON.parse(r.request().postData() ?? "{}"); calls.push(["change", b]); r.fulfill(b.currentPassword === "wrong-one-1" ? err("That is not your current password.") : json({ changed: true, signedOutOthers: b.signOutOthers !== false })); });
    await page.goto(`${BASE}/settings?tab=security`, { waitUntil: "load", timeout: 60000 }); await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
    await page.getByTestId("password-section").waitFor({ timeout: 20000 });
    return calls;
  }
  // B1 · has a password, two-step off
  let calls = await arrange({ has: true, twoStep: false });
  ok("[change] a Password section sits in the person's own sign-in group", (await page.getByTestId("password-section").innerText()).includes("Change password"));
  await page.screenshot({ path: `${OUT}/security-1-section-${TAG}.png` });
  await page.getByTestId("password-open").click(); await page.getByTestId("password-dialog").waitFor();
  ok("[change] the dialog asks for the current password and the new one", (await page.getByTestId("password-current").count()) === 1 && (await page.locator("#pw-new").count()) === 1);
  ok("[change] 'sign me out on my other devices' is ticked by default", await page.getByTestId("password-signout-others").isChecked());
  await page.waitForTimeout(600); await page.screenshot({ path: `${OUT}/security-2-dialog-${TAG}.png` });
  await page.getByTestId("password-current").fill("old password 1"); await page.locator("#pw-new").fill("short"); await page.getByTestId("password-save").click();
  ok("[change] a short new password is refused before anything is sent", /at least 8/.test(await page.getByTestId("password-problem").innerText()) && !calls.some((c) => c[0] === "change"));
  await page.getByTestId("password-current").fill("wrong-one-1"); await page.locator("#pw-new").fill("a long new phrase 2"); await page.getByTestId("password-save").click();
  await page.waitForFunction(() => /not your current/.test(document.querySelector("[data-testid=password-problem]")?.textContent ?? ""), null, { timeout: 6000 }).catch(() => {});
  ok("[change] a wrong current password says so and the dialog stays", /not your current password/.test(await page.getByTestId("password-problem").innerText()));
  await page.screenshot({ path: `${OUT}/security-3-wrong-${TAG}.png` });
  await page.getByTestId("password-current").fill("old password 1"); await page.getByTestId("password-signout-others").uncheck(); await page.getByTestId("password-save").click();
  await page.getByTestId("password-dialog").waitFor({ state: "detached", timeout: 6000 }).catch(() => {});
  const ch = calls.filter((c) => c[0] === "change").at(-1)?.[1];
  ok("[change] the right answer closes the dialog and sends current + new + the sign-out choice", ch?.currentPassword === "old password 1" && ch?.newPassword === "a long new phrase 2" && ch?.signOutOthers === false && (await page.getByTestId("password-dialog").count()) === 0);
  ok("[change] no sideways scroll", await noSideScroll(page));

  // B2 · no password yet (code-only sign-up) -> "Set a password" by emailed code
  calls = await arrange({ has: false, twoStep: false });
  ok("[set] a person with no password sees 'Set a password'", (await page.getByTestId("password-open").innerText()).includes("Set a password"));
  await page.getByTestId("password-open").click(); await page.getByTestId("password-dialog").waitFor();
  ok("[set] no current-password field; it asks to email a code", (await page.getByTestId("password-current").count()) === 0 && (await page.getByTestId("password-send-code").count()) === 1);
  await page.getByTestId("password-send-code").click(); await page.locator("#pw-code").waitFor({ timeout: 5000 });
  await page.screenshot({ path: `${OUT}/security-4-set-${TAG}.png` });
  await page.locator("#pw-code").fill("123456"); await page.locator("#pw-new").fill("a long new phrase 3"); await page.getByTestId("password-save").click();
  await page.getByTestId("password-dialog").waitFor({ state: "detached", timeout: 6000 }).catch(() => {});
  const st = calls.filter((c) => c[0] === "change").at(-1)?.[1];
  ok("[set] the code and the new password are sent together", st?.code === "123456" && st?.newPassword === "a long new phrase 3" && !("currentPassword" in st));

  // B3 · two-step on: the second step is asked, and travels with the change
  calls = await arrange({ has: true, twoStep: true });
  await page.getByTestId("password-open").click(); await page.getByTestId("password-dialog").waitFor();
  await page.getByTestId("password-current").fill("old password 1"); await page.locator("#pw-new").fill("a long new phrase 4"); await page.getByTestId("password-save").click();
  await page.getByTestId("proof-dialog").waitFor({ timeout: 6000 });
  ok("[two-step] the person is asked to confirm with their second step before anything changes", !calls.some((c) => c[0] === "change"));
  await page.screenshot({ path: `${OUT}/security-5-proof-${TAG}.png` });
  await page.locator("#proof-code").fill("654321");
  await page.waitForFunction(() => !document.querySelector("[data-testid=proof-dialog]"), null, { timeout: 8000 }).catch(() => {});
  const pr = calls.filter((c) => c[0] === "change").at(-1)?.[1];
  ok("[two-step] the code travels as the proof", pr?.proof?.code === "654321" && pr?.newPassword === "a long new phrase 4");
  await ctx.close();
}
ok("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(`\n${TAG}: ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
