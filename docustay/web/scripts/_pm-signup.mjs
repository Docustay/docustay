import { chromium, contextFor, WS } from "./pm-lib.mjs";
const b = await chromium.launch();
for (const [k, e] of Object.entries(WS)) { const ctx = await contextFor(b, e); console.log(k, "ready"); await ctx.close(); }
await b.close();
