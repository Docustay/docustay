// LIGHT production smoke for the 20 Oct release, on the throwaway workspace trtheking97+smoke1 only (never a real customer): passkey registration and sign-in on app.docustay.app, a form template's Preview,
// thumbnails, no 404s on template pages and pictures, a small burst of page requests. Every call is sequential and short; nothing heavy; two-step is turned off again at the end.
//   node scripts/prod-smoke-release.mjs [--out DIR]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { contextFor } from "./pm-lib.mjs";
const BASE = "https://app.docustay.app", EMAIL = "trtheking97+smoke1@gmail.com";
const OUT = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "/tmp/prod-smoke"; mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0; const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const browser = await chromium.launch(); const ctx = await contextFor(browser, EMAIL, { base: BASE, width: 1280 }); const page = await ctx.newPage();
const bad = []; page.on("response", (r) => { if (r.status() >= 500 || (r.status() === 404 && /\/starters\//.test(r.url()))) bad.push(`${r.status()} ${r.url().replace(BASE, "").slice(0, 80)}`); });
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
const decline = () => page.getByRole("button", { name: "Decline" }).click({ timeout: 2000 }).catch(() => {});
const api = (method, path, body) => page.evaluate(async ([m, p, b]) => { const r = await fetch(p, { method: m, headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; }, [method, path, body ?? null]);
const cdp = await ctx.newCDPSession(page); await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
// 1. passkeys are on
await page.goto(`${BASE}/settings?tab=security`, { waitUntil: "load" }); await decline();
ok("passkeys are switched on", (await api("GET", "/api/auth/passkeys/status")).json?.enabled === true);
// 2. register a passkey through the wizard (the workspace starts without two-step)
const before = (await api("GET", "/api/auth/two-step/overview")).json; ok("smoke workspace starts without two-step", before?.on === false, JSON.stringify(before?.on));
await page.getByTestId("two-step-start").click(); await page.getByTestId("method-passkey").click(); await page.getByTestId("passkey-name").fill("Smoke key"); await page.getByTestId("passkey-create").click();
await page.getByTestId("recovery-codes").waitFor({ timeout: 25000 }).then(() => ok("passkey registered on app.docustay.app; recovery codes shown", true)).catch(() => ok("passkey registered on app.docustay.app; recovery codes shown", false));
await shot("01-recovery"); await page.getByTestId("recovery-saved").check(); await page.getByTestId("recovery-finish").click(); await page.getByTestId("two-step-protected").waitFor({ timeout: 8000 }).catch(() => {}); await page.getByTestId("wizard-done").click().catch(() => {});
// 3. sign out, sign in with the passkey
await api("POST", "/api/auth/logout", {}); await ctx.clearCookies();
await page.goto(`${BASE}/login`, { waitUntil: "load" }); await decline();
await page.waitForURL(/\/documents|\/home|\/$/, { timeout: 25000 }).then(() => ok("signed in with the passkey on app.docustay.app", true)).catch(async () => { await page.getByTestId("login-passkey").click().catch(() => {}); await page.waitForURL(/\/documents|\/home|\/$/, { timeout: 25000 }).then(() => ok("signed in with the passkey on app.docustay.app (button)", true)).catch(() => ok("signed in with the passkey on app.docustay.app", false, page.url())); });
await shot("02-signed-in");
// 4. a form template's Preview opens the print view; thumbnails load
await page.goto(`${BASE}/create?preview=incident-report`, { waitUntil: "load" });
await page.getByTestId("template-preview").waitFor({ timeout: 20000 }).then(() => ok("a form template's Preview opens in the app (print view)", true)).catch(() => ok("a form template's Preview opens in the app (print view)", false));
await page.locator(".pv-sheet img").first().waitFor({ timeout: 15000 }).catch(() => {}); ok("its pages are drawn with the fields marked", (await page.locator(".pv-sheet").count()) >= 1 && (await page.locator(".pv-f").count()) > 3); await shot("03-preview");
await page.keyboard.press("Escape");
await page.goto(`${BASE}/create`, { waitUntil: "load" }); await page.waitForTimeout(2500);
const thumbs = await page.evaluate(() => [...document.querySelectorAll("li.tpl img")].map((i) => ({ ok: i.complete && i.naturalWidth > 0 }))); ok(`thumbnails load (${thumbs.length} tiles)`, thumbs.length > 0 && thumbs.every((t) => t.ok));
// 5. a small burst of sequential page requests (no hang)
const t0 = Date.now(); let slow = 0; for (const p of ["/starters/incident-report/p1-sm.webp", "/starters/mutual-nda/p1-sm.webp", "/starters/rsvp/p1-lg.webp", "/starters/incident-report/meta.json", "/templates/nda-template", "/templates/incident-report", "/templates/mutual-nda", "/free-templates"]) { const s = Date.now(); const r = await page.request.get(`https://docustay.app${p}`, { maxRedirects: 3 }).catch(() => null); if (!r || r.status() !== 200) bad.push(`${r?.status()} ${p}`); if (Date.now() - s > 4000) slow += 1; }
ok("template pages and pictures answer 200 and none hangs", bad.filter((b) => /^404|^5/.test(b)).length === 0 && slow === 0, bad.join(" | ") + ` slow=${slow}`);
// 6. put it back: turn two-step off again (needs the passkey as proof)
await page.goto(`${BASE}/settings?tab=security`, { waitUntil: "load" });
await page.getByTestId("two-step-off").click(); await page.getByTestId("proof-dialog").waitFor(); await page.getByTestId("proof-passkey").click();
await page.getByTestId("two-step-start").waitFor({ timeout: 25000 }).then(() => ok("two-step turned off again (the workspace is back as it was)", true)).catch(() => ok("two-step turned off again", false));
ok("no 5xx on the way", bad.filter((b) => /^5/.test(b)).length === 0, bad.join(" | "));
console.log(`\n${pass} pass, ${fail} fail`); await browser.close(); process.exit(fail ? 1 : 0);
