import { chromium } from "playwright";
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await p.goto("http://localhost:4402/", { waitUntil: "networkidle" });
console.log(await p.evaluate(() => { const out = []; for (const el of document.querySelectorAll("body *")) { if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const s = getComputedStyle(n); if ((/url\(/.test(s.backgroundImage) && !/gradient/.test(s.backgroundImage)) || n.tagName === "IMG" || n.tagName === "VIDEO") { out.push(el.tagName + "." + el.className + " :: " + el.textContent.trim().slice(0, 60) + " :: on " + n.tagName + "." + n.className); break; } } } return out.join("\n"); }));
await b.close();
