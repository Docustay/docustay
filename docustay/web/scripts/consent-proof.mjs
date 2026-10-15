#!/usr/bin/env node
// Cookie banner proof: the Accept, Decline and Settings paths clicked in headless Chromium, and whether tracking (the Google Tag Manager request) follows the choice. Google is never contacted: its host is answered locally.
// Usage: BASE=http://127.0.0.1:5190 CHROME=<path> node scripts/consent-proof.mjs
import { chromium } from "playwright";
const BASE = process.env.BASE ?? "http://127.0.0.1:5190";
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${m}`); };
const b = await chromium.launch({ headless: true, ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}) });
async function fresh() { const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } }), page = await ctx.newPage(), g = []; await ctx.route(/googletagmanager|google-analytics|doubleclick/, (r) => { g.push(r.request().url()); r.fulfill({ status: 200, contentType: "application/javascript", body: "" }); }); return { ctx, page, g }; }
const cookie = async (ctx) => (await ctx.cookies()).find((c) => c.name === "docustay-consent")?.value ?? null;
const go = async (page, url = "/") => { await page.goto(BASE + url, { waitUntil: "load" }); await page.waitForTimeout(2500); };
{ const { ctx, page, g } = await fresh(); await go(page);
  ok(await page.locator('[data-testid="consent"]').isVisible(), "first visit: the banner shows"); ok(g.length === 0, "first visit, no choice: no request to Google");
  await page.click('[data-testid="consent-decline"]'); await page.waitForTimeout(800);
  ok(!(await page.locator('[data-testid="consent"]').count()), "Decline: the banner closes"); ok((await cookie(ctx)) === "denied", "Decline: choice remembered (denied)"); ok(g.length === 0, "Decline: no request to Google");
  await go(page, "/pricing"); ok(!(await page.locator('[data-testid="consent"]').count()), "after Decline, a later page does not ask again"); ok(g.length === 0, "after Decline, a later page makes no request to Google");
  // Settings: reopen from the footer link
  const link = page.getByText(/cookie settings|cookie choices|cookie preferences/i).first(); const hasLink = await link.count();
  ok(hasLink > 0, "Settings: the footer has a cookie settings control");
  if (hasLink) { await link.click(); await page.waitForTimeout(500); ok(await page.locator('[data-testid="consent"]').isVisible(), "Settings: the banner reopens");
    await page.click('[data-testid="consent-accept"]'); await page.waitForTimeout(1500); ok((await cookie(ctx)) === "granted", "Settings then Accept: choice changes to granted"); ok(g.some((u) => /gtm\.js\?id=GTM-M4XHM72X/.test(u)), "Accept: the tag manager is requested (" + g.length + " request)");
    await go(page, "/product/signing"); ok(g.some((u) => /gtm\.js/.test(u)), "after Accept, a later page loads the tag manager again");
    const n = g.length; await link.click().catch(async () => { await page.getByText(/cookie settings|cookie choices|cookie preferences/i).first().click(); }); await page.waitForTimeout(500); await page.click('[data-testid="consent-decline"]'); await page.waitForTimeout(800);
    ok((await cookie(ctx)) === "denied", "Accept then Settings then Decline: choice changes to denied"); await go(page, "/pricing"); const m = g.length; ok(m === n || !g.slice(n).some((u) => /gtm\.js/.test(u)), "after changing to Decline, the next page does not load the tag manager"); }
  await ctx.close(); }
{ const { ctx, page, g } = await fresh(); await go(page); await page.click('[data-testid="consent-accept"]'); await page.waitForTimeout(1500);
  ok(g.some((u) => /gtm\.js/.test(u)), "Accept (fresh visitor): tag manager requested"); ok((await cookie(ctx)) === "granted", "Accept: cookie granted"); await go(page, "/pricing"); ok(!(await page.locator('[data-testid="consent"]').count()), "after Accept, the banner does not return"); await ctx.close(); }
{ const { ctx, page, g } = await fresh(); await go(page); await page.mouse.click(10, 10); await page.waitForTimeout(500); await go(page, "/about"); ok(g.length === 0, "no choice made, a second page: still no request to Google"); await ctx.close(); }
{ const { ctx, page, g } = await fresh(); await go(page); await page.locator('[data-testid="consent"] a').click(); await page.waitForTimeout(2000); ok(/\/legal\/cookies/.test(page.url()), "Details: opens the cookie page"); ok(g.length === 0, "Details: still no request to Google"); await ctx.close(); }
await b.close(); console.log(`\n${fail ? "CONSENT PROOF FAIL" : "CONSENT PROOF PASS"}: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
