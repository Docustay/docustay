import { chromium } from "playwright";
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await p.goto(process.argv[2], { waitUntil: "networkidle" }); await p.waitForTimeout(1200);
console.log(await p.evaluate((t) => { const el = [...document.querySelectorAll("span")].find((e) => e.textContent.trim() === t); const out = []; for (let n = el; n && n.tagName !== "BODY"; n = n.parentElement) { const s = getComputedStyle(n); out.push(`${n.tagName}.${n.className} bg=${s.backgroundColor} img=${s.backgroundImage.slice(0, 80)} op=${s.opacity}`); } return out.slice(0, 5).join("\n"); }, process.argv[3]));
await b.close();
