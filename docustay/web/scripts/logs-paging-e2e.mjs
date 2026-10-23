// Part C on BETA: the API log and Email events page like the Security logs (Previous / Next, a page size, a new search starts on page 1), and the Team page lays out under the full-width rules.
// The server's answers are stood in for (page.route) so every case is exact: five pages of 25, cursors c1..c4.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { BETA_WEB, WS, contextFor } from "./pm-lib.mjs";
const OUT = process.argv[2] ?? "/tmp/logs-e2e"; mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0; const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const browser = await chromium.launch(); const ctx = await contextFor(browser, WS.pro, { width: 1440 }); const page = await ctx.newPage();
const TOTAL = 120;   // rows the pretend server holds
function serve(urlPart, makeRow, listKey) {
  const seen = [];
  page.route(new RegExp(urlPart), async (route) => {
    const u = new URL(route.request().url()); const limit = Number(u.searchParams.get("limit") ?? 50); const cur = u.searchParams.get("cursor"); const start = cur ? Number(cur.slice(1)) : 0;
    seen.push({ limit, cursor: cur, status: u.searchParams.get("status"), path: u.searchParams.get("path") });
    const rows = Array.from({ length: Math.min(limit, TOTAL - start) }, (_, i) => makeRow(start + i));
    const next = start + limit < TOTAL ? `c${start + limit}` : null;
    const body = listKey === "calls" ? { calls: rows, nextCursor: next, retentionDays: 30 } : { data: { emails: rows, nextCursor: next } };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  return seen;
}
const rowsOf = (testid) => page.getByTestId(testid).locator("tbody tr").count();
async function pagerChecks(label, tab, tableId, pagerId, searchAction) {
  await page.goto(`${BETA_WEB}/settings?tab=${tab}`, { waitUntil: "load" }); await page.getByTestId(tableId).waitFor({ timeout: 20000 });
  await page.getByTestId(`${pagerId}-page`).waitFor();
  ok(`${label}: starts on page 1 with 50 rows`, (await page.getByTestId(`${pagerId}-page`).innerText()).includes("1") && (await rowsOf(tableId)) === 50);
  ok(`${label}: Previous is off on page 1`, await page.getByTestId(`${pagerId}-prev`).isDisabled());
  await page.getByTestId(`${pagerId}-next`).click(); await page.waitForTimeout(500);
  ok(`${label}: Next goes to page 2`, (await page.getByTestId(`${pagerId}-page`).innerText()).includes("2"));
  await page.getByTestId(`${pagerId}-next`).click(); await page.waitForTimeout(500);
  ok(`${label}: page 3 is the last page of 120 at 50 (20 rows), Next is off`, (await rowsOf(tableId)) === 20 && await page.getByTestId(`${pagerId}-next`).isDisabled());
  await page.getByTestId(`${pagerId}-prev`).click(); await page.waitForTimeout(500);
  ok(`${label}: Previous returns to page 2 with the same rows`, (await page.getByTestId(`${pagerId}-page`).innerText()).includes("2") && (await rowsOf(tableId)) === 50);
  await page.screenshot({ path: `${OUT}/${label.replace(/\W+/g, "-")}-page2.png` });
  await page.getByTestId(`${pagerId}-size`).selectOption("25"); await page.waitForTimeout(600);
  ok(`${label}: a new page size starts again on page 1 with 25 rows`, (await page.getByTestId(`${pagerId}-page`).innerText()).includes("1") && (await rowsOf(tableId)) === 25);
  await page.getByTestId(`${pagerId}-next`).click(); await page.waitForTimeout(500);
  await searchAction(); await page.waitForTimeout(700);
  ok(`${label}: searching returns to page 1`, (await page.getByTestId(`${pagerId}-page`).innerText()).includes("1"));
}
const apiSeen = serve("/api/product/docustay/api-calls", (i) => ({ id: `a${i}`, at: new Date(Date.now() - i * 60000).toISOString(), keyId: "k1", keyName: "Test key", method: "GET", path: `/api/v1/docs/${i}`, status: 200, durationMs: 12 + (i % 9), requestId: `r${i}` }), "calls");
await pagerChecks("API log", "apilog", "log-table", "log-pager", async () => { await page.getByTestId("log-path").fill("docs"); await page.getByTestId("log-apply").click(); });
ok("API log: the search was sent to the server", apiSeen.some((s) => s.path === "docs" && s.cursor === null));
const mailSeen = serve("/api/documents/email-events", (i) => ({ id: `e${i}`, createdAt: new Date(Date.now() - i * 60000).toISOString(), to: `p${i}@example.test`, kind: "signing_request", subject: `Doc ${i}`, status: i % 7 ? "delivered" : "bounced", documentId: null }), "emails");
await pagerChecks("Email events", "emailevents", "email-events-table", "email-events-pager", async () => { await page.locator('[data-testid="email-events"] select').first().selectOption("delivered"); });
ok("Email events: the filter was sent to the server", mailSeen.some((s) => s.status === "delivered" && s.cursor === null));
// Team page, 1440 and 390: the invite form is a strip above, the table is full width and does not scroll sideways
for (const w of [1440, 1024, 390]) {
  await page.setViewportSize({ width: w, height: 900 }); await page.goto(`${BETA_WEB}/settings?tab=team`, { waitUntil: "load" }); await page.getByTestId("team-table").waitFor({ timeout: 20000 });
  const m = await page.evaluate(() => { const t = document.querySelector('[data-testid="team-table"]').getBoundingClientRect(), f = document.querySelector('[data-testid="team-invite-form"]').getBoundingClientRect(), sc = document.querySelector("[data-scroll-main]"); const mainW = document.querySelector('[data-testid="team-panel"]').getBoundingClientRect().width; return { tw: t.width, fw: f.width, above: f.bottom <= t.top + 1, mainW, sw: sc ? sc.scrollWidth : document.documentElement.scrollWidth, vw: innerWidth }; });
  ok(`Team ${w}: the table fills its column (${Math.round(m.tw)} of ${Math.round(m.mainW)})`, m.tw >= m.mainW - 2, JSON.stringify(m));
  ok(`Team ${w}: the invite form sits above the table`, m.above); ok(`Team ${w}: nothing scrolls sideways`, m.sw <= m.vw + 1, JSON.stringify(m));
  await page.screenshot({ path: `${OUT}/team-${w}.png` });
}
console.log(`\n${pass} pass, ${fail} fail`); await browser.close(); process.exit(fail ? 1 : 0);
