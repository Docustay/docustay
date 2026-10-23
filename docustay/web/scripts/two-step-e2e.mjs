// Two-step sign-in, end to end on BETA with a virtual passkey device: set up (passkey, authenticator app, security key), sign in with each, recovery code, remember device, turn off.
// Usage: node scripts/two-step-e2e.mjs [--email trtheking97+ts1@gmail.com] [--out DIR] [--base URL]
import { chromium } from "playwright";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { BETA_WEB, code as emailCode, stateFile } from "./pm-lib.mjs";
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const SCHEME = arg("scheme", "light"), WIDTH = Number(arg("width", "1280")), BASE = arg("base", BETA_WEB), EMAIL = arg("email", `trtheking97+ts${Date.now() % 100000000}@gmail.com`), OUT = arg("out", "/tmp/ts-e2e");
mkdirSync(OUT, { recursive: true });
const { TOTP, Secret } = createRequire(import.meta.url)(process.env.OTPAUTH_PATH || "~/keystone-dashboard/node_modules/otpauth");
let pass = 0, fail = 0;
const ok = (n, c, extra = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, extra); } };
const browser = await chromium.launch();
const mk = async (width = WIDTH) => { const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: SCHEME }); if (SCHEME === "dark") await ctx.addCookies([{ name: "docustay-theme", value: "dark", url: BASE }]);   // the app wears the person's Appearance, which defaults to light
  const page = await ctx.newPage(); return { ctx, page }; };
async function withKeys(ctx, page) { const cdp = await ctx.newCDPSession(page); await cdp.send("WebAuthn.enable"); const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } }); return { cdp, authenticatorId }; }
const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png` });
const decline = (page) => page.getByRole("button", { name: "Decline" }).click({ timeout: 2500 }).catch(() => {});
const PASSWORD = `Ts-${Date.now()}-beta-pass`;   // a throwaway password for a throwaway BETA workspace
async function signUp(page) {
  await page.goto(`${BASE}/login`); await decline(page);
  const r = await api(page, "POST", "/api/auth/local/signup", { email: EMAIL, password: PASSWORD }); if (r.status >= 300) throw new Error(`signup failed ${r.status}`);   // the identity, with a password only this test knows
  const t0 = Math.floor(Date.now() / 1000);   // then the sign-up page makes the workspace (its emailed code proves the address)
  await page.goto(`${BASE}/signup`); await decline(page);
  await page.getByRole("textbox", { name: "Email" }).fill(EMAIL); await page.locator("input[type=checkbox]").first().check(); await page.getByRole("button", { name: "Email me a code" }).click();
  const c = emailCode(EMAIL, t0); await page.locator("input").first().click(); await page.keyboard.type(c); await page.waitForURL(/\/documents/, { timeout: 60000 });
}
/** sign in with email and password up to the second step (or all the way when there is none) */
async function signInToSecondStep(page) {
  await page.goto(`${BASE}/login`); await decline(page);
  await page.getByRole("textbox", { name: "Email" }).fill(EMAIL); await page.getByTestId("login-continue").click(); await page.waitForTimeout(1200);
  if (!(await page.locator("#pw").isVisible())) await page.getByTestId("login-continue").click();   // (before the fix, a click before the page knew codes are off showed only a message)
  await page.locator("#pw").fill(PASSWORD); await page.keyboard.press("Enter");
}
let usedWindow = -1;
// a code is accepted once (replay protection): when this 30-second window's code was already used, wait for the next window
const totpNow = async (secret) => { let w = Math.floor(Date.now() / 30000); if (w === usedWindow) { await new Promise((r) => setTimeout(r, 30500 - (Date.now() % 30000))); w = Math.floor(Date.now() / 30000); } usedWindow = w; return new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 }).generate(); };
const api = (page, method, path, body) => page.evaluate(async ([m, p, b]) => { const r = await fetch(p, { method: m, headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; }, [method, path, body ?? null]);

// ── 1. sign up, set up a passkey ────────────────────────────────────────────────────────────────
let { ctx, page } = await mk(); const keys = await withKeys(ctx, page);
await signUp(page);
await page.goto(`${BASE}/settings?tab=security`, { waitUntil: "load" }); await decline(page);
await page.getByTestId("two-step-start").click();
ok("wizard shows four stages", (await page.locator('[data-testid="wizard-ribbon"] li').count()) === 4);
ok("passkey is offered first and recommended", /Recommended/.test(await page.getByTestId("method-passkey").innerText()));
await shot(page, "01-choose");
await page.getByTestId("method-passkey").click();
await page.getByTestId("passkey-name").fill("Test laptop"); await shot(page, "02-passkey-name");
await page.getByTestId("passkey-create").click();
await page.getByTestId("recovery-codes").waitFor({ timeout: 20000 });
const codes = (await page.getByTestId("recovery-list").innerText()).match(/[0-9A-Z]{5}-[0-9A-Z]{5}/g) ?? [];
ok("ten recovery codes shown", codes.length === 10, String(codes.length)); await shot(page, "03-recovery-codes");
ok("Finish is gated by the box", await page.getByTestId("recovery-finish").isDisabled());
await page.getByTestId("recovery-saved").check(); await page.getByTestId("recovery-finish").click();
await page.getByTestId("two-step-protected").waitFor(); await shot(page, "04-protected");
await page.getByTestId("wizard-done").click();
await page.getByTestId("methods").waitFor();
ok("passkey is listed with its name", /Test laptop/.test(await page.getByTestId("methods").innerText()));
ok("recovery says 10 left", /10 recovery codes left/.test(await page.getByTestId("recovery-left").innerText()));
await shot(page, "05-security-page");

// ── 2. sign out; the device offers the passkey on its own at sign-in (it is both factors), then the email-code path asks for the second step ─
await api(page, "POST", "/api/auth/logout", {}); await ctx.clearCookies();
await page.goto(`${BASE}/login`); await decline(page);
await page.waitForURL(/\/documents|\/home|\/$/, { timeout: 20000 }).then(() => ok("a passkey on this device signs in by itself (no second step needed)", true)).catch(() => ok("a passkey on this device signs in by itself (no second step needed)", false, page.url()));
await api(page, "POST", "/api/auth/logout", {}); await ctx.clearCookies();
await ctx.addInitScript(() => { try { PublicKeyCredential.isConditionalMediationAvailable = async () => false; } catch {} });   // from here the passkey is NOT offered in the email box, so the code path is exercised
await signInToSecondStep(page);
await page.getByTestId("login-two-step").waitFor({ timeout: 30000 }); await shot(page, "06-signin-passkey");
ok("passkey is the first choice at the second step", await page.getByTestId("two-step-passkey").isVisible());
await page.getByTestId("two-step-passkey").click(); await page.waitForURL(/\/documents|\/home|\/$/, { timeout: 30000 });
ok("signed in with the passkey as the second step", !/login/.test(page.url()));

// ── 2b. a phone gets the link, not the QR (same page: a virtual passkey device belongs to one page, so the page is made to look like a phone) ──
{ const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  await keys.cdp.send("Emulation.setUserAgentOverride", { userAgent: IPHONE }); await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`${BASE}/settings?tab=security`, { waitUntil: "load" }); await page.getByTestId("add-method").click(); await page.getByTestId("method-totp").click();
  await page.getByTestId("proof-dialog").waitFor(); await page.getByTestId("proof-passkey").click();
  await page.getByTestId("totp-open").waitFor({ timeout: 15000 }).then(() => ok("phone shows 'Open in my authenticator app'", true)).catch(() => ok("phone shows 'Open in my authenticator app'", false));
  ok("phone shows no QR", (await page.getByTestId("totp-qr").count()) === 0); await shot(page, "10-phone-authenticator");
  await keys.cdp.send("Emulation.setUserAgentOverride", { userAgent: "" }); await page.setViewportSize({ width: WIDTH, height: 900 }); }

// ── 3. add an authenticator app (needs a proof: the passkey) ────────────────────────────────────
await page.goto(`${BASE}/settings?tab=security`, { waitUntil: "load" }); await page.reload({ waitUntil: "load" });
await page.getByTestId("add-method").click(); await page.getByTestId("method-totp").click();
await page.getByTestId("proof-dialog").waitFor(); await shot(page, "07-proof-dialog");
await page.getByTestId("proof-passkey").click();
await page.getByTestId("totp-key").waitFor({ timeout: 20000 });
const secret = (await page.getByTestId("totp-key").innerText()).trim();
ok("QR and key shown on desktop", (await page.getByTestId("totp-qr").count()) === 1 && secret.length >= 16); await shot(page, "08-authenticator-setup");
await page.locator("#enrol-code").fill("000000"); await page.waitForTimeout(1500);
ok("a wrong code says so clearly", await page.getByTestId("totp-problem").isVisible()); await shot(page, "09-wrong-code");
await page.locator("#enrol-code").fill(await totpNow(secret));
await page.getByTestId("two-step-protected").waitFor({ timeout: 20000 });
ok("adding a second way skips the recovery stage", (await page.getByTestId("recovery-codes").count()) === 0);
await page.getByTestId("wizard-done").click(); await page.getByTestId("methods").waitFor();
await page.waitForFunction(() => document.querySelectorAll('[data-testid="method-row"]').length >= 2, null, { timeout: 8000 }).catch(() => {});
ok("two ways are listed", (await page.getByTestId("method-row").count()) === 2);

// ── 5. sign in with the authenticator code, then remember the device ────────────────────────────
await api(page, "POST", "/api/auth/logout", {}); await ctx.clearCookies();
await signInToSecondStep(page); await page.getByTestId("login-two-step").waitFor({ timeout: 30000 });
await page.getByText("Authenticator app", { exact: true }).click();
await page.getByTestId("two-step-remember").check();
await page.locator("#ts-code").fill("111111"); await page.waitForTimeout(1500);
ok("wrong code at sign-in says so", await page.getByTestId("two-step-problem").isVisible()); await shot(page, "11-signin-wrong-code");
await page.locator("#ts-code").fill(await totpNow(secret)); await page.waitForURL(/\/documents|\/home|\/$/, { timeout: 30000 });
ok("signed in with the code", !/login/.test(page.url()));
await api(page, "POST", "/api/auth/logout", {}); 
await signInToSecondStep(page); await page.waitForURL(/\/documents|\/home|\/$/, { timeout: 30000 }).then(() => ok("remembered device skips the second step", true)).catch(async () => { ok("remembered device skips the second step", false, page.url()); });

// ── 6. recovery code at sign-in (a fresh context has no remembered cookie) ───────────────────────
{ const r = await mk(); await r.page.goto(`${BASE}/login`); await decline(r.page);
  await signInToSecondStep(r.page); await r.page.getByTestId("login-two-step").waitFor({ timeout: 30000 });
  await r.page.getByTestId("two-step-use-recovery").click(); await r.page.getByTestId("two-step-recovery").fill("WRONGWRONG"); await r.page.keyboard.press("Enter"); await r.page.waitForTimeout(1500);
  ok("wrong recovery code says so", await r.page.getByTestId("two-step-problem").isVisible()); await r.page.screenshot({ path: `${OUT}/12-recovery-wrong.png` });
  await r.page.getByTestId("two-step-recovery").fill(codes[0].replace("-", "").toLowerCase()); await r.page.keyboard.press("Enter");
  await r.page.waitForURL(/\/documents|\/home|\/$/, { timeout: 30000 }).then(() => ok("recovery code signs in", true)).catch(() => ok("recovery code signs in", false, r.page.url()));
  const ov = await api(r.page, "GET", "/api/auth/two-step/overview"); ok("recovery code is spent (9 left)", ov.json?.recoveryLeft === 9, String(ov.json?.recoveryLeft)); await r.ctx.close(); }

// ── 7. turn off needs a current code ────────────────────────────────────────────────────────────
await page.goto(`${BASE}/settings?tab=security`, { waitUntil: "load" });
await page.getByTestId("two-step-off").click(); await page.getByTestId("proof-dialog").waitFor(); await shot(page, "13-turn-off");
await page.locator("#proof-code").fill("222222"); await page.waitForTimeout(1500);
ok("turn off refuses a wrong code", await page.getByTestId("proof-problem").isVisible());
await page.locator("#proof-code").fill(await totpNow(secret)).catch(async () => { await page.getByTestId("proof-passkey").click(); });
await page.getByTestId("two-step-start").waitFor({ timeout: 20000 }).then(() => ok("turned off", true)).catch(() => ok("turned off", false));
await shot(page, "14-off-again");
// ── 8. a security key (a second, USB-style device) ─────────────────────────────────────────────
async function setupPasskey(pg, name) { await pg.getByTestId("two-step-start").click(); await pg.getByTestId("method-passkey").click(); await pg.getByTestId("passkey-name").fill(name); await pg.getByTestId("passkey-create").click(); await pg.getByTestId("recovery-codes").waitFor({ timeout: 20000 }); await pg.getByTestId("recovery-saved").check(); await pg.getByTestId("recovery-finish").click(); await pg.getByTestId("wizard-done").click(); await pg.getByTestId("methods").waitFor(); }
await page.reload({ waitUntil: "load" }); await setupPasskey(page, "Again laptop");
const usb = await keys.cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "usb", hasResidentKey: false, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
await page.getByTestId("add-method").click(); await page.getByTestId("method-security_key").click();
await page.getByTestId("passkey-name").fill("Desk key"); await page.getByTestId("passkey-create").click();
await page.getByTestId("proof-dialog").waitFor(); await page.getByTestId("proof-passkey").click();
await page.getByTestId("two-step-protected").waitFor({ timeout: 25000 }).then(() => ok("a security key can be added", true)).catch(async () => { ok("a security key can be added", false, await page.locator("body").innerText().then((x) => x.slice(0, 200))); });
await page.getByTestId("wizard-done").click().catch(() => {}); await page.getByTestId("methods").waitFor();
await page.waitForFunction(() => /Desk key/.test(document.querySelector('[data-testid="methods"]')?.innerText ?? ""), null, { timeout: 8000 }).catch(() => {});
ok("security key is listed", /Desk key/.test(await page.getByTestId("methods").innerText())); await shot(page, "15-methods-with-key");
await keys.cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId: usb.authenticatorId });   // (a passkey needs the device that can hold one; the key was only for its own test)
// rename and remove
await page.getByTestId("method-rename").last().click(); await page.getByTestId("rename-input").fill("Desk key 2"); await page.getByTestId("rename-save").click();
await page.waitForFunction(() => /Desk key 2/.test(document.querySelector('[data-testid="methods"]')?.innerText ?? ""), null, { timeout: 8000 }).then(() => ok("a method can be renamed", true)).catch(() => ok("a method can be renamed", false));

// ── 9. enforcement: a grace period, then required now, then the gate (an owner who turns their own off lands on it and can still get out) ──
await page.getByTestId("require-grace").check(); await page.getByTestId("require-grace").waitFor();
await page.waitForFunction(() => document.querySelector('[data-testid="grace-left"]'), null, { timeout: 8000 }).then(() => ok("grace period is shown with days left", true)).catch(() => ok("grace period is shown with days left", false));
await shot(page, "16-require-grace");
ok("who has set it up is listed", (await page.getByTestId("people").locator("li").count()) >= 1);
await page.getByTestId("require-now").check();
await page.waitForFunction(() => document.querySelector('[data-testid="require-now"]')?.checked, null, { timeout: 8000 }).catch(() => {});
await shot(page, "17-require-now");
// turn off the owner's own two-step: with "required now" the app shows the one set-up page
await page.getByTestId("two-step-off").click(); await page.getByTestId("proof-dialog").waitFor(); await page.getByTestId("proof-passkey").click();
await page.locator('[data-testid="two-step-required"], [data-testid="two-step-gate"]').first().waitFor({ timeout: 20000 }).then(() => ok("turning off your own when it is required shows the set-up page", true)).catch(() => ok("turning off your own when it is required shows the set-up page", false));
await page.goto(`${BASE}/documents`, { waitUntil: "load" });
await page.getByTestId("two-step-gate").waitFor({ timeout: 20000 }).then(() => ok("the set-up page replaces the screen when it is required", true)).catch(() => ok("the set-up page replaces the screen when it is required", false)); await shot(page, "18-gate");
await page.getByTestId("gate-set-up").click(); await page.getByTestId("method-passkey").click(); await page.getByTestId("passkey-name").fill("Gate laptop"); await page.getByTestId("passkey-create").click();
await page.getByTestId("recovery-codes").waitFor({ timeout: 20000 }); await page.getByTestId("recovery-saved").check(); await page.getByTestId("recovery-finish").click(); await page.getByTestId("wizard-done").click();
await page.getByTestId("two-step-gate").waitFor({ state: "detached", timeout: 20000 }).then(() => ok("the gate lets them carry on once set up", true)).catch(() => ok("the gate lets them carry on once set up", false));
// back to off, and a grace notice for someone without it
await page.goto(`${BASE}/settings?tab=security`, { waitUntil: "load" }); await page.getByTestId("require-grace").check();
await page.waitForFunction(() => document.querySelector('[data-testid="grace-left"]'), null, { timeout: 8000 }).catch(() => {});
await page.getByTestId("two-step-off").click(); await page.getByTestId("proof-dialog").waitFor(); await page.getByTestId("proof-passkey").click(); await page.getByTestId("two-step-start").waitFor({ timeout: 20000 });
await page.goto(`${BASE}/documents`, { waitUntil: "load" });
await page.getByTestId("two-step-grace-notice").waitFor({ timeout: 15000 }).then(() => ok("the days-left notice shows during a grace period", true)).catch(() => ok("the days-left notice shows during a grace period", false)); await shot(page, "19-grace-notice");
await api(page, "POST", "/api/settings/security", { mode: "off" });

console.log(`\n${pass} pass, ${fail} fail`); await browser.close(); process.exit(fail ? 1 : 0);
