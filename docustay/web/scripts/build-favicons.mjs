// Builds the site's favicon set from the final D (specs/brand/docustay-logo): favicon.svg, favicon.ico (16, 32, 48), 192 and 512 PNG, apple-touch-icon 180 on a white tile. Run by hand when the logo changes; the outputs are committed.
import fs from "node:fs"; import { chromium } from "../../../node_modules/playwright/index.mjs";
const SRC = "static/brand/docustay-favicon-D-violet.svg", OUT = "static/brand";
const svg = fs.readFileSync(SRC, "utf8");
fs.writeFileSync(`${OUT}/favicon-d.svg`, svg);
const b = await chromium.launch(); const page = await b.newPage();
async function png(size, { tile = false, pad = 0.14 } = {}) {
  const inner = Math.round(size * (1 - pad * 2));
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;width:${size}px;height:${size}px;background:${tile ? "#fff" : "transparent"}}body{display:grid;place-items:center}img{width:${inner}px;height:${inner}px;object-fit:contain}</style><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}">`);
  return await page.screenshot({ type: "png", omitBackground: !tile });
}
fs.writeFileSync(`${OUT}/favicon-192.png`, await png(192)); fs.writeFileSync(`${OUT}/favicon-512.png`, await png(512));
fs.writeFileSync(`${OUT}/apple-touch-icon.png`, await png(180, { tile: true, pad: 0.18 }));
// ICO with PNG payloads (valid since Vista): 16, 32, 48
const sizes = [16, 32, 48], imgs = []; for (const s of sizes) imgs.push(await png(s, { pad: 0.06 }));
const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let off = 6 + 16 * sizes.length; const dir = [];
sizes.forEach((s, i) => { const e = Buffer.alloc(16); e.writeUInt8(s, 0); e.writeUInt8(s, 1); e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(imgs[i].length, 8); e.writeUInt32LE(off, 12); off += imgs[i].length; dir.push(e); });
fs.writeFileSync(`${OUT}/favicon.ico`, Buffer.concat([head, ...dir, ...imgs])); await b.close(); console.log("favicons written to", OUT);
