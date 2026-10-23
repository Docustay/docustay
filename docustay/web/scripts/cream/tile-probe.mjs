import { chromium } from "playwright";
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await p.goto("http://localhost:4320/", { waitUntil: "networkidle" });
console.log(await p.evaluate(() => { const t = document.querySelector(".tile.A2"); const s = getComputedStyle(t); const ic = t.querySelector(".ic"); return { cls: t.className, bg: s.backgroundImage, bgc: s.backgroundColor, color: s.color, op: s.opacity, filter: s.filter, parent: t.parentElement.className, icColor: ic && getComputedStyle(ic).color }; }));
await b.close();
