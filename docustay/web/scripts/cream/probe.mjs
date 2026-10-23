import { chromium } from "playwright";
const [url, sel] = process.argv.slice(2);
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await p.goto(url, { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
console.log(JSON.stringify(await p.evaluate((sel) => [...document.querySelectorAll(sel)].slice(0, 4).map((e) => { const s = getComputedStyle(e); let o = 1, n = e; while (n && n.nodeType === 1) { o *= +getComputedStyle(n).opacity; n = n.parentElement; } return { tag: e.tagName, cls: e.className, color: s.color, opacityChain: o, text: e.textContent.slice(0, 40) }; }), sel), null, 1));
await b.close();
