#!/usr/bin/env node
// Makes ONE real sealed, signed PDF on the DEPLOYED sandbox (its worker does the sealing; the local harness has none) and writes it to the path in argv[2]. build-screens.mjs uses it for the Verify and Certificate pictures.
//   node docustay/web/scripts/seal-sample.mjs /tmp/sealed.pdf        (SANDBOX_BASE unset = the deployed sandbox)
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { newWorkspace, closeDb } from "../../../scripts/sandbox/p29-lib.mjs";
import { BASE, uploadPdf } from "../../../scripts/sandbox/lib.mjs";
import { starterInstance, sendStarter, presentedFor } from "../../../scripts/sandbox/p31-starter-lib.mjs";
const out = process.argv[2]; if (!out) throw new Error("usage: seal-sample.mjs <output.pdf>");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const w = await newWorkspace("Northside Studio", "Northside Studio", `office+${Date.now().toString(36)}@northside-studio.example`); const me = w.me;
const st = await starterInstance(me, "services-agreement"); const d = { instanceId: st.instanceId };
const parties = await sendStarter(me, st, "Services agreement", [{ name: "Rosa Alvarez", email: "rosa.alvarez@example.com" }, { name: "Daniel Okafor", email: "daniel.okafor@example.com" }]);
// a hand-drawn-looking signature, made without a browser: a PNG written from a polyline
const { PNG } = await import("pngjs").catch(() => ({ PNG: null }));
let mark;
if (PNG) { const W = 420, H = 140, png = new PNG({ width: W, height: H }); png.data.fill(0); const dot = (x, y) => { for (let a = -2; a <= 2; a += 1) for (let b = -2; b <= 2; b += 1) { const X = Math.round(x + a), Y = Math.round(y + b); if (X >= 0 && X < W && Y >= 0 && Y < H && a * a + b * b <= 5) { const o = (Y * W + X) * 4; png.data[o] = 27; png.data[o + 1] = 26; png.data[o + 2] = 23; png.data[o + 3] = 255; } } };
  for (let i = 0; i <= 600; i += 1) { const t = i / 600, x = 14 + t * 390, y = 78 + Math.sin(t * 18) * 30 * Math.exp(-t * 3) + (Math.floor(t * 18 / Math.PI) % 2 ? -6 : 6); dot(x, y); } for (let i = 0; i <= 300; i += 1) { const t = i / 300; dot(40 + t * 360, 118 - Math.sin(t * Math.PI) * 14); }
  mark = "data:image/png;base64," + PNG.sync.write(png).toString("base64"); }
else mark = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const fill = async (party) => { const presented = await presentedFor(me, st, party.id); const doc = (await st.read()); const mine = (doc.body.fields ?? []).filter((f) => f.role === party.role); const values = {}; const kind = (f) => { const k = f.validation && f.validation !== "none" ? f.validation : f.type; return ["date", "number", "email", "phone"].includes(k) ? k : f.type; };
  for (const f of mine) if (!["signature", "initials", "date_signed"].includes(f.type)) { const k = kind(f); values[f.id] = k === "checkbox" ? "true" : k === "dropdown" ? (f.options?.[0] ?? "") : k === "date" ? "2026-10-05" : k === "number" ? "250" : k === "email" ? "tyler+field@example.com" : k === "phone" ? "+1 415 555 0100" : `Sample ${f.label ?? ""}`.slice(0, 60); }
  const r = await fetch(`${BASE}/api/public/pdf/sign`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ presented, typedName: party.name, consent: true, marks: { signature: mark, initials: mark }, values }) });
  if (r.status >= 300) throw new Error("sign failed " + r.status + " " + (await r.text()).slice(0, 200)); };
for (const party of parties) await fill(party);
let pdf = null; for (let i = 0; i < 60 && !pdf; i += 1) { const g = await me.get(`/api/documents/${d.instanceId}/pdf`); if (g.status === 200 && g.buf.subarray(0, 5).toString() === "%PDF-" && g.buf.includes("/ByteRange")) pdf = g.buf; else await sleep(3000); }
if (!pdf) throw new Error("the sealed PDF never appeared");
fs.writeFileSync(out, pdf); console.log(`wrote ${out} (${pdf.length} bytes)`); await closeDb?.();
