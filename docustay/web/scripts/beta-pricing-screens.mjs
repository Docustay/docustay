// BETA, PRICING WORDS: the Billing table and meters, the Contacts rename and the /people 301, the website pricing page. Screenshots to /tmp/la/pw.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { BETA_WEB as BASE, WS, contextFor } from "./pm-lib.mjs";
mkdirSync("/tmp/la/pw", { recursive: true }); const out = []; const ok = (n, p, i = "") => { out.push(p); console.log(`${p ? "PASS" : "FAIL"}  ${n}  ${i}`); };
const b = await chromium.launch();
for (const scheme of ["light", "dark"]) {
  const ctx = await contextFor(b, WS.payg, { base: BASE, colorScheme: scheme }); const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(`${BASE}/billing`, { waitUntil: "networkidle" }); await page.getByTestId("billing-plans").waitFor({ timeout: 20000 });
  const txt = await page.getByTestId("billing-plans").innerText();
  if (scheme === "light") {
    for (const w of ["Team members", "Signers", "Documents sent each month", "AI drafts each month", "New templates each month", "per team member a month", "Fair use applies to Unlimited", "A team of 3 sending 40 documents"]) ok(`Billing table says "${w}"`, txt.includes(w));
    ok("no old words in Billing", !/a person a month|\bseat\b/i.test(await page.locator("main").innerText()));
    ok("Billing shows signers and templates meters", (await page.getByTestId("billing-signers-line").count()) === 1 && (await page.getByTestId("billing-templates-line").count()) === 1, await page.getByTestId("billing-templates-line").innerText());
  }
  await page.screenshot({ path: `/tmp/la/pw/billing-${scheme}.png`, fullPage: true });
  ok(`no page errors (${scheme})`, errs.length === 0, errs.join("|"));
  if (scheme === "light") {
    const r = await page.goto(`${BASE}/people?x=1`, { waitUntil: "networkidle" }); ok("/people lands on /contacts", page.url().includes("/contacts") && page.url().includes("x=1"), page.url());
    await page.getByTestId("people-source").waitFor({ timeout: 20000 }); ok("Contacts page heading", /Contacts/.test(await page.locator("h1").first().innerText()));
    await page.screenshot({ path: "/tmp/la/pw/contacts.png" });
    const nav = await page.locator("nav").first().innerText(); ok("nav says Contacts not People", /Contacts/.test(nav) && !/\bPeople\b/.test(nav));
  }
  await ctx.close();
}
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage();
const resp = await p.goto(`${BASE}/pricing`, { waitUntil: "networkidle" }); ok("pricing page loads", resp.status() === 200);
const t = await p.locator("main").innerText();
for (const w of ["per team member a month", "Fair use applies to Unlimited", "Signers", "15 different signers", "founders price"]) ok(`pricing page says "${w}"`, t.includes(w));
ok("no old words on pricing page", !/a person a month|\bper person\b|\bseat\b/i.test(t));
await p.getByTestId("price-calc").scrollIntoViewIfNeeded(); const calc = await p.getByTestId("price-calc").innerText(); ok("calculator has team members and signers sliders", /Team members/.test(calc) && /Different signers/.test(calc));
await p.screenshot({ path: "/tmp/la/pw/pricing.png", fullPage: true });
await b.close(); console.log(out.every(Boolean) ? "ALL PASS" : `FAILED ${out.filter((x) => !x).length}`);
