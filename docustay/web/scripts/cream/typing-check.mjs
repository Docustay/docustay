import { chromium } from "playwright";
const b = await chromium.launch(); const p = await (await b.newContext()).newPage();
for (const base of ["http://localhost:4401", "http://localhost:4402"]) for (const w of [300, 2500]) {
  await p.goto(base + "/sign-pdf/typescript", { waitUntil: "networkidle" }); await p.waitForTimeout(w);
  console.log(base, w, JSON.stringify(await p.evaluate(() => document.body.innerText.split("\n").find((l) => l.includes("npm install @doc")))));
}
await b.close();
